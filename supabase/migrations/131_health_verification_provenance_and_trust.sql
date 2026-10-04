-- Tailmance v19 R8 directive audit: evidence-bound pet-health verification.
-- Manual document review is explicitly distinct from provider/OCR clinic verification.
-- No historical cryptographic/provider provenance is fabricated; veterinarian_verified fails closed.

create table public.health_verification_attestations (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  health_document_id uuid not null references public.health_documents(id) on delete cascade,
  signal text not null check (signal in ('veterinarian_verified','microchip_verified','genetic_screening_available','pedigree_available','vaccination_complete','neutered')),
  method text not null check (method in ('manual_document_review','provider_ocr_signature')),
  clinic_public_id text,
  provider_code text,
  provider_reference_sha256 text,
  integrity_status text not null check (integrity_status in ('not_applicable','valid','invalid')),
  verified_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (clinic_public_id is null or char_length(trim(clinic_public_id)) between 2 and 80),
  check (provider_code is null or provider_code ~ '^[A-Za-z0-9._-]{2,80}$'),
  check (provider_reference_sha256 is null or provider_reference_sha256 ~ '^[0-9a-f]{64}$'),
  check (expires_at is null or expires_at > verified_at),
  check (
    (method='manual_document_review' and signal<>'veterinarian_verified' and clinic_public_id is null and provider_code is null and provider_reference_sha256 is null and integrity_status='not_applicable')
    or
    (method='provider_ocr_signature' and clinic_public_id is not null and provider_code is not null and provider_reference_sha256 is not null and integrity_status in ('valid','invalid'))
  )
);

create unique index health_verification_provider_event_unique
  on public.health_verification_attestations(health_document_id,signal,provider_code,provider_reference_sha256)
  where method='provider_ocr_signature';
create index health_verification_active_pet_idx
  on public.health_verification_attestations(pet_id,signal,verified_at desc)
  where revoked_at is null;
create index health_verification_document_idx
  on public.health_verification_attestations(health_document_id,verified_at desc);

alter table public.health_verification_attestations enable row level security;
revoke all on table public.health_verification_attestations from public,anon,authenticated;
grant select,insert,update,delete on table public.health_verification_attestations to service_role;

