-- Tailmance migration 205: the health-record check never involves a veterinarian, clinic or registry (2026-10-05).
--
-- Product decision: the AI-assisted check reads the uploaded vaccination-booklet pages and only compares
-- the dated entries (vaccines, internal and external parasite treatment) with the published schedule for
-- the pet's species and age. It does not verify, approve or look up any veterinarian, clinic or credential,
-- and it is not a statement about a pet's health. Everything that modelled a "veterinarian verified" state
-- is removed: the signal, the clinic and integrity columns, the summary flag, the trust badge payload,
-- the discovery filter, the mating-eligibility condition and the match-vector slot that used it.
--
-- Vaccination currency replaces it: a document check carries an expiry (the earliest due date it found), and
-- the "vaccinations complete" state is effective only while that check is current.

-- 1. Attestation table: drop veterinarian/clinic/credential concepts -----------------------------------------
drop trigger if exists health_verification_attestation_recompute on public.health_verification_attestations;
drop trigger if exists trg_pet_match_embedding_health on public.pet_health_summary;
drop function if exists public.health_verification_attestation_recompute_trigger();

delete from public.health_verification_attestations where signal='veterinarian_verified';

do $$ declare c record; begin
  for c in select conname from pg_constraint
           where conrelid='public.health_verification_attestations'::regclass and contype='c' loop
    execute format('alter table public.health_verification_attestations drop constraint %I',c.conname);
  end loop;
end $$;

drop index if exists public.health_verification_provider_event_unique;
alter table public.health_verification_attestations drop column if exists clinic_public_id;
alter table public.health_verification_attestations drop column if exists integrity_status;
update public.health_verification_attestations set method='ai_document_check' where method='provider_ocr_signature';

alter table public.health_verification_attestations
  add constraint health_attestation_signal_check check (signal in ('microchip_verified','genetic_screening_available','pedigree_available','vaccination_complete','neutered')),
  add constraint health_attestation_method_check check (method in ('manual_document_review','ai_document_check')),
  add constraint health_attestation_provider_code_check check (provider_code is null or provider_code ~ '^[A-Za-z0-9._-]{2,80}$'),
  add constraint health_attestation_reference_hash_check check (provider_reference_sha256 is null or provider_reference_sha256 ~ '^[0-9a-f]{64}$'),
  add constraint health_attestation_expiry_check check (expires_at is null or expires_at > verified_at),
  add constraint health_attestation_method_evidence_check check (
    (method='manual_document_review' and provider_code is null and provider_reference_sha256 is null)
    or (method='ai_document_check' and provider_code is not null and provider_reference_sha256 is not null)
  );

create unique index health_attestation_ai_event_unique
  on public.health_verification_attestations(health_document_id,signal,provider_code,provider_reference_sha256)
  where method='ai_document_check';

-- 2. Currency helpers -----------------------------------------------------------------------------------------
create or replace function public.has_current_vaccination_check(p_pet_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.health_verification_attestations a
    where a.pet_id=p_pet_id
      and a.signal='vaccination_complete'
      and a.revoked_at is null
      and a.verified_at<=now()
      and (a.expires_at is null or a.expires_at>now())
  )
$$;
revoke all on function public.has_current_vaccination_check(uuid) from public,anon,authenticated;

create or replace function public.effective_vaccination_complete(p_pet_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select h.vaccination_status='complete' from public.pet_health_summary h where h.pet_id=p_pet_id),false)
    and (
      public.has_current_vaccination_check(p_pet_id)
      or not exists(select 1 from public.health_verification_attestations a where a.pet_id=p_pet_id and a.signal='vaccination_complete' and a.revoked_at is null)
    )
$$;
revoke all on function public.effective_vaccination_complete(uuid) from public,anon,authenticated;

