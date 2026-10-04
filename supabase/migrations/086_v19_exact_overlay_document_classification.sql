-- Tailmance v19 exact applicability-overlay document classification hardening.
-- A document row is not lawful/release-active merely because it belongs to an applicable overlay.
-- Every overlay document must be explicitly required by the reviewed overlay for its exact document type
-- AND exact document locale. Extra, stale, untrusted, cross-matrix or not-applicable-overlay documents fail closed.

create or replace function public.enforce_legal_overlay_document_classification()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_overlay public.legal_applicability_overlays;
begin
  select * into v_overlay from public.legal_applicability_overlays where overlay_id=new.overlay_id;
  if not found then raise exception 'legal_overlay_not_found'; end if;
  if v_overlay.matrix_id<>new.matrix_id then raise exception 'legal_overlay_matrix_mismatch'; end if;
  if v_overlay.applicability_status<>'applicable' then raise exception 'legal_overlay_document_for_non_applicable_overlay'; end if;
  if not (new.document_type=any(v_overlay.required_document_types)) then raise exception 'legal_overlay_document_type_not_required'; end if;
  if not (new.document_locale=any(v_overlay.required_document_locales)) then raise exception 'legal_overlay_document_locale_not_required'; end if;
  if not public.legal_document_url_allowed(new.document_url) then raise exception 'legal_overlay_document_origin_not_approved'; end if;
  if new.reviewed_at>now()+interval '5 minutes' or new.reviewed_at<now()-interval '90 days' then raise exception 'legal_overlay_document_review_stale'; end if;
  if new.valid_until<=now() or new.valid_until>new.reviewed_at+interval '90 days' then raise exception 'legal_overlay_document_validity_invalid'; end if;
  if jsonb_array_length(new.source_evidence_reference)=0
     or jsonb_array_length(new.counsel_evidence_reference)=0
     or jsonb_array_length(new.localization_evidence_reference)=0 then
    raise exception 'legal_overlay_document_evidence_incomplete';
  end if;
  return new;
end $$;
revoke all on function public.enforce_legal_overlay_document_classification() from public,anon,authenticated;
grant execute on function public.enforce_legal_overlay_document_classification() to service_role;

drop trigger if exists trg_legal_overlay_document_classification on public.legal_bundle_overlay_documents;
create trigger trg_legal_overlay_document_classification
before insert on public.legal_bundle_overlay_documents
for each row execute function public.enforce_legal_overlay_document_classification();

