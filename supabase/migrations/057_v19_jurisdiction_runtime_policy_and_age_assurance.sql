-- Tailmance v19 jurisdiction-runtime policy + privacy-minimized age-assurance evidence.
-- The release registry and runtime must not disagree about whether a country/subnational layer is approved.
-- All 27 configured markets are seeded BLOCKED. Production approval requires attributable source,
-- external-counsel and professional-localization evidence. No DOB, ID image or raw provider identity
-- document is stored by this layer.

create table if not exists public.legal_jurisdiction_policies (
  legal_country_code text primary key check (legal_country_code ~ '^[A-Z]{2}$'),
  release_status text not null default 'blocked' check (release_status in ('blocked','approved')),
  legal_review_status text not null default 'pending_external_counsel' check (legal_review_status in ('pending_external_counsel','approved_by_external_counsel')),
  subnational_review_required boolean not null default true,
  subnational_review_status text not null default 'pending_external_counsel' check (subnational_review_status in ('pending_external_counsel','approved','not_applicable_with_evidence')),
  subnational_scope_units text[] not null default '{}'::text[],
  launch_document_locales text[] not null check (cardinality(launch_document_locales)>0),
  approved_document_locales text[] not null default '{}'::text[],
  language_review_status text not null default 'pending_external_counsel' check (language_review_status in ('pending_external_counsel','approved')),
  age_assurance_mode text not null default 'unresolved' check (age_assurance_mode in ('unresolved','self_attestation','verified_external')),
  minimum_user_age smallint not null default 18 check (minimum_user_age between 18 and 100),
  animal_welfare_status text not null default 'pending_external_counsel' check (animal_welfare_status in ('pending_external_counsel','approved','not_applicable_with_evidence')),
  breeding_mating_status text not null default 'pending_external_counsel' check (breeding_mating_status in ('pending_external_counsel','approved','not_applicable_with_evidence')),
  pet_commerce_status text not null default 'pending_external_counsel' check (pet_commerce_status in ('pending_external_counsel','approved','not_applicable_with_evidence')),
  source_evidence_reference jsonb not null default '[]'::jsonb check (jsonb_typeof(source_evidence_reference)='array'),
  counsel_evidence_reference jsonb not null default '[]'::jsonb check (jsonb_typeof(counsel_evidence_reference)='array'),
  subnational_evidence_reference jsonb not null default '[]'::jsonb check (jsonb_typeof(subnational_evidence_reference)='array'),
  language_evidence_reference jsonb not null default '[]'::jsonb check (jsonb_typeof(language_evidence_reference)='array'),
  localization_evidence_reference jsonb not null default '[]'::jsonb check (jsonb_typeof(localization_evidence_reference)='array'),
  age_assurance_evidence_reference jsonb not null default '[]'::jsonb check (jsonb_typeof(age_assurance_evidence_reference)='array'),
  animal_welfare_evidence_reference jsonb not null default '[]'::jsonb check (jsonb_typeof(animal_welfare_evidence_reference)='array'),
  breeding_mating_evidence_reference jsonb not null default '[]'::jsonb check (jsonb_typeof(breeding_mating_evidence_reference)='array'),
  pet_commerce_evidence_reference jsonb not null default '[]'::jsonb check (jsonb_typeof(pet_commerce_evidence_reference)='array'),
  operational_evidence_reference jsonb not null default '[]'::jsonb check (jsonb_typeof(operational_evidence_reference)='array'),
  legal_reviewed_at timestamptz,
  next_review_due_at timestamptz,
  effective_at timestamptz,
  expires_at timestamptz,
  updated_by text not null check (char_length(trim(updated_by)) between 1 and 160),
  updated_at timestamptz not null default now(),
  check (
    release_status<>'approved' or (
      legal_review_status='approved_by_external_counsel' and
      subnational_review_status in ('approved','not_applicable_with_evidence') and
      language_review_status='approved' and
      cardinality(approved_document_locales)>0 and
      age_assurance_mode<>'unresolved' and
      animal_welfare_status in ('approved','not_applicable_with_evidence') and
      breeding_mating_status in ('approved','not_applicable_with_evidence') and
      pet_commerce_status in ('approved','not_applicable_with_evidence') and
      jsonb_array_length(source_evidence_reference)>0 and
      jsonb_array_length(counsel_evidence_reference)>0 and
      jsonb_array_length(subnational_evidence_reference)>0 and
      jsonb_array_length(language_evidence_reference)>0 and
      jsonb_array_length(localization_evidence_reference)>0 and
      jsonb_array_length(age_assurance_evidence_reference)>0 and
      jsonb_array_length(animal_welfare_evidence_reference)>0 and
      jsonb_array_length(breeding_mating_evidence_reference)>0 and
      jsonb_array_length(pet_commerce_evidence_reference)>0 and
      jsonb_array_length(operational_evidence_reference)>0 and
      legal_reviewed_at is not null and next_review_due_at is not null and
      effective_at is not null
    )
  ),
  check (not subnational_review_required or cardinality(subnational_scope_units)>0),
  check (expires_at is null or effective_at is null or expires_at>effective_at),
  check (next_review_due_at is null or legal_reviewed_at is null or next_review_due_at>legal_reviewed_at)
);
alter table public.legal_jurisdiction_policies enable row level security;
revoke all on table public.legal_jurisdiction_policies from public,anon,authenticated;
grant select,insert,update on table public.legal_jurisdiction_policies to service_role;

