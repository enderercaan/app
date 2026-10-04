-- Tailmance v19 legal presentation/pre-contract binding finalization.
-- Unifies the exact overlay-document set with the whole displayed presentation, prevents silent
-- acceptance of unseen supplements, and binds subscription pre-contract UI to the exact current documents.

-- Acceptance evidence is append-only. Service code may never erase an acceptance presentation.
revoke delete on table public.legal_acceptance_presentations from service_role;
grant select,insert on table public.legal_acceptance_presentations to service_role;

-- The binding presentation includes the local privacy supplement (e.g. TR KVKK notice) when required.
create or replace function public.legal_acceptance_presentation_payload(p_user_id uuid,p_bundle_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_matrix_id uuid;v_base jsonb;v_overlay jsonb;
begin
  if p_user_id is null or p_bundle_id is null then return null; end if;
  select current_applicability_matrix_id into v_matrix_id from public.legal_country_runtime where user_id=p_user_id;
  if v_matrix_id is null then return null; end if;
  if public.resolve_current_legal_bundle_id(p_user_id,(select ui_locale from public.legal_document_bundles where bundle_id=p_bundle_id)) is distinct from p_bundle_id then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'documentType',d.document_type,'documentLocale',d.document_locale,'documentVersion',d.document_version,
    'documentUrl',d.document_url,'documentSha256',d.document_sha256
  ) order by d.document_type),'[]'::jsonb) into v_base
  from public.legal_bundle_documents d
  where d.bundle_id=p_bundle_id
    and d.document_type=any(array['terms','privacy_notice','community_guidelines','jurisdiction_privacy_supplement']::text[]);

  select coalesce(jsonb_agg(jsonb_build_object(
    'overlayDocumentId',d.overlay_document_id,'overlayId',d.overlay_id,
    'jurisdictionCountryCode',o.jurisdiction_country_code,'jurisdictionSubnationalCode',o.jurisdiction_subnational_code,
    'applicabilityBasis',o.applicability_basis,'documentType',d.document_type,'documentLocale',d.document_locale,
    'documentVersion',d.document_version,'documentUrl',d.document_url,'documentSha256',d.document_sha256,
    'actionRequirement',d.user_action_requirement
  ) order by o.jurisdiction_country_code,coalesce(o.jurisdiction_subnational_code,''),d.document_type,d.document_locale,d.overlay_document_id),'[]'::jsonb) into v_overlay
  from public.legal_bundle_overlay_documents d
  join public.legal_applicability_overlays o on o.overlay_id=d.overlay_id and o.matrix_id=d.matrix_id and o.applicability_status='applicable'
  where d.matrix_id=v_matrix_id and d.bundle_id=p_bundle_id;

  return jsonb_build_object(
    'matrixId',v_matrix_id,'bundleId',p_bundle_id,
    'overlayDocumentSetSha256',public.current_legal_overlay_document_set_sha256(p_user_id,p_bundle_id),
    'baseDocuments',v_base,'overlayDocuments',v_overlay
  );
end $$;
revoke all on function public.legal_acceptance_presentation_payload(uuid,uuid) from public,anon,authenticated;
grant execute on function public.legal_acceptance_presentation_payload(uuid,uuid) to service_role;