-- Supersede applicability-bundle validation. Presence of all required artifacts is necessary but not sufficient:
-- there must also be zero unclassified, wrong-locale, stale, untrusted or evidence-incomplete artifacts attached
-- to an applicable overlay for the candidate bundle.
create or replace function public.legal_applicability_bundle_satisfied(p_user_id uuid,p_bundle_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_matrix_id uuid;v_overlay public.legal_applicability_overlays;v_type text;v_locale text;
begin
  if p_user_id is null or p_bundle_id is null then return false; end if;
  if not public.legal_applicability_matrix_satisfied(p_user_id) then return false; end if;
  select current_applicability_matrix_id into v_matrix_id from public.legal_country_runtime where user_id=p_user_id;
  if v_matrix_id is null then return false; end if;

  for v_overlay in select * from public.legal_applicability_overlays where matrix_id=v_matrix_id and applicability_status='applicable' loop
    if cardinality(v_overlay.required_document_types)>0 then
      if cardinality(v_overlay.required_document_locales)=0 then return false; end if;
      foreach v_type in array v_overlay.required_document_types loop
        foreach v_locale in array v_overlay.required_document_locales loop
          if not exists(
            select 1 from public.legal_bundle_overlay_documents d
            where d.matrix_id=v_matrix_id and d.overlay_id=v_overlay.overlay_id and d.bundle_id=p_bundle_id
              and d.document_type=v_type and d.document_locale=v_locale
              and public.legal_document_url_allowed(d.document_url)
              and d.reviewed_at<=now()+interval '5 minutes' and d.reviewed_at>=now()-interval '90 days'
              and d.valid_until>now() and d.valid_until<=d.reviewed_at+interval '90 days'
              and jsonb_array_length(d.source_evidence_reference)>0
              and jsonb_array_length(d.counsel_evidence_reference)>0
              and jsonb_array_length(d.localization_evidence_reference)>0
          ) then return false; end if;
        end loop;
      end loop;
    end if;

    if exists(
      select 1 from public.legal_bundle_overlay_documents d
      where d.matrix_id=v_matrix_id and d.overlay_id=v_overlay.overlay_id and d.bundle_id=p_bundle_id
        and (
          not (d.document_type=any(v_overlay.required_document_types))
          or not (d.document_locale=any(v_overlay.required_document_locales))
          or not public.legal_document_url_allowed(d.document_url)
          or d.reviewed_at>now()+interval '5 minutes' or d.reviewed_at<now()-interval '90 days'
          or d.valid_until<=now() or d.valid_until>d.reviewed_at+interval '90 days'
          or jsonb_array_length(d.source_evidence_reference)=0
          or jsonb_array_length(d.counsel_evidence_reference)=0
          or jsonb_array_length(d.localization_evidence_reference)=0
        )
    ) then return false; end if;
  end loop;

  -- No document may be attached to an overlay that the reviewed matrix classified as not applicable.
  if exists(
    select 1 from public.legal_bundle_overlay_documents d
    join public.legal_applicability_overlays o on o.overlay_id=d.overlay_id
    where d.matrix_id=v_matrix_id and d.bundle_id=p_bundle_id
      and (o.matrix_id<>d.matrix_id or o.applicability_status<>'applicable')
  ) then return false; end if;

  return true;
end $$;
revoke all on function public.legal_applicability_bundle_satisfied(uuid,uuid) from public,anon,authenticated;
grant execute on function public.legal_applicability_bundle_satisfied(uuid,uuid) to service_role;

-- User-visible mandatory overlay projection is an exact projection of the reviewed required type×locale set.
create or replace function public.current_legal_overlay_documents(p_user_id uuid,p_bundle_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when not public.legal_applicability_bundle_satisfied(p_user_id,p_bundle_id) then '[]'::jsonb else
    coalesce((select jsonb_agg(jsonb_build_object(
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
    ) order by o.jurisdiction_country_code,coalesce(o.jurisdiction_subnational_code,''),o.applicability_basis,d.document_type,d.document_locale,d.overlay_document_id)
    from public.legal_country_runtime r
    join public.legal_bundle_overlay_documents d on d.matrix_id=r.current_applicability_matrix_id and d.bundle_id=p_bundle_id
    join public.legal_applicability_overlays o on o.overlay_id=d.overlay_id and o.matrix_id=d.matrix_id and o.applicability_status='applicable'
    where r.user_id=p_user_id
      and d.document_type=any(o.required_document_types)
      and d.document_locale=any(o.required_document_locales)
      and d.document_type<>'marketing_push_consent'),'[]'::jsonb) end;
$$;
revoke all on function public.current_legal_overlay_documents(uuid,uuid) from public,anon,authenticated;
grant execute on function public.current_legal_overlay_documents(uuid,uuid) to service_role;

-- Mandatory presentation digest uses the same exact classified projection. A bundle that fails the exact
-- overlay classification gate has no valid mandatory overlay digest.
create or replace function public.current_legal_overlay_document_set_sha256(p_user_id uuid,p_bundle_id uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare v_matrix_id uuid;v_bundle public.legal_document_bundles;v_base jsonb;v_overlay jsonb;
begin
  if p_user_id is null or p_bundle_id is null then return null; end if;
  if not public.legal_applicability_bundle_satisfied(p_user_id,p_bundle_id) then return null; end if;
  select current_applicability_matrix_id into v_matrix_id from public.legal_country_runtime where user_id=p_user_id;
  select * into v_bundle from public.legal_document_bundles where bundle_id=p_bundle_id;
  if v_matrix_id is null or not found then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_array(d.document_type,d.document_locale,d.document_version,d.document_url,d.document_sha256) order by d.document_type),'[]'::jsonb)
    into v_base from public.legal_bundle_documents d
    where d.bundle_id=p_bundle_id and d.document_type=any(array['terms','privacy_notice','community_guidelines','jurisdiction_privacy_supplement']::text[]);
  select coalesce(jsonb_agg(jsonb_build_array(
      d.overlay_document_id::text,o.jurisdiction_country_code,coalesce(o.jurisdiction_subnational_code,''),o.applicability_basis,
      d.document_type,d.document_locale,d.document_version,d.document_url,d.document_sha256,d.user_action_requirement
    ) order by o.jurisdiction_country_code,coalesce(o.jurisdiction_subnational_code,''),o.applicability_basis,d.document_type,d.document_locale,d.overlay_document_id::text),'[]'::jsonb)
    into v_overlay
    from public.legal_bundle_overlay_documents d
    join public.legal_applicability_overlays o on o.overlay_id=d.overlay_id and o.matrix_id=d.matrix_id and o.applicability_status='applicable'
    where d.matrix_id=v_matrix_id and d.bundle_id=p_bundle_id
      and d.document_type=any(o.required_document_types)
      and d.document_locale=any(o.required_document_locales)
      and d.document_type<>'marketing_push_consent';
  return encode(extensions.digest(convert_to(jsonb_build_object(
    'matrixId',v_matrix_id::text,'bundleId',v_bundle.bundle_id::text,'legalCountryCode',v_bundle.legal_country_code,
    'legalSubnationalCode',coalesce(v_bundle.legal_subnational_code,''),'uiLocale',v_bundle.ui_locale,
    'documentLocale',v_bundle.document_locale,'baseDocuments',v_base,'overlayDocuments',v_overlay
  )::text,'UTF8'),'sha256'),'hex');
end $$;
revoke all on function public.current_legal_overlay_document_set_sha256(uuid,uuid) from public,anon,authenticated;
grant execute on function public.current_legal_overlay_document_set_sha256(uuid,uuid) to service_role;

-- Comprehension mirrors inherit the same exact overlay classification. Unclassified overlay rows can never
-- create a user-language mirror that makes an otherwise invalid bundle appear acceptable.
create or replace function public.legal_overlay_comprehension_documents_complete(p_user_id uuid,p_bundle_id uuid,p_ui_locale text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_locale text:=trim(coalesce(p_ui_locale,''));v_matrix_id uuid;v_source record;
begin
  if p_user_id is null or p_bundle_id is null or char_length(v_locale) not between 2 and 16 then return false; end if;
  if not public.legal_applicability_bundle_satisfied(p_user_id,p_bundle_id) then return false; end if;
  select current_applicability_matrix_id into v_matrix_id from public.legal_country_runtime where user_id=p_user_id;
  if v_matrix_id is null then return false; end if;
  for v_source in
    select d.* from public.legal_bundle_overlay_documents d
    join public.legal_applicability_overlays o on o.overlay_id=d.overlay_id and o.matrix_id=d.matrix_id and o.applicability_status='applicable'
    where d.matrix_id=v_matrix_id and d.bundle_id=p_bundle_id
      and d.document_type=any(o.required_document_types)
      and d.document_locale=any(o.required_document_locales)
  loop
    if v_source.document_locale<>v_locale and not exists(
      select 1 from public.legal_overlay_comprehension_documents c
      where c.source_overlay_document_id=v_source.overlay_document_id and c.bundle_id=p_bundle_id and c.document_locale=v_locale
        and c.source_document_version=v_source.document_version and c.source_document_sha256=v_source.document_sha256
        and public.legal_document_url_allowed(c.document_url)
        and c.reviewed_at<=now()+interval '5 minutes' and c.reviewed_at>=now()-interval '90 days'
        and c.valid_until>now() and c.valid_until<=c.reviewed_at+interval '90 days'
        and jsonb_array_length(c.source_evidence_reference)>0 and jsonb_array_length(c.localization_evidence_reference)>0
    ) then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function public.legal_overlay_comprehension_documents_complete(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.legal_overlay_comprehension_documents_complete(uuid,uuid,text) to service_role;

create or replace function public.current_legal_overlay_comprehension_documents(p_user_id uuid,p_bundle_id uuid,p_ui_locale text)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when not public.legal_overlay_comprehension_documents_complete(p_user_id,p_bundle_id,p_ui_locale) then '[]'::jsonb else coalesce(jsonb_agg(jsonb_build_object(
    'comprehensionDocumentId',c.comprehension_document_id,'sourceOverlayDocumentId',d.overlay_document_id,
    'jurisdictionCountryCode',o.jurisdiction_country_code,'jurisdictionSubnationalCode',o.jurisdiction_subnational_code,'applicabilityBasis',o.applicability_basis,
    'sourceDocumentType',d.document_type,'sourceDocumentLocale',d.document_locale,'sourceDocumentVersion',c.source_document_version,'sourceDocumentSha256',c.source_document_sha256,
    'documentLocale',c.document_locale,'translationVersion',c.translation_version,'documentUrl',c.document_url,'documentSha256',c.document_sha256,
    'actionRequirement',d.user_action_requirement
  ) order by o.jurisdiction_country_code,coalesce(o.jurisdiction_subnational_code,''),d.document_type,d.document_locale,d.overlay_document_id),'[]'::jsonb) end
  from public.legal_country_runtime r
  join public.legal_bundle_overlay_documents d on d.matrix_id=r.current_applicability_matrix_id and d.bundle_id=p_bundle_id
  join public.legal_applicability_overlays o on o.overlay_id=d.overlay_id and o.matrix_id=d.matrix_id and o.applicability_status='applicable'
    and d.document_type=any(o.required_document_types) and d.document_locale=any(o.required_document_locales)
  join public.legal_overlay_comprehension_documents c on c.source_overlay_document_id=d.overlay_document_id and c.bundle_id=p_bundle_id
    and c.document_locale=trim(coalesce(p_ui_locale,'')) and d.document_locale<>trim(coalesce(p_ui_locale,''))
  where r.user_id=p_user_id;
$$;
revoke all on function public.current_legal_overlay_comprehension_documents(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.current_legal_overlay_comprehension_documents(uuid,uuid,text) to service_role;