-- All target markets begin blocked. launch_document_locales is a product/localization planning gate, not a claim
-- that every listed locale is independently mandated by statute. Counsel must document the actual
-- statutory/consumer-language basis before release_status can become approved.
insert into public.legal_jurisdiction_policies(
  legal_country_code,launch_document_locales,subnational_scope_units,updated_by
) values
('AE',array['ar','en'],array['emirate','free-zone/regulatory-zone','municipality'],'v19_seed_blocked'),
('AT',array['de'],array['province/state','district/municipality'],'v19_seed_blocked'),
('AU',array['en'],array['state','territory','local authority'],'v19_seed_blocked'),
('BE',array['fr','nl'],array['region','community','municipality'],'v19_seed_blocked'),
('BR',array['pt-BR'],array['state','municipality'],'v19_seed_blocked'),
('CA',array['en','fr'],array['province','territory','municipality'],'v19_seed_blocked'),
('CN',array['zh-Hans'],array['province','autonomous region','municipality/local authority'],'v19_seed_blocked'),
('DE',array['de'],array['Land/state','municipality'],'v19_seed_blocked'),
('ES',array['es'],array['autonomous community','municipality'],'v19_seed_blocked'),
('FR',array['fr'],array['territorial/local authority'],'v19_seed_blocked'),
('GB',array['en'],array['England','Scotland','Wales','Northern Ireland','local authority'],'v19_seed_blocked'),
('ID',array['id'],array['province','regency/city'],'v19_seed_blocked'),
('IE',array['en'],array['local authority'],'v19_seed_blocked'),
('IN',array['en'],array['state','union territory','local authority'],'v19_seed_blocked'),
('IT',array['it'],array['region','autonomous province','municipality'],'v19_seed_blocked'),
('JP',array['ja'],array['prefecture','municipality'],'v19_seed_blocked'),
('KR',array['ko'],array['special/provincial/local authority'],'v19_seed_blocked'),
('NL',array['nl'],array['municipality/province'],'v19_seed_blocked'),
('PL',array['pl'],array['voivodeship','municipality'],'v19_seed_blocked'),
('RU',array['ru'],array['federal subject','municipality'],'v19_seed_blocked'),
('SA',array['ar'],array['region','municipality'],'v19_seed_blocked'),
('SG',array['en'],array['national plus local licensing authority where applicable'],'v19_seed_blocked'),
('TH',array['th'],array['province','local authority'],'v19_seed_blocked'),
('TR',array['tr'],array['province','municipality'],'v19_seed_blocked'),
('TW',array['zh-Hant'],array['special municipality/county/city'],'v19_seed_blocked'),
('US',array['en'],array['state','territory','local authority'],'v19_seed_blocked'),
('VN',array['vi'],array['province/centrally governed municipality','local authority'],'v19_seed_blocked')
on conflict(legal_country_code) do nothing;

create table if not exists public.legal_age_assurance_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  legal_country_code text not null check (legal_country_code ~ '^[A-Z]{2}$'),
  legal_subnational_code text,
  age_threshold smallint not null check (age_threshold between 18 and 100),
  verification_method text not null check (char_length(trim(verification_method)) between 2 and 80),
  provider_code text not null check (char_length(trim(provider_code)) between 2 and 80),
  provider_reference_sha256 text check (provider_reference_sha256 is null or provider_reference_sha256 ~ '^[0-9a-f]{64}$'),
  result text not null check (result in ('passed','revoked')),
  evidence_reference jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_reference)='array'),
  verified_at timestamptz not null,
  expires_at timestamptz,
  created_by text not null check (char_length(trim(created_by)) between 1 and 160),
  created_at timestamptz not null default now(),
  check (legal_subnational_code is null or (char_length(legal_subnational_code) between 1 and 32 and legal_subnational_code ~ '^[A-Z0-9-]+$')),
  check (expires_at is null or expires_at>verified_at),
  check (result<>'passed' or jsonb_array_length(evidence_reference)>0)
);
create index if not exists legal_age_assurance_events_user_context_idx
  on public.legal_age_assurance_events(user_id,legal_country_code,legal_subnational_code,created_at desc,id desc);
alter table public.legal_age_assurance_events enable row level security;
revoke all on table public.legal_age_assurance_events from public,anon,authenticated;
grant select,insert on table public.legal_age_assurance_events to service_role;

drop trigger if exists trg_legal_age_assurance_events_append_only on public.legal_age_assurance_events;
create trigger trg_legal_age_assurance_events_append_only
before update or delete on public.legal_age_assurance_events
for each row execute function public.prevent_append_only_legal_event_update();