-- 3. Attestation, review and revoke RPCs ---------------------------------------------------------------------
drop function if exists public.service_apply_health_verification_attestation(uuid,text,text,text,text,text,text,timestamptz,timestamptz);
create or replace function public.service_apply_health_verification_attestation(
  p_health_document_id uuid,
  p_signal text,
  p_method text,
  p_provider_code text default null,
  p_provider_reference_sha256 text default null,
  p_verified_at timestamptz default now(),
  p_expires_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_pet_id uuid;
  v_attestation_id uuid;
  v_now timestamptz:=coalesce(p_verified_at,now());
begin
  if p_signal not in ('microchip_verified','genetic_screening_available','pedigree_available','vaccination_complete','neutered') then raise exception 'invalid_health_signal'; end if;
  if p_method not in ('manual_document_review','ai_document_check') then raise exception 'invalid_health_verification_method'; end if;
  select pet_id into v_pet_id from public.health_documents where id=p_health_document_id for update;
  if v_pet_id is null then raise exception 'health_document_not_found'; end if;

  if p_method='manual_document_review' then
    if p_provider_code is not null or p_provider_reference_sha256 is not null then raise exception 'manual_health_attestation_cannot_claim_provider_evidence'; end if;
    update public.health_verification_attestations
      set revoked_at=now()
      where health_document_id=p_health_document_id and signal=p_signal and method='manual_document_review' and revoked_at is null;
    insert into public.health_verification_attestations(pet_id,health_document_id,signal,method,verified_at,expires_at)
      values(v_pet_id,p_health_document_id,p_signal,p_method,v_now,p_expires_at)
      returning id into v_attestation_id;
  else
    if p_provider_code is null or p_provider_code !~ '^[A-Za-z0-9._-]{2,80}$' then raise exception 'provider_code_invalid'; end if;
    if p_provider_reference_sha256 is null or p_provider_reference_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'provider_reference_hash_invalid'; end if;
    if p_signal not in ('vaccination_complete') then raise exception 'ai_document_check_signal_not_allowed'; end if;
    insert into public.health_verification_attestations(pet_id,health_document_id,signal,method,provider_code,provider_reference_sha256,verified_at,expires_at)
      values(v_pet_id,p_health_document_id,p_signal,p_method,p_provider_code,p_provider_reference_sha256,v_now,p_expires_at)
      on conflict (health_document_id,signal,provider_code,provider_reference_sha256) where method='ai_document_check'
      do update set verified_at=excluded.verified_at,expires_at=excluded.expires_at,revoked_at=null
      returning id into v_attestation_id;
  end if;

  if p_signal='vaccination_complete' then
    update public.pet_health_summary set vaccination_status='complete' where pet_id=v_pet_id;
  elsif p_signal='neutered' then
    update public.pet_health_summary set neutered=true where pet_id=v_pet_id;
  elsif p_signal='microchip_verified' then
    update public.pet_health_summary set microchip_verified=true where pet_id=v_pet_id;
  elsif p_signal='genetic_screening_available' then
    update public.pet_health_summary set genetic_screening_available=true where pet_id=v_pet_id;
  elsif p_signal='pedigree_available' then
    update public.pet_health_summary set pedigree_available=true where pet_id=v_pet_id;
  end if;

  update public.health_documents set verification_status='verified'::public.verification_state,verified_at=v_now where id=p_health_document_id;
  return jsonb_build_object('ok',true,'attestationId',v_attestation_id,'petId',v_pet_id,'signal',p_signal,'method',p_method);
end $$;
revoke all on function public.service_apply_health_verification_attestation(uuid,text,text,text,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.service_apply_health_verification_attestation(uuid,text,text,text,text,timestamptz,timestamptz) to service_role;

create or replace function public.service_revoke_health_document_attestations(p_health_document_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_pet_id uuid; v_count integer;
begin
  select pet_id into v_pet_id from public.health_documents where id=p_health_document_id;
  if v_pet_id is null then raise exception 'health_document_not_found'; end if;
  update public.health_verification_attestations set revoked_at=coalesce(revoked_at,now()) where health_document_id=p_health_document_id and revoked_at is null;
  get diagnostics v_count=row_count;
  return jsonb_build_object('ok',true,'revoked',v_count,'petId',v_pet_id);
end $$;
revoke all on function public.service_revoke_health_document_attestations(uuid) from public,anon,authenticated;
grant execute on function public.service_revoke_health_document_attestations(uuid) to service_role;

create or replace function public.service_review_health_document(
  p_health_document_id uuid,
  p_approved boolean,
  p_signal text default null,
  p_reviewed_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_pet_id uuid; v_result jsonb;
begin
  select pet_id into v_pet_id from public.health_documents where id=p_health_document_id for update;
  if v_pet_id is null then raise exception 'health_document_not_found'; end if;
  if not p_approved then
    update public.health_documents set verification_status='rejected',verified_at=coalesce(p_reviewed_at,now()) where id=p_health_document_id;
    update public.health_verification_attestations set revoked_at=coalesce(revoked_at,now()) where health_document_id=p_health_document_id and revoked_at is null;
    return jsonb_build_object('ok',true,'petId',v_pet_id,'status','rejected');
  end if;
  if p_signal is null then
    update public.health_documents set verification_status='verified',verified_at=coalesce(p_reviewed_at,now()) where id=p_health_document_id;
    return jsonb_build_object('ok',true,'petId',v_pet_id,'status','verified');
  end if;
  v_result:=public.service_apply_health_verification_attestation(p_health_document_id,p_signal,'manual_document_review',null,null,coalesce(p_reviewed_at,now()),null);
  return v_result || jsonb_build_object('status','verified');
end $$;
revoke all on function public.service_review_health_document(uuid,boolean,text,timestamptz) from public,anon,authenticated;
grant execute on function public.service_review_health_document(uuid,boolean,text,timestamptz) to service_role;

-- 4. AI document-check result -------------------------------------------------------------------------------
-- The worker decides from the pages' text and the schedule; the database re-checks the confidence bands and never
-- lets a low-confidence or non-vaccination signal become an approval.
alter table public.ai_inference_logs drop constraint if exists ai_inference_logs_system_name_check;
update public.ai_inference_logs set system_name='health_document_check' where system_name='health_ocr_registry';
alter table public.ai_inference_logs add constraint ai_inference_logs_system_name_check check (system_name in ('health_document_check'));

drop function if exists public.service_apply_health_ai_result(uuid,text,text,text,text,numeric,text,jsonb,integer);
create or replace function public.service_apply_health_ai_result(
  p_health_document_id uuid,
  p_provider_code text,
  p_provider_reference_sha256 text,
  p_model_version text,
  p_document_confidence numeric,
  p_outcome text,
  p_reason_code text,
  p_signals jsonb,
  p_latency_ms integer default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_doc public.health_documents;
  v_job public.health_ai_jobs;
  v_signal jsonb;
  v_signal_name text;
  v_signal_conf numeric;
  v_decision text;
  v_signal_count integer;
  v_verified_at timestamptz;
  v_expires_at timestamptz;
  v_seen_signals text[]:=array[]::text[];
  v_now timestamptz:=now();
begin
  if p_provider_code is null or p_provider_code !~ '^[A-Za-z0-9._-]{2,80}$' then raise exception 'health_ai_provider_invalid'; end if;
  if p_provider_reference_sha256 is null or p_provider_reference_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'health_ai_reference_hash_invalid'; end if;
  if p_model_version is null or char_length(trim(p_model_version)) not between 1 and 120 then raise exception 'health_ai_model_invalid'; end if;
  if p_document_confidence is null or p_document_confidence<0 or p_document_confidence>1 then raise exception 'health_ai_confidence_invalid'; end if;
  if p_outcome is null or p_outcome not in ('approved','manual_review','rejected') then raise exception 'health_ai_outcome_invalid'; end if;
  if p_reason_code is null or p_reason_code !~ '^[a-z0-9_]{1,60}$' then raise exception 'health_ai_reason_invalid'; end if;
  if p_latency_ms is not null and (p_latency_ms<0 or p_latency_ms>120000) then raise exception 'health_ai_latency_invalid'; end if;
  if jsonb_typeof(p_signals)<>'array' then raise exception 'health_ai_signals_invalid'; end if;
  v_signal_count:=jsonb_array_length(p_signals);
  if v_signal_count>16 or (p_outcome='approved' and v_signal_count<1) then raise exception 'health_ai_signals_invalid'; end if;

  select * into v_doc from public.health_documents where id=p_health_document_id for update;
  if v_doc.id is null then raise exception 'health_document_not_found'; end if;
  select * into v_job from public.health_ai_jobs where health_document_id=p_health_document_id for update;
  if v_job.health_document_id is null or v_job.status<>'processing' then raise exception 'health_ai_job_not_claimed'; end if;
  if v_doc.verification_status<>'pending' then
    update public.health_ai_jobs set status=case when v_doc.verification_status='verified' then 'auto_verified' else 'rejected' end,completed_at=coalesce(completed_at,v_now),updated_at=v_now where health_document_id=p_health_document_id;
    return jsonb_build_object('decision','already_finalized');
  end if;

  for v_signal in select value from jsonb_array_elements(p_signals) loop
    v_verified_at:=null;
    v_expires_at:=null;
    if jsonb_typeof(v_signal)<>'object' or (v_signal-'signal'-'confidence'-'verifiedAt'-'expiresAt')<>'{}'::jsonb then
      raise exception 'health_ai_signal_schema_invalid';
    end if;
    v_signal_name:=nullif(trim(v_signal->>'signal'),'');
    v_signal_conf:=nullif(v_signal->>'confidence','')::numeric;
    if v_signal_name<>'vaccination_complete' or v_signal_conf is null or v_signal_conf<0 or v_signal_conf>1 then
      raise exception 'health_ai_signal_invalid';
    end if;
    if v_signal_name=any(v_seen_signals) then raise exception 'health_ai_signal_duplicate'; end if;
    v_seen_signals:=array_append(v_seen_signals,v_signal_name);
    if v_signal ? 'verifiedAt' and nullif(v_signal->>'verifiedAt','') is not null then
      v_verified_at:=(v_signal->>'verifiedAt')::timestamptz;
      if v_verified_at>v_now+interval '5 minutes' then raise exception 'health_ai_signal_time_invalid'; end if;
    end if;
    if v_signal ? 'expiresAt' and nullif(v_signal->>'expiresAt','') is not null then
      v_expires_at:=(v_signal->>'expiresAt')::timestamptz;
      if v_expires_at<=coalesce(v_verified_at,v_now) then raise exception 'health_ai_signal_expiry_invalid'; end if;
    end if;
  end loop;

  if p_document_confidence<0.65 or p_outcome='rejected' then
    v_decision:='rejected';
    update public.health_documents set verification_status='rejected',verified_at=null where id=p_health_document_id;
    update public.moderation_items set status='rejected',manual_review_required=false,reviewed_at=v_now,next_attempt_at=null,
      last_error_code=case when p_document_confidence<0.65 then 'health_ai_low_confidence' else 'health_ai_not_a_health_record' end,
      reason='The submitted pages could not be read as a vaccination booklet.'
    where target_type='health_document' and target_id=p_health_document_id;
    update public.health_ai_jobs set status='rejected',completed_at=v_now,claimed_at=null,last_error_code=null,updated_at=v_now where health_document_id=p_health_document_id;
  elsif p_outcome<>'approved' or p_document_confidence<=0.85
     or exists(select 1 from jsonb_array_elements(p_signals) s where (s->>'confidence')::numeric<=0.85) then
    v_decision:='manual_review';
    update public.moderation_items set status='pending',manual_review_required=true,reviewed_at=null,next_attempt_at=null,
      last_error_code='health_ai_manual_review_required',reason=null
    where target_type='health_document' and target_id=p_health_document_id;
    update public.health_ai_jobs set status='manual_review',completed_at=v_now,claimed_at=null,last_error_code=null,updated_at=v_now where health_document_id=p_health_document_id;
  else
    v_decision:='auto_verified';
    for v_signal in select value from jsonb_array_elements(p_signals) loop
      perform public.service_apply_health_verification_attestation(
        p_health_document_id,
        v_signal->>'signal',
        'ai_document_check',
        p_provider_code,
        p_provider_reference_sha256,
        coalesce(nullif(v_signal->>'verifiedAt','')::timestamptz,v_now),
        nullif(v_signal->>'expiresAt','')::timestamptz
      );
    end loop;
    update public.moderation_items set status='approved',manual_review_required=false,reviewed_at=v_now,next_attempt_at=null,last_error_code=null,reason=null
    where target_type='health_document' and target_id=p_health_document_id;
    update public.health_ai_jobs set status='auto_verified',completed_at=v_now,claimed_at=null,last_error_code=null,updated_at=v_now where health_document_id=p_health_document_id;
  end if;

  insert into public.ai_inference_logs(system_name,target_type,target_id,provider_code,model_version,decision,confidence,latency_ms,signal_count,metadata)
  values('health_document_check','health_document',p_health_document_id,p_provider_code,trim(p_model_version),v_decision,p_document_confidence,p_latency_ms,v_signal_count,
    jsonb_build_object('reasonCode',p_reason_code,'thresholdPolicy','gt_0.85_auto_0.65_to_0.85_manual_lt_0.65_reject'));

  return jsonb_build_object('decision',v_decision,'signalCount',v_signal_count);
end $$;
revoke all on function public.service_apply_health_ai_result(uuid,text,text,text,numeric,text,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.service_apply_health_ai_result(uuid,text,text,text,numeric,text,text,jsonb,integer) to service_role;

-- 5. One check per uploaded booklet: wait for the last page, and never exceed the provider's free monthly quota ---
create or replace function public.enqueue_health_ai_job()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.health_ai_jobs(health_document_id,status,attempts,not_before,claimed_at,completed_at,last_error_code,updated_at)
  values(new.id,'pending',0,now()+interval '3 minutes',null,null,null,now())
  on conflict(health_document_id) do update set
    status=case when public.health_ai_jobs.status='auto_verified' then public.health_ai_jobs.status else 'pending' end,
    not_before=case when public.health_ai_jobs.status='auto_verified' then public.health_ai_jobs.not_before else now()+interval '3 minutes' end,
    claimed_at=null,
    completed_at=case when public.health_ai_jobs.status='auto_verified' then public.health_ai_jobs.completed_at else null end,
    last_error_code=case when public.health_ai_jobs.status='auto_verified' then public.health_ai_jobs.last_error_code else null end,
    updated_at=now();
  -- Every further page of the same booklet moves the whole booklet's check back, so the check runs once, after the last upload.
  update public.health_ai_jobs j set not_before=now()+interval '3 minutes',updated_at=now()
  where j.status in ('pending','failed')
    and j.health_document_id in (select d.id from public.health_documents d where d.pet_id=new.pet_id and d.verification_status='pending');
  return new;
end $$;
revoke all on function public.enqueue_health_ai_job() from public,anon,authenticated;

create table if not exists public.health_ai_monthly_units (
  month_start date primary key,
  units integer not null default 0 check (units>=0),
  updated_at timestamptz not null default now()
);
alter table public.health_ai_monthly_units enable row level security;
revoke all on table public.health_ai_monthly_units from public,anon,authenticated;
grant select,insert,update,delete on table public.health_ai_monthly_units to service_role;

create or replace function public.service_consume_health_ai_units(p_units integer,p_monthly_cap integer)
returns integer language plpgsql security definer set search_path='' as $$
declare v_month date:=date_trunc('month',now() at time zone 'utc')::date; v_total integer;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  -- Positive values reserve provider units before a call; a negative value returns units after a failed call.
  if p_units is null or p_units=0 or p_units not between -64 and 64 then raise exception 'health_ai_units_invalid'; end if;
  if p_monthly_cap is null or p_monthly_cap not between 1 and 1000000 then raise exception 'health_ai_cap_invalid'; end if;
  insert into public.health_ai_monthly_units(month_start,units) values(v_month,0) on conflict(month_start) do nothing;
  update public.health_ai_monthly_units set units=greatest(0,units+p_units),updated_at=now()
    where month_start=v_month and (p_units<0 or units+p_units<=p_monthly_cap)
    returning units into v_total;
  if v_total is null then raise exception 'health_ai_monthly_units_exhausted'; end if;
  return v_total;
end $$;
revoke all on function public.service_consume_health_ai_units(integer,integer) from public,anon,authenticated;
grant execute on function public.service_consume_health_ai_units(integer,integer) to service_role;

-- 6. Everything that exposed or required the veterinarian flag ------------------------------------------------
create or replace function public.mating_pair_profile_signals_eligible(p_from_pet_id uuid,p_to_pet_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.current_mating_feature_enabled()
    and exists(
      select 1
      from public.pets a
      join public.pet_health_summary ah on ah.pet_id=a.id
      join public.pets b on b.id=p_to_pet_id
      join public.pet_health_summary bh on bh.pet_id=b.id
      where a.id=p_from_pet_id
        and a.species='dog' and b.species='dog' and a.sex<>b.sex
        and ah.neutered is false and bh.neutered is false
        and public.effective_vaccination_complete(a.id) and public.effective_vaccination_complete(b.id)
        and exists(select 1 from public.pet_purposes x where x.pet_id=a.id and x.purpose='mating')
        and exists(select 1 from public.pet_purposes x where x.pet_id=b.id and x.purpose='mating')
    );
$$;
revoke all on function public.mating_pair_profile_signals_eligible(uuid,uuid) from public,anon,authenticated;

create or replace function public.discovery_filters_use_premium_features(p_filters jsonb)
returns boolean language sql immutable set search_path='' as $$
  select
    jsonb_array_length(coalesce(p_filters->'sizes','[]'::jsonb))>0
    or jsonb_array_length(coalesce(p_filters->'energyLevels','[]'::jsonb))>0
    or coalesce((p_filters->>'vaccinatedOnly')::boolean,false)
    or coalesce((p_filters->>'profileVerifiedOnly')::boolean,false)
    or coalesce((p_filters->>'ownerVerifiedOnly')::boolean,false)
    or coalesce((p_filters->>'microchipVerifiedOnly')::boolean,false)
    or coalesce((p_filters->>'geneticScreeningOnly')::boolean,false)
    or coalesce((p_filters->>'pedigreeOnly')::boolean,false);
$$;
revoke all on function public.discovery_filters_use_premium_features(jsonb) from public,anon,authenticated;

create or replace function public.pet_json(p_pet_id uuid,p_viewer_pet_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'id',p.id,'name',p.name,'species',p.species,'breed',p.breed,'sex',p.sex,'birthDate',p.birth_date,
    'ageYears',case when p.birth_date is null then null else extract(year from age(current_date,p.birth_date))::int end,
    'size',p.size,'weightKg',p.weight_kg,'energyLevel',p.energy_level,'temperamentTags',p.temperament_tags,
    'city',p.city,'district',p.district,'neighborhood',p.neighborhood,
    'purposes',coalesce((select jsonb_agg(pp.purpose order by pp.purpose) from public.pet_purposes pp where pp.pet_id=p.id and (pp.purpose<>'mating' or (p.species='dog' and public.current_mating_feature_enabled()))),'[]'::jsonb),
    'prompts',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'promptKey',q.prompt_key,'answer',q.answer,'sortOrder',q.sort_order) order by q.sort_order) from public.pet_prompts q where q.pet_id=p.id),'[]'::jsonb),
    'bio',p.bio,'profileVerified',p.profile_verified,'ownerVerified',u.identity_verified,
    'photos',coalesce((select jsonb_agg(jsonb_build_object('id',ph.id,'url',ph.storage_path,'sortOrder',ph.sort_order,'moderationStatus',ph.moderation_status) order by ph.sort_order) from public.pet_photos ph where ph.pet_id=p.id and (ph.moderation_status='approved' or p.owner_id=auth.uid())),'[]'::jsonb),
    'health',jsonb_build_object('vaccinationStatus',case when public.effective_vaccination_complete(p.id) then 'complete'::public.vaccination_status when h.vaccination_status='complete' then 'unknown'::public.vaccination_status else coalesce(h.vaccination_status,'unknown'::public.vaccination_status) end,'neutered',h.neutered,'microchipVerified',coalesce(h.microchip_verified,false),'geneticScreeningAvailable',coalesce(h.genetic_screening_available,false),'pedigreeAvailable',coalesce(h.pedigree_available,false)),
    'followersCount',(select count(*) from public.follows f where f.to_pet_id=p.id),
    'followingCount',(select count(*) from public.follows f where f.from_pet_id=p.id),
    'isFollowing',case when p_viewer_pet_id is null then false else exists(select 1 from public.follows f where f.from_pet_id=p_viewer_pet_id and f.to_pet_id=p.id) end,
    'isFavorite',case when p_viewer_pet_id is null then false else exists(select 1 from public.pet_favorites f where f.from_pet_id=p_viewer_pet_id and f.to_pet_id=p.id) end
  ) from public.pets p join public.users u on u.id=p.owner_id left join public.pet_health_summary h on h.pet_id=p.id where p.id=p_pet_id;
$$;
revoke all on function public.pet_json(uuid,uuid) from public,anon,authenticated;

create or replace function public.get_pet_health_details(p_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.owns_pet(p_pet_id) then jsonb_build_object(
    'summary',jsonb_build_object(
      'vaccinationStatus',case when public.effective_vaccination_complete(p_pet_id) then 'complete'::public.vaccination_status when h.vaccination_status='complete' then 'unknown'::public.vaccination_status else coalesce(h.vaccination_status,'unknown'::public.vaccination_status) end,
      'neutered',h.neutered,'microchipVerified',coalesce(h.microchip_verified,false),
      'geneticScreeningAvailable',coalesce(h.genetic_screening_available,false),
      'pedigreeAvailable',coalesce(h.pedigree_available,false),
      'documentCheck',jsonb_build_object(
        'approved',public.has_current_vaccination_check(p_pet_id),
        'validUntil',(select min(a.expires_at) from public.health_verification_attestations a
          where a.pet_id=p_pet_id and a.signal='vaccination_complete' and a.revoked_at is null and a.verified_at<=now() and (a.expires_at is null or a.expires_at>now()))
      )
    ),
    'vaccinations',coalesce((select jsonb_agg(jsonb_build_object(
      'id',v.id,'vaccineName',v.vaccine_name,'doseDate',v.dose_date,'nextDueDate',v.next_due_date,
      'verificationStatus',v.verification_status
    ) order by coalesce(v.next_due_date,v.dose_date) desc nulls last) from public.pet_vaccinations v where v.pet_id=p_pet_id),'[]'::jsonb),
    'documents',coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.id,'documentType',d.document_type,'verificationStatus',d.verification_status,'createdAt',d.created_at
    ) order by d.created_at desc) from public.health_documents d where d.pet_id=p_pet_id),'[]'::jsonb),
    'attestations',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'healthDocumentId',a.health_document_id,'signal',a.signal,'method',a.method,
      'providerCode',a.provider_code,'verifiedAt',a.verified_at,'expiresAt',a.expires_at,'revokedAt',a.revoked_at
    ) order by a.verified_at desc,a.id desc) from public.health_verification_attestations a where a.pet_id=p_pet_id),'[]'::jsonb)
  ) else null end
  from public.pet_health_summary h where h.pet_id=p_pet_id;
