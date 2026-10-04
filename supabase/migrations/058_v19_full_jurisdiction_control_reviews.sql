-- Tailmance v19 full jurisdiction topic-control review enforcement.
-- Country approval is not equivalent to privacy-only review. Every configured release-control family
-- must have attributable official-source + counsel/applicability evidence before runtime approval.

alter table public.legal_jurisdiction_policies
  add column if not exists control_reviews jsonb not null default '{}'::jsonb
    check (jsonb_typeof(control_reviews)='object');

create or replace function public.legal_required_control_families()
returns text[] language sql immutable set search_path='' as $$
  select array[
    'privacy','consumer','age','ugc_moderation','subscription_iap','international_transfer',
    'data_localization_or_representative','animal_welfare','breeding_mating','pet_commerce',
    'electronic_marketing_push','legal_document_language','digital_accessibility',
    'operator_identity_tax_invoicing','ip_notice_takedown','cybersecurity_breach_notification',
    'regulatory_recordkeeping','sanctions_payments_distribution'
  ]::text[];
$$;
revoke all on function public.legal_required_control_families() from public,anon,authenticated;
grant execute on function public.legal_required_control_families() to service_role;

create or replace function public.legal_control_reviews_complete(p_reviews jsonb)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare
  v_family text;
  v_review jsonb;
  v_text text;
  v_ts timestamptz;
