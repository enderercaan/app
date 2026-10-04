-- Tailmance v19 exact-context legal-document manifest hardening.
-- Every release-active legal route must have immutable, hash-bound, counsel/source/localization-reviewed
-- documents for the full legal/support surface. Global environment URLs may never substitute for the
-- resolved legal-country + subnational + UI-locale + document-locale bundle.

alter table public.legal_jurisdiction_policies
  add column if not exists required_document_types text[] not null default array[
    'terms','privacy_notice','community_guidelines','marketing_push_consent','subscription_consumer',
    'moderation_appeals','intellectual_property','accessibility','account_deletion','support'
  ]::text[] check (cardinality(required_document_types)>0);

-- Türkiye additionally exposes a jurisdiction-specific KVKK/privacy supplement. Other markets can add
-- their own required supplements only after counsel determines the applicable document architecture.
update public.legal_jurisdiction_policies
set required_document_types=array[
  'terms','privacy_notice','community_guidelines','marketing_push_consent','subscription_consumer',
  'moderation_appeals','intellectual_property','accessibility','account_deletion','support','jurisdiction_privacy_supplement'
]::text[], updated_at=now(), updated_by='v19_064_context_bound_documents'
where legal_country_code='TR';

create table if not exists public.legal_bundle_documents (
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
  primary key(bundle_id,document_type),
  check (valid_until>reviewed_at),
  check (valid_until<=reviewed_at+interval '90 days')
);
create index if not exists legal_bundle_documents_locale_idx on public.legal_bundle_documents(bundle_id,document_locale,document_type);
alter table public.legal_bundle_documents enable row level security;
revoke all on table public.legal_bundle_documents from public,anon,authenticated;
grant select,insert on table public.legal_bundle_documents to service_role;

create or replace function public.prevent_immutable_legal_bundle_document_mutation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception 'immutable_legal_bundle_document';
end $$;
revoke all on function public.prevent_immutable_legal_bundle_document_mutation() from public,anon,authenticated;
drop trigger if exists trg_legal_bundle_documents_immutable on public.legal_bundle_documents;
create trigger trg_legal_bundle_documents_immutable
before update or delete on public.legal_bundle_documents
for each row execute function public.prevent_immutable_legal_bundle_document_mutation();