create or replace function public.service_record_legal_age_assurance(
  p_user_id uuid,
  p_legal_country_code text,
  p_legal_subnational_code text,
  p_age_threshold smallint,
  p_verification_method text,
  p_provider_code text,
  p_provider_reference_sha256 text,
  p_result text,
  p_evidence_reference jsonb,
  p_verified_at timestamptz,
  p_expires_at timestamptz,
  p_created_by text
)
returns bigint language plpgsql security definer set search_path='' as $$
declare v_id bigint;v_country text:=upper(trim(coalesce(p_legal_country_code,'')));v_sub text:=upper(trim(coalesce(p_legal_subnational_code,'')));v_policy public.legal_jurisdiction_policies;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_user_id is null then raise exception 'user_required'; end if;
  if v_country !~ '^[A-Z]{2}$' then raise exception 'invalid_legal_country'; end if;
  select * into v_policy from public.legal_jurisdiction_policies where legal_country_code=v_country;
  if not found then raise exception 'unlisted_country_blocked'; end if;
  if v_sub<>'' and (char_length(v_sub)>32 or v_sub !~ '^[A-Z0-9-]+$') then raise exception 'invalid_legal_subnational'; end if;
  if v_policy.subnational_review_required and v_sub='' then raise exception 'subnational_review_required'; end if;
  if not v_policy.subnational_review_required then v_sub:=''; end if;
  if p_age_threshold is null or p_age_threshold<18 or p_age_threshold>100 then raise exception 'invalid_age_threshold'; end if;
  if nullif(trim(coalesce(p_verification_method,'')),'') is null or char_length(trim(p_verification_method))>80 then raise exception 'invalid_verification_method'; end if;
  if nullif(trim(coalesce(p_provider_code,'')),'') is null or char_length(trim(p_provider_code))>80 then raise exception 'invalid_provider_code'; end if;
  if nullif(trim(coalesce(p_created_by,'')),'') is null or char_length(trim(p_created_by))>160 then raise exception 'invalid_created_by'; end if;
  if nullif(trim(coalesce(p_provider_reference_sha256,'')),'') is not null and lower(trim(p_provider_reference_sha256)) !~ '^[0-9a-f]{64}$' then raise exception 'invalid_provider_reference_hash'; end if;
  if p_result not in ('passed','revoked') then raise exception 'invalid_age_assurance_result'; end if;
  if p_verified_at is null or p_verified_at>now()+interval '5 minutes' then raise exception 'invalid_verified_at'; end if;
  if p_expires_at is not null and p_expires_at<=p_verified_at then raise exception 'invalid_age_assurance_expiry'; end if;
  if p_result='passed' and (p_evidence_reference is null or jsonb_typeof(p_evidence_reference)<>'array' or jsonb_array_length(p_evidence_reference)=0) then raise exception 'age_assurance_evidence_required'; end if;
  insert into public.legal_age_assurance_events(user_id,legal_country_code,legal_subnational_code,age_threshold,verification_method,provider_code,provider_reference_sha256,result,evidence_reference,verified_at,expires_at,created_by)
  values(p_user_id,v_country,nullif(v_sub,''),p_age_threshold,trim(p_verification_method),trim(p_provider_code),nullif(lower(trim(coalesce(p_provider_reference_sha256,''))),''),p_result,coalesce(p_evidence_reference,'[]'::jsonb),p_verified_at,p_expires_at,trim(p_created_by))
  returning id into v_id;
  insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
  values(p_user_id,'legal_age_assurance_recorded','user',p_user_id,jsonb_build_object('ageAssuranceEventId',v_id,'legalCountry',v_country,'legalSubnational',nullif(v_sub,''),'threshold',p_age_threshold,'result',p_result,'providerCode',trim(p_provider_code)));
  return v_id;
