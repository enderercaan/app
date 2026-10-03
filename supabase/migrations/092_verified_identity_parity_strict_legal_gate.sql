-- Executed-Postgres verification fix (2026-10-03): PL/pgSQL ends an IF condition at the first THEN, so
-- inline CASE expressions inside IF conditions are parenthesized to compile on a real PostgreSQL server.
-- Tailmance v19 R8: verified phone/email identity parity without weakening the strict v19 legal gate.
-- The exact overlay/presentation/MFA/privacy evidence requirements from migrations 071/073 remain intact.

create or replace function public.accept_current_legal_bundle(
  p_user_id uuid,
  p_bundle_id uuid,
  p_ui_locale text,
  p_age_18_confirmed boolean,
  p_presented_overlay_document_set_sha256 text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_bundle public.legal_document_bundles;
  v_runtime public.legal_country_runtime;
  v_current_bundle_id uuid;
  v_overlay_actions integer:=0;
  v_current_overlay_document_set_sha256 text;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden'; end if;
  if p_user_id is null or p_age_18_confirmed is distinct from true then raise exception 'age_confirmation_required'; end if;
  if p_bundle_id is null then raise exception 'legal_bundle_required'; end if;
  if char_length(trim(coalesce(p_ui_locale,''))) not between 2 and 16 then raise exception 'invalid_locale'; end if;
  if not exists(select 1 from auth.users au where au.id=p_user_id and (au.email_confirmed_at is not null or au.phone_confirmed_at is not null)) then raise exception 'identity_verification_required_before_legal_acceptance'; end if;

  select * into v_runtime from public.legal_country_runtime where user_id=p_user_id for update;
  if not found or v_runtime.resolution_status<>'verified' or v_runtime.legal_country_code is null then raise exception 'legal_country_unresolved'; end if;
  if v_runtime.expires_at is null or v_runtime.expires_at<=now() then raise exception 'legal_country_evidence_expired'; end if;
  if v_runtime.current_applicability_matrix_id is null or not public.legal_applicability_matrix_satisfied(p_user_id) then raise exception 'legal_applicability_review_incomplete'; end if;

  v_current_bundle_id:=public.resolve_current_legal_bundle_id(p_user_id,trim(p_ui_locale));
  if v_current_bundle_id is null or v_current_bundle_id<>p_bundle_id then raise exception 'legal_bundle_not_current_for_context'; end if;
  if not public.legal_applicability_bundle_satisfied(p_user_id,p_bundle_id) then raise exception 'legal_overlay_documents_incomplete'; end if;
  v_current_overlay_document_set_sha256:=public.current_legal_overlay_document_set_sha256(p_user_id,p_bundle_id);
  if p_presented_overlay_document_set_sha256 is null or p_presented_overlay_document_set_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'presented_overlay_document_set_hash_required'; end if;
  if p_presented_overlay_document_set_sha256<>v_current_overlay_document_set_sha256 then raise exception 'legal_overlay_document_set_changed'; end if;
  select * into v_bundle from public.legal_document_bundles where bundle_id=p_bundle_id;
  if not found then raise exception 'legal_bundle_not_found'; end if;
  if v_bundle.legal_country_code<>v_runtime.legal_country_code
     or coalesce(v_bundle.legal_subnational_code,'')<>(case when public.legal_country_requires_subnational_review(v_runtime.legal_country_code) then coalesce(v_runtime.legal_subnational_code,'') else '' end)
     or v_bundle.ui_locale<>trim(p_ui_locale) then raise exception 'legal_bundle_context_mismatch'; end if;

  update public.users set age_18_confirmed=true,legal_version=v_bundle.legal_version,preferred_locale=v_bundle.ui_locale,updated_at=now() where id=p_user_id;
  if not found then raise exception 'user_profile_not_found'; end if;

  insert into public.legal_acceptances(
    user_id,legal_version,terms_version,community_guidelines_version,locale,country_code,accepted_source,accepted_at,
    bundle_id,document_locale,terms_sha256,community_guidelines_sha256,accepted_ui_locale,accepted_country_code,accepted_subnational_code,applicability_matrix_id,overlay_document_set_sha256
  ) values(
    p_user_id,v_bundle.legal_version,v_bundle.terms_version,v_bundle.community_guidelines_version,v_bundle.ui_locale,v_bundle.legal_country_code,
    'verified_session_immutable_bundle',now(),v_bundle.bundle_id,v_bundle.document_locale,v_bundle.terms_sha256,v_bundle.community_guidelines_sha256,
    v_bundle.ui_locale,v_bundle.legal_country_code,v_bundle.legal_subnational_code,v_runtime.current_applicability_matrix_id,v_current_overlay_document_set_sha256
  );

  insert into public.privacy_notice_acknowledgements(
    user_id,notice_version,locale,country_code,acknowledged_source,acknowledged_at,bundle_id,document_locale,notice_sha256,legal_subnational_code,applicability_matrix_id,overlay_document_set_sha256
  ) values(
    p_user_id,v_bundle.privacy_notice_version,v_bundle.ui_locale,v_bundle.legal_country_code,'verified_session_immutable_bundle',now(),
    v_bundle.bundle_id,v_bundle.document_locale,v_bundle.privacy_notice_sha256,v_bundle.legal_subnational_code,v_runtime.current_applicability_matrix_id,v_current_overlay_document_set_sha256
  );

  insert into public.legal_overlay_document_actions(
    user_id,matrix_id,overlay_id,bundle_id,overlay_document_id,document_type,document_locale,document_version,document_sha256,action_type,accepted_source,accepted_at
  )
  select p_user_id,d.matrix_id,d.overlay_id,d.bundle_id,d.overlay_document_id,d.document_type,d.document_locale,d.document_version,d.document_sha256,
    case when d.user_action_requirement='affirmative_acceptance' then 'accepted' else 'acknowledged' end,
    'verified_session_current_applicability_matrix',now()
  from public.legal_bundle_overlay_documents d
  join public.legal_applicability_overlays o on o.overlay_id=d.overlay_id and o.matrix_id=d.matrix_id and o.applicability_status='applicable'
  where d.matrix_id=v_runtime.current_applicability_matrix_id and d.bundle_id=v_bundle.bundle_id and d.user_action_requirement<>'none'
  on conflict(user_id,overlay_document_id,document_sha256,action_type) do nothing;
  get diagnostics v_overlay_actions=row_count;

  if not public.legal_overlay_document_actions_complete(p_user_id,p_bundle_id) then raise exception 'required_overlay_legal_action_not_recorded'; end if;

  insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
  values(p_user_id,'legal_bundle_accepted','legal_document_bundle',v_bundle.bundle_id,jsonb_build_object(
    'bundleId',v_bundle.bundle_id,'legalCountry',v_bundle.legal_country_code,'legalSubnational',v_bundle.legal_subnational_code,
    'uiLocale',v_bundle.ui_locale,'documentLocale',v_bundle.document_locale,'legalVersion',v_bundle.legal_version,
    'termsVersion',v_bundle.terms_version,'communityGuidelinesVersion',v_bundle.community_guidelines_version,
    'privacyNoticeVersion',v_bundle.privacy_notice_version,'privacyNoticeIsConsent',false,
    'applicabilityMatrixId',v_runtime.current_applicability_matrix_id,'overlayDocumentSetSha256',v_current_overlay_document_set_sha256,'overlayActionsRecorded',v_overlay_actions
  ));

  return jsonb_build_object(
    'ok',true,'age18Confirmed',true,'bundleId',v_bundle.bundle_id,'legalCountryCode',v_bundle.legal_country_code,
    'legalSubnationalCode',v_bundle.legal_subnational_code,'uiLocale',v_bundle.ui_locale,'documentLocale',v_bundle.document_locale,
    'legalVersion',v_bundle.legal_version,'termsVersion',v_bundle.terms_version,'communityGuidelinesVersion',v_bundle.community_guidelines_version,
    'privacyNoticeVersion',v_bundle.privacy_notice_version,'marketingPushConsentVersion',v_bundle.marketing_push_consent_version,
    'applicabilityMatrixId',v_runtime.current_applicability_matrix_id,'overlayDocumentSetSha256',v_current_overlay_document_set_sha256,'overlayActionsRecorded',v_overlay_actions
  );
end $$;
revoke all on function public.accept_current_legal_bundle(uuid,uuid,text,boolean,text) from public,anon,authenticated;
grant execute on function public.accept_current_legal_bundle(uuid,uuid,text,boolean,text) to service_role;

create or replace function public.current_user_has_product_access()
returns boolean language sql stable security definer set search_path='' as $$
  select public.current_session_satisfies_mfa_if_enrolled() and exists(
    select 1 from public.users u
    join auth.users au on au.id=u.id and (au.email_confirmed_at is not null or au.phone_confirmed_at is not null)
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

create or replace function public.service_product_access_user_ids(p_user_ids uuid[])
returns table(user_id uuid) language plpgsql stable security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_user_ids is null or cardinality(p_user_ids)=0 then return; end if;
  if cardinality(p_user_ids)>200 then raise exception 'too_many_user_ids'; end if;
  return query
  select u.id from public.users u
  join auth.users au on au.id=u.id and (au.email_confirmed_at is not null or au.phone_confirmed_at is not null)
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
