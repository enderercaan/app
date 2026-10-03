-- Tailmance v19 canonical legal-control family alignment.
-- Runtime approval must evaluate the same 22 independently release-blocking legal families
-- as the country/source registry. An old 18-family approval is intentionally invalidated.

create or replace function public.legal_required_control_families()
returns text[] language sql immutable set search_path='' as $$
  select array[
    'privacy','consumer','age','ugc_moderation','subscription_iap','international_transfer',
    'data_localization','representative_requirement','store_platform_obligations','animal_welfare',
    'breeding_mating','pet_commerce','subnational_requirements','applicability_effective_dates',
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

    if v_family='operator_identity_tax_invoicing' then
      if coalesce(v_review->>'operator_identity_disclosure_status','') not in ('approved','not_applicable_with_evidence') then return false; end if;
      if coalesce(jsonb_typeof(v_review->'operator_identity_disclosure_evidence_reference'),'')<>'array' or jsonb_array_length(v_review->'operator_identity_disclosure_evidence_reference')=0 then return false; end if;
      if exists(select 1 from jsonb_array_elements_text(v_review->'operator_identity_disclosure_evidence_reference') x(value) where nullif(trim(value),'') is null) then return false; end if;
      if coalesce(v_review->>'tax_invoicing_status','') not in ('approved','not_applicable_with_evidence') then return false; end if;
      if coalesce(jsonb_typeof(v_review->'tax_invoicing_evidence_reference'),'')<>'array' or jsonb_array_length(v_review->'tax_invoicing_evidence_reference')=0 then return false; end if;
      if exists(select 1 from jsonb_array_elements_text(v_review->'tax_invoicing_evidence_reference') x(value) where nullif(trim(value),'') is null) then return false; end if;
      if coalesce(v_review->>'registration_licensing_filing_notification_status','') not in ('approved','not_applicable_with_evidence') then return false; end if;
      if coalesce(jsonb_typeof(v_review->'registration_licensing_filing_notification_evidence_reference'),'')<>'array' or jsonb_array_length(v_review->'registration_licensing_filing_notification_evidence_reference')=0 then return false; end if;
      if exists(select 1 from jsonb_array_elements_text(v_review->'registration_licensing_filing_notification_evidence_reference') x(value) where nullif(trim(value),'') is null) then return false; end if;
    end if;
  end loop;
  if exists(select 1 from jsonb_object_keys(p_reviews) k where not (k=any(public.legal_required_control_families()))) then return false; end if;
  return true;
end $$;
revoke all on function public.legal_control_reviews_complete(jsonb) from public,anon,authenticated;
grant execute on function public.legal_control_reviews_complete(jsonb) to service_role;

-- Old 18-family approvals, stale combined-family objects, or any incomplete 22-family object fail closed.
update public.legal_jurisdiction_policies
set release_status='blocked',updated_by='v19_061_canonical_22_control_migration',updated_at=now()
where release_status='approved' and not public.legal_control_reviews_complete(control_reviews);