end $$;
revoke all on function public.service_record_legal_age_assurance(uuid,text,text,smallint,text,text,text,text,jsonb,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.service_record_legal_age_assurance(uuid,text,text,smallint,text,text,text,text,jsonb,timestamptz,timestamptz,text) to service_role;

create or replace function public.service_set_legal_jurisdiction_policy(
  p_country_code text,
  p_release_status text,
  p_legal_review_status text,
  p_subnational_review_required boolean,
  p_subnational_review_status text,
  p_subnational_scope_units text[],
  p_launch_document_locales text[],
  p_approved_document_locales text[],
  p_language_review_status text,
  p_age_assurance_mode text,
  p_minimum_user_age smallint,
  p_animal_welfare_status text,
  p_breeding_mating_status text,
  p_pet_commerce_status text,
  p_source_evidence_reference jsonb,
  p_counsel_evidence_reference jsonb,
  p_subnational_evidence_reference jsonb,
  p_language_evidence_reference jsonb,
  p_localization_evidence_reference jsonb,
  p_age_assurance_evidence_reference jsonb,
  p_animal_welfare_evidence_reference jsonb,
  p_breeding_mating_evidence_reference jsonb,
  p_pet_commerce_evidence_reference jsonb,
  p_operational_evidence_reference jsonb,
  p_legal_reviewed_at timestamptz,
  p_next_review_due_at timestamptz,
  p_effective_at timestamptz,
  p_expires_at timestamptz,
  p_updated_by text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_country text:=upper(trim(coalesce(p_country_code,'')));
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if v_country !~ '^[A-Z]{2}$' then raise exception 'invalid_country_code'; end if;
  if not exists(select 1 from public.legal_jurisdiction_policies where legal_country_code=v_country) then raise exception 'unlisted_country_blocked'; end if;
  if p_release_status not in ('blocked','approved') then raise exception 'invalid_release_status'; end if;
  if p_legal_review_status not in ('pending_external_counsel','approved_by_external_counsel') then raise exception 'invalid_legal_review_status'; end if;
  if p_subnational_review_status not in ('pending_external_counsel','approved','not_applicable_with_evidence') then raise exception 'invalid_subnational_review_status'; end if;
  if p_language_review_status not in ('pending_external_counsel','approved') then raise exception 'invalid_language_review_status'; end if;
  if p_age_assurance_mode not in ('unresolved','self_attestation','verified_external') then raise exception 'invalid_age_assurance_mode'; end if;
  if p_animal_welfare_status not in ('pending_external_counsel','approved','not_applicable_with_evidence') or p_breeding_mating_status not in ('pending_external_counsel','approved','not_applicable_with_evidence') or p_pet_commerce_status not in ('pending_external_counsel','approved','not_applicable_with_evidence') then raise exception 'invalid_animal_policy_status'; end if;
  if p_launch_document_locales is null or cardinality(p_launch_document_locales)=0 then raise exception 'launch_document_locales_missing'; end if;
  if p_approved_document_locales is null then raise exception 'approved_document_locales_required'; end if;
  if p_minimum_user_age is null or p_minimum_user_age<18 or p_minimum_user_age>100 then raise exception 'invalid_minimum_user_age'; end if;
  if p_age_assurance_mode='self_attestation' and p_minimum_user_age<>18 then raise exception 'self_attestation_only_supports_18_threshold'; end if;
  if nullif(trim(coalesce(p_updated_by,'')),'') is null or char_length(trim(p_updated_by))>160 then raise exception 'invalid_updated_by'; end if;
  if exists(select 1 from unnest(p_launch_document_locales) x where x is null or char_length(trim(x)) not between 2 and 16 or x !~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$') then raise exception 'invalid_launch_document_locale'; end if;
  if exists(select 1 from unnest(p_approved_document_locales) x where x is null or char_length(trim(x)) not between 2 and 16 or x !~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$') then raise exception 'invalid_approved_document_locale'; end if;
  if p_subnational_review_required and (p_subnational_scope_units is null or cardinality(p_subnational_scope_units)=0) then raise exception 'subnational_scope_units_missing'; end if;
  if p_release_status='approved' and (
    p_legal_review_status<>'approved_by_external_counsel' or
    p_subnational_review_status not in ('approved','not_applicable_with_evidence') or
    p_language_review_status<>'approved' or cardinality(p_approved_document_locales)=0 or p_age_assurance_mode='unresolved' or
    p_animal_welfare_status not in ('approved','not_applicable_with_evidence') or
    p_breeding_mating_status not in ('approved','not_applicable_with_evidence') or
    p_pet_commerce_status not in ('approved','not_applicable_with_evidence') or
    p_source_evidence_reference is null or jsonb_typeof(p_source_evidence_reference)<>'array' or jsonb_array_length(p_source_evidence_reference)=0 or
    p_counsel_evidence_reference is null or jsonb_typeof(p_counsel_evidence_reference)<>'array' or jsonb_array_length(p_counsel_evidence_reference)=0 or
    p_subnational_evidence_reference is null or jsonb_typeof(p_subnational_evidence_reference)<>'array' or jsonb_array_length(p_subnational_evidence_reference)=0 or
    p_language_evidence_reference is null or jsonb_typeof(p_language_evidence_reference)<>'array' or jsonb_array_length(p_language_evidence_reference)=0 or
    p_localization_evidence_reference is null or jsonb_typeof(p_localization_evidence_reference)<>'array' or jsonb_array_length(p_localization_evidence_reference)=0 or
    p_age_assurance_evidence_reference is null or jsonb_typeof(p_age_assurance_evidence_reference)<>'array' or jsonb_array_length(p_age_assurance_evidence_reference)=0 or
    p_animal_welfare_evidence_reference is null or jsonb_typeof(p_animal_welfare_evidence_reference)<>'array' or jsonb_array_length(p_animal_welfare_evidence_reference)=0 or
    p_breeding_mating_evidence_reference is null or jsonb_typeof(p_breeding_mating_evidence_reference)<>'array' or jsonb_array_length(p_breeding_mating_evidence_reference)=0 or
    p_pet_commerce_evidence_reference is null or jsonb_typeof(p_pet_commerce_evidence_reference)<>'array' or jsonb_array_length(p_pet_commerce_evidence_reference)=0 or
    p_operational_evidence_reference is null or jsonb_typeof(p_operational_evidence_reference)<>'array' or jsonb_array_length(p_operational_evidence_reference)=0 or
    p_legal_reviewed_at is null or p_legal_reviewed_at>now()+interval '5 minutes' or p_next_review_due_at is null or p_next_review_due_at<=now() or p_next_review_due_at<=p_legal_reviewed_at or p_next_review_due_at>p_legal_reviewed_at+interval '90 days' or
    p_effective_at is null or p_effective_at>now() or (p_expires_at is not null and p_expires_at<=now()) or (p_expires_at is not null and p_expires_at<=p_effective_at)
  ) then raise exception 'jurisdiction_approval_evidence_incomplete'; end if;
  update public.legal_jurisdiction_policies set
    release_status=p_release_status,legal_review_status=p_legal_review_status,
    subnational_review_required=coalesce(p_subnational_review_required,true),subnational_review_status=p_subnational_review_status,
    subnational_scope_units=coalesce(p_subnational_scope_units,'{}'::text[]),launch_document_locales=p_launch_document_locales,approved_document_locales=coalesce(p_approved_document_locales,'{}'::text[]),
    language_review_status=p_language_review_status,age_assurance_mode=p_age_assurance_mode,minimum_user_age=p_minimum_user_age,
    animal_welfare_status=p_animal_welfare_status,breeding_mating_status=p_breeding_mating_status,pet_commerce_status=p_pet_commerce_status,
    source_evidence_reference=coalesce(p_source_evidence_reference,'[]'::jsonb),counsel_evidence_reference=coalesce(p_counsel_evidence_reference,'[]'::jsonb),
    subnational_evidence_reference=coalesce(p_subnational_evidence_reference,'[]'::jsonb),language_evidence_reference=coalesce(p_language_evidence_reference,'[]'::jsonb),
    localization_evidence_reference=coalesce(p_localization_evidence_reference,'[]'::jsonb),age_assurance_evidence_reference=coalesce(p_age_assurance_evidence_reference,'[]'::jsonb),
    animal_welfare_evidence_reference=coalesce(p_animal_welfare_evidence_reference,'[]'::jsonb),breeding_mating_evidence_reference=coalesce(p_breeding_mating_evidence_reference,'[]'::jsonb),pet_commerce_evidence_reference=coalesce(p_pet_commerce_evidence_reference,'[]'::jsonb),operational_evidence_reference=coalesce(p_operational_evidence_reference,'[]'::jsonb),
    legal_reviewed_at=p_legal_reviewed_at,next_review_due_at=p_next_review_due_at,effective_at=p_effective_at,expires_at=p_expires_at,updated_by=trim(p_updated_by),updated_at=now()
  where legal_country_code=v_country;
  return jsonb_build_object('ok',true,'legalCountryCode',v_country,'releaseStatus',p_release_status,'ageAssuranceMode',p_age_assurance_mode);
end $$;
revoke all on function public.service_set_legal_jurisdiction_policy(text,text,text,boolean,text,text[],text[],text[],text,text,smallint,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz,timestamptz,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.service_set_legal_jurisdiction_policy(text,text,text,boolean,text,text[],text[],text[],text,text,smallint,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz,timestamptz,timestamptz,timestamptz,text) to service_role;

create or replace function public.legal_country_requires_subnational_review(p_country text)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select subnational_review_required from public.legal_jurisdiction_policies where legal_country_code=upper(trim(coalesce(p_country,'')))),true);
$$;
revoke all on function public.legal_country_requires_subnational_review(text) from public,anon,authenticated;

create or replace function public.current_legal_age_assurance_satisfied(p_user_id uuid,p_country text,p_subnational text)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((
    select case p.age_assurance_mode
      when 'self_attestation' then p.minimum_user_age=18 and exists(select 1 from public.users u where u.id=p_user_id and u.age_18_confirmed=true)
      when 'verified_external' then exists(
        select 1 from public.legal_age_assurance_events e
        where e.user_id=p_user_id and e.legal_country_code=p.legal_country_code
          and coalesce(e.legal_subnational_code,'')=case when p.subnational_review_required then coalesce(p_subnational,'') else '' end
          and e.result='passed' and e.age_threshold>=p.minimum_user_age
          and e.verified_at<=now() and (e.expires_at is null or e.expires_at>now())
          and jsonb_array_length(e.evidence_reference)>0
          and not exists(
            select 1 from public.legal_age_assurance_events r
            where r.user_id=e.user_id and r.legal_country_code=e.legal_country_code
              and coalesce(r.legal_subnational_code,'')=coalesce(e.legal_subnational_code,'')
              and r.result='revoked' and (r.created_at>e.created_at or (r.created_at=e.created_at and r.id>e.id))
          )
      ) else false end
    from public.legal_jurisdiction_policies p
    where p.legal_country_code=upper(trim(coalesce(p_country,''))) and p.release_status='approved'
      and p.legal_review_status='approved_by_external_counsel' and p.language_review_status='approved'
      and p.legal_reviewed_at is not null and p.legal_reviewed_at<=now() and p.next_review_due_at is not null and p.next_review_due_at>now()
      and p.effective_at is not null and p.effective_at<=now() and (p.expires_at is null or p.expires_at>now())
  ),false);
$$;
revoke all on function public.current_legal_age_assurance_satisfied(uuid,text,text) from public,anon,authenticated;

-- Country runtime setter now rejects any unlisted country and uses the server jurisdiction policy for
-- subnational requirements. A verified runtime country still does not mean the market is approved;
-- the resolver below separately requires an approved jurisdiction policy.
create or replace function public.service_set_legal_country_runtime(
  p_user_id uuid,p_legal_country_code text,p_legal_subnational_code text,p_resolution_status text,p_resolution_source text,
  p_storefront_country_code text,p_operational_country_code text,p_country_mismatch_reviewed boolean,p_evidence_reference jsonb,p_resolved_by text,p_expires_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_country text:=upper(trim(coalesce(p_legal_country_code,'')));v_subnational text:=upper(trim(coalesce(p_legal_subnational_code,'')));
  v_storefront text:=upper(trim(coalesce(p_storefront_country_code,'')));v_operational text:=upper(trim(coalesce(p_operational_country_code,'')));
  v_previous_country text;v_previous_subnational text;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden'; end if;
  if p_user_id is null then raise exception 'user_required'; end if;
  if p_resolution_status not in ('pending','verified','blocked') then raise exception 'invalid_resolution_status'; end if;
  if p_resolution_source not in ('unresolved','storefront_verified','service_country_verified','identity_verified','manual_legal_review') then raise exception 'invalid_resolution_source'; end if;
  if v_country<>'' and v_country !~ '^[A-Z]{2}$' then raise exception 'invalid_legal_country'; end if;
  if v_country<>'' and not exists(select 1 from public.legal_jurisdiction_policies where legal_country_code=v_country) then raise exception 'unlisted_country_blocked'; end if;
  if v_subnational<>'' and (char_length(v_subnational)>32 or v_subnational !~ '^[A-Z0-9-]+$') then raise exception 'invalid_legal_subnational'; end if;
  if v_storefront<>'' and v_storefront !~ '^[A-Z]{2}$' then raise exception 'invalid_storefront_country'; end if;
  if v_operational<>'' and v_operational !~ '^[A-Z]{2}$' then raise exception 'invalid_operational_country'; end if;
  if p_resolution_status='verified' and (v_country='' or p_resolution_source='unresolved' or nullif(trim(coalesce(p_resolved_by,'')),'') is null or p_evidence_reference is null or jsonb_typeof(p_evidence_reference)<>'array' or jsonb_array_length(p_evidence_reference)=0) then raise exception 'verified_country_requires_attributable_evidence'; end if;
  if p_resolution_status='verified' and p_expires_at is not null and p_expires_at<=now() then raise exception 'verified_country_evidence_expired'; end if;
  if p_resolution_status='verified' and public.legal_country_requires_subnational_review(v_country) and v_subnational='' then raise exception 'subnational_review_required'; end if;
  if p_resolution_status='verified' and (((v_storefront<>'' and v_storefront<>v_country) or (v_operational<>'' and v_operational<>v_country) or (v_storefront<>'' and v_operational<>'' and v_storefront<>v_operational))) and p_country_mismatch_reviewed is distinct from true then raise exception 'country_mismatch_review_required'; end if;
  select legal_country_code,legal_subnational_code into v_previous_country,v_previous_subnational from public.legal_country_runtime where user_id=p_user_id for update;
  insert into public.legal_country_runtime(user_id,legal_country_code,legal_subnational_code,resolution_status,resolution_source,storefront_country_code,operational_country_code,country_mismatch_reviewed,evidence_reference,resolved_by,resolved_at,expires_at,updated_at)
  values(p_user_id,nullif(v_country,''),nullif(v_subnational,''),p_resolution_status,p_resolution_source,nullif(v_storefront,''),nullif(v_operational,''),coalesce(p_country_mismatch_reviewed,false),coalesce(p_evidence_reference,'[]'::jsonb),nullif(trim(coalesce(p_resolved_by,'')),''),case when p_resolution_status='verified' then now() else null end,p_expires_at,now())
  on conflict(user_id) do update set legal_country_code=excluded.legal_country_code,legal_subnational_code=excluded.legal_subnational_code,resolution_status=excluded.resolution_status,resolution_source=excluded.resolution_source,storefront_country_code=excluded.storefront_country_code,operational_country_code=excluded.operational_country_code,country_mismatch_reviewed=excluded.country_mismatch_reviewed,evidence_reference=excluded.evidence_reference,resolved_by=excluded.resolved_by,resolved_at=excluded.resolved_at,expires_at=excluded.expires_at,updated_at=now();
  if v_previous_country is distinct from nullif(v_country,'') or v_previous_subnational is distinct from nullif(v_subnational,'') or p_resolution_status<>'verified' then update public.users set legal_version=null,notification_preferences=jsonb_set(coalesce(notification_preferences,'{}'::jsonb),'{marketing}','false'::jsonb,true),updated_at=now() where id=p_user_id; end if;
  insert into public.audit_events(user_id,action,entity_type,entity_id,metadata) values(p_user_id,'legal_country_runtime_changed','user',p_user_id,jsonb_build_object('previousCountry',v_previous_country,'previousSubnational',v_previous_subnational,'legalCountry',nullif(v_country,''),'legalSubnational',nullif(v_subnational,''),'resolutionStatus',p_resolution_status,'resolutionSource',p_resolution_source,'storefrontCountry',nullif(v_storefront,''),'operationalCountry',nullif(v_operational,''),'countryMismatchReviewed',coalesce(p_country_mismatch_reviewed,false)));
  return jsonb_build_object('ok',true,'legalCountryCode',nullif(v_country,''),'legalSubnationalCode',nullif(v_subnational,''),'resolutionStatus',p_resolution_status);
end $$;
revoke all on function public.service_set_legal_country_runtime(uuid,text,text,text,text,text,text,boolean,jsonb,text,timestamptz) from public,anon,authenticated;
grant execute on function public.service_set_legal_country_runtime(uuid,text,text,text,text,text,text,boolean,jsonb,text,timestamptz) to service_role;

create or replace function public.resolve_current_legal_bundle_id(p_user_id uuid,p_ui_locale text)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_runtime public.legal_country_runtime;v_policy public.legal_jurisdiction_policies;v_locale text:=trim(coalesce(p_ui_locale,''));v_bundle_id uuid;
begin
  if p_user_id is null or char_length(v_locale) not between 2 and 16 then return null; end if;
  select * into v_runtime from public.legal_country_runtime where user_id=p_user_id;
  if not found or v_runtime.resolution_status<>'verified' or v_runtime.legal_country_code is null then return null; end if;
  if v_runtime.expires_at is not null and v_runtime.expires_at<=now() then return null; end if;
  select * into v_policy from public.legal_jurisdiction_policies where legal_country_code=v_runtime.legal_country_code;
  if not found or v_policy.release_status<>'approved' or v_policy.legal_review_status<>'approved_by_external_counsel' or v_policy.language_review_status<>'approved' then return null; end if;
  if v_policy.legal_reviewed_at is null or v_policy.legal_reviewed_at>now() or v_policy.next_review_due_at is null or v_policy.next_review_due_at<=now() then return null; end if;
  if jsonb_array_length(v_policy.source_evidence_reference)=0 or jsonb_array_length(v_policy.counsel_evidence_reference)=0 or jsonb_array_length(v_policy.subnational_evidence_reference)=0 or jsonb_array_length(v_policy.language_evidence_reference)=0 or jsonb_array_length(v_policy.localization_evidence_reference)=0 or jsonb_array_length(v_policy.age_assurance_evidence_reference)=0 or jsonb_array_length(v_policy.animal_welfare_evidence_reference)=0 or jsonb_array_length(v_policy.breeding_mating_evidence_reference)=0 or jsonb_array_length(v_policy.pet_commerce_evidence_reference)=0 or jsonb_array_length(v_policy.operational_evidence_reference)=0 then return null; end if;
  if v_policy.effective_at is null or v_policy.effective_at>now() or (v_policy.expires_at is not null and v_policy.expires_at<=now()) then return null; end if;
  if v_policy.subnational_review_required and v_runtime.legal_subnational_code is null then return null; end if;
  if ((v_runtime.storefront_country_code is not null and v_runtime.storefront_country_code<>v_runtime.legal_country_code) or (v_runtime.operational_country_code is not null and v_runtime.operational_country_code<>v_runtime.legal_country_code)) and v_runtime.country_mismatch_reviewed is distinct from true then return null; end if;
  if not public.current_legal_age_assurance_satisfied(p_user_id,v_runtime.legal_country_code,v_runtime.legal_subnational_code) then return null; end if;
  select r.current_bundle_id into v_bundle_id from public.legal_document_bundle_routes r join public.legal_document_bundles b on b.bundle_id=r.current_bundle_id
  where r.legal_country_code=v_runtime.legal_country_code and r.legal_subnational_code=case when v_policy.subnational_review_required then coalesce(v_runtime.legal_subnational_code,'') else '' end
    and r.ui_locale=v_locale and r.route_status='active' and r.effective_at is not null and r.effective_at<=now() and jsonb_array_length(r.evidence_reference)>0
    and b.legal_country_code=r.legal_country_code and coalesce(b.legal_subnational_code,'')=r.legal_subnational_code and b.ui_locale=r.ui_locale and b.document_locale=any(v_policy.approved_document_locales) and b.effective_at<=now()
    and jsonb_array_length(b.source_evidence_reference)>0 and jsonb_array_length(b.counsel_evidence_reference)>0 and jsonb_array_length(b.localization_evidence_reference)>0
  limit 1;
  return v_bundle_id;
end $$;
revoke all on function public.resolve_current_legal_bundle_id(uuid,text) from public,anon,authenticated;

-- An active route is impossible unless the jurisdiction itself is runtime-approved.
create or replace function public.enforce_legal_bundle_route_release_evidence()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_bundle public.legal_document_bundles;v_policy public.legal_jurisdiction_policies;
begin
  if new.route_status='active' then
    select * into v_policy from public.legal_jurisdiction_policies where legal_country_code=new.legal_country_code;
    if not found or v_policy.release_status<>'approved' or v_policy.legal_review_status<>'approved_by_external_counsel' or v_policy.language_review_status<>'approved' or v_policy.age_assurance_mode='unresolved' then raise exception 'jurisdiction_not_approved_for_runtime'; end if;
    if v_policy.legal_reviewed_at is null or v_policy.legal_reviewed_at>now() or v_policy.next_review_due_at is null or v_policy.next_review_due_at<=now() then raise exception 'jurisdiction_legal_review_expired'; end if;
    if jsonb_array_length(v_policy.source_evidence_reference)=0 or jsonb_array_length(v_policy.counsel_evidence_reference)=0 or jsonb_array_length(v_policy.subnational_evidence_reference)=0 or jsonb_array_length(v_policy.language_evidence_reference)=0 or jsonb_array_length(v_policy.localization_evidence_reference)=0 or jsonb_array_length(v_policy.age_assurance_evidence_reference)=0 or jsonb_array_length(v_policy.animal_welfare_evidence_reference)=0 or jsonb_array_length(v_policy.breeding_mating_evidence_reference)=0 or jsonb_array_length(v_policy.pet_commerce_evidence_reference)=0 or jsonb_array_length(v_policy.operational_evidence_reference)=0 then raise exception 'jurisdiction_evidence_incomplete'; end if;
    if v_policy.subnational_review_required and new.legal_subnational_code='' then raise exception 'subnational_route_required'; end if;
    if new.current_bundle_id is null or new.effective_at is null or new.effective_at>now() or jsonb_array_length(new.evidence_reference)=0 then raise exception 'active_legal_route_requires_current_evidence'; end if;
    select * into v_bundle from public.legal_document_bundles where bundle_id=new.current_bundle_id;
    if not found then raise exception 'legal_bundle_not_found'; end if;
    if v_bundle.legal_country_code<>new.legal_country_code or coalesce(v_bundle.legal_subnational_code,'')<>new.legal_subnational_code or v_bundle.ui_locale<>new.ui_locale then raise exception 'legal_bundle_route_context_mismatch'; end if;
    if not (v_bundle.document_locale=any(v_policy.approved_document_locales)) then raise exception 'document_locale_not_approved_for_jurisdiction'; end if;
    if v_bundle.effective_at>now() then raise exception 'legal_bundle_not_effective'; end if;
    if jsonb_array_length(v_bundle.source_evidence_reference)=0 then raise exception 'legal_bundle_official_source_evidence_required'; end if;
    if jsonb_array_length(v_bundle.counsel_evidence_reference)=0 then raise exception 'legal_bundle_counsel_evidence_required'; end if;
    if jsonb_array_length(v_bundle.localization_evidence_reference)=0 then raise exception 'legal_bundle_professional_localization_evidence_required'; end if;
  end if;
  return new;
end $$;
revoke all on function public.enforce_legal_bundle_route_release_evidence() from public,anon,authenticated;

-- Give the UI transparent, non-sensitive legal context details. Evidence arrays and provider data remain private.
create or replace function public.get_current_legal_context(p_ui_locale text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_user_id uuid:=auth.uid();v_runtime public.legal_country_runtime;v_policy public.legal_jurisdiction_policies;v_bundle public.legal_document_bundles;v_bundle_id uuid;v_locale text:=trim(coalesce(p_ui_locale,''));v_accepted boolean:=false;v_privacy_ack boolean:=false;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if char_length(v_locale) not between 2 and 16 then return jsonb_build_object('status','blocked_unsupported_ui_locale'); end if;
  select * into v_runtime from public.legal_country_runtime where user_id=v_user_id;
  if not found or v_runtime.resolution_status<>'verified' or v_runtime.legal_country_code is null then return jsonb_build_object('status','blocked_legal_country_unresolved'); end if;
  if v_runtime.expires_at is not null and v_runtime.expires_at<=now() then return jsonb_build_object('status','blocked_legal_country_evidence_expired','legalCountryCode',v_runtime.legal_country_code); end if;
  select * into v_policy from public.legal_jurisdiction_policies where legal_country_code=v_runtime.legal_country_code;
  if not found or v_policy.release_status<>'approved' then return jsonb_build_object('status','blocked_jurisdiction_not_approved','legalCountryCode',v_runtime.legal_country_code); end if;
  if v_policy.legal_reviewed_at is null or v_policy.legal_reviewed_at>now() or v_policy.next_review_due_at is null or v_policy.next_review_due_at<=now() then return jsonb_build_object('status','blocked_jurisdiction_review_expired','legalCountryCode',v_runtime.legal_country_code,'nextReviewDueAt',v_policy.next_review_due_at); end if;
  if v_policy.subnational_review_required and v_runtime.legal_subnational_code is null then return jsonb_build_object('status','blocked_subnational_review_required','legalCountryCode',v_runtime.legal_country_code); end if;
  if not public.current_legal_age_assurance_satisfied(v_user_id,v_runtime.legal_country_code,v_runtime.legal_subnational_code) then return jsonb_build_object('status','blocked_age_assurance_required','legalCountryCode',v_runtime.legal_country_code,'ageAssuranceMode',v_policy.age_assurance_mode,'minimumUserAge',v_policy.minimum_user_age); end if;
  v_bundle_id:=public.resolve_current_legal_bundle_id(v_user_id,v_locale);
  if v_bundle_id is null then return jsonb_build_object('status','blocked_legal_bundle_missing','legalCountryCode',v_runtime.legal_country_code,'legalSubnationalCode',v_runtime.legal_subnational_code,'uiLocale',v_locale); end if;
  select * into v_bundle from public.legal_document_bundles where bundle_id=v_bundle_id;
  select exists(select 1 from public.legal_acceptances a where a.user_id=v_user_id and a.bundle_id=v_bundle_id) into v_accepted;
  select exists(select 1 from public.privacy_notice_acknowledgements p where p.user_id=v_user_id and p.bundle_id=v_bundle_id) into v_privacy_ack;
  return jsonb_build_object('status','ready','accepted',v_accepted and v_privacy_ack,'bundleId',v_bundle.bundle_id,'legalCountryCode',v_bundle.legal_country_code,'legalSubnationalCode',v_bundle.legal_subnational_code,'uiLocale',v_bundle.ui_locale,'documentLocale',v_bundle.document_locale,'legalVersion',v_bundle.legal_version,'termsVersion',v_bundle.terms_version,'communityGuidelinesVersion',v_bundle.community_guidelines_version,'privacyNoticeVersion',v_bundle.privacy_notice_version,'marketingPushConsentVersion',v_bundle.marketing_push_consent_version,'termsUrl',v_bundle.terms_url,'privacyNoticeUrl',v_bundle.privacy_notice_url,'communityGuidelinesUrl',v_bundle.community_guidelines_url,'marketingPushConsentUrl',v_bundle.marketing_push_consent_url,'effectiveAt',v_bundle.effective_at,'ageAssuranceMode',v_policy.age_assurance_mode,'minimumUserAge',v_policy.minimum_user_age);
end $$;
revoke all on function public.get_current_legal_context(text) from public,anon;
grant execute on function public.get_current_legal_context(text) to authenticated;

create or replace function public.get_account_settings()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'tier',u.tier,'freeMessagesSent',u.free_messages_sent,'discoverable',u.discoverable,'incognito',u.incognito,
    'paused',u.paused_at is not null,'suspended',u.suspended_at is not null,'age18Confirmed',u.age_18_confirmed,'legalVersion',u.legal_version,
    'identityVerified',coalesce(u.identity_verified,false),'preferredLocale',u.preferred_locale,'measurementSystem',u.measurement_system,
    'legalContextCurrent',public.current_user_has_product_access(),'legalBundleAccepted',public.current_user_has_product_access(),
    'legalBundleId',public.resolve_current_legal_bundle_id(u.id,coalesce(u.preferred_locale,'en')),
    'legalCountry',r.legal_country_code,'legalCountryCode',r.legal_country_code,'legalSubnationalCode',r.legal_subnational_code,
    'legalCountryVerificationStatus',coalesce(r.resolution_status,'pending'),'legalCountryExpiresAt',r.expires_at,
    'legalJurisdictionReleaseStatus',coalesce(j.release_status,'blocked'),'legalLanguageReviewStatus',coalesce(j.language_review_status,'pending_external_counsel'),'legalAgeAssuranceMode',coalesce(j.age_assurance_mode,'unresolved'),
    'legalUiLocale',b.ui_locale,'legalDocumentLocale',b.document_locale,
    'privacyNoticeVersion',(select p.notice_version from public.privacy_notice_acknowledgements p where p.user_id=u.id order by p.acknowledged_at desc,p.id desc limit 1),
    'marketingConsentVersion',(select e.consent_version from public.marketing_consent_events e where e.user_id=u.id and e.channel='push' and e.purpose='marketing_product_updates' order by e.created_at desc,e.id desc limit 1),
    'notificationPreferences',jsonb_set(('{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb||coalesce(u.notification_preferences,'{}'::jsonb)),'{marketing}',to_jsonb(coalesce((select e.granted from public.marketing_consent_events e where e.user_id=u.id and e.bundle_id=b.bundle_id and e.channel='push' and e.purpose='marketing_product_updates' order by e.created_at desc,e.id desc limit 1),false)),true)
  ) from public.users u
  left join public.legal_country_runtime r on r.user_id=u.id
  left join public.legal_jurisdiction_policies j on j.legal_country_code=r.legal_country_code
  left join public.legal_document_bundles b on b.bundle_id=public.resolve_current_legal_bundle_id(u.id,coalesce(u.preferred_locale,'en'))
  where u.id=auth.uid() and public.current_session_satisfies_mfa_if_enrolled();
$$;
revoke all on function public.get_account_settings() from public,anon;
grant execute on function public.get_account_settings() to authenticated;

revoke all on table public.legal_jurisdiction_policies,public.legal_age_assurance_events from public,anon,authenticated;
grant select,insert,update on table public.legal_jurisdiction_policies to service_role;
grant select,insert on table public.legal_age_assurance_events to service_role;
