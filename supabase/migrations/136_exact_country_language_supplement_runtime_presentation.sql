-- Tailmance v19 R8: bind the exact configured-country legal supplement into runtime presentation.
-- The 594 generated country×legal-locale documents are source assets. This migration makes the exact
-- controlling country supplement (plus a non-controlling UI-language accessibility translation when
-- different) part of the immutable acceptance presentation, and exposes only an allowlisted HTTPS URL.

alter table public.legal_country_source_document_supplements
  add column if not exists public_route_path text;

update public.legal_country_source_document_supplements
set public_route_path='/'||regexp_replace(public_relative_path,'^web/','')
where public_route_path is null or trim(public_route_path)='';

alter table public.legal_country_source_document_supplements
  alter column public_route_path set not null;

-- Executed-Postgres verification fix (2026-10-03): the generated hash-sync upserts (138-140) do not list
-- public_route_path, and NOT NULL is evaluated on the proposed row before ON CONFLICT resolution. Derive the
-- route on every insert/update from the canonical public_relative_path so it can never be omitted or drift.
create or replace function public.derive_legal_supplement_public_route_path()
returns trigger language plpgsql set search_path='' as $$
begin
  new.public_route_path:='/'||regexp_replace(new.public_relative_path,'^web/','');
  return new;
end $$;
revoke all on function public.derive_legal_supplement_public_route_path() from public,anon,authenticated;
drop trigger if exists legal_supplement_public_route_path_derive on public.legal_country_source_document_supplements;
create trigger legal_supplement_public_route_path_derive
  before insert or update on public.legal_country_source_document_supplements
  for each row execute function public.derive_legal_supplement_public_route_path();

alter table public.legal_country_source_document_supplements
  drop constraint if exists legal_country_source_document_supplements_public_route_path_ck;
alter table public.legal_country_source_document_supplements
  add constraint legal_country_source_document_supplements_public_route_path_ck check (
    public_route_path ~ '^/legal-country/[A-Z]{2}/[A-Za-z0-9-]+/jurisdiction\.html$'
    and public_route_path !~ '[?#]'
  );

create or replace function public.legal_country_supplement_public_url(
  p_country_code text,p_document_locale text,p_reference_url text
)
returns text language plpgsql stable security definer set search_path='' as $$
declare d public.legal_country_source_document_supplements;v_origin text;v_url text;
begin
  if p_country_code is null or p_document_locale is null or p_reference_url is null then return null; end if;
  if not public.legal_document_url_allowed(p_reference_url) then return null; end if;
  select * into d from public.legal_country_source_document_supplements
   where legal_country_code=upper(trim(p_country_code)) and document_locale=trim(p_document_locale)
     and internal_language_qa_status='complete_internal_reviewed'
     and reviewed_at<=now()+interval '5 minutes' and valid_until>now();
  if not found then return null; end if;
  v_origin:=substring(p_reference_url from '^(https://[^/]+)');
  if v_origin is null then return null; end if;
  v_url:=v_origin||d.public_route_path;
  if not public.legal_document_url_allowed(v_url) then return null; end if;
  return v_url;
end $$;
revoke all on function public.legal_country_supplement_public_url(text,text,text) from public,anon,authenticated;
grant execute on function public.legal_country_supplement_public_url(text,text,text) to service_role;

-- Replace the historical generic jurisdiction supplement inside the binding acceptance payload with
-- the exact country supplement. The generic jurisdiction privacy document remains a compatibility /
-- informational document, but it can no longer satisfy the country-specific binding layer.
create or replace function public.legal_acceptance_presentation_payload(p_user_id uuid,p_bundle_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_matrix_id uuid;v_base jsonb;v_overlay jsonb;v_bundle public.legal_document_bundles;
  v_binding public.legal_country_source_document_supplements;v_ui public.legal_country_source_document_supplements;
  v_country_supplements jsonb;
begin
  if p_user_id is null or p_bundle_id is null then return null; end if;
  select current_applicability_matrix_id into v_matrix_id from public.legal_country_runtime where user_id=p_user_id;
  if v_matrix_id is null then return null; end if;
  select * into v_bundle from public.legal_document_bundles where bundle_id=p_bundle_id;
  if not found then return null; end if;
  if public.resolve_current_legal_bundle_id(p_user_id,v_bundle.ui_locale) is distinct from p_bundle_id then return null; end if;
  if not public.legal_source_approval_current(v_bundle.legal_country_code) then return null; end if;

  select * into v_binding from public.legal_country_source_document_supplements
   where legal_country_code=v_bundle.legal_country_code and document_locale=v_bundle.document_locale
     and required_binding_locale and route_role='required_binding_document_locale'
     and internal_language_qa_status='complete_internal_reviewed'
     and reviewed_at<=now()+interval '5 minutes' and valid_until>now();
  if not found then return null; end if;

  select * into v_ui from public.legal_country_source_document_supplements
   where legal_country_code=v_bundle.legal_country_code and document_locale=v_bundle.ui_locale
     and internal_language_qa_status='complete_internal_reviewed'
     and reviewed_at<=now()+interval '5 minutes' and valid_until>now();
  if not found then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'documentType',d.document_type,'documentLocale',d.document_locale,'documentVersion',d.document_version,
    'documentUrl',d.document_url,'documentSha256',d.document_sha256
  ) order by d.document_type),'[]'::jsonb) into v_base
  from public.legal_bundle_documents d
  where d.bundle_id=p_bundle_id
    and d.document_type=any(array['terms','privacy_notice','community_guidelines']::text[]);

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

  v_country_supplements:=jsonb_build_object(
    'binding',jsonb_build_object(
      'legalCountryCode',v_binding.legal_country_code,'documentLocale',v_binding.document_locale,
      'documentVersion',v_binding.document_version,'publicRoutePath',v_binding.public_route_path,
      'publicSha256',v_binding.public_sha256,'routeRole',v_binding.route_role,'requiredBindingLocale',true
    ),
    'ui',jsonb_build_object(
      'legalCountryCode',v_ui.legal_country_code,'documentLocale',v_ui.document_locale,
      'documentVersion',v_ui.document_version,'publicRoutePath',v_ui.public_route_path,
      'publicSha256',v_ui.public_sha256,'routeRole',v_ui.route_role,'requiredBindingLocale',v_ui.required_binding_locale
    )
  );

  return jsonb_build_object(
    'matrixId',v_matrix_id,'bundleId',p_bundle_id,
    'overlayDocumentSetSha256',public.current_legal_overlay_document_set_sha256(p_user_id,p_bundle_id),
    'baseDocuments',v_base,'countryJurisdictionSupplements',v_country_supplements,'overlayDocuments',v_overlay
  );
