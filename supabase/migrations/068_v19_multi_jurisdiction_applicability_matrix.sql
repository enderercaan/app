-- Tailmance v19 multi-jurisdiction applicability hardening.
-- A single primary legal country is not treated as the universe of potentially applicable law.
-- Residence, service-contract country, current presence, storefront/market, operator establishment and
-- feature-specific facts are independent signals. They are reviewed into an immutable applicability
-- matrix; UI language never creates a country, and travel never silently replaces the primary country.

create table if not exists public.legal_applicability_matrices (
  matrix_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  primary_country_code text not null check (primary_country_code ~ '^[A-Z]{2}$'),
  primary_subnational_code text check (
    primary_subnational_code is null or
    (primary_subnational_code ~ '^[A-Z]{2}-[A-Z0-9-]{1,29}$' and left(primary_subnational_code,2)=primary_country_code)
  ),
  review_status text not null check (review_status in ('approved_with_overlays','approved_no_additional_overlays','blocked')),
  signal_snapshot jsonb not null check (jsonb_typeof(signal_snapshot)='object'),
  signal_snapshot_sha256 text not null check (signal_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  evidence_reference jsonb not null check (jsonb_typeof(evidence_reference)='array' and jsonb_array_length(evidence_reference)>0),
  counsel_evidence_reference jsonb not null check (jsonb_typeof(counsel_evidence_reference)='array'),
  reviewer text not null check (char_length(trim(reviewer)) between 1 and 160),
  reviewed_at timestamptz not null,
  valid_until timestamptz not null,
  created_at timestamptz not null default now(),
  check (valid_until>reviewed_at and valid_until<=reviewed_at+interval '90 days'),
  check (review_status='blocked' or jsonb_array_length(counsel_evidence_reference)>0)
);
create index if not exists legal_applicability_matrices_user_idx on public.legal_applicability_matrices(user_id,created_at desc);
alter table public.legal_applicability_matrices enable row level security;
revoke all on table public.legal_applicability_matrices from public,anon,authenticated;
grant select,insert,delete on table public.legal_applicability_matrices to service_role;

create table if not exists public.legal_applicability_overlays (
  overlay_id uuid primary key default gen_random_uuid(),
  matrix_id uuid not null references public.legal_applicability_matrices(matrix_id) on delete cascade,
  jurisdiction_country_code text not null check (jurisdiction_country_code ~ '^[A-Z]{2}$'),
  jurisdiction_subnational_code text check (
    jurisdiction_subnational_code is null or
    (jurisdiction_subnational_code ~ '^[A-Z]{2}-[A-Z0-9-]{1,29}$' and left(jurisdiction_subnational_code,2)=jurisdiction_country_code)
  ),
  applicability_basis text not null check (applicability_basis in (
    'habitual_residence','service_contract','current_presence','storefront_market','operator_establishment',
    'data_subject_residence','feature_specific','subnational_rule','manual_legal_review'
  )),
  applicability_status text not null check (applicability_status in ('applicable','not_applicable_with_evidence')),
  control_families text[] not null default '{}',
  required_document_types text[] not null default '{}',
  required_document_locales text[] not null default '{}',
  scope_note text not null check (char_length(trim(scope_note)) between 8 and 4000),
  official_source_reference jsonb not null check (jsonb_typeof(official_source_reference)='array' and jsonb_array_length(official_source_reference)>0),
  evidence_reference jsonb not null check (jsonb_typeof(evidence_reference)='array' and jsonb_array_length(evidence_reference)>0),
  counsel_evidence_reference jsonb not null check (jsonb_typeof(counsel_evidence_reference)='array' and jsonb_array_length(counsel_evidence_reference)>0),
  reviewer text not null check (char_length(trim(reviewer)) between 1 and 160),
  reviewed_at timestamptz not null,
  valid_until timestamptz not null,
  created_at timestamptz not null default now(),
  check (valid_until>reviewed_at and valid_until<=reviewed_at+interval '90 days'),
  check (
    applicability_status='not_applicable_with_evidence' or
    cardinality(control_families)>0 or cardinality(required_document_types)>0
  ),
  check (cardinality(required_document_locales)=0 or cardinality(required_document_types)>0)
);
create index if not exists legal_applicability_overlays_matrix_idx on public.legal_applicability_overlays(matrix_id);
alter table public.legal_applicability_overlays enable row level security;
revoke all on table public.legal_applicability_overlays from public,anon,authenticated;
grant select,insert,delete on table public.legal_applicability_overlays to service_role;

create table if not exists public.legal_bundle_overlay_documents (
  overlay_document_id uuid primary key default gen_random_uuid(),
  matrix_id uuid not null references public.legal_applicability_matrices(matrix_id) on delete cascade,
  overlay_id uuid not null references public.legal_applicability_overlays(overlay_id) on delete cascade,
  bundle_id uuid not null references public.legal_document_bundles(bundle_id) on delete cascade,
  document_type text not null check (document_type in (
    'terms','privacy_notice','community_guidelines','marketing_push_consent','subscription_consumer',
    'moderation_appeals','intellectual_property','accessibility','account_deletion','support',
    'jurisdiction_privacy_supplement','jurisdiction_consumer_supplement','jurisdiction_platform_supplement'
  )),
  document_locale text not null check (char_length(document_locale) between 2 and 16),
  document_version text not null check (char_length(document_version) between 1 and 64),
  document_url text not null check (document_url ~ '^https://'),
  document_sha256 text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
  source_evidence_reference jsonb not null check (jsonb_typeof(source_evidence_reference)='array' and jsonb_array_length(source_evidence_reference)>0),
  counsel_evidence_reference jsonb not null check (jsonb_typeof(counsel_evidence_reference)='array' and jsonb_array_length(counsel_evidence_reference)>0),
  localization_evidence_reference jsonb not null check (jsonb_typeof(localization_evidence_reference)='array' and jsonb_array_length(localization_evidence_reference)>0),
  reviewer text not null check (char_length(trim(reviewer)) between 1 and 160),
  reviewed_at timestamptz not null,
  valid_until timestamptz not null,
  created_at timestamptz not null default now(),
  unique(overlay_id,bundle_id,document_type,document_locale),
  check (valid_until>reviewed_at and valid_until<=reviewed_at+interval '90 days')
);
create index if not exists legal_bundle_overlay_documents_bundle_idx on public.legal_bundle_overlay_documents(bundle_id,matrix_id);
alter table public.legal_bundle_overlay_documents enable row level security;
revoke all on table public.legal_bundle_overlay_documents from public,anon,authenticated;
grant select,insert,delete on table public.legal_bundle_overlay_documents to service_role;

alter table public.legal_country_runtime
  add column if not exists current_applicability_matrix_id uuid references public.legal_applicability_matrices(matrix_id) on delete set null;

-- New writes cannot pair a country with another country's subdivision. NOT VALID avoids pretending that
-- unknown production legacy rows were already remediated; runtime checks below reject any mismatched legacy row.
alter table public.legal_country_runtime drop constraint if exists legal_country_runtime_subnational_country_match;
alter table public.legal_country_runtime add constraint legal_country_runtime_subnational_country_match check (
  legal_subnational_code is null or (legal_country_code is not null and left(legal_subnational_code,3)=legal_country_code||'-')
) not valid;
alter table public.legal_document_bundles drop constraint if exists legal_document_bundles_subnational_country_match;
alter table public.legal_document_bundles add constraint legal_document_bundles_subnational_country_match check (
  legal_subnational_code is null or left(legal_subnational_code,3)=legal_country_code||'-'
) not valid;
alter table public.legal_document_bundle_routes drop constraint if exists legal_document_bundle_routes_subnational_country_match;
alter table public.legal_document_bundle_routes add constraint legal_document_bundle_routes_subnational_country_match check (
  legal_subnational_code='' or left(legal_subnational_code,3)=legal_country_code||'-'
) not valid;

create or replace function public.legal_runtime_signal_snapshot(p_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'legalCountryCode',r.legal_country_code,
    'legalSubnationalCode',r.legal_subnational_code,
    'resolutionStatus',r.resolution_status,
    'resolutionSource',r.resolution_source,
    'habitualResidenceCountryCode',r.habitual_residence_country_code,
    'serviceContractCountryCode',r.service_contract_country_code,
    'currentPresenceCountryCode',r.current_presence_country_code,
    'storefrontCountryCode',r.storefront_country_code,
    'operationalCountryCode',r.operational_country_code,
    'countryMismatchReviewed',r.country_mismatch_reviewed
  ) from public.legal_country_runtime r where r.user_id=p_user_id;
$$;
revoke all on function public.legal_runtime_signal_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.legal_runtime_signal_snapshot(uuid) to service_role;

create or replace function public.legal_signal_snapshot_sha256(p_snapshot jsonb)
returns text language sql immutable security definer set search_path='' as $$
  select encode(extensions.digest(convert_to(coalesce(p_snapshot,'{}'::jsonb)::text,'UTF8'),'sha256'),'hex');
$$;
revoke all on function public.legal_signal_snapshot_sha256(jsonb) from public,anon,authenticated;
grant execute on function public.legal_signal_snapshot_sha256(jsonb) to service_role;

create or replace function public.prevent_legal_applicability_update()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception 'immutable_legal_applicability_evidence';
end $$;
revoke all on function public.prevent_legal_applicability_update() from public,anon,authenticated;

drop trigger if exists trg_legal_applicability_matrices_immutable_update on public.legal_applicability_matrices;
create trigger trg_legal_applicability_matrices_immutable_update before update on public.legal_applicability_matrices
for each row execute function public.prevent_legal_applicability_update();
drop trigger if exists trg_legal_applicability_overlays_immutable_update on public.legal_applicability_overlays;
create trigger trg_legal_applicability_overlays_immutable_update before update on public.legal_applicability_overlays
for each row execute function public.prevent_legal_applicability_update();
drop trigger if exists trg_legal_bundle_overlay_documents_immutable_update on public.legal_bundle_overlay_documents;
create trigger trg_legal_bundle_overlay_documents_immutable_update before update on public.legal_bundle_overlay_documents
for each row execute function public.prevent_legal_applicability_update();

create or replace function public.legal_single_control_review_complete(p_review jsonb,p_family text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_reviewed timestamptz;v_checked timestamptz;v_until timestamptz;
begin
  if not (p_family=any(public.legal_required_control_families())) then return false; end if;
  if p_review is null or coalesce(jsonb_typeof(p_review),'')<>'object' then return false; end if;
  if coalesce(p_review->>'status','') not in ('approved','not_applicable_with_evidence') then return false; end if;
  if coalesce(jsonb_typeof(p_review->'official_source_reference'),'')<>'array' or jsonb_array_length(p_review->'official_source_reference')=0 then return false; end if;
  if exists(select 1 from jsonb_array_elements_text(p_review->'official_source_reference') x(value) where nullif(trim(value),'') is null or value !~ '^https://') then return false; end if;
  if coalesce(jsonb_typeof(p_review->'evidence_reference'),'')<>'array' or jsonb_array_length(p_review->'evidence_reference')=0 then return false; end if;
  if coalesce(jsonb_typeof(p_review->'reviewer'),'')<>'object' or nullif(trim(p_review#>>'{reviewer,name}'),'') is null then return false; end if;
  if nullif(trim(p_review->>'reviewed_at'),'') is null or nullif(trim(p_review->>'applicability_checked_at'),'') is null or nullif(trim(p_review->>'valid_until'),'') is null then return false; end if;
  begin
    v_reviewed:=(p_review->>'reviewed_at')::timestamptz;
    v_checked:=(p_review->>'applicability_checked_at')::timestamptz;
    v_until:=(p_review->>'valid_until')::timestamptz;
  exception when others then return false; end;
  if v_reviewed>now()+interval '5 minutes' or v_checked>now()+interval '5 minutes' then return false; end if;
  if v_reviewed<now()-interval '90 days' or v_checked<now()-interval '90 days' then return false; end if;
  if v_until<=now() or v_until<=greatest(v_reviewed,v_checked) or v_until>greatest(v_reviewed,v_checked)+interval '90 days' then return false; end if;
  if char_length(trim(coalesce(p_review->>'scope_note','')))<8 then return false; end if;
  if p_family='operator_identity_tax_invoicing' then
    if coalesce(p_review->>'operator_identity_disclosure_status','') not in ('approved','not_applicable_with_evidence') then return false; end if;
    if coalesce(jsonb_typeof(p_review->'operator_identity_disclosure_evidence_reference'),'')<>'array' or jsonb_array_length(p_review->'operator_identity_disclosure_evidence_reference')=0 then return false; end if;
    if coalesce(p_review->>'tax_invoicing_status','') not in ('approved','not_applicable_with_evidence') then return false; end if;
    if coalesce(jsonb_typeof(p_review->'tax_invoicing_evidence_reference'),'')<>'array' or jsonb_array_length(p_review->'tax_invoicing_evidence_reference')=0 then return false; end if;
    if coalesce(p_review->>'registration_licensing_filing_notification_status','') not in ('approved','not_applicable_with_evidence') then return false; end if;
    if coalesce(jsonb_typeof(p_review->'registration_licensing_filing_notification_evidence_reference'),'')<>'array' or jsonb_array_length(p_review->'registration_licensing_filing_notification_evidence_reference')=0 then return false; end if;
  end if;
  return true;
end $$;
revoke all on function public.legal_single_control_review_complete(jsonb,text) from public,anon,authenticated;
grant execute on function public.legal_single_control_review_complete(jsonb,text) to service_role;

create or replace function public.legal_applicability_matrix_record_satisfied(p_user_id uuid,p_matrix_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_matrix public.legal_applicability_matrices;v_runtime public.legal_country_runtime;v_overlay record;v_policy public.legal_jurisdiction_policies;v_snapshot jsonb;v_family text;v_applicable integer:=0;
begin
  if p_user_id is null or p_matrix_id is null then return false; end if;
  select * into v_runtime from public.legal_country_runtime where user_id=p_user_id;
  if not found or v_runtime.resolution_status<>'verified' or v_runtime.legal_country_code is null then return false; end if;
  if v_runtime.legal_subnational_code is not null and left(v_runtime.legal_subnational_code,3)<>v_runtime.legal_country_code||'-' then return false; end if;
  select * into v_matrix from public.legal_applicability_matrices where matrix_id=p_matrix_id and user_id=p_user_id;
  if not found or v_matrix.review_status='blocked' then return false; end if;
  if v_matrix.reviewed_at>now()+interval '5 minutes' or v_matrix.reviewed_at<now()-interval '90 days' or v_matrix.valid_until<=now() or v_matrix.valid_until>v_matrix.reviewed_at+interval '90 days' then return false; end if;
  if jsonb_array_length(v_matrix.evidence_reference)=0 or jsonb_array_length(v_matrix.counsel_evidence_reference)=0 or nullif(trim(v_matrix.reviewer),'') is null then return false; end if;
  if v_matrix.primary_country_code<>v_runtime.legal_country_code or coalesce(v_matrix.primary_subnational_code,'')<>coalesce(v_runtime.legal_subnational_code,'') then return false; end if;
  v_snapshot:=public.legal_runtime_signal_snapshot(p_user_id);
  if v_snapshot is null or v_matrix.signal_snapshot<>v_snapshot or v_matrix.signal_snapshot_sha256<>public.legal_signal_snapshot_sha256(v_snapshot) then return false; end if;

  for v_overlay in select * from public.legal_applicability_overlays where matrix_id=p_matrix_id loop
    if v_overlay.reviewed_at>now()+interval '5 minutes' or v_overlay.reviewed_at<now()-interval '90 days' or v_overlay.valid_until<=now() or v_overlay.valid_until>v_overlay.reviewed_at+interval '90 days' then return false; end if;
    if v_overlay.jurisdiction_subnational_code is not null and left(v_overlay.jurisdiction_subnational_code,3)<>v_overlay.jurisdiction_country_code||'-' then return false; end if;
    if exists(select 1 from jsonb_array_elements_text(v_overlay.official_source_reference) x(value) where nullif(trim(value),'') is null or value !~ '^https://') then return false; end if;
    if exists(select 1 from unnest(v_overlay.control_families) f where not (f=any(public.legal_required_control_families()))) then return false; end if;
    if cardinality(v_overlay.control_families)<>(select count(distinct f) from unnest(v_overlay.control_families) f) then return false; end if;
    if exists(select 1 from unnest(v_overlay.required_document_types) d where d not in ('terms','privacy_notice','community_guidelines','marketing_push_consent','subscription_consumer','moderation_appeals','intellectual_property','accessibility','account_deletion','support','jurisdiction_privacy_supplement','jurisdiction_consumer_supplement','jurisdiction_platform_supplement')) then return false; end if;
    if cardinality(v_overlay.required_document_types)<>(select count(distinct d) from unnest(v_overlay.required_document_types) d) then return false; end if;
    if exists(select 1 from unnest(v_overlay.required_document_locales) l where char_length(l) not between 2 and 16 or l !~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$') then return false; end if;
    if cardinality(v_overlay.required_document_locales)<>(select count(distinct l) from unnest(v_overlay.required_document_locales) l) then return false; end if;
    if v_overlay.applicability_status='applicable' then
      v_applicable:=v_applicable+1;
      select * into v_policy from public.legal_jurisdiction_policies where legal_country_code=v_overlay.jurisdiction_country_code;
      if not found then return false; end if;
      foreach v_family in array v_overlay.control_families loop
        if not public.legal_single_control_review_complete(v_policy.control_reviews->v_family,v_family) then return false; end if;
      end loop;
    end if;
  end loop;
  if v_matrix.review_status='approved_with_overlays' and v_applicable=0 then return false; end if;
  if v_matrix.review_status='approved_no_additional_overlays' and v_applicable<>0 then return false; end if;
  return true;
end $$;
revoke all on function public.legal_applicability_matrix_record_satisfied(uuid,uuid) from public,anon,authenticated;
grant execute on function public.legal_applicability_matrix_record_satisfied(uuid,uuid) to service_role;

create or replace function public.legal_applicability_matrix_satisfied(p_user_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_matrix_id uuid;
begin
  select current_applicability_matrix_id into v_matrix_id from public.legal_country_runtime where user_id=p_user_id;
  return public.legal_applicability_matrix_record_satisfied(p_user_id,v_matrix_id);
end $$;
revoke all on function public.legal_applicability_matrix_satisfied(uuid) from public,anon,authenticated;
grant execute on function public.legal_applicability_matrix_satisfied(uuid) to service_role;

create or replace function public.legal_applicability_bundle_satisfied(p_user_id uuid,p_bundle_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_matrix_id uuid;v_overlay record;v_type text;v_locale text;
begin
  if not public.legal_applicability_matrix_satisfied(p_user_id) then return false; end if;
  select current_applicability_matrix_id into v_matrix_id from public.legal_country_runtime where user_id=p_user_id;
  for v_overlay in select * from public.legal_applicability_overlays where matrix_id=v_matrix_id and applicability_status='applicable' loop
    if cardinality(v_overlay.required_document_types)>0 then
      if cardinality(v_overlay.required_document_locales)=0 then return false; end if;
      foreach v_type in array v_overlay.required_document_types loop
        foreach v_locale in array v_overlay.required_document_locales loop
          if not exists(
            select 1 from public.legal_bundle_overlay_documents d
            where d.matrix_id=v_matrix_id and d.overlay_id=v_overlay.overlay_id and d.bundle_id=p_bundle_id
              and d.document_type=v_type and d.document_locale=v_locale
              and d.reviewed_at<=now() and d.reviewed_at>=now()-interval '90 days'
              and d.valid_until>now() and d.valid_until<=d.reviewed_at+interval '90 days'
              and jsonb_array_length(d.source_evidence_reference)>0
              and jsonb_array_length(d.counsel_evidence_reference)>0
              and jsonb_array_length(d.localization_evidence_reference)>0
          ) then return false; end if;
        end loop;
      end loop;
    end if;
  end loop;
  return true;
end $$;
revoke all on function public.legal_applicability_bundle_satisfied(uuid,uuid) from public,anon,authenticated;
grant execute on function public.legal_applicability_bundle_satisfied(uuid,uuid) to service_role;

create or replace function public.service_activate_legal_applicability_matrix(p_user_id uuid,p_matrix_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if not public.legal_applicability_matrix_record_satisfied(p_user_id,p_matrix_id) then raise exception 'legal_applicability_matrix_not_release_ready'; end if;
  update public.legal_country_runtime set current_applicability_matrix_id=p_matrix_id,updated_at=now() where user_id=p_user_id;
  if not found then raise exception 'legal_country_runtime_missing'; end if;
  update public.users set legal_version=null,
    notification_preferences=jsonb_set(coalesce(notification_preferences,'{}'::jsonb),'{marketing}','false'::jsonb,true),updated_at=now()
    where id=p_user_id;
  insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
  values(p_user_id,'legal_applicability_matrix_activated','user',p_user_id,jsonb_build_object('matrixId',p_matrix_id));
  return jsonb_build_object('ok',true,'matrixId',p_matrix_id);
end $$;
revoke all on function public.service_activate_legal_applicability_matrix(uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_activate_legal_applicability_matrix(uuid,uuid) to service_role;

-- Any change in a jurisdiction-relevant signal invalidates the previous matrix. Updating the pointer itself does not.
create or replace function public.invalidate_legal_applicability_matrix_on_signal_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    new.current_applicability_matrix_id:=null;
  elsif old.legal_country_code is distinct from new.legal_country_code
     or old.legal_subnational_code is distinct from new.legal_subnational_code
     or old.resolution_status is distinct from new.resolution_status
     or old.resolution_source is distinct from new.resolution_source
     or old.habitual_residence_country_code is distinct from new.habitual_residence_country_code
     or old.service_contract_country_code is distinct from new.service_contract_country_code
     or old.current_presence_country_code is distinct from new.current_presence_country_code
     or old.storefront_country_code is distinct from new.storefront_country_code
     or old.operational_country_code is distinct from new.operational_country_code
     or old.country_mismatch_reviewed is distinct from new.country_mismatch_reviewed
     or old.evidence_reference is distinct from new.evidence_reference
     or old.resolved_by is distinct from new.resolved_by
     or old.resolved_at is distinct from new.resolved_at
     or old.expires_at is distinct from new.expires_at then
    new.current_applicability_matrix_id:=null;
    update public.users set legal_version=null,
      notification_preferences=jsonb_set(coalesce(notification_preferences,'{}'::jsonb),'{marketing}','false'::jsonb,true),updated_at=now()
      where id=new.user_id;
  end if;
  return new;
end $$;
revoke all on function public.invalidate_legal_applicability_matrix_on_signal_change() from public,anon,authenticated;
drop trigger if exists trg_legal_country_runtime_invalidate_applicability on public.legal_country_runtime;
create trigger trg_legal_country_runtime_invalidate_applicability before insert or update on public.legal_country_runtime
for each row execute function public.invalidate_legal_applicability_matrix_on_signal_change();

-- Existing users intentionally have no active matrix after this migration. They fail closed until the
-- additional-jurisdiction review is actually completed. No country is self-approved by this migration.
update public.legal_country_runtime set current_applicability_matrix_id=null where current_applicability_matrix_id is not null;

-- Supersede the route resolver: primary jurisdiction selects the base bundle, while the independently
-- reviewed applicability matrix and any overlay documents are additional release gates.
create or replace function public.resolve_current_legal_bundle_id(p_user_id uuid,p_ui_locale text)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_runtime public.legal_country_runtime;v_policy public.legal_jurisdiction_policies;v_locale text:=trim(coalesce(p_ui_locale,''));v_bundle_id uuid;
begin
  if p_user_id is null or char_length(v_locale) not between 2 and 16 then return null; end if;
  select * into v_runtime from public.legal_country_runtime where user_id=p_user_id;
  if not found or v_runtime.resolution_status<>'verified' or v_runtime.legal_country_code is null then return null; end if;
  if v_runtime.legal_subnational_code is not null and left(v_runtime.legal_subnational_code,3)<>v_runtime.legal_country_code||'-' then return null; end if;
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
  if not public.legal_applicability_matrix_satisfied(p_user_id) then return null; end if;
  select r.current_bundle_id into v_bundle_id
  from public.legal_document_bundle_routes r join public.legal_document_bundles b on b.bundle_id=r.current_bundle_id
  where r.legal_country_code=v_runtime.legal_country_code
    and r.legal_subnational_code=case when v_policy.subnational_review_required then coalesce(v_runtime.legal_subnational_code,'') else '' end
    and r.ui_locale=v_locale and r.route_status='active' and r.effective_at is not null and r.effective_at<=now() and jsonb_array_length(r.evidence_reference)>0
    and b.legal_country_code=r.legal_country_code and coalesce(b.legal_subnational_code,'')=r.legal_subnational_code and b.ui_locale=r.ui_locale
    and (b.legal_subnational_code is null or left(b.legal_subnational_code,3)=b.legal_country_code||'-')
    and b.document_locale=any(v_policy.approved_document_locales) and b.effective_at<=now()
    and jsonb_array_length(b.source_evidence_reference)>0 and jsonb_array_length(b.counsel_evidence_reference)>0 and jsonb_array_length(b.localization_evidence_reference)>0
    and public.legal_bundle_document_manifest_complete(b.bundle_id)
    and public.legal_subnational_language_requirements_satisfied(b.bundle_id)
  limit 1;
  if v_bundle_id is null or not public.legal_applicability_bundle_satisfied(p_user_id,v_bundle_id) then return null; end if;
  return v_bundle_id;
end $$;
revoke all on function public.resolve_current_legal_bundle_id(uuid,text) from public,anon,authenticated;

-- Precise authenticated block reasons for the new independent applicability layer.
create or replace function public.get_current_legal_context(p_ui_locale text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_user_id uuid:=auth.uid();v_runtime public.legal_country_runtime;v_policy public.legal_jurisdiction_policies;
  v_bundle public.legal_document_bundles;v_bundle_id uuid;v_candidate_id uuid;v_locale text:=trim(coalesce(p_ui_locale,''));
  v_accepted boolean:=false;v_privacy_ack boolean:=false;v_docs jsonb:='{}'::jsonb;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if char_length(v_locale) not between 2 and 16 then return jsonb_build_object('status','blocked_unsupported_ui_locale'); end if;
  select * into v_runtime from public.legal_country_runtime where user_id=v_user_id;
  if not found or v_runtime.resolution_status<>'verified' or v_runtime.legal_country_code is null then return jsonb_build_object('status','blocked_legal_country_unresolved'); end if;
  if v_runtime.legal_subnational_code is not null and left(v_runtime.legal_subnational_code,3)<>v_runtime.legal_country_code||'-' then return jsonb_build_object('status','blocked_legal_subnational_country_mismatch','legalCountryCode',v_runtime.legal_country_code,'legalSubnationalCode',v_runtime.legal_subnational_code); end if;
  if v_runtime.expires_at is null or v_runtime.expires_at<=now() then return jsonb_build_object('status','blocked_legal_country_evidence_expired','legalCountryCode',v_runtime.legal_country_code); end if;
  if v_runtime.resolution_source not in ('habitual_residence_verified','service_contract_country_verified','manual_legal_review') then return jsonb_build_object('status','blocked_legal_country_provenance_insufficient','legalCountryCode',v_runtime.legal_country_code); end if;
  select * into v_policy from public.legal_jurisdiction_policies where legal_country_code=v_runtime.legal_country_code;
  if not found or v_policy.release_status<>'approved' then return jsonb_build_object('status','blocked_jurisdiction_not_approved','legalCountryCode',v_runtime.legal_country_code); end if;
  if v_policy.legal_reviewed_at is null or v_policy.legal_reviewed_at>now() or v_policy.next_review_due_at is null or v_policy.next_review_due_at<=now() then return jsonb_build_object('status','blocked_jurisdiction_review_expired','legalCountryCode',v_runtime.legal_country_code,'nextReviewDueAt',v_policy.next_review_due_at); end if;
  if not public.legal_control_reviews_complete(v_policy.control_reviews) then return jsonb_build_object('status','blocked_jurisdiction_control_review_incomplete','legalCountryCode',v_runtime.legal_country_code); end if;
  if v_policy.subnational_review_required and v_runtime.legal_subnational_code is null then return jsonb_build_object('status','blocked_subnational_review_required','legalCountryCode',v_runtime.legal_country_code); end if;
  if not public.current_legal_age_assurance_satisfied(v_user_id,v_runtime.legal_country_code,v_runtime.legal_subnational_code) then return jsonb_build_object('status','blocked_age_assurance_required','legalCountryCode',v_runtime.legal_country_code,'ageAssuranceMode',v_policy.age_assurance_mode,'minimumUserAge',v_policy.minimum_user_age); end if;
  if v_runtime.current_applicability_matrix_id is null then return jsonb_build_object('status','blocked_legal_applicability_matrix_unresolved','legalCountryCode',v_runtime.legal_country_code); end if;
  if not public.legal_applicability_matrix_satisfied(v_user_id) then return jsonb_build_object('status','blocked_legal_applicability_overlay_review_incomplete','legalCountryCode',v_runtime.legal_country_code,'applicabilityMatrixId',v_runtime.current_applicability_matrix_id); end if;

  select r.current_bundle_id into v_candidate_id from public.legal_document_bundle_routes r
  join public.legal_document_bundles b on b.bundle_id=r.current_bundle_id
  where r.legal_country_code=v_runtime.legal_country_code
    and r.legal_subnational_code=case when v_policy.subnational_review_required then coalesce(v_runtime.legal_subnational_code,'') else '' end
    and r.ui_locale=v_locale and r.route_status='active' and r.effective_at is not null and r.effective_at<=now()
    and b.legal_country_code=r.legal_country_code and coalesce(b.legal_subnational_code,'')=r.legal_subnational_code and b.ui_locale=r.ui_locale
  limit 1;
  if v_candidate_id is not null and not public.legal_bundle_document_manifest_complete(v_candidate_id) then
    return jsonb_build_object('status','blocked_legal_document_manifest_incomplete','legalCountryCode',v_runtime.legal_country_code,'legalSubnationalCode',v_runtime.legal_subnational_code,'uiLocale',v_locale);
  end if;
  if v_candidate_id is not null and not public.legal_subnational_language_requirements_satisfied(v_candidate_id) then
    return jsonb_build_object('status','blocked_subnational_language_requirement_incomplete','legalCountryCode',v_runtime.legal_country_code,'legalSubnationalCode',v_runtime.legal_subnational_code,'uiLocale',v_locale);
  end if;
  if v_candidate_id is not null and not public.legal_applicability_bundle_satisfied(v_user_id,v_candidate_id) then
    return jsonb_build_object('status','blocked_legal_applicability_documents_incomplete','legalCountryCode',v_runtime.legal_country_code,'legalSubnationalCode',v_runtime.legal_subnational_code,'uiLocale',v_locale,'applicabilityMatrixId',v_runtime.current_applicability_matrix_id);
  end if;

  v_bundle_id:=public.resolve_current_legal_bundle_id(v_user_id,v_locale);
  if v_bundle_id is null then return jsonb_build_object('status','blocked_legal_bundle_missing','legalCountryCode',v_runtime.legal_country_code,'legalSubnationalCode',v_runtime.legal_subnational_code,'uiLocale',v_locale); end if;
  select * into v_bundle from public.legal_document_bundles where bundle_id=v_bundle_id;
  select coalesce(jsonb_object_agg(document_type,document_url),'{}'::jsonb) into v_docs from public.legal_bundle_documents where bundle_id=v_bundle_id;
  select exists(select 1 from public.legal_acceptances a where a.user_id=v_user_id and a.bundle_id=v_bundle_id) into v_accepted;
  select exists(select 1 from public.privacy_notice_acknowledgements p where p.user_id=v_user_id and p.bundle_id=v_bundle_id) into v_privacy_ack;
  return jsonb_build_object(
    'status','ready','accepted',v_accepted and v_privacy_ack,'bundleId',v_bundle.bundle_id,
    'legalCountryCode',v_bundle.legal_country_code,'legalSubnationalCode',v_bundle.legal_subnational_code,
    'uiLocale',v_bundle.ui_locale,'documentLocale',v_bundle.document_locale,'legalVersion',v_bundle.legal_version,
    'termsVersion',v_bundle.terms_version,'communityGuidelinesVersion',v_bundle.community_guidelines_version,
    'privacyNoticeVersion',v_bundle.privacy_notice_version,'marketingPushConsentVersion',v_bundle.marketing_push_consent_version,
    'termsUrl',v_docs->>'terms','privacyNoticeUrl',v_docs->>'privacy_notice','communityGuidelinesUrl',v_docs->>'community_guidelines',
    'marketingPushConsentUrl',v_docs->>'marketing_push_consent','subscriptionConsumerUrl',v_docs->>'subscription_consumer',
    'moderationAppealsUrl',v_docs->>'moderation_appeals','intellectualPropertyUrl',v_docs->>'intellectual_property',
    'accessibilityUrl',v_docs->>'accessibility','accountDeletionUrl',v_docs->>'account_deletion','supportUrl',v_docs->>'support',
    'jurisdictionPrivacySupplementUrl',v_docs->>'jurisdiction_privacy_supplement','legalDocumentUrls',v_docs,
    'applicabilityMatrixId',v_runtime.current_applicability_matrix_id,
    'effectiveAt',v_bundle.effective_at,'ageAssuranceMode',v_policy.age_assurance_mode,'minimumUserAge',v_policy.minimum_user_age
  );
end $$;
revoke all on function public.get_current_legal_context(text) from public,anon;
grant execute on function public.get_current_legal_context(text) to authenticated;

revoke all on table public.legal_applicability_matrices,public.legal_applicability_overlays,public.legal_bundle_overlay_documents from public,anon,authenticated;
