-- Tailmance v19 subnational language-route hardening.
-- An approved country review is never enough for a subnational route. Every route must have an exact,
-- attributable subnational language/applicability decision, and any required alternate-language legal
-- documents must be hash-bound and professionally localized before activation.

create table if not exists public.legal_subnational_language_requirements (
  legal_country_code text not null check (legal_country_code ~ '^[A-Z]{2}$'),
  legal_subnational_code text not null check (char_length(legal_subnational_code) between 1 and 32 and legal_subnational_code ~ '^[A-Z0-9-]+$'),
  requirement_status text not null default 'pending_external_counsel' check (requirement_status in ('pending_external_counsel','approved','not_applicable_with_evidence')),
  required_available_document_locales text[] not null default '{}'::text[],
  required_document_types text[] not null default '{}'::text[],
  other_language_requires_express_choice boolean not null default false,
  scope_note text not null check (char_length(trim(scope_note)) between 8 and 4000),
  official_source_reference jsonb not null default '[]'::jsonb check (jsonb_typeof(official_source_reference)='array'),
  counsel_evidence_reference jsonb not null default '[]'::jsonb check (jsonb_typeof(counsel_evidence_reference)='array'),
  reviewer text,
  reviewed_at timestamptz,
  valid_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key(legal_country_code,legal_subnational_code),
  check (
    requirement_status='pending_external_counsel' or (
      jsonb_array_length(official_source_reference)>0 and jsonb_array_length(counsel_evidence_reference)>0 and
      reviewer is not null and char_length(trim(reviewer)) between 1 and 160 and reviewed_at is not null and valid_until is not null and
      valid_until>reviewed_at and valid_until<=reviewed_at+interval '90 days'
    )
  )
);
alter table public.legal_subnational_language_requirements enable row level security;
revoke all on table public.legal_subnational_language_requirements from public,anon,authenticated;
grant select,insert,update on table public.legal_subnational_language_requirements to service_role;

create table if not exists public.legal_bundle_document_alternates (
  bundle_id uuid not null references public.legal_document_bundles(bundle_id) on delete restrict,
  document_type text not null check (document_type in (
    'terms','privacy_notice','community_guidelines','marketing_push_consent','subscription_consumer',
    'moderation_appeals','intellectual_property','accessibility','account_deletion','support','jurisdiction_privacy_supplement'
  )),
  document_locale text not null check (char_length(document_locale) between 2 and 16),
  document_version text not null check (char_length(trim(document_version)) between 1 and 64),
  document_url text not null check (document_url ~ '^https://'),
  document_sha256 text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
  source_evidence_reference jsonb not null check (jsonb_typeof(source_evidence_reference)='array' and jsonb_array_length(source_evidence_reference)>0),
  counsel_evidence_reference jsonb not null check (jsonb_typeof(counsel_evidence_reference)='array' and jsonb_array_length(counsel_evidence_reference)>0),
  localization_evidence_reference jsonb not null check (jsonb_typeof(localization_evidence_reference)='array' and jsonb_array_length(localization_evidence_reference)>0),
  reviewer text not null check (char_length(trim(reviewer)) between 1 and 160),
  reviewed_at timestamptz not null,
  valid_until timestamptz not null,
  created_at timestamptz not null default now(),
  primary key(bundle_id,document_type,document_locale),
  check (valid_until>reviewed_at),
  check (valid_until<=reviewed_at+interval '90 days')
);
alter table public.legal_bundle_document_alternates enable row level security;
revoke all on table public.legal_bundle_document_alternates from public,anon,authenticated;
grant select,insert on table public.legal_bundle_document_alternates to service_role;

drop trigger if exists trg_legal_bundle_document_alternates_immutable on public.legal_bundle_document_alternates;
create trigger trg_legal_bundle_document_alternates_immutable
before update or delete on public.legal_bundle_document_alternates
for each row execute function public.prevent_immutable_legal_bundle_document_mutation();