$$;
revoke all on function public.get_pet_health_details(uuid) from public,anon;
grant execute on function public.get_pet_health_details(uuid) to authenticated;

create or replace function public.pet_match_feature_source(p_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'schemaVersion',2,
    'petId',p.id,
    'species',p.species::text,
    'breed',public.normalize_search_text(p.breed),
    'birthDate',p.birth_date,
    'size',p.size::text,
    'weightKg',p.weight_kg,
    'energyLevel',p.energy_level,
    'temperamentTags',coalesce((select jsonb_agg(public.normalize_search_text(t) order by public.normalize_search_text(t)) from unnest(p.temperament_tags) t),'[]'::jsonb),
    'purposes',coalesce((select jsonb_agg(pp.purpose::text order by pp.purpose::text) from public.pet_purposes pp where pp.pet_id=p.id),'[]'::jsonb),
    'health',jsonb_build_object(
      'vaccinationComplete',public.effective_vaccination_complete(p.id),
      'documentCheckCurrent',public.has_current_vaccination_check(p.id),
      'microchipVerified',coalesce(h.microchip_verified,false),
      'geneticScreeningAvailable',coalesce(h.genetic_screening_available,false),
      'pedigreeAvailable',coalesce(h.pedigree_available,false)
    ),
    'profileVerified',p.profile_verified
  )
  from public.pets p
  left join public.pet_health_summary h on h.pet_id=p.id
  where p.id=p_pet_id;
