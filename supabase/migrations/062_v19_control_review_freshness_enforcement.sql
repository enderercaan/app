-- Tailmance v19 per-control legal-review freshness enforcement.
-- A fresh top-level country approval must not be able to carry materially stale topic-level
-- counsel/applicability conclusions. Every one of the 22 canonical control reviews therefore
-- carries its own bounded validity window and fails closed after expiry.

create or replace function public.legal_control_reviews_complete(p_reviews jsonb)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare
  v_family text;
  v_review jsonb;
  v_text text;
  v_reviewed timestamptz;
  v_applicability_checked timestamptz;
  v_valid_until timestamptz;
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
    if nullif(trim(v_review->>'reviewed_at'),'') is null
       or nullif(trim(v_review->>'applicability_checked_at'),'') is null
       or nullif(trim(v_review->>'valid_until'),'') is null then return false; end if;
    begin
      v_reviewed:=(v_review->>'reviewed_at')::timestamptz;
      v_applicability_checked:=(v_review->>'applicability_checked_at')::timestamptz;
      v_valid_until:=(v_review->>'valid_until')::timestamptz;
    exception when others then return false;
    end;
    if v_reviewed>now()+interval '5 minutes' or v_applicability_checked>now()+interval '5 minutes' then return false; end if;
    if v_reviewed<now()-interval '90 days' or v_applicability_checked<now()-interval '90 days' then return false; end if;
    if v_valid_until<=now() or v_valid_until<=v_reviewed or v_valid_until<=v_applicability_checked then return false; end if;
    if v_valid_until>greatest(v_reviewed,v_applicability_checked)+interval '90 days' then return false; end if;
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

-- Any legacy approval that lacks a still-current per-control validity window is invalidated.
update public.legal_jurisdiction_policies
set release_status='blocked',updated_by='v19_062_control_review_freshness',updated_at=now()
where release_status='approved' and not public.legal_control_reviews_complete(control_reviews);