create or replace function public.legal_subnational_language_requirements_satisfied(p_bundle_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare
  v_bundle public.legal_document_bundles;
  v_policy public.legal_jurisdiction_policies;
  v_req public.legal_subnational_language_requirements;
  v_locale text;
  v_type text;
  v_primary_exists boolean;
  v_alt_exists boolean;
begin
  if p_bundle_id is null then return false; end if;
  select * into v_bundle from public.legal_document_bundles where bundle_id=p_bundle_id;
  if not found then return false; end if;
  select * into v_policy from public.legal_jurisdiction_policies where legal_country_code=v_bundle.legal_country_code;
  if not found then return false; end if;
  if not v_policy.subnational_review_required then return true; end if;
  if v_bundle.legal_subnational_code is null then return false; end if;
  select * into v_req from public.legal_subnational_language_requirements
  where legal_country_code=v_bundle.legal_country_code and legal_subnational_code=v_bundle.legal_subnational_code;
  if not found or v_req.requirement_status not in ('approved','not_applicable_with_evidence') then return false; end if;
  if v_req.reviewed_at is null or v_req.reviewed_at>now()+interval '5 minutes' or v_req.reviewed_at<now()-interval '90 days' then return false; end if;
  if v_req.valid_until is null or v_req.valid_until<=now() or v_req.valid_until>v_req.reviewed_at+interval '90 days' then return false; end if;
  if jsonb_array_length(v_req.official_source_reference)=0 or jsonb_array_length(v_req.counsel_evidence_reference)=0 then return false; end if;
  if v_req.requirement_status='not_applicable_with_evidence' then return true; end if;
  if cardinality(v_req.required_available_document_locales)=0 or cardinality(v_req.required_document_types)=0 then return false; end if;
  foreach v_locale in array v_req.required_available_document_locales loop
    foreach v_type in array v_req.required_document_types loop
      select exists(select 1 from public.legal_bundle_documents d
        where d.bundle_id=p_bundle_id and d.document_type=v_type and d.document_locale=v_locale
          and d.reviewed_at<=now()+interval '5 minutes' and d.reviewed_at>=now()-interval '90 days' and d.valid_until>now()) into v_primary_exists;
      select exists(select 1 from public.legal_bundle_document_alternates a
        where a.bundle_id=p_bundle_id and a.document_type=v_type and a.document_locale=v_locale
          and a.reviewed_at<=now()+interval '5 minutes' and a.reviewed_at>=now()-interval '90 days' and a.valid_until>now()
          and jsonb_array_length(a.source_evidence_reference)>0 and jsonb_array_length(a.counsel_evidence_reference)>0 and jsonb_array_length(a.localization_evidence_reference)>0) into v_alt_exists;
      if not (v_primary_exists or v_alt_exists) then return false; end if;
    end loop;
  end loop;
  return true;
end $$;
revoke all on function public.legal_subnational_language_requirements_satisfied(uuid) from public,anon,authenticated;
grant execute on function public.legal_subnational_language_requirements_satisfied(uuid) to service_role;

-- Pinned source-screening rows. These are deliberately pending and cannot activate routes until counsel
-- supplies exact applicability + document scope + professional localization evidence.
insert into public.legal_subnational_language_requirements(
  legal_country_code,legal_subnational_code,requirement_status,required_available_document_locales,required_document_types,
  other_language_requires_express_choice,scope_note,official_source_reference
) values
('CA','CA-QC','pending_external_counsel',array['fr'],array['terms','subscription_consumer'],true,
 'Québec technological adhesion-contract French-version/availability flow requires exact Tailmance contract classification and counsel-approved implementation before activation.',
 '["https://www.oqlf.gouv.qc.ca/francisation/entreprises/contrats-adhesion.html"]'::jsonb),
('ES','ES-CT','pending_external_counsel',array['ca'],array['terms','subscription_consumer'],false,
 'Catalonia official consumer-language sources show Catalan duties for commercial/contractual information; exact Tailmance scope and document set require counsel approval.',
 '["https://consum.gencat.cat/ca/el-consum/durant-la-compra/drets-linguistics-/"]'::jsonb),
('ES','ES-PV','pending_external_counsel',array['eu'],array['terms','subscription_consumer'],false,
 'Basque Country official consumer-language sources show Euskera/Spanish consumer and adhesion-contract rights; exact Tailmance scope requires counsel approval.',
 '["https://www.euskadi.eus/gobierno-vasco/-/derechos-linguisticos-y-obligaciones-de-las-empresas/"]'::jsonb),
('ES','ES-GA','pending_external_counsel',array['gl'],array['terms','subscription_consumer'],false,
 'Galicia consumer law recognizes consumer language rights in the autonomous community; exact Tailmance contract/communication scope requires counsel approval.',
 '["https://www.boe.es/buscar/act.php?id=BOE-A-2012-5595"]'::jsonb),
('BE','BE-DE-COMMUNITY','pending_external_counsel',array['de'],array['terms','subscription_consumer'],false,
 'Belgium has a German-speaking Community and German official-language territory; exact Tailmance consumer-document duties require territorial counsel scoping.',
 '["https://www.belgium.be/en/about_belgium/government/federale_staat"]'::jsonb)
on conflict(legal_country_code,legal_subnational_code) do nothing;

-- Belgium product/legal-document planning must not omit German. This does not self-assert that every Belgian
-- consumer relationship mandates all three languages; exact route requirements remain subnational/counsel controlled.
update public.legal_jurisdiction_policies
set launch_document_locales=array['fr','nl','de'],updated_by='v19_065_belgium_language_planning',updated_at=now()
where legal_country_code='BE';

-- Supersede resolver one final time with exact subnational-language route evidence.
create or replace function public.resolve_current_legal_bundle_id(p_user_id uuid,p_ui_locale text)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_runtime public.legal_country_runtime;v_policy public.legal_jurisdiction_policies;v_locale text:=trim(coalesce(p_ui_locale,''));v_bundle_id uuid;
begin
  if p_user_id is null or char_length(v_locale) not between 2 and 16 then return null; end if;
  select * into v_runtime from public.legal_country_runtime where user_id=p_user_id;
  if not found or v_runtime.resolution_status<>'verified' or v_runtime.legal_country_code is null then return null; end if;
  if v_runtime.expires_at is null or v_runtime.expires_at<=now() then return null; end if;
  if v_runtime.resolution_source not in ('habitual_residence_verified','service_contract_country_verified','manual_legal_review') then return null; end if;
  select * into v_policy from public.legal_jurisdiction_policies where legal_country_code=v_runtime.legal_country_code;
  if not found or v_policy.release_status<>'approved' or v_policy.legal_review_status<>'approved_by_external_counsel' or v_policy.language_review_status<>'approved' then return null; end if;
  if v_policy.legal_reviewed_at is null or v_policy.legal_reviewed_at>now() or v_policy.next_review_due_at is null or v_policy.next_review_due_at<=now() then return null; end if;
  if not public.legal_control_reviews_complete(v_policy.control_reviews) then return null; end if;
  if cardinality(v_policy.approved_document_locales)=0 or cardinality(v_policy.required_document_types)=0 then return null; end if;
  if jsonb_array_length(v_policy.source_evidence_reference)=0 or jsonb_array_length(v_policy.counsel_evidence_reference)=0 or jsonb_array_length(v_policy.subnational_evidence_reference)=0 or jsonb_array_length(v_policy.language_evidence_reference)=0 or jsonb_array_length(v_policy.localization_evidence_reference)=0 or jsonb_array_length(v_policy.age_assurance_evidence_reference)=0 or jsonb_array_length(v_policy.animal_welfare_evidence_reference)=0 or jsonb_array_length(v_policy.breeding_mating_evidence_reference)=0 or jsonb_array_length(v_policy.pet_commerce_evidence_reference)=0 or jsonb_array_length(v_policy.operational_evidence_reference)=0 then return null; end if;
  if v_policy.effective_at is null or v_policy.effective_at>now() or (v_policy.expires_at is not null and v_policy.expires_at<=now()) then return null; end if;
  if v_policy.subnational_review_required and v_runtime.legal_subnational_code is null then return null; end if;
  if ((v_runtime.storefront_country_code is not null and v_runtime.storefront_country_code<>v_runtime.legal_country_code) or (v_runtime.operational_country_code is not null and v_runtime.operational_country_code<>v_runtime.legal_country_code) or (v_runtime.habitual_residence_country_code is not null and v_runtime.habitual_residence_country_code<>v_runtime.legal_country_code) or (v_runtime.service_contract_country_code is not null and v_runtime.service_contract_country_code<>v_runtime.legal_country_code)) and v_runtime.country_mismatch_reviewed is distinct from true then return null; end if;
  if not public.current_legal_age_assurance_satisfied(p_user_id,v_runtime.legal_country_code,v_runtime.legal_subnational_code) then return null; end if;
  select r.current_bundle_id into v_bundle_id
  from public.legal_document_bundle_routes r join public.legal_document_bundles b on b.bundle_id=r.current_bundle_id
  where r.legal_country_code=v_runtime.legal_country_code
    and r.legal_subnational_code=case when v_policy.subnational_review_required then coalesce(v_runtime.legal_subnational_code,'') else '' end
    and r.ui_locale=v_locale and r.route_status='active' and r.effective_at is not null and r.effective_at<=now() and jsonb_array_length(r.evidence_reference)>0
    and b.legal_country_code=r.legal_country_code and coalesce(b.legal_subnational_code,'')=r.legal_subnational_code and b.ui_locale=r.ui_locale
    and b.document_locale=any(v_policy.approved_document_locales) and b.effective_at<=now()
    and jsonb_array_length(b.source_evidence_reference)>0 and jsonb_array_length(b.counsel_evidence_reference)>0 and jsonb_array_length(b.localization_evidence_reference)>0
    and public.legal_bundle_document_manifest_complete(b.bundle_id)
    and public.legal_subnational_language_requirements_satisfied(b.bundle_id)
  limit 1;
  return v_bundle_id;
end $$;
revoke all on function public.resolve_current_legal_bundle_id(uuid,text) from public,anon,authenticated;

-- Active route writes are also blocked if the exact subnational language matrix has not been approved.
create or replace function public.enforce_legal_bundle_route_release_evidence()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_bundle public.legal_document_bundles;v_policy public.legal_jurisdiction_policies;
begin
  if new.route_status='active' then
    select * into v_policy from public.legal_jurisdiction_policies where legal_country_code=new.legal_country_code;
    if not found or v_policy.release_status<>'approved' or v_policy.legal_review_status<>'approved_by_external_counsel' or v_policy.language_review_status<>'approved' or v_policy.age_assurance_mode='unresolved' then raise exception 'jurisdiction_not_approved_for_runtime'; end if;
    if v_policy.legal_reviewed_at is null or v_policy.legal_reviewed_at>now() or v_policy.next_review_due_at is null or v_policy.next_review_due_at<=now() then raise exception 'jurisdiction_legal_review_expired'; end if;
    if not public.legal_control_reviews_complete(v_policy.control_reviews) then raise exception 'jurisdiction_topic_control_reviews_incomplete'; end if;
    if cardinality(v_policy.approved_document_locales)=0 or cardinality(v_policy.required_document_types)=0 then raise exception 'approved_document_or_manifest_policy_missing'; end if;
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
    if not public.legal_bundle_document_manifest_complete(v_bundle.bundle_id) then raise exception 'legal_bundle_document_manifest_incomplete_or_stale'; end if;
    if not public.legal_subnational_language_requirements_satisfied(v_bundle.bundle_id) then raise exception 'subnational_language_requirement_incomplete_or_stale'; end if;
  end if;
  return new;
end $$;
revoke all on function public.enforce_legal_bundle_route_release_evidence() from public,anon,authenticated;

drop trigger if exists trg_legal_bundle_route_release_evidence on public.legal_document_bundle_routes;
create trigger trg_legal_bundle_route_release_evidence
before insert or update on public.legal_document_bundle_routes
for each row execute function public.enforce_legal_bundle_route_release_evidence();

revoke all on table public.legal_subnational_language_requirements,public.legal_bundle_document_alternates from public,anon,authenticated;