create or replace function public.recompute_veterinarian_verified(p_pet_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.pet_health_summary h
  set veterinarian_verified=exists(
    select 1 from public.health_verification_attestations a
    where a.pet_id=p_pet_id
      and a.signal='veterinarian_verified'
      and a.method='provider_ocr_signature'
      and a.integrity_status='valid'
      and a.revoked_at is null
      and (a.expires_at is null or a.expires_at>now())
  )
  where h.pet_id=p_pet_id;
end $$;
revoke all on function public.recompute_veterinarian_verified(uuid) from public,anon,authenticated;

create or replace function public.health_verification_attestation_recompute_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform public.recompute_veterinarian_verified(coalesce(new.pet_id,old.pet_id));
  return coalesce(new,old);
end $$;
revoke all on function public.health_verification_attestation_recompute_trigger() from public,anon,authenticated;

drop trigger if exists health_verification_attestation_recompute on public.health_verification_attestations;
create trigger health_verification_attestation_recompute
after insert or update or delete on public.health_verification_attestations
for each row execute function public.health_verification_attestation_recompute_trigger();

create or replace function public.service_apply_health_verification_attestation(
  p_health_document_id uuid,
  p_signal text,
  p_method text,
  p_clinic_public_id text default null,
  p_provider_code text default null,
  p_provider_reference_sha256 text default null,
  p_integrity_status text default 'not_applicable',
  p_verified_at timestamptz default now(),
  p_expires_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_pet_id uuid;
  v_attestation_id uuid;
  v_now timestamptz:=coalesce(p_verified_at,now());
begin
  if p_signal not in ('veterinarian_verified','microchip_verified','genetic_screening_available','pedigree_available','vaccination_complete','neutered') then raise exception 'invalid_health_signal'; end if;
  if p_method not in ('manual_document_review','provider_ocr_signature') then raise exception 'invalid_health_verification_method'; end if;
  select pet_id into v_pet_id from public.health_documents where id=p_health_document_id for update;
  if v_pet_id is null then raise exception 'health_document_not_found'; end if;

  if p_method='manual_document_review' then
    if p_signal='veterinarian_verified' then raise exception 'provider_attestation_required_for_veterinarian_verified'; end if;
    if p_clinic_public_id is not null or p_provider_code is not null or p_provider_reference_sha256 is not null or p_integrity_status<>'not_applicable' then raise exception 'manual_health_attestation_cannot_claim_provider_evidence'; end if;
    update public.health_verification_attestations
      set revoked_at=now()
      where health_document_id=p_health_document_id and signal=p_signal and method='manual_document_review' and revoked_at is null;
    insert into public.health_verification_attestations(pet_id,health_document_id,signal,method,integrity_status,verified_at,expires_at)
      values(v_pet_id,p_health_document_id,p_signal,p_method,'not_applicable',v_now,p_expires_at)
      returning id into v_attestation_id;
  else
    if p_clinic_public_id is null or char_length(trim(p_clinic_public_id)) not between 2 and 80 then raise exception 'clinic_public_id_required'; end if;
    if p_provider_code is null or p_provider_code !~ '^[A-Za-z0-9._-]{2,80}$' then raise exception 'provider_code_invalid'; end if;
    if p_provider_reference_sha256 is null or p_provider_reference_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'provider_reference_hash_invalid'; end if;
    if p_integrity_status not in ('valid','invalid') then raise exception 'provider_integrity_status_invalid'; end if;
    insert into public.health_verification_attestations(pet_id,health_document_id,signal,method,clinic_public_id,provider_code,provider_reference_sha256,integrity_status,verified_at,expires_at)
      values(v_pet_id,p_health_document_id,p_signal,p_method,trim(p_clinic_public_id),p_provider_code,p_provider_reference_sha256,p_integrity_status,v_now,p_expires_at)
      on conflict (health_document_id,signal,provider_code,provider_reference_sha256) where method='provider_ocr_signature'
      do update set clinic_public_id=excluded.clinic_public_id,integrity_status=excluded.integrity_status,verified_at=excluded.verified_at,expires_at=excluded.expires_at,revoked_at=null
      returning id into v_attestation_id;
  end if;

  if p_integrity_status<>'invalid' then
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
  end if;

  update public.health_documents set verification_status=case when p_integrity_status='invalid' then 'rejected'::public.verification_state else 'verified'::public.verification_state end,verified_at=v_now where id=p_health_document_id;
  perform public.recompute_veterinarian_verified(v_pet_id);
  return jsonb_build_object('ok',true,'attestationId',v_attestation_id,'petId',v_pet_id,'signal',p_signal,'method',p_method,'integrityStatus',p_integrity_status);
end $$;
revoke all on function public.service_apply_health_verification_attestation(uuid,text,text,text,text,text,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.service_apply_health_verification_attestation(uuid,text,text,text,text,text,text,timestamptz,timestamptz) to service_role;

create or replace function public.service_revoke_health_document_attestations(p_health_document_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_pet_id uuid; v_count integer;
begin
  select pet_id into v_pet_id from public.health_documents where id=p_health_document_id;
  if v_pet_id is null then raise exception 'health_document_not_found'; end if;
  update public.health_verification_attestations set revoked_at=coalesce(revoked_at,now()) where health_document_id=p_health_document_id and revoked_at is null;
  get diagnostics v_count=row_count;
  perform public.recompute_veterinarian_verified(v_pet_id);
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
    perform public.recompute_veterinarian_verified(v_pet_id);
    return jsonb_build_object('ok',true,'petId',v_pet_id,'status','rejected');
  end if;
  if p_signal is null then
    update public.health_documents set verification_status='verified',verified_at=coalesce(p_reviewed_at,now()) where id=p_health_document_id;
    return jsonb_build_object('ok',true,'petId',v_pet_id,'status','verified');
  end if;
  if p_signal='veterinarian_verified' then raise exception 'provider_attestation_required_for_veterinarian_verified'; end if;
  v_result:=public.service_apply_health_verification_attestation(p_health_document_id,p_signal,'manual_document_review',null,null,null,'not_applicable',coalesce(p_reviewed_at,now()),null);
  return v_result || jsonb_build_object('status','verified');
end $$;
revoke all on function public.service_review_health_document(uuid,boolean,text,timestamptz) from public,anon,authenticated;
grant execute on function public.service_review_health_document(uuid,boolean,text,timestamptz) to service_role;

create or replace function public.health_trust_json(p_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce((
    select jsonb_build_object(
      'method',a.method,
      'clinicPublicId',a.clinic_public_id,
      'providerCode',a.provider_code,
      'integrityStatus',a.integrity_status,
      'verifiedAt',a.verified_at,
      'expiresAt',a.expires_at
    )
    from public.health_verification_attestations a
    where a.pet_id=p_pet_id and a.signal='veterinarian_verified' and a.method='provider_ocr_signature'
      and a.integrity_status='valid' and a.revoked_at is null and (a.expires_at is null or a.expires_at>now())
    order by a.verified_at desc,a.id desc limit 1
  ),'null'::jsonb)
$$;
revoke all on function public.health_trust_json(uuid) from public,anon,authenticated;

-- Existing boolean-only veterinarian flags have no attributable provider evidence in prior schema.
-- Fail closed rather than inventing provenance.
update public.pet_health_summary set veterinarian_verified=false where veterinarian_verified=true;

create or replace function public.get_pet_health_details(p_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.owns_pet(p_pet_id) then jsonb_build_object(
    'summary',jsonb_build_object(
      'vaccinationStatus',coalesce(h.vaccination_status,'unknown'::public.vaccination_status),
      'veterinarianVerified',coalesce(h.veterinarian_verified,false),
      'neutered',h.neutered,'microchipVerified',coalesce(h.microchip_verified,false),
      'geneticScreeningAvailable',coalesce(h.genetic_screening_available,false),
      'pedigreeAvailable',coalesce(h.pedigree_available,false),
      'trust',public.health_trust_json(p_pet_id)
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
      'clinicPublicId',a.clinic_public_id,'providerCode',a.provider_code,'integrityStatus',a.integrity_status,
      'verifiedAt',a.verified_at,'expiresAt',a.expires_at,'revokedAt',a.revoked_at
    ) order by a.verified_at desc,a.id desc) from public.health_verification_attestations a where a.pet_id=p_pet_id),'[]'::jsonb)
  ) else null end
  from public.pet_health_summary h where h.pet_id=p_pet_id;
$$;
revoke all on function public.get_pet_health_details(uuid) from public,anon;
grant execute on function public.get_pet_health_details(uuid) to authenticated;

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
    'health',jsonb_build_object('vaccinationStatus',coalesce(h.vaccination_status,'unknown'::public.vaccination_status),'veterinarianVerified',coalesce(h.veterinarian_verified,false),'neutered',h.neutered,'microchipVerified',coalesce(h.microchip_verified,false),'geneticScreeningAvailable',coalesce(h.genetic_screening_available,false),'pedigreeAvailable',coalesce(h.pedigree_available,false),'trust',public.health_trust_json(p.id)),
    'followersCount',(select count(*) from public.follows f where f.to_pet_id=p.id),
    'followingCount',(select count(*) from public.follows f where f.from_pet_id=p.id),
    'isFollowing',case when p_viewer_pet_id is null then false else exists(select 1 from public.follows f where f.from_pet_id=p_viewer_pet_id and f.to_pet_id=p.id) end,
    'isFavorite',case when p_viewer_pet_id is null then false else exists(select 1 from public.pet_favorites f where f.from_pet_id=p_viewer_pet_id and f.to_pet_id=p.id) end
  ) from public.pets p join public.users u on u.id=p.owner_id left join public.pet_health_summary h on h.pet_id=p.id where p.id=p_pet_id;
$$;
revoke all on function public.pet_json(uuid,uuid) from public,anon,authenticated;