begin
  if p_reviews is null or coalesce(jsonb_typeof(p_reviews),'')<>'object' then return false; end if;
  foreach v_family in array public.legal_required_control_families() loop
    v_review:=p_reviews->v_family;
    if v_review is null or coalesce(jsonb_typeof(v_review),'')<>'object' then return false; end if;
    if coalesce(v_review->>'status','') not in ('approved','not_applicable_with_evidence') then return false; end if;
    if coalesce(jsonb_typeof(v_review->'official_source_reference'),'')<>'array' or jsonb_array_length(v_review->'official_source_reference')=0 then return false; end if;
    if exists(select 1 from jsonb_array_elements_text(v_review->'official_source_reference') x(value) where nullif(trim(value),'') is null or value !~ '^https://') then return false; end if;
    if coalesce(jsonb_typeof(v_review->'evidence_reference'),'')<>'array' or jsonb_array_length(v_review->'evidence_reference')=0 then return false; end if;
    if exists(select 1 from jsonb_array_elements_text(v_review->'evidence_reference') x(value) where nullif(trim(value),'') is null) then return false; end if;
    if coalesce(jsonb_typeof(v_review->'reviewer'),'')<>'object' or nullif(trim(v_review#>>'{reviewer,name}'),'') is null then return false; end if;
    if char_length(trim(v_review#>>'{reviewer,name}'))>160 then return false; end if;
    if nullif(trim(v_review->>'reviewed_at'),'') is null or nullif(trim(v_review->>'applicability_checked_at'),'') is null then return false; end if;
    begin
      v_ts:=(v_review->>'reviewed_at')::timestamptz;
      if v_ts>now()+interval '5 minutes' then return false; end if;
      v_ts:=(v_review->>'applicability_checked_at')::timestamptz;
      if v_ts>now()+interval '5 minutes' then return false; end if;
    exception when others then return false;
    end;
    v_text:=coalesce(v_review->>'scope_note','');
    if char_length(trim(v_text))<8 or char_length(v_text)>4000 then return false; end if;
  end loop;
  if exists(select 1 from jsonb_object_keys(p_reviews) k where not (k=any(public.legal_required_control_families()))) then return false; end if;
  return true;
end $$;
revoke all on function public.legal_control_reviews_complete(jsonb) from public,anon,authenticated;
grant execute on function public.legal_control_reviews_complete(jsonb) to service_role;

create or replace function public.enforce_legal_jurisdiction_policy_control_reviews()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.release_status='approved' and not public.legal_control_reviews_complete(new.control_reviews) then
    raise exception 'jurisdiction_topic_control_reviews_incomplete';
  end if;
  if new.release_status='approved' and (new.legal_reviewed_at is null or new.legal_reviewed_at>now()+interval '5 minutes' or new.next_review_due_at is null or new.next_review_due_at<=now() or new.next_review_due_at<=new.legal_reviewed_at or new.next_review_due_at>new.legal_reviewed_at+interval '90 days') then
    raise exception 'jurisdiction_legal_review_window_invalid';
  end if;
  return new;
end $$;
revoke all on function public.enforce_legal_jurisdiction_policy_control_reviews() from public,anon,authenticated;

drop trigger if exists trg_legal_jurisdiction_policy_control_reviews on public.legal_jurisdiction_policies;
create trigger trg_legal_jurisdiction_policy_control_reviews
before insert or update on public.legal_jurisdiction_policies
for each row execute function public.enforce_legal_jurisdiction_policy_control_reviews();

-- A pre-existing approval from an earlier migration can never survive without the new 18-family review object.
update public.legal_jurisdiction_policies
set release_status='blocked',updated_by='v19_058_control_review_migration',updated_at=now()
where release_status='approved' and not public.legal_control_reviews_complete(control_reviews);

create or replace function public.service_set_legal_jurisdiction_control_reviews(
  p_country_code text,
  p_control_reviews jsonb,
  p_updated_by text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_country text:=upper(trim(coalesce(p_country_code,'')));
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if v_country !~ '^[A-Z]{2}$' then raise exception 'invalid_country_code'; end if;
  if not exists(select 1 from public.legal_jurisdiction_policies where legal_country_code=v_country) then raise exception 'unlisted_country_blocked'; end if;
  if nullif(trim(coalesce(p_updated_by,'')),'') is null or char_length(trim(p_updated_by))>160 then raise exception 'invalid_updated_by'; end if;
  if not public.legal_control_reviews_complete(p_control_reviews) then raise exception 'jurisdiction_topic_control_reviews_incomplete'; end if;
  update public.legal_jurisdiction_policies
    set control_reviews=p_control_reviews,updated_by=trim(p_updated_by),updated_at=now()
    where legal_country_code=v_country;
  return jsonb_build_object('ok',true,'legalCountryCode',v_country,'controlReviewCount',jsonb_object_length(p_control_reviews));
end $$;
revoke all on function public.service_set_legal_jurisdiction_control_reviews(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.service_set_legal_jurisdiction_control_reviews(text,jsonb,text) to service_role;

-- Supersede resolution so no historical/direct row can grant product access without the 18/18 control review.
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
  if not public.legal_control_reviews_complete(v_policy.control_reviews) then return null; end if;
  if cardinality(v_policy.approved_document_locales)=0 then return null; end if;
  if jsonb_array_length(v_policy.source_evidence_reference)=0 or jsonb_array_length(v_policy.counsel_evidence_reference)=0 or jsonb_array_length(v_policy.subnational_evidence_reference)=0 or jsonb_array_length(v_policy.language_evidence_reference)=0 or jsonb_array_length(v_policy.localization_evidence_reference)=0 or jsonb_array_length(v_policy.age_assurance_evidence_reference)=0 or jsonb_array_length(v_policy.animal_welfare_evidence_reference)=0 or jsonb_array_length(v_policy.breeding_mating_evidence_reference)=0 or jsonb_array_length(v_policy.pet_commerce_evidence_reference)=0 or jsonb_array_length(v_policy.operational_evidence_reference)=0 then return null; end if;
  if v_policy.effective_at is null or v_policy.effective_at>now() or (v_policy.expires_at is not null and v_policy.expires_at<=now()) then return null; end if;
  if v_policy.subnational_review_required and v_runtime.legal_subnational_code is null then return null; end if;
  if ((v_runtime.storefront_country_code is not null and v_runtime.storefront_country_code<>v_runtime.legal_country_code) or (v_runtime.operational_country_code is not null and v_runtime.operational_country_code<>v_runtime.legal_country_code)) and v_runtime.country_mismatch_reviewed is distinct from true then return null; end if;
  if not public.current_legal_age_assurance_satisfied(p_user_id,v_runtime.legal_country_code,v_runtime.legal_subnational_code) then return null; end if;
  select r.current_bundle_id into v_bundle_id
  from public.legal_document_bundle_routes r
  join public.legal_document_bundles b on b.bundle_id=r.current_bundle_id
  where r.legal_country_code=v_runtime.legal_country_code
    and r.legal_subnational_code=case when v_policy.subnational_review_required then coalesce(v_runtime.legal_subnational_code,'') else '' end
    and r.ui_locale=v_locale and r.route_status='active'
    and r.effective_at is not null and r.effective_at<=now() and jsonb_array_length(r.evidence_reference)>0
    and b.legal_country_code=r.legal_country_code and coalesce(b.legal_subnational_code,'')=r.legal_subnational_code
    and b.ui_locale=r.ui_locale and b.document_locale=any(v_policy.approved_document_locales) and b.effective_at<=now()
    and jsonb_array_length(b.source_evidence_reference)>0 and jsonb_array_length(b.counsel_evidence_reference)>0 and jsonb_array_length(b.localization_evidence_reference)>0
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
