-- Tailmance v19 R8: health-document AI/OCR pipeline with deterministic confidence bands.
-- OCR/model confidence alone never establishes veterinary truth. Automatic verification requires
-- a registry/credential-backed provider result with credential_integrity='valid'. Ambiguous output
-- remains pending for human review; low-confidence or invalid-credential output is rejected.

create table if not exists public.health_ai_jobs (
  health_document_id uuid primary key references public.health_documents(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','processing','auto_verified','manual_review','rejected','failed')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  not_before timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  last_error_code text check (last_error_code is null or char_length(last_error_code)<=120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_health_ai_jobs_due on public.health_ai_jobs(status,not_before,created_at)
  where status in ('pending','failed');
alter table public.health_ai_jobs enable row level security;
revoke all on table public.health_ai_jobs from public,anon,authenticated;

create table if not exists public.ai_inference_logs (
  id bigint generated always as identity primary key,
  system_name text not null check (system_name in ('health_ocr_registry')),
  target_type text not null check (target_type='health_document'),
  target_id uuid not null,
  provider_code text not null check (char_length(provider_code) between 2 and 80),
  model_version text not null check (char_length(model_version) between 1 and 120),
  decision text not null check (decision in ('auto_verified','manual_review','rejected','provider_error')),
  confidence numeric(6,5) check (confidence is null or confidence between 0 and 1),
  latency_ms integer check (latency_ms is null or latency_ms between 0 and 120000),
  signal_count integer not null default 0 check (signal_count between 0 and 32),
  metadata jsonb not null default '{}'::jsonb check (pg_column_size(metadata)<=4096),
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_inference_logs_target_created on public.ai_inference_logs(target_type,target_id,created_at desc);
create index if not exists idx_ai_inference_logs_system_decision_created on public.ai_inference_logs(system_name,decision,created_at desc);
alter table public.ai_inference_logs enable row level security;
revoke all on table public.ai_inference_logs from public,anon,authenticated;

create or replace function public.enqueue_health_ai_job()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.health_ai_jobs(health_document_id,status,attempts,not_before,claimed_at,completed_at,last_error_code,updated_at)
  values(new.id,'pending',0,now(),null,null,null,now())
  on conflict(health_document_id) do update set
    status=case when public.health_ai_jobs.status='auto_verified' then public.health_ai_jobs.status else 'pending' end,
    not_before=case when public.health_ai_jobs.status='auto_verified' then public.health_ai_jobs.not_before else now() end,
    claimed_at=null,
    completed_at=case when public.health_ai_jobs.status='auto_verified' then public.health_ai_jobs.completed_at else null end,
    last_error_code=case when public.health_ai_jobs.status='auto_verified' then public.health_ai_jobs.last_error_code else null end,
    updated_at=now();
  return new;
end $$;
revoke all on function public.enqueue_health_ai_job() from public,anon,authenticated;

drop trigger if exists trg_health_document_ai_enqueue on public.health_documents;
create trigger trg_health_document_ai_enqueue
after insert on public.health_documents
for each row execute function public.enqueue_health_ai_job();

insert into public.health_ai_jobs(health_document_id,status,attempts,not_before)
select d.id,'pending',0,now()
from public.health_documents d
where d.verification_status='pending'
on conflict(health_document_id) do nothing;

create or replace function public.claim_health_ai_jobs(p_limit integer default 10)
returns table(health_document_id uuid,attempts integer)
language plpgsql security definer set search_path='' as $$
begin
  return query
  with candidates as (
    select j.health_document_id
    from public.health_ai_jobs j
    join public.health_documents d on d.id=j.health_document_id
    where d.verification_status='pending'
      and j.status in ('pending','failed')
      and j.not_before<=now()
      and j.attempts<8
    order by j.not_before asc,j.created_at asc,j.health_document_id asc
    for update of j skip locked
    limit least(greatest(coalesce(p_limit,10),1),25)
  )
  update public.health_ai_jobs j
  set status='processing',claimed_at=now(),updated_at=now()
  from candidates c
  where j.health_document_id=c.health_document_id
  returning j.health_document_id,j.attempts;
end $$;
revoke all on function public.claim_health_ai_jobs(integer) from public,anon,authenticated;
grant execute on function public.claim_health_ai_jobs(integer) to service_role;

create or replace function public.service_apply_health_ai_result(
  p_health_document_id uuid,
  p_provider_code text,
  p_provider_reference_sha256 text,
  p_clinic_public_id text,
  p_model_version text,
  p_document_confidence numeric,
  p_credential_integrity text,
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
  if p_clinic_public_id is null or char_length(trim(p_clinic_public_id)) not between 2 and 80 then raise exception 'health_ai_clinic_invalid'; end if;
  if p_model_version is null or char_length(trim(p_model_version)) not between 1 and 120 then raise exception 'health_ai_model_invalid'; end if;
  if p_document_confidence is null or p_document_confidence<0 or p_document_confidence>1 then raise exception 'health_ai_confidence_invalid'; end if;
  if p_credential_integrity not in ('valid','invalid','unverified') then raise exception 'health_ai_integrity_invalid'; end if;
  if p_latency_ms is not null and (p_latency_ms<0 or p_latency_ms>120000) then raise exception 'health_ai_latency_invalid'; end if;
  if jsonb_typeof(p_signals)<>'array' then raise exception 'health_ai_signals_invalid'; end if;
  v_signal_count:=jsonb_array_length(p_signals);
  if v_signal_count<1 or v_signal_count>16 then raise exception 'health_ai_signals_invalid'; end if;

  select * into v_doc from public.health_documents where id=p_health_document_id for update;
  if v_doc.id is null then raise exception 'health_document_not_found'; end if;
  select * into v_job from public.health_ai_jobs where health_document_id=p_health_document_id for update;
  if v_job.health_document_id is null or v_job.status<>'processing' then raise exception 'health_ai_job_not_claimed'; end if;
  if v_doc.verification_status<>'pending' then
    update public.health_ai_jobs set status=case when v_doc.verification_status='verified' then 'auto_verified' else 'rejected' end,completed_at=coalesce(completed_at,v_now),updated_at=v_now where health_document_id=p_health_document_id;
    return jsonb_build_object('decision','already_finalized');
  end if;

  -- Strictly validate every extracted signal before making any state change.
  for v_signal in select value from jsonb_array_elements(p_signals) loop
    v_verified_at:=null;
    v_expires_at:=null;
    if jsonb_typeof(v_signal)<>'object' or (v_signal-'signal'-'confidence'-'verifiedAt'-'expiresAt')<>'{}'::jsonb then
      raise exception 'health_ai_signal_schema_invalid';
    end if;
    v_signal_name:=nullif(trim(v_signal->>'signal'),'');
    v_signal_conf:=nullif(v_signal->>'confidence','')::numeric;
    if v_signal_name not in ('veterinarian_verified','microchip_verified','genetic_screening_available','pedigree_available','vaccination_complete','neutered')
       or v_signal_conf is null or v_signal_conf<0 or v_signal_conf>1 then
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

  if p_document_confidence<0.65 or p_credential_integrity='invalid' then
    v_decision:='rejected';
    update public.health_documents set verification_status='rejected',verified_at=null where id=p_health_document_id;
    update public.moderation_items set status='rejected',manual_review_required=false,reviewed_at=v_now,next_attempt_at=null,
      last_error_code=case when p_credential_integrity='invalid' then 'health_ai_invalid_credential' else 'health_ai_low_confidence' end,
      reason='Health verification could not be established from the submitted document.'
    where target_type='health_document' and target_id=p_health_document_id;
    update public.health_ai_jobs set status='rejected',completed_at=v_now,claimed_at=null,last_error_code=null,updated_at=v_now where health_document_id=p_health_document_id;
  elsif p_document_confidence<=0.85 or p_credential_integrity<>'valid'
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
        'provider_ocr_signature',
        trim(p_clinic_public_id),
        p_provider_code,
        p_provider_reference_sha256,
        'valid',
        coalesce(nullif(v_signal->>'verifiedAt','')::timestamptz,v_now),
        nullif(v_signal->>'expiresAt','')::timestamptz
      );
    end loop;
    update public.moderation_items set status='approved',manual_review_required=false,reviewed_at=v_now,next_attempt_at=null,last_error_code=null,reason=null
    where target_type='health_document' and target_id=p_health_document_id;
    update public.health_ai_jobs set status='auto_verified',completed_at=v_now,claimed_at=null,last_error_code=null,updated_at=v_now where health_document_id=p_health_document_id;
  end if;

  insert into public.ai_inference_logs(system_name,target_type,target_id,provider_code,model_version,decision,confidence,latency_ms,signal_count,metadata)
  values('health_ocr_registry','health_document',p_health_document_id,p_provider_code,trim(p_model_version),v_decision,p_document_confidence,p_latency_ms,v_signal_count,
    jsonb_build_object('credentialIntegrity',p_credential_integrity,'thresholdPolicy','gt_0.85_auto_0.65_to_0.85_manual_lt_0.65_reject'));

  return jsonb_build_object('decision',v_decision,'signalCount',v_signal_count);
end $$;
revoke all on function public.service_apply_health_ai_result(uuid,text,text,text,text,numeric,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.service_apply_health_ai_result(uuid,text,text,text,text,numeric,text,jsonb,integer) to service_role;

create or replace function public.service_defer_health_ai_job(p_health_document_id uuid,p_error_code text)
returns void language plpgsql security definer set search_path='' as $$
declare v_attempts integer; v_delay interval;
begin
  select attempts into v_attempts from public.health_ai_jobs where health_document_id=p_health_document_id for update;
  if v_attempts is null then return; end if;
  v_attempts:=v_attempts+1;
  v_delay:=make_interval(secs=>least(3600,60*power(2,least(v_attempts-1,6))::integer));
  update public.health_ai_jobs set
    status=case when v_attempts>=8 then 'manual_review' else 'failed' end,
    attempts=v_attempts,claimed_at=null,completed_at=case when v_attempts>=8 then now() else null end,
    not_before=case when v_attempts>=8 then now() else now()+v_delay end,
    last_error_code=left(coalesce(nullif(trim(p_error_code),''),'health_ai_provider_error'),120),updated_at=now()
  where health_document_id=p_health_document_id;
  if v_attempts>=8 then
    update public.moderation_items set status='pending',manual_review_required=true,next_attempt_at=null,
      last_error_code='health_ai_provider_unavailable_manual_review'
    where target_type='health_document' and target_id=p_health_document_id;
  end if;
end $$;
revoke all on function public.service_defer_health_ai_job(uuid,text) from public,anon,authenticated;
grant execute on function public.service_defer_health_ai_job(uuid,text) to service_role;