end $$;
revoke all on function public.legal_acceptance_presentation_payload(uuid,uuid) from public,anon,authenticated;
grant execute on function public.legal_acceptance_presentation_payload(uuid,uuid) to service_role;

-- Authenticated read surface for the exact documents that are already bound into the presentation hash.
-- URLs are constructed only on the same approved origin as the current binding privacy document.
create or replace function public.get_current_country_legal_supplements(p_ui_locale text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_context jsonb;v_country text;v_doc_locale text;v_ui_locale text;v_reference_url text;v_presentation_sha text;
  v_binding public.legal_country_source_document_supplements;v_ui public.legal_country_source_document_supplements;
  v_binding_url text;v_ui_url text;
begin
  perform public.require_active_authenticated_session();
  if char_length(trim(coalesce(p_ui_locale,''))) not between 2 and 16 then return jsonb_build_object('status','blocked_unsupported_ui_locale'); end if;
  v_context:=public.get_current_legal_context(trim(p_ui_locale));
  if coalesce(v_context->>'status','')<>'ready' then
    return jsonb_build_object('status',coalesce(v_context->>'status','blocked_legal_context_unavailable'));
  end if;
  v_country:=v_context->>'legalCountryCode';v_doc_locale:=v_context->>'documentLocale';v_ui_locale:=v_context->>'uiLocale';
  v_reference_url:=v_context->>'privacyNoticeUrl';v_presentation_sha:=v_context->>'acceptancePresentationSha256';
  if v_country is null or v_doc_locale is null or v_ui_locale is null or coalesce(v_presentation_sha,'') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status','blocked_country_supplement_context_incomplete');
  end if;
  if not public.legal_source_approval_current(v_country) then return jsonb_build_object('status','blocked_country_source_approval_expired'); end if;

  select * into v_binding from public.legal_country_source_document_supplements
   where legal_country_code=v_country and document_locale=v_doc_locale and required_binding_locale
     and route_role='required_binding_document_locale' and internal_language_qa_status='complete_internal_reviewed'
     and reviewed_at<=now()+interval '5 minutes' and valid_until>now();
  if not found then return jsonb_build_object('status','blocked_binding_country_supplement_missing'); end if;
  select * into v_ui from public.legal_country_source_document_supplements
   where legal_country_code=v_country and document_locale=v_ui_locale
     and internal_language_qa_status='complete_internal_reviewed'
     and reviewed_at<=now()+interval '5 minutes' and valid_until>now();
  if not found then return jsonb_build_object('status','blocked_ui_country_supplement_missing'); end if;

  v_binding_url:=public.legal_country_supplement_public_url(v_country,v_binding.document_locale,v_reference_url);
  v_ui_url:=public.legal_country_supplement_public_url(v_country,v_ui.document_locale,v_reference_url);
  if v_binding_url is null or v_ui_url is null then return jsonb_build_object('status','blocked_country_supplement_public_url_unavailable'); end if;

  return jsonb_build_object(
    'status','ready','legalCountryCode',v_country,'uiLocale',v_ui_locale,'documentLocale',v_doc_locale,
    'presentationSha256',v_presentation_sha,
    'bindingSupplement',jsonb_build_object('documentLocale',v_binding.document_locale,'documentVersion',v_binding.document_version,
      'documentUrl',v_binding_url,'documentSha256',v_binding.public_sha256,'routeRole',v_binding.route_role,'requiredBindingLocale',true),
    'uiSupplement',case when v_ui.document_locale=v_binding.document_locale then null else jsonb_build_object(
      'documentLocale',v_ui.document_locale,'documentVersion',v_ui.document_version,'documentUrl',v_ui_url,
      'documentSha256',v_ui.public_sha256,'routeRole',v_ui.route_role,'requiredBindingLocale',v_ui.required_binding_locale) end
  );
end $$;
revoke all on function public.get_current_country_legal_supplements(text) from public,anon;
grant execute on function public.get_current_country_legal_supplements(text) to authenticated;