-- Exact document set shown immediately before a subscription purchase. This is presentation evidence,
-- not a claim that App Store / Google Play billing itself is controlled by this database transaction.
create or replace function public.current_subscription_purchase_document_set_sha256(p_user_id uuid,p_bundle_id uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare v_matrix_id uuid;v_base jsonb;v_overlay jsonb;
begin
  if p_user_id is null or p_bundle_id is null then return null; end if;
  select current_applicability_matrix_id into v_matrix_id from public.legal_country_runtime where user_id=p_user_id;
  if v_matrix_id is null then return null; end if;
  if public.resolve_current_legal_bundle_id(p_user_id,(select ui_locale from public.legal_document_bundles where bundle_id=p_bundle_id)) is distinct from p_bundle_id then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_array(d.document_type,d.document_locale,d.document_version,d.document_url,d.document_sha256) order by d.document_type),'[]'::jsonb)
    into v_base
  from public.legal_bundle_documents d
  where d.bundle_id=p_bundle_id and d.document_type=any(array['terms','privacy_notice','subscription_consumer']::text[]);

  select coalesce(jsonb_agg(jsonb_build_array(
      d.overlay_document_id::text,o.jurisdiction_country_code,coalesce(o.jurisdiction_subnational_code,''),o.applicability_basis,
      d.document_type,d.document_locale,d.document_version,d.document_url,d.document_sha256
    ) order by o.jurisdiction_country_code,coalesce(o.jurisdiction_subnational_code,''),o.applicability_basis,d.document_type,d.document_locale,d.overlay_document_id::text),'[]'::jsonb)
    into v_overlay
  from public.legal_bundle_overlay_documents d
  join public.legal_applicability_overlays o on o.overlay_id=d.overlay_id and o.matrix_id=d.matrix_id and o.applicability_status='applicable'
  where d.matrix_id=v_matrix_id and d.bundle_id=p_bundle_id
    and d.document_type=any(array['subscription_consumer','jurisdiction_consumer_supplement']::text[]);

  return encode(extensions.digest(convert_to(jsonb_build_object(
    'matrixId',v_matrix_id,'bundleId',p_bundle_id,'baseDocuments',v_base,'overlayDocuments',v_overlay
  )::text,'UTF8'),'sha256'),'hex');
end $$;
revoke all on function public.current_subscription_purchase_document_set_sha256(uuid,uuid) from public,anon,authenticated;
grant execute on function public.current_subscription_purchase_document_set_sha256(uuid,uuid) to service_role;

-- Final acceptance route: prove the whole presentation the client saw, then delegate writes to the
-- five-argument overlay-set-bound implementation from migration 071. The stale four-argument route stays blocked.
revoke execute on function public.accept_current_legal_bundle(uuid,uuid,text,boolean) from service_role;
revoke execute on function public.accept_current_legal_bundle(uuid,uuid,text,boolean,text) from service_role;