$$;
revoke all on function public.pet_match_feature_source(uuid) from public,anon,authenticated;
grant execute on function public.pet_match_feature_source(uuid) to service_role;

create or replace function public.compute_pet_match_embedding(p_pet_id uuid,p_query boolean default false)
returns extensions.vector language plpgsql stable security definer set search_path='' as $$
declare
  p public.pets;
  h public.pet_health_summary;
  v_age numeric:=0;
  v_weight numeric:=0;
  v_tag_count numeric:=1;
  v_breed_bucket int:=0;
  v_values numeric[]:=array[]::numeric[];
  i int;
  v_count numeric;
begin
  select * into p from public.pets where id=p_pet_id;
  if p.id is null then raise exception 'pet_not_found'; end if;
  select * into h from public.pet_health_summary where pet_id=p_pet_id;

  v_age:=case when p.birth_date is null then 0 else least(extract(year from age(current_date,p.birth_date))::numeric,20)/20 end;
  v_weight:=case when p.weight_kg is null then 0 else least(p.weight_kg,80)/80 end;
  v_tag_count:=greatest(coalesce(array_length(p.temperament_tags,1),0),1);
  v_breed_bucket:=abs(hashtextextended(public.normalize_search_text(p.breed),0)%8)::int;

  -- 1-3: continuous observed traits.
  v_values:=v_values||array[
    coalesce(p.energy_level,3)::numeric/5,
    v_age,
    v_weight
  ];
  -- 4-8: size one-hot.
  foreach i in array array[0,1,2,3,4] loop
    v_values:=v_values||case when array_position(array['mini','small','medium','large','giant'],p.size::text)-1=i then array[1::numeric] else array[0::numeric] end;
  end loop;
  -- 9-13: health-first candidate quality. Query vectors intentionally seek checked state.
  if p_query then
    v_values:=v_values||array[1::numeric,1,1,1,1];
  else
    v_values:=v_values||array[
      case when public.effective_vaccination_complete(p.id) then 1 else 0 end,
      case when public.has_current_vaccination_check(p.id) then 1 else 0 end,
      case when coalesce(h.microchip_verified,false) then 1 else 0 end,
      case when coalesce(h.genetic_screening_available,false) then 1 else 0 end,
      case when coalesce(h.pedigree_available,false) then 1 else 0 end
    ];
  end if;
  -- 14-17: declared pet purposes. These are social intent, not owner identity.
  foreach i in array array[0,1,2,3] loop
    v_values:=v_values||case when exists(
      select 1 from public.pet_purposes pp where pp.pet_id=p.id
      and pp.purpose::text=(array['socialize','playmate','walk','mating'])[i+1]
    ) then array[1::numeric] else array[0::numeric] end;
  end loop;
  -- 18-25: privacy-safe breed identity buckets. Breed semantics are never invented.
  foreach i in array array[0,1,2,3,4,5,6,7] loop
    v_values:=v_values||case when v_breed_bucket=i then array[1::numeric] else array[0::numeric] end;
  end loop;
  -- 26-37: temperament tag feature hashing. Only user-declared normalized tags are used.
  foreach i in array array[0,1,2,3,4,5,6,7,8,9,10,11] loop
    select count(*)::numeric into v_count
    from unnest(p.temperament_tags) t
    where abs(hashtextextended(public.normalize_search_text(t),0)%12)::int=i;
    v_values:=v_values||array[least(v_count/v_tag_count,1)];
  end loop;
  -- 38: verified profile quality. Query vectors prefer verified profiles.
  v_values:=v_values||array[case when p_query or p.profile_verified then 1::numeric else 0 end];
  -- 39-40: species anchors preserve future dog/cat separation without owner metadata.
  v_values:=v_values||array[
    case when p.species='dog' then 1::numeric else 0 end,
    case when p.species='cat' then 1::numeric else 0 end
  ];

  if array_length(v_values,1)<>40 then raise exception 'pet_match_embedding_dimension_invalid'; end if;
  return ('['||array_to_string(v_values,',')||']')::extensions.vector;