create or replace function public.legal_bundle_document_manifest_complete(p_bundle_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare
  v_bundle public.legal_document_bundles;
  v_policy public.legal_jurisdiction_policies;
  v_type text;
  v_doc public.legal_bundle_documents;
begin
  if p_bundle_id is null then return false; end if;
  select * into v_bundle from public.legal_document_bundles where bundle_id=p_bundle_id;
  if not found then return false; end if;
  select * into v_policy from public.legal_jurisdiction_policies where legal_country_code=v_bundle.legal_country_code;
  if not found or cardinality(v_policy.required_document_types)=0 then return false; end if;

  foreach v_type in array v_policy.required_document_types loop
    select * into v_doc from public.legal_bundle_documents where bundle_id=p_bundle_id and document_type=v_type;
    if not found then return false; end if;
    if v_doc.document_locale<>v_bundle.document_locale then return false; end if;
    if v_doc.reviewed_at>now()+interval '5 minutes' or v_doc.reviewed_at<now()-interval '90 days' then return false; end if;
    if v_doc.valid_until<=now() or v_doc.valid_until>v_doc.reviewed_at+interval '90 days' then return false; end if;
    if jsonb_array_length(v_doc.source_evidence_reference)=0 or jsonb_array_length(v_doc.counsel_evidence_reference)=0 or jsonb_array_length(v_doc.localization_evidence_reference)=0 then return false; end if;

    -- The four binding documents already present on the immutable bundle must be byte/hash/version-identical
    -- to their manifest entries; the manifest cannot point users to a different text than the accepted hash.
    if v_type='terms' and (v_doc.document_version<>v_bundle.terms_version or v_doc.document_url<>v_bundle.terms_url or v_doc.document_sha256<>v_bundle.terms_sha256) then return false; end if;
    if v_type='privacy_notice' and (v_doc.document_version<>v_bundle.privacy_notice_version or v_doc.document_url<>v_bundle.privacy_notice_url or v_doc.document_sha256<>v_bundle.privacy_notice_sha256) then return false; end if;
    if v_type='community_guidelines' and (v_doc.document_version<>v_bundle.community_guidelines_version or v_doc.document_url<>v_bundle.community_guidelines_url or v_doc.document_sha256<>v_bundle.community_guidelines_sha256) then return false; end if;
    if v_type='marketing_push_consent' and (v_doc.document_version<>v_bundle.marketing_push_consent_version or v_doc.document_url<>v_bundle.marketing_push_consent_url or v_doc.document_sha256<>v_bundle.marketing_push_consent_sha256) then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function public.legal_bundle_document_manifest_complete(uuid) from public,anon,authenticated;
grant execute on function public.legal_bundle_document_manifest_complete(uuid) to service_role;

-- Supersede bundle resolution: a route cannot resolve if any legal/support document is stale, missing,
-- mismatched to the bundle document locale, or lacks attributable source/counsel/localization evidence.
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
  limit 1;
  return v_bundle_id;
end $$;
revoke all on function public.resolve_current_legal_bundle_id(uuid,text) from public,anon,authenticated;

create or replace function public.enforce_legal_bundle_route_release_evidence()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_bundle public.legal_document_bundles;v_policy public.legal_jurisdiction_policies;
begin
  if new.route_status='active' then
    select * into v_policy from public.legal_jurisdiction_policies where legal_country_code=new.legal_country_code;
    if not found or v_policy.release_status<>'approved' or v_policy.legal_review_status<>'approved_by_external_counsel' or v_policy.language_review_status<>'approved' or v_policy.age_assurance_mode='unresolved' then raise exception 'jurisdiction_not_approved_for_runtime'; end if;
    if v_policy.legal_reviewed_at is null or v_policy.legal_reviewed_at>now() or v_policy.next_review_due_at is null or v_policy.next_review_due_at<=now() then raise exception 'jurisdiction_legal_review_expired'; end if;
    if not public.legal_control_reviews_complete(v_policy.control_reviews) then raise exception 'jurisdiction_topic_control_reviews_incomplete'; end if;
    if cardinality(v_policy.approved_document_locales)=0 then raise exception 'approved_document_locale_missing'; end if;
    if cardinality(v_policy.required_document_types)=0 then raise exception 'required_document_manifest_missing'; end if;
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
  end if;
  return new;
end $$;
revoke all on function public.enforce_legal_bundle_route_release_evidence() from public,anon,authenticated;

drop trigger if exists trg_legal_bundle_route_release_evidence on public.legal_document_bundle_routes;
create trigger trg_legal_bundle_route_release_evidence
before insert or update on public.legal_document_bundle_routes
for each row execute function public.enforce_legal_bundle_route_release_evidence();

-- Exact-context user-facing URLs. Raw evidence/reviewer records remain private.
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
  if v_runtime.expires_at is null or v_runtime.expires_at<=now() then return jsonb_build_object('status','blocked_legal_country_evidence_expired','legalCountryCode',v_runtime.legal_country_code); end if;
  if v_runtime.resolution_source not in ('habitual_residence_verified','service_contract_country_verified','manual_legal_review') then return jsonb_build_object('status','blocked_legal_country_provenance_insufficient','legalCountryCode',v_runtime.legal_country_code); end if;
  select * into v_policy from public.legal_jurisdiction_policies where legal_country_code=v_runtime.legal_country_code;
  if not found or v_policy.release_status<>'approved' then return jsonb_build_object('status','blocked_jurisdiction_not_approved','legalCountryCode',v_runtime.legal_country_code); end if;
  if v_policy.legal_reviewed_at is null or v_policy.legal_reviewed_at>now() or v_policy.next_review_due_at is null or v_policy.next_review_due_at<=now() then return jsonb_build_object('status','blocked_jurisdiction_review_expired','legalCountryCode',v_runtime.legal_country_code,'nextReviewDueAt',v_policy.next_review_due_at); end if;
  if not public.legal_control_reviews_complete(v_policy.control_reviews) then return jsonb_build_object('status','blocked_jurisdiction_control_review_incomplete','legalCountryCode',v_runtime.legal_country_code); end if;
  if v_policy.subnational_review_required and v_runtime.legal_subnational_code is null then return jsonb_build_object('status','blocked_subnational_review_required','legalCountryCode',v_runtime.legal_country_code); end if;
  if not public.current_legal_age_assurance_satisfied(v_user_id,v_runtime.legal_country_code,v_runtime.legal_subnational_code) then return jsonb_build_object('status','blocked_age_assurance_required','legalCountryCode',v_runtime.legal_country_code,'ageAssuranceMode',v_policy.age_assurance_mode,'minimumUserAge',v_policy.minimum_user_age); end if;

  -- Distinguish an exact route whose document manifest is incomplete/stale from a genuinely missing route.
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
    'effectiveAt',v_bundle.effective_at,'ageAssuranceMode',v_policy.age_assurance_mode,'minimumUserAge',v_policy.minimum_user_age
  );
end $$;
revoke all on function public.get_current_legal_context(text) from public,anon;
grant execute on function public.get_current_legal_context(text) to authenticated;