create or replace function public.accept_current_legal_bundle(
  p_user_id uuid,
  p_bundle_id uuid,
  p_ui_locale text,
  p_age_18_confirmed boolean,
  p_expected_applicability_matrix_id uuid,
  p_expected_presentation_sha256 text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_runtime public.legal_country_runtime;v_sha text;v_overlay_sha text;v_result jsonb;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden'; end if;
  if p_expected_applicability_matrix_id is null then raise exception 'expected_applicability_matrix_required'; end if;
  if coalesce(p_expected_presentation_sha256,'') !~ '^[0-9a-f]{64}$' then raise exception 'expected_legal_presentation_required'; end if;

  select * into v_runtime from public.legal_country_runtime where user_id=p_user_id for update;
  if not found then raise exception 'legal_country_unresolved'; end if;
  if v_runtime.current_applicability_matrix_id is distinct from p_expected_applicability_matrix_id then raise exception 'legal_presentation_context_changed'; end if;
  if not public.legal_applicability_matrix_satisfied(p_user_id) then raise exception 'legal_applicability_review_incomplete'; end if;

  v_sha:=public.legal_acceptance_presentation_sha256(p_user_id,p_bundle_id);
  if v_sha is null or v_sha<>p_expected_presentation_sha256 then raise exception 'legal_presentation_changed'; end if;
  v_overlay_sha:=public.current_legal_overlay_document_set_sha256(p_user_id,p_bundle_id);
  if v_overlay_sha is null then raise exception 'legal_overlay_document_set_unavailable'; end if;

  v_result:=public.accept_current_legal_bundle(p_user_id,p_bundle_id,p_ui_locale,p_age_18_confirmed,v_overlay_sha);
  if coalesce(v_result->>'applicabilityMatrixId','')<>p_expected_applicability_matrix_id::text then raise exception 'legal_acceptance_matrix_mismatch'; end if;
  if coalesce(v_result->>'overlayDocumentSetSha256','')<>v_overlay_sha then raise exception 'legal_acceptance_overlay_set_mismatch'; end if;

  insert into public.legal_acceptance_presentations(user_id,matrix_id,bundle_id,presentation_sha256,accepted_source,accepted_at)
  values(p_user_id,p_expected_applicability_matrix_id,p_bundle_id,v_sha,'verified_session_exact_presentation',now())
  on conflict(user_id,matrix_id,bundle_id,presentation_sha256) do nothing;

  if not public.legal_acceptance_presentation_complete(p_user_id,p_bundle_id) then raise exception 'legal_presentation_acceptance_not_recorded'; end if;
  return v_result||jsonb_build_object('presentationSha256',v_sha);
end $$;
revoke all on function public.accept_current_legal_bundle(uuid,uuid,text,boolean,uuid,text) from public,anon,authenticated;
grant execute on function public.accept_current_legal_bundle(uuid,uuid,text,boolean,uuid,text) to service_role;

-- Product access requires the exact current overlay-set evidence in addition to the whole-presentation hash.
create or replace function public.current_user_has_product_access()
returns boolean language sql stable security definer set search_path='' as $$
  select public.current_session_satisfies_mfa_if_enrolled() and exists(
    select 1 from public.users u
    join auth.users au on au.id=u.id and au.email_confirmed_at is not null
    join public.app_security_config c on c.singleton=true
    join public.legal_document_bundles b on b.bundle_id=public.resolve_current_legal_bundle_id(u.id,coalesce(u.preferred_locale,'en'))
    where u.id=auth.uid() and u.suspended_at is null and u.paused_at is null and u.age_18_confirmed=true
      and u.legal_version=b.legal_version and b.legal_version=c.current_legal_version and b.terms_version=c.current_terms_version
      and b.community_guidelines_version=c.current_community_guidelines_version and b.privacy_notice_version=c.current_privacy_notice_version
      and exists(select 1 from public.legal_acceptances a where a.user_id=u.id and a.bundle_id=b.bundle_id
        and a.legal_version=b.legal_version and a.terms_version=b.terms_version and a.community_guidelines_version=b.community_guidelines_version
        and a.terms_sha256=b.terms_sha256 and a.community_guidelines_sha256=b.community_guidelines_sha256
        and a.accepted_ui_locale=b.ui_locale and a.accepted_country_code=b.legal_country_code
        and coalesce(a.accepted_subnational_code,'')=coalesce(b.legal_subnational_code,'') and a.document_locale=b.document_locale
        and a.applicability_matrix_id=(select r.current_applicability_matrix_id from public.legal_country_runtime r where r.user_id=u.id)
        and a.overlay_document_set_sha256=public.current_legal_overlay_document_set_sha256(u.id,b.bundle_id))
      and exists(select 1 from public.privacy_notice_acknowledgements p where p.user_id=u.id and p.bundle_id=b.bundle_id
        and p.notice_version=b.privacy_notice_version and p.notice_sha256=b.privacy_notice_sha256 and p.locale=b.ui_locale
        and p.country_code=b.legal_country_code and coalesce(p.legal_subnational_code,'')=coalesce(b.legal_subnational_code,'')
        and p.document_locale=b.document_locale
        and p.applicability_matrix_id=(select r.current_applicability_matrix_id from public.legal_country_runtime r where r.user_id=u.id)
        and p.overlay_document_set_sha256=public.current_legal_overlay_document_set_sha256(u.id,b.bundle_id))
      and public.legal_overlay_document_actions_complete(u.id,b.bundle_id)
      and public.legal_acceptance_presentation_complete(u.id,b.bundle_id)
  );
$$;
revoke all on function public.current_user_has_product_access() from public,anon,authenticated;
grant execute on function public.current_user_has_product_access() to service_role;

-- Context exposes all exact document-set hashes used by user-action and pre-contract flows.
create or replace function public.get_current_legal_context(p_ui_locale text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_user_id uuid:=auth.uid();v_runtime public.legal_country_runtime;v_policy public.legal_jurisdiction_policies;
  v_bundle public.legal_document_bundles;v_bundle_id uuid;v_candidate_id uuid;v_locale text:=trim(coalesce(p_ui_locale,''));
  v_accepted boolean:=false;v_privacy_ack boolean:=false;v_overlay_actions boolean:=false;v_presentation_complete boolean:=false;
  v_docs jsonb:='{}'::jsonb;v_overlay_docs jsonb:='[]'::jsonb;v_presentation_sha text;v_overlay_sha text;v_marketing_sha text;v_subscription_sha text;
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

  select r.current_bundle_id into v_candidate_id from public.legal_document_bundle_routes r join public.legal_document_bundles b on b.bundle_id=r.current_bundle_id
  where r.legal_country_code=v_runtime.legal_country_code
    and r.legal_subnational_code=case when v_policy.subnational_review_required then coalesce(v_runtime.legal_subnational_code,'') else '' end
    and r.ui_locale=v_locale and r.route_status='active' and r.effective_at is not null and r.effective_at<=now()
    and b.legal_country_code=r.legal_country_code and coalesce(b.legal_subnational_code,'')=r.legal_subnational_code and b.ui_locale=r.ui_locale limit 1;
  if v_candidate_id is not null and not public.legal_bundle_document_manifest_complete(v_candidate_id) then return jsonb_build_object('status','blocked_legal_document_manifest_incomplete','legalCountryCode',v_runtime.legal_country_code,'legalSubnationalCode',v_runtime.legal_subnational_code,'uiLocale',v_locale); end if;
  if v_candidate_id is not null and not public.legal_subnational_language_requirements_satisfied(v_candidate_id) then return jsonb_build_object('status','blocked_subnational_language_requirement_incomplete','legalCountryCode',v_runtime.legal_country_code,'legalSubnationalCode',v_runtime.legal_subnational_code,'uiLocale',v_locale); end if;
  if v_candidate_id is not null and not public.legal_applicability_bundle_satisfied(v_user_id,v_candidate_id) then return jsonb_build_object('status','blocked_legal_applicability_documents_incomplete','legalCountryCode',v_runtime.legal_country_code,'legalSubnationalCode',v_runtime.legal_subnational_code,'uiLocale',v_locale,'applicabilityMatrixId',v_runtime.current_applicability_matrix_id); end if;

  v_bundle_id:=public.resolve_current_legal_bundle_id(v_user_id,v_locale);
  if v_bundle_id is null then return jsonb_build_object('status','blocked_legal_bundle_missing','legalCountryCode',v_runtime.legal_country_code,'legalSubnationalCode',v_runtime.legal_subnational_code,'uiLocale',v_locale); end if;
  select * into v_bundle from public.legal_document_bundles where bundle_id=v_bundle_id;
  select coalesce(jsonb_object_agg(document_type,document_url),'{}'::jsonb) into v_docs from public.legal_bundle_documents where bundle_id=v_bundle_id;
  v_overlay_docs:=public.current_legal_overlay_documents(v_user_id,v_bundle_id);
  v_overlay_sha:=public.current_legal_overlay_document_set_sha256(v_user_id,v_bundle_id);
  v_marketing_sha:=public.current_marketing_consent_document_set_sha256(v_user_id,v_bundle_id);
  v_subscription_sha:=public.current_subscription_purchase_document_set_sha256(v_user_id,v_bundle_id);
  v_presentation_sha:=public.legal_acceptance_presentation_sha256(v_user_id,v_bundle_id);
  select exists(select 1 from public.legal_acceptances a where a.user_id=v_user_id and a.bundle_id=v_bundle_id
    and a.applicability_matrix_id=v_runtime.current_applicability_matrix_id and a.overlay_document_set_sha256=v_overlay_sha) into v_accepted;
  select exists(select 1 from public.privacy_notice_acknowledgements p where p.user_id=v_user_id and p.bundle_id=v_bundle_id
    and p.applicability_matrix_id=v_runtime.current_applicability_matrix_id and p.overlay_document_set_sha256=v_overlay_sha) into v_privacy_ack;
  v_overlay_actions:=public.legal_overlay_document_actions_complete(v_user_id,v_bundle_id);
  v_presentation_complete:=public.legal_acceptance_presentation_complete(v_user_id,v_bundle_id);
  return jsonb_build_object(
    'status','ready','accepted',v_accepted and v_privacy_ack and v_overlay_actions and v_presentation_complete,'bundleId',v_bundle.bundle_id,
    'legalCountryCode',v_bundle.legal_country_code,'legalSubnationalCode',v_bundle.legal_subnational_code,
    'uiLocale',v_bundle.ui_locale,'documentLocale',v_bundle.document_locale,'legalVersion',v_bundle.legal_version,
    'termsVersion',v_bundle.terms_version,'communityGuidelinesVersion',v_bundle.community_guidelines_version,
    'privacyNoticeVersion',v_bundle.privacy_notice_version,'marketingPushConsentVersion',v_bundle.marketing_push_consent_version,
    'termsUrl',v_docs->>'terms','privacyNoticeUrl',v_docs->>'privacy_notice','communityGuidelinesUrl',v_docs->>'community_guidelines',
    'marketingPushConsentUrl',v_docs->>'marketing_push_consent','subscriptionConsumerUrl',v_docs->>'subscription_consumer',
    'moderationAppealsUrl',v_docs->>'moderation_appeals','intellectualPropertyUrl',v_docs->>'intellectual_property',
    'accessibilityUrl',v_docs->>'accessibility','accountDeletionUrl',v_docs->>'account_deletion','supportUrl',v_docs->>'support',
    'jurisdictionPrivacySupplementUrl',v_docs->>'jurisdiction_privacy_supplement','legalDocumentUrls',v_docs,
    'applicabilityMatrixId',v_runtime.current_applicability_matrix_id,'overlayDocuments',v_overlay_docs,'overlayActionsComplete',v_overlay_actions,
    'overlayDocumentSetSha256',v_overlay_sha,'marketingConsentDocumentSetSha256',v_marketing_sha,
    'subscriptionPurchaseDocumentSetSha256',v_subscription_sha,
    'acceptancePresentationSha256',v_presentation_sha,'presentationAcceptanceComplete',v_presentation_complete,
    'effectiveAt',v_bundle.effective_at,'ageAssuranceMode',v_policy.age_assurance_mode,'minimumUserAge',v_policy.minimum_user_age
  );
end $$;
revoke all on function public.get_current_legal_context(text) from public,anon;
grant execute on function public.get_current_legal_context(text) to authenticated;

create or replace function public.service_product_access_user_ids(p_user_ids uuid[])
returns table(user_id uuid) language plpgsql stable security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_user_ids is null or cardinality(p_user_ids)=0 then return; end if;
  if cardinality(p_user_ids)>200 then raise exception 'too_many_user_ids'; end if;
  return query
  select u.id from public.users u
  join auth.users au on au.id=u.id and au.email_confirmed_at is not null
  join public.app_security_config c on c.singleton=true
  join public.legal_document_bundles b on b.bundle_id=public.resolve_current_legal_bundle_id(u.id,coalesce(u.preferred_locale,'en'))
  where u.id=any(p_user_ids) and u.suspended_at is null and u.paused_at is null and u.age_18_confirmed=true
    and u.legal_version=b.legal_version and b.legal_version=c.current_legal_version and b.terms_version=c.current_terms_version
    and b.community_guidelines_version=c.current_community_guidelines_version and b.privacy_notice_version=c.current_privacy_notice_version
    and exists(select 1 from public.legal_acceptances a where a.user_id=u.id and a.bundle_id=b.bundle_id
      and a.terms_sha256=b.terms_sha256 and a.community_guidelines_sha256=b.community_guidelines_sha256
      and a.applicability_matrix_id=(select r.current_applicability_matrix_id from public.legal_country_runtime r where r.user_id=u.id)
      and a.overlay_document_set_sha256=public.current_legal_overlay_document_set_sha256(u.id,b.bundle_id))
    and exists(select 1 from public.privacy_notice_acknowledgements p where p.user_id=u.id and p.bundle_id=b.bundle_id
      and p.notice_sha256=b.privacy_notice_sha256
      and p.applicability_matrix_id=(select r.current_applicability_matrix_id from public.legal_country_runtime r where r.user_id=u.id)
      and p.overlay_document_set_sha256=public.current_legal_overlay_document_set_sha256(u.id,b.bundle_id))
    and public.legal_overlay_document_actions_complete(u.id,b.bundle_id)
    and public.legal_acceptance_presentation_complete(u.id,b.bundle_id);
end $$;
revoke all on function public.service_product_access_user_ids(uuid[]) from public,anon,authenticated;
grant execute on function public.service_product_access_user_ids(uuid[]) to service_role;