end $$;
revoke all on function public.compute_pet_match_embedding(uuid,boolean) from public,anon,authenticated;
grant execute on function public.compute_pet_match_embedding(uuid,boolean) to service_role;

create or replace function public.discover_pets_v86(p_active_pet_id uuid,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_me public.pets;
  v_private public.pet_private;
  v_me_health public.pet_health_summary;
  v_result jsonb;
  v_max_distance double precision;
begin
  if not public.owns_pet(p_active_pet_id) then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.pet_purposes pp where pp.pet_id=p_active_pet_id and pp.purpose<>'mating')
     and not (public.current_mating_feature_enabled() and exists(select 1 from public.pet_purposes pp where pp.pet_id=p_active_pet_id and pp.purpose='mating'))
  then raise exception 'profile_purpose_unavailable'; end if;
  perform public.validate_discovery_filters(p_filters);
  select * into v_me from public.pets where id=p_active_pet_id;
  if v_me.species<>'dog' then return '[]'::jsonb; end if;
  select * into v_private from public.pet_private where pet_id=p_active_pet_id;
  select * into v_me_health from public.pet_health_summary where pet_id=p_active_pet_id;
  v_max_distance:=case when nullif(p_filters->>'maxDistanceKm','') is null then null
    else greatest(1::double precision,ceil(nullif(p_filters->>'maxDistanceKm','')::double precision)) end;

  with candidates as (
    select
      p.id,pp.location as candidate_location,
      least(100,35
        + case when p.species=v_me.species then 15 else 0 end
        + case when p.size=v_me.size then 8 else 0 end
        + least(20,(select count(*)*7 from public.pet_purposes a join public.pet_purposes b on a.purpose=b.purpose where a.pet_id=p_active_pet_id and b.pet_id=p.id and a.purpose<>'mating'))
      )::int as compatibility_score
    from public.pets p
    join public.users u on u.id=p.owner_id and u.suspended_at is null and u.paused_at is null and u.discoverable
    left join public.pet_private pp on pp.pet_id=p.id
    left join public.pet_health_summary h on h.pet_id=p.id
    where p.id<>p_active_pet_id and p.owner_id<>auth.uid() and p.discovery_enabled and p.moderation_status='approved'
      and p.species='dog'
      and (exists(select 1 from public.pet_purposes enabled_purpose where enabled_purpose.pet_id=p.id and enabled_purpose.purpose<>'mating')
        or (coalesce(p_filters->'purposes','[]'::jsonb) ? 'mating' and public.mating_pair_profile_signals_eligible(p_active_pet_id,p.id)))
      and (select count(*) from public.pet_photos ph where ph.pet_id=p.id and ph.moderation_status='approved')=3
      and (not u.incognito or exists(select 1 from public.pet_likes il where il.from_pet_id=p.id and il.to_pet_id=p_active_pet_id))
      and not public.is_blocked(p_active_pet_id,p.id)
      and not exists(select 1 from public.pet_passes ps where ps.from_pet_id=p_active_pet_id and ps.to_pet_id=p.id and ps.created_at>now()-interval '30 days')
      and not exists(select 1 from public.pet_matches m where m.unmatched_at is null and m.pet_low_id=least(p_active_pet_id,p.id) and m.pet_high_id=greatest(p_active_pet_id,p.id))
      and (coalesce(p_filters->>'species','all')='all' or p.species::text=p_filters->>'species')
      and (coalesce(p_filters->>'sex','all')='all' or p.sex::text=p_filters->>'sex')
      and (jsonb_array_length(coalesce(p_filters->'sizes','[]'::jsonb))=0 or p.size::text in (select jsonb_array_elements_text(p_filters->'sizes')))
      and (jsonb_array_length(coalesce(p_filters->'breeds','[]'::jsonb))=0 or public.normalize_search_text(p.breed) in (select public.normalize_search_text(x) from jsonb_array_elements_text(p_filters->'breeds') x))
      and (nullif(p_filters->>'minAge','') is null or (p.birth_date is not null and extract(year from age(current_date,p.birth_date)) >= (p_filters->>'minAge')::int))
      and (nullif(p_filters->>'maxAge','') is null or (p.birth_date is not null and extract(year from age(current_date,p.birth_date)) <= (p_filters->>'maxAge')::int))
      and (nullif(p_filters->>'minWeightKg','') is null or (p.weight_kg is not null and p.weight_kg >= (p_filters->>'minWeightKg')::numeric))
      and (nullif(p_filters->>'maxWeightKg','') is null or (p.weight_kg is not null and p.weight_kg <= (p_filters->>'maxWeightKg')::numeric))
      and (jsonb_array_length(coalesce(p_filters->'energyLevels','[]'::jsonb))=0 or p.energy_level::text in (select jsonb_array_elements_text(p_filters->'energyLevels')))
      and (jsonb_array_length(coalesce(p_filters->'temperamentTags','[]'::jsonb))=0 or exists(select 1 from unnest(p.temperament_tags) t where public.normalize_search_text(t) in (select public.normalize_search_text(x) from jsonb_array_elements_text(p_filters->'temperamentTags') x)))
      and (nullif(p_filters->>'city','') is null or public.normalize_search_text(p.city)=public.normalize_search_text(p_filters->>'city'))
      and (nullif(p_filters->>'district','') is null or public.normalize_search_text(p.district)=public.normalize_search_text(p_filters->>'district'))
      and (nullif(p_filters->>'neighborhood','') is null or public.normalize_search_text(coalesce(p.neighborhood,''))=public.normalize_search_text(p_filters->>'neighborhood'))
      and (coalesce((p_filters->>'vaccinatedOnly')::boolean,false)=false or public.effective_vaccination_complete(p.id))
      and (coalesce((p_filters->>'profileVerifiedOnly')::boolean,false)=false or p.profile_verified)
      and (coalesce((p_filters->>'ownerVerifiedOnly')::boolean,false)=false or u.identity_verified)
      and (coalesce((p_filters->>'microchipVerifiedOnly')::boolean,false)=false or h.microchip_verified)
      and (coalesce((p_filters->>'geneticScreeningOnly')::boolean,false)=false or h.genetic_screening_available)
      and (coalesce((p_filters->>'pedigreeOnly')::boolean,false)=false or h.pedigree_available)
      and (coalesce(p_filters->>'neutered','all')='all' or (p_filters->>'neutered'='yes' and h.neutered=true) or (p_filters->>'neutered'='no' and h.neutered=false))
      and (jsonb_array_length(coalesce(p_filters->'purposes','[]'::jsonb))=0 or exists(select 1 from public.pet_purposes x where x.pet_id=p.id and x.purpose::text in (select jsonb_array_elements_text(p_filters->'purposes'))))
      and (v_max_distance is null or (
        v_private.location is not null and pp.location is not null
        and extensions.ST_DWithin(v_private.location,pp.location,v_max_distance*1000.0)
      ))
  ), ranked as (
    select c.*,md5(p_active_pet_id::text||':'||c.id::text||':'||current_date::text) as fairness_key
    from candidates c
    order by compatibility_score desc,fairness_key
    limit 100
  )
  select coalesce(jsonb_agg(
    public.pet_json(r.id,p_active_pet_id) || jsonb_build_object(
      'approximateDistanceKm',case when v_private.location is null or r.candidate_location is null then null else public.privacy_display_distance_km(v_private.location,r.candidate_location) end,
      'compatibilityScore',r.compatibility_score
    ) order by r.compatibility_score desc,r.fairness_key
  ),'[]'::jsonb) into v_result from ranked r;

  return v_result;
end $$;
revoke all on function public.discover_pets_v86(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.discover_pets_v86(uuid,jsonb) to service_role;


-- 7. Remove the flag and the functions that only existed for it ---------------------------------------------
alter table public.pet_health_summary drop column veterinarian_verified;

drop trigger if exists trg_pet_match_embedding_health on public.pet_health_summary;
create trigger trg_pet_match_embedding_health
after insert or update of vaccination_status,microchip_verified,genetic_screening_available,pedigree_available on public.pet_health_summary
for each row execute function public.trg_refresh_pet_match_embedding();

drop function if exists public.health_trust_json(uuid);
drop function if exists public.health_attestation_public_signature_sha256(uuid);
drop function if exists public.has_current_veterinarian_verification(uuid);
drop function if exists public.recompute_veterinarian_verified(uuid);

-- 8. Re-embed every pet with the new health slots ------------------------------------------------------------
do $$ declare r record; begin
  for r in select id from public.pets loop
    perform public.refresh_pet_match_embedding(r.id);
  end loop;
end $$;
