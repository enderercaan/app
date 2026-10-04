-- Tailmance v19 mandatory legal acceptance / optional marketing separation.
-- The exact acceptance presentation must contain only documents actually shown in the mandatory
-- legal-consent flow. Optional marketing documents have their own independent digest and consent event.

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

  -- Reuse the canonical user-visible mandatory overlay projection. It deliberately excludes
  -- marketing_push_consent, which is displayed and evidenced only in the optional marketing flow.
  v_overlay:=public.current_legal_overlay_documents(p_user_id,p_bundle_id);

  return jsonb_build_object(
    'matrixId',v_matrix_id,'bundleId',p_bundle_id,
    'overlayDocumentSetSha256',public.current_legal_overlay_document_set_sha256(p_user_id,p_bundle_id),
    'baseDocuments',v_base,'overlayDocuments',v_overlay
  );
end $$;
revoke all on function public.legal_acceptance_presentation_payload(uuid,uuid) from public,anon,authenticated;
grant execute on function public.legal_acceptance_presentation_payload(uuid,uuid) to service_role;

-- Defensive invariant: the mandatory displayed overlay projection itself may never surface optional
-- marketing consent text. Keep this definition here so later migrations cannot accidentally widen it.
create or replace function public.current_legal_overlay_documents(p_user_id uuid,p_bundle_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'overlayDocumentId',d.overlay_document_id,
    'jurisdictionCountryCode',o.jurisdiction_country_code,
    'jurisdictionSubnationalCode',o.jurisdiction_subnational_code,
    'applicabilityBasis',o.applicability_basis,
    'documentType',d.document_type,
    'documentLocale',d.document_locale,
    'documentVersion',d.document_version,
    'documentUrl',d.document_url,
    'documentSha256',d.document_sha256,
    'actionRequirement',d.user_action_requirement
  ) order by o.jurisdiction_country_code,coalesce(o.jurisdiction_subnational_code,''),o.applicability_basis,d.document_type,d.document_locale,d.overlay_document_id),'[]'::jsonb)
  from public.legal_country_runtime r
  join public.legal_bundle_overlay_documents d on d.matrix_id=r.current_applicability_matrix_id and d.bundle_id=p_bundle_id
  join public.legal_applicability_overlays o on o.overlay_id=d.overlay_id and o.matrix_id=d.matrix_id and o.applicability_status='applicable'
  where r.user_id=p_user_id
    and d.document_type<>'marketing_push_consent';
$$;
revoke all on function public.current_legal_overlay_documents(uuid,uuid) from public,anon,authenticated;
grant execute on function public.current_legal_overlay_documents(uuid,uuid) to service_role;
