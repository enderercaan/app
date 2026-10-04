-- Tailmance v19 R8 configured-27 runtime legal-source authority.
-- External-counsel evidence remains optional audit metadata, never a source/legal-language correctness prerequisite.
-- Current legal authority is the internally reviewed official-source matrix + exact country/document-locale supplement,
-- while live store/provider/operator/age/route evidence continues to fail closed independently.

-- Counsel evidence columns are preserved for optional provenance, but non-empty counsel checks are removed from
-- source/document/applicability tables. Source + localization evidence and current internal source approval remain mandatory.
do $$
declare r record; t text;
begin
  foreach t in array array[
    'legal_applicability_matrices','legal_applicability_overlays','legal_bundle_overlay_documents',
    'legal_bundle_documents','legal_bundle_document_alternates','pre_registration_legal_bundles'
  ] loop
    for r in
      select conname from pg_constraint
      where conrelid=('public.'||t)::regclass and contype='c'
        and pg_get_constraintdef(oid) ilike '%counsel_evidence_reference%'
    loop
      execute format('alter table public.%I drop constraint %I',t,r.conname);
    end loop;
    execute format('alter table public.%I add constraint %I check (jsonb_typeof(counsel_evidence_reference)=''array'')',
      t,t||'_counsel_evidence_optional_array_ck');
  end loop;
end $$;

create or replace function public.legal_country_locale_source_approved(p_country_code text,p_document_locale text)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(
    public.legal_source_approval_current(upper(trim(coalesce(p_country_code,''))))
    and exists(
      select 1 from public.legal_country_source_document_supplements d
      join public.legal_jurisdiction_policies p on p.legal_country_code=d.legal_country_code
      where d.legal_country_code=upper(trim(coalesce(p_country_code,'')))
        and d.document_locale=trim(coalesce(p_document_locale,''))
        and d.document_locale=any(p.source_approved_document_locales)
        and d.internal_language_qa_status='complete_internal_reviewed'
        and d.reviewed_at<=now()+interval '5 minutes'
        and d.valid_until>now()
        and jsonb_array_length(d.internal_review_evidence_reference)>0
    ),false
  );
$$;
revoke all on function public.legal_country_locale_source_approved(text,text) from public,anon,authenticated;
grant execute on function public.legal_country_locale_source_approved(text,text) to service_role;

create or replace function public.legal_subnational_source_approved(p_country_code text,p_subnational_code text)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(
    public.legal_source_approval_current(upper(trim(coalesce(p_country_code,''))))
    and exists(
      select 1 from public.legal_subnational_language_requirements r
      where r.legal_country_code=upper(trim(coalesce(p_country_code,'')))
        and r.legal_subnational_code=upper(trim(coalesce(p_subnational_code,'')))
        and r.internal_source_review_status='approved_internal_official_source_review'
        and r.internal_reviewed_at<=now()+interval '5 minutes'
        and r.internal_review_valid_until>now()
        and jsonb_array_length(r.official_source_reference)>0
        and jsonb_array_length(r.internal_review_evidence_reference)>0
    ),false
  );
$$;
revoke all on function public.legal_subnational_source_approved(text,text) from public,anon,authenticated;
grant execute on function public.legal_subnational_source_approved(text,text) to service_role;

-- Base document completeness now derives legal authority from the country/locale source review, not counsel metadata.
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
  if not public.legal_country_locale_source_approved(v_bundle.legal_country_code,v_bundle.document_locale) then return false; end if;

  foreach v_type in array v_policy.required_document_types loop
    select * into v_doc from public.legal_bundle_documents where bundle_id=p_bundle_id and document_type=v_type;
    if not found then return false; end if;
    if v_doc.document_locale<>v_bundle.document_locale then return false; end if;
    if not public.legal_document_url_allowed(v_doc.document_url) then return false; end if;
    if v_doc.reviewed_at>now()+interval '5 minutes' or v_doc.reviewed_at<now()-interval '90 days' then return false; end if;
    if v_doc.valid_until<=now() or v_doc.valid_until>v_doc.reviewed_at+interval '90 days' then return false; end if;
    if jsonb_array_length(v_doc.source_evidence_reference)=0 or jsonb_array_length(v_doc.localization_evidence_reference)=0 then return false; end if;
    if v_type='terms' and (v_doc.document_version<>v_bundle.terms_version or v_doc.document_url<>v_bundle.terms_url or v_doc.document_sha256<>v_bundle.terms_sha256) then return false; end if;
    if v_type='privacy_notice' and (v_doc.document_version<>v_bundle.privacy_notice_version or v_doc.document_url<>v_bundle.privacy_notice_url or v_doc.document_sha256<>v_bundle.privacy_notice_sha256) then return false; end if;
    if v_type='community_guidelines' and (v_doc.document_version<>v_bundle.community_guidelines_version or v_doc.document_url<>v_bundle.community_guidelines_url or v_doc.document_sha256<>v_bundle.community_guidelines_sha256) then return false; end if;
    if v_type='marketing_push_consent' and (v_doc.document_version<>v_bundle.marketing_push_consent_version or v_doc.document_url<>v_bundle.marketing_push_consent_url or v_doc.document_sha256<>v_bundle.marketing_push_consent_sha256) then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function public.legal_bundle_document_manifest_complete(uuid) from public,anon,authenticated;
grant execute on function public.legal_bundle_document_manifest_complete(uuid) to service_role;

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
  if not public.legal_country_locale_source_approved(v_overlay.jurisdiction_country_code,new.document_locale) then raise exception 'legal_overlay_country_locale_source_not_approved'; end if;
  if not public.legal_document_url_allowed(new.document_url) then raise exception 'legal_overlay_document_origin_not_approved'; end if;
  if new.reviewed_at>now()+interval '5 minutes' or new.reviewed_at<now()-interval '90 days' then raise exception 'legal_overlay_document_review_stale'; end if;
  if new.valid_until<=now() or new.valid_until>new.reviewed_at+interval '90 days' then raise exception 'legal_overlay_document_validity_invalid'; end if;
  if jsonb_array_length(new.source_evidence_reference)=0 or jsonb_array_length(new.localization_evidence_reference)=0 then
    raise exception 'legal_overlay_document_evidence_incomplete';
  end if;
  return new;
end $$;
revoke all on function public.enforce_legal_overlay_document_classification() from public,anon,authenticated;
grant execute on function public.enforce_legal_overlay_document_classification() to service_role;

create or replace function public.legal_applicability_matrix_record_satisfied(p_user_id uuid,p_matrix_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_matrix public.legal_applicability_matrices;v_runtime public.legal_country_runtime;v_overlay record;v_policy public.legal_jurisdiction_policies;v_snapshot jsonb;v_family text;v_locale text;v_applicable integer:=0;
begin
  if p_user_id is null or p_matrix_id is null then return false; end if;
  select * into v_runtime from public.legal_country_runtime where user_id=p_user_id;
  if not found or v_runtime.resolution_status<>'verified' or v_runtime.legal_country_code is null then return false; end if;
  if not public.legal_source_approval_current(v_runtime.legal_country_code) then return false; end if;
  if v_runtime.legal_subnational_code is not null and left(v_runtime.legal_subnational_code,3)<>v_runtime.legal_country_code||'-' then return false; end if;
  select * into v_matrix from public.legal_applicability_matrices where matrix_id=p_matrix_id and user_id=p_user_id;
  if not found or v_matrix.review_status='blocked' then return false; end if;
  if v_matrix.reviewed_at>now()+interval '5 minutes' or v_matrix.reviewed_at<now()-interval '90 days' or v_matrix.valid_until<=now() or v_matrix.valid_until>v_matrix.reviewed_at+interval '90 days' then return false; end if;
  if jsonb_array_length(v_matrix.evidence_reference)=0 or nullif(trim(v_matrix.reviewer),'') is null then return false; end if;
  if v_matrix.primary_country_code<>v_runtime.legal_country_code or coalesce(v_matrix.primary_subnational_code,'')<>coalesce(v_runtime.legal_subnational_code,'') then return false; end if;
  v_snapshot:=public.legal_runtime_signal_snapshot(p_user_id);
  if v_snapshot is null or v_matrix.signal_snapshot<>v_snapshot or v_matrix.signal_snapshot_sha256<>public.legal_signal_snapshot_sha256(v_snapshot) then return false; end if;

  for v_overlay in select * from public.legal_applicability_overlays where matrix_id=p_matrix_id loop
    if v_overlay.reviewed_at>now()+interval '5 minutes' or v_overlay.reviewed_at<now()-interval '90 days' or v_overlay.valid_until<=now() or v_overlay.valid_until>v_overlay.reviewed_at+interval '90 days' then return false; end if;
    if not public.legal_source_approval_current(v_overlay.jurisdiction_country_code) then return false; end if;
    if v_overlay.jurisdiction_subnational_code is not null and left(v_overlay.jurisdiction_subnational_code,3)<>v_overlay.jurisdiction_country_code||'-' then return false; end if;
    if v_overlay.jurisdiction_subnational_code is not null and not public.legal_subnational_source_approved(v_overlay.jurisdiction_country_code,v_overlay.jurisdiction_subnational_code) then return false; end if;
    if exists(select 1 from jsonb_array_elements_text(v_overlay.official_source_reference) x(value) where nullif(trim(value),'') is null or value !~ '^https://') then return false; end if;
    if jsonb_array_length(v_overlay.evidence_reference)=0 or nullif(trim(v_overlay.reviewer),'') is null then return false; end if;
    if exists(select 1 from unnest(v_overlay.control_families) f where not (f=any(public.legal_required_control_families()))) then return false; end if;
    if cardinality(v_overlay.control_families)<>(select count(distinct f) from unnest(v_overlay.control_families) f) then return false; end if;
    if exists(select 1 from unnest(v_overlay.required_document_types) d where d not in ('terms','privacy_notice','community_guidelines','marketing_push_consent','subscription_consumer','moderation_appeals','intellectual_property','accessibility','account_deletion','support','jurisdiction_privacy_supplement','jurisdiction_consumer_supplement','jurisdiction_platform_supplement')) then return false; end if;
    if cardinality(v_overlay.required_document_types)<>(select count(distinct d) from unnest(v_overlay.required_document_types) d) then return false; end if;
    if exists(select 1 from unnest(v_overlay.required_document_locales) l where char_length(l) not between 2 and 16 or l !~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$') then return false; end if;
    if cardinality(v_overlay.required_document_locales)<>(select count(distinct l) from unnest(v_overlay.required_document_locales) l) then return false; end if;
    foreach v_locale in array v_overlay.required_document_locales loop
      if not public.legal_country_locale_source_approved(v_overlay.jurisdiction_country_code,v_locale) then return false; end if;
    end loop;
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

create or replace function public.legal_applicability_bundle_satisfied(p_user_id uuid,p_bundle_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_matrix_id uuid;v_overlay public.legal_applicability_overlays;v_type text;v_locale text;
begin
  if p_user_id is null or p_bundle_id is null then return false; end if;
  if not public.legal_applicability_matrix_satisfied(p_user_id) then return false; end if;
  select current_applicability_matrix_id into v_matrix_id from public.legal_country_runtime where user_id=p_user_id;
  if v_matrix_id is null then return false; end if;
  for v_overlay in select * from public.legal_applicability_overlays where matrix_id=v_matrix_id and applicability_status='applicable' loop
    if not public.legal_source_approval_current(v_overlay.jurisdiction_country_code) then return false; end if;
    if cardinality(v_overlay.required_document_types)>0 then
      if cardinality(v_overlay.required_document_locales)=0 then return false; end if;
      foreach v_type in array v_overlay.required_document_types loop
        foreach v_locale in array v_overlay.required_document_locales loop
          if not public.legal_country_locale_source_approved(v_overlay.jurisdiction_country_code,v_locale) then return false; end if;
          if not exists(
            select 1 from public.legal_bundle_overlay_documents d
            where d.matrix_id=v_matrix_id and d.overlay_id=v_overlay.overlay_id and d.bundle_id=p_bundle_id
              and d.document_type=v_type and d.document_locale=v_locale
              and public.legal_document_url_allowed(d.document_url)
              and d.reviewed_at<=now()+interval '5 minutes' and d.reviewed_at>=now()-interval '90 days'
              and d.valid_until>now() and d.valid_until<=d.reviewed_at+interval '90 days'
              and jsonb_array_length(d.source_evidence_reference)>0
              and jsonb_array_length(d.localization_evidence_reference)>0
          ) then return false; end if;
        end loop;
      end loop;
    end if;
  end loop;
  if exists(
    select 1 from public.legal_bundle_overlay_documents d
    join public.legal_applicability_overlays o on o.overlay_id=d.overlay_id and o.matrix_id=d.matrix_id
    where d.matrix_id=v_matrix_id and d.bundle_id=p_bundle_id and o.applicability_status='applicable'
      and (
        not (d.document_type=any(o.required_document_types)) or not (d.document_locale=any(o.required_document_locales))
        or not public.legal_country_locale_source_approved(o.jurisdiction_country_code,d.document_locale)
        or not public.legal_document_url_allowed(d.document_url)
        or d.reviewed_at>now()+interval '5 minutes' or d.reviewed_at<now()-interval '90 days'
        or d.valid_until<=now() or d.valid_until>d.reviewed_at+interval '90 days'
        or jsonb_array_length(d.source_evidence_reference)=0 or jsonb_array_length(d.localization_evidence_reference)=0
      )
  ) then return false; end if;
  return true;
end $$;
revoke all on function public.legal_applicability_bundle_satisfied(uuid,uuid) from public,anon,authenticated;
grant execute on function public.legal_applicability_bundle_satisfied(uuid,uuid) to service_role;

create or replace function public.marketing_consent_overlay_documents_complete(p_user_id uuid,p_bundle_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_matrix_id uuid;v_overlay public.legal_applicability_overlays;v_locale text;
begin
  if p_user_id is null or p_bundle_id is null then return false; end if;
  select current_applicability_matrix_id into v_matrix_id from public.legal_country_runtime where user_id=p_user_id;
  if v_matrix_id is null then return false; end if;
  if not public.legal_applicability_matrix_satisfied(p_user_id) then return false; end if;
  if not public.legal_applicability_bundle_satisfied(p_user_id,p_bundle_id) then return false; end if;
  if not public.legal_bundle_document_manifest_complete(p_bundle_id) then return false; end if;
  for v_overlay in
    select * from public.legal_applicability_overlays
    where matrix_id=v_matrix_id and applicability_status='applicable' and 'marketing_push_consent'=any(required_document_types)
  loop
    if cardinality(v_overlay.required_document_locales)=0 then return false; end if;
    foreach v_locale in array v_overlay.required_document_locales loop
      if not public.legal_country_locale_source_approved(v_overlay.jurisdiction_country_code,v_locale) then return false; end if;
      if not exists(
        select 1 from public.legal_bundle_overlay_documents d
        where d.matrix_id=v_matrix_id and d.overlay_id=v_overlay.overlay_id and d.bundle_id=p_bundle_id
          and d.document_type='marketing_push_consent' and d.document_locale=v_locale
          and public.legal_document_url_allowed(d.document_url)
          and d.reviewed_at<=now()+interval '5 minutes' and d.reviewed_at>=now()-interval '90 days'
          and d.valid_until>now() and d.valid_until<=d.reviewed_at+interval '90 days'
          and jsonb_array_length(d.source_evidence_reference)>0 and jsonb_array_length(d.localization_evidence_reference)>0
      ) then return false; end if;
    end loop;
  end loop;
  if exists(
    select 1 from public.legal_bundle_overlay_documents d
    join public.legal_applicability_overlays o on o.overlay_id=d.overlay_id and o.matrix_id=d.matrix_id
    where d.matrix_id=v_matrix_id and d.bundle_id=p_bundle_id and d.document_type='marketing_push_consent'
      and o.applicability_status='applicable'
      and (
        not ('marketing_push_consent'=any(o.required_document_types)) or not (d.document_locale=any(o.required_document_locales))
        or not public.legal_country_locale_source_approved(o.jurisdiction_country_code,d.document_locale)
        or not public.legal_document_url_allowed(d.document_url)
        or d.reviewed_at>now()+interval '5 minutes' or d.reviewed_at<now()-interval '90 days'
        or d.valid_until<=now() or d.valid_until>d.reviewed_at+interval '90 days'
        or jsonb_array_length(d.source_evidence_reference)=0 or jsonb_array_length(d.localization_evidence_reference)=0
      )
  ) then return false; end if;
  return true;
end $$;
revoke all on function public.marketing_consent_overlay_documents_complete(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketing_consent_overlay_documents_complete(uuid,uuid) to service_role;

create or replace function public.legal_subnational_language_requirements_satisfied(p_bundle_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_bundle public.legal_document_bundles;v_policy public.legal_jurisdiction_policies;v_req public.legal_subnational_language_requirements;v_locale text;v_type text;v_primary_exists boolean;v_alt_exists boolean;
begin
  if p_bundle_id is null then return false; end if;
  select * into v_bundle from public.legal_document_bundles where bundle_id=p_bundle_id;
  if not found then return false; end if;
  select * into v_policy from public.legal_jurisdiction_policies where legal_country_code=v_bundle.legal_country_code;
  if not found or not public.legal_source_approval_current(v_bundle.legal_country_code) then return false; end if;
  if not v_policy.subnational_review_required then return true; end if;
  if v_bundle.legal_subnational_code is null then return false; end if;
  select * into v_req from public.legal_subnational_language_requirements
  where legal_country_code=v_bundle.legal_country_code and legal_subnational_code=v_bundle.legal_subnational_code;
  if not found or v_req.internal_source_review_status<>'approved_internal_official_source_review' then return false; end if;
  if v_req.internal_reviewed_at is null or v_req.internal_reviewed_at>now()+interval '5 minutes' or v_req.internal_review_valid_until is null or v_req.internal_review_valid_until<=now() then return false; end if;
  if jsonb_array_length(v_req.official_source_reference)=0 or jsonb_array_length(v_req.internal_review_evidence_reference)=0 then return false; end if;
  if cardinality(v_req.required_available_document_locales)=0 or cardinality(v_req.required_document_types)=0 then return true; end if;
  foreach v_locale in array v_req.required_available_document_locales loop
    if not public.legal_country_locale_source_approved(v_bundle.legal_country_code,v_locale) then return false; end if;
    foreach v_type in array v_req.required_document_types loop
      select exists(select 1 from public.legal_bundle_documents d
        where d.bundle_id=p_bundle_id and d.document_type=v_type and d.document_locale=v_locale
          and d.reviewed_at<=now()+interval '5 minutes' and d.reviewed_at>=now()-interval '90 days' and d.valid_until>now()
          and jsonb_array_length(d.source_evidence_reference)>0 and jsonb_array_length(d.localization_evidence_reference)>0) into v_primary_exists;
      select exists(select 1 from public.legal_bundle_document_alternates a
        where a.bundle_id=p_bundle_id and a.document_type=v_type and a.document_locale=v_locale
          and a.reviewed_at<=now()+interval '5 minutes' and a.reviewed_at>=now()-interval '90 days' and a.valid_until>now()
          and jsonb_array_length(a.source_evidence_reference)>0 and jsonb_array_length(a.localization_evidence_reference)>0) into v_alt_exists;
      if not (v_primary_exists or v_alt_exists) then return false; end if;
    end loop;
  end loop;
  return true;
end $$;
revoke all on function public.legal_subnational_language_requirements_satisfied(uuid) from public,anon,authenticated;
grant execute on function public.legal_subnational_language_requirements_satisfied(uuid) to service_role;

create or replace function public.current_legal_age_assurance_satisfied(p_user_id uuid,p_country text,p_subnational text)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(public.legal_source_approval_current(upper(trim(coalesce(p_country,'')))) and (
    select case p.age_assurance_mode
      when 'self_attestation' then p.minimum_user_age=18 and (
        exists(select 1 from public.users u where u.id=p_user_id and u.age_18_confirmed=true)
        or exists(select 1 from public.prelegal_age_attestations a where a.user_id=p_user_id and a.age_threshold>=18)
      )
      when 'verified_external' then exists(
        select 1 from public.legal_age_assurance_events e
        where e.user_id=p_user_id and e.legal_country_code=p.legal_country_code
          and coalesce(e.legal_subnational_code,'')=case when p.subnational_review_required then coalesce(p_subnational,'') else '' end
          and e.result='passed' and e.age_threshold>=p.minimum_user_age
          and e.verified_at<=now() and (e.expires_at is null or e.expires_at>now())
          and jsonb_array_length(e.evidence_reference)>0
          and not exists(
            select 1 from public.legal_age_assurance_events r
            where r.user_id=e.user_id and r.legal_country_code=e.legal_country_code
              and coalesce(r.legal_subnational_code,'')=coalesce(e.legal_subnational_code,'')
              and r.result='revoked' and (r.created_at>e.created_at or (r.created_at=e.created_at and r.id>e.id))
          )
      ) else false end
    from public.legal_jurisdiction_policies p
    where p.legal_country_code=upper(trim(coalesce(p_country,'')))
      and p.effective_at is not null and p.effective_at<=now() and (p.expires_at is null or p.expires_at>now())
  ),false);
$$;
revoke all on function public.current_legal_age_assurance_satisfied(uuid,text,text) from public,anon,authenticated;
grant execute on function public.current_legal_age_assurance_satisfied(uuid,text,text) to service_role;

-- Pre-registration legal presentation is source/legal-language controlled. Legacy scope-mode tokens containing
-- "counsel" are accepted for backward-compatible stored evidence only; they no longer imply or require counsel approval.
create or replace function public.pre_registration_legal_bundle_content_current(p_bundle_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(exists(
    select 1
    from public.pre_registration_legal_bundles b
    join public.legal_jurisdiction_policies p on p.legal_country_code=b.declared_country_code
    where b.pre_registration_bundle_id=p_bundle_id
      and b.status='active'
      and public.legal_source_approval_current(b.declared_country_code)
      and public.legal_country_locale_source_approved(b.declared_country_code,b.document_locale)
      and b.reviewed_at<=now() and b.reviewed_at>=now()-interval '90 days'
      and b.effective_at<=now() and b.valid_until>now() and b.valid_until<=b.reviewed_at+interval '90 days'
      and jsonb_array_length(b.source_evidence_reference)>0
      and jsonb_array_length(b.localization_evidence_reference)>0
      and jsonb_array_length(b.subnational_scope_evidence_reference)>0
      and public.legal_document_url_allowed(b.terms_url)
      and public.legal_document_url_allowed(b.privacy_notice_url)
      and public.legal_document_url_allowed(b.community_guidelines_url)
      and b.document_locale=any(p.source_approved_document_locales)
      and (
        (p.subnational_review_required=false and b.subnational_scope_mode='not_required_with_counsel_evidence' and b.declared_subnational_code is null) or
        (p.subnational_review_required=true and b.subnational_scope_mode='countrywide_notice_counsel_approved' and b.declared_subnational_code is null) or
        (p.subnational_review_required=true and b.subnational_scope_mode='exact_subnational_route' and b.declared_subnational_code is not null
          and public.legal_subnational_source_approved(b.declared_country_code,b.declared_subnational_code))
      )
  ),false);
$$;
revoke all on function public.pre_registration_legal_bundle_content_current(uuid) from public,anon,authenticated;
grant execute on function public.pre_registration_legal_bundle_content_current(uuid) to service_role;

-- Runtime resolution uses internal official-source/legal-language approval. Live route, age, applicability and
-- operational evidence remain fail-closed, so removing counsel as a source prerequisite is not a production bypass.
create or replace function public.resolve_current_legal_bundle_id(p_user_id uuid,p_ui_locale text)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_runtime public.legal_country_runtime;v_policy public.legal_jurisdiction_policies;v_locale text:=trim(coalesce(p_ui_locale,''));v_bundle_id uuid;
begin
  if p_user_id is null or char_length(v_locale) not between 2 and 16 then return null; end if;
  select * into v_runtime from public.legal_country_runtime where user_id=p_user_id;
  if not found or v_runtime.resolution_status<>'verified' or v_runtime.legal_country_code is null then return null; end if;
  if not public.legal_source_approval_current(v_runtime.legal_country_code) then return null; end if;
  if v_runtime.legal_subnational_code is not null and left(v_runtime.legal_subnational_code,3)<>v_runtime.legal_country_code||'-' then return null; end if;
  if v_runtime.expires_at is null or v_runtime.expires_at<=now() then return null; end if;
  if v_runtime.resolution_source not in ('habitual_residence_verified','service_contract_country_verified','manual_legal_review') then return null; end if;
  select * into v_policy from public.legal_jurisdiction_policies where legal_country_code=v_runtime.legal_country_code;
  if not found then return null; end if;
  if not public.legal_control_reviews_complete(v_policy.control_reviews) then return null; end if;
  if cardinality(v_policy.source_approved_document_locales)=0 or cardinality(v_policy.required_document_types)=0 then return null; end if;
  if jsonb_array_length(v_policy.subnational_evidence_reference)=0 or jsonb_array_length(v_policy.language_evidence_reference)=0 or jsonb_array_length(v_policy.localization_evidence_reference)=0 or jsonb_array_length(v_policy.age_assurance_evidence_reference)=0 or jsonb_array_length(v_policy.animal_welfare_evidence_reference)=0 or jsonb_array_length(v_policy.breeding_mating_evidence_reference)=0 or jsonb_array_length(v_policy.pet_commerce_evidence_reference)=0 or jsonb_array_length(v_policy.operational_evidence_reference)=0 then return null; end if;
  if v_policy.effective_at is null or v_policy.effective_at>now() or (v_policy.expires_at is not null and v_policy.expires_at<=now()) then return null; end if;
  if v_policy.subnational_review_required and v_runtime.legal_subnational_code is null then return null; end if;
  if v_policy.subnational_review_required and not public.legal_subnational_source_approved(v_runtime.legal_country_code,v_runtime.legal_subnational_code) then return null; end if;
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
    and b.document_locale=any(v_policy.source_approved_document_locales) and b.effective_at<=now()
    and public.legal_country_locale_source_approved(b.legal_country_code,b.document_locale)
    and jsonb_array_length(b.source_evidence_reference)>0 and jsonb_array_length(b.localization_evidence_reference)>0
    and public.legal_bundle_document_manifest_complete(b.bundle_id)
    and public.legal_subnational_language_requirements_satisfied(b.bundle_id)
    and public.legal_comprehension_documents_complete(b.bundle_id,v_locale)
  limit 1;
  if v_bundle_id is null or not public.legal_applicability_bundle_satisfied(p_user_id,v_bundle_id) then return null; end if;
  if not public.legal_overlay_comprehension_documents_complete(p_user_id,v_bundle_id,v_locale) then return null; end if;
  return v_bundle_id;
end $$;
revoke all on function public.resolve_current_legal_bundle_id(uuid,text) from public,anon,authenticated;
grant execute on function public.resolve_current_legal_bundle_id(uuid,text) to service_role;

create or replace function public.enforce_legal_bundle_route_release_evidence()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_bundle public.legal_document_bundles;v_policy public.legal_jurisdiction_policies;
begin
  if new.route_status='active' then
    select * into v_policy from public.legal_jurisdiction_policies where legal_country_code=new.legal_country_code;
    if not found or not public.legal_source_approval_current(new.legal_country_code) or v_policy.age_assurance_mode='unresolved' then raise exception 'jurisdiction_not_source_approved_or_age_policy_unresolved'; end if;
    if not public.legal_control_reviews_complete(v_policy.control_reviews) then raise exception 'jurisdiction_topic_control_reviews_incomplete'; end if;
    if cardinality(v_policy.source_approved_document_locales)=0 or cardinality(v_policy.required_document_types)=0 then raise exception 'approved_document_or_manifest_policy_missing'; end if;
    if jsonb_array_length(v_policy.subnational_evidence_reference)=0 or jsonb_array_length(v_policy.language_evidence_reference)=0 or jsonb_array_length(v_policy.localization_evidence_reference)=0 or jsonb_array_length(v_policy.age_assurance_evidence_reference)=0 or jsonb_array_length(v_policy.animal_welfare_evidence_reference)=0 or jsonb_array_length(v_policy.breeding_mating_evidence_reference)=0 or jsonb_array_length(v_policy.pet_commerce_evidence_reference)=0 or jsonb_array_length(v_policy.operational_evidence_reference)=0 then raise exception 'jurisdiction_operational_evidence_incomplete'; end if;
    if v_policy.subnational_review_required and new.legal_subnational_code='' then raise exception 'subnational_route_required'; end if;
    if v_policy.subnational_review_required and not public.legal_subnational_source_approved(new.legal_country_code,new.legal_subnational_code) then raise exception 'subnational_source_review_incomplete'; end if;
    if new.current_bundle_id is null or new.effective_at is null or new.effective_at>now() or jsonb_array_length(new.evidence_reference)=0 then raise exception 'active_legal_route_requires_current_evidence'; end if;
    select * into v_bundle from public.legal_document_bundles where bundle_id=new.current_bundle_id;
    if not found then raise exception 'legal_bundle_not_found'; end if;
    if v_bundle.legal_country_code<>new.legal_country_code or coalesce(v_bundle.legal_subnational_code,'')<>new.legal_subnational_code or v_bundle.ui_locale<>new.ui_locale then raise exception 'legal_bundle_route_context_mismatch'; end if;
    if not (v_bundle.document_locale=any(v_policy.source_approved_document_locales)) or not public.legal_country_locale_source_approved(v_bundle.legal_country_code,v_bundle.document_locale) then raise exception 'document_locale_not_source_approved_for_jurisdiction'; end if;
    if v_bundle.effective_at>now() then raise exception 'legal_bundle_not_effective'; end if;
    if jsonb_array_length(v_bundle.source_evidence_reference)=0 then raise exception 'legal_bundle_official_source_evidence_required'; end if;
    if jsonb_array_length(v_bundle.localization_evidence_reference)=0 then raise exception 'legal_bundle_localization_evidence_required'; end if;
    if not public.legal_bundle_document_manifest_complete(v_bundle.bundle_id) then raise exception 'legal_bundle_document_manifest_incomplete_or_stale'; end if;
    if not public.legal_subnational_language_requirements_satisfied(v_bundle.bundle_id) then raise exception 'subnational_language_requirement_incomplete_or_stale'; end if;
  end if;
  return new;
end $$;
revoke all on function public.enforce_legal_bundle_route_release_evidence() from public,anon,authenticated;
grant execute on function public.enforce_legal_bundle_route_release_evidence() to service_role;

-- Mating remains operator-controlled and welfare/kinship gated, but source legality no longer depends on counsel metadata.
create or replace function public.current_mating_feature_enabled()
returns boolean language plpgsql stable security definer set search_path='' as $$
declare r public.legal_country_runtime; f public.jurisdiction_product_features;
begin
  select * into r from public.legal_country_runtime where user_id=auth.uid();
  if r.legal_country_code is null or r.resolution_status<>'verified' then return false; end if;
  if not public.legal_source_approval_current(r.legal_country_code) then return false; end if;
  select * into f from public.jurisdiction_product_features where country_code=r.legal_country_code;
  return coalesce(f.mating_owner_arranged_enabled,false)
    and coalesce(f.animal_welfare_review_complete,false) and coalesce(f.kinship_control_complete,false)
    and f.effective_at<=now() and f.expires_at>now() and nullif(trim(f.evidence_reference),'') is not null;
end $$;
revoke all on function public.current_mating_feature_enabled() from public,anon,authenticated;
grant execute on function public.current_mating_feature_enabled() to service_role;

comment on function public.legal_source_approval_current(text) is
  'Configured-27 official-source + exact legal-language source approval. External counsel is not a prerequisite. Live production/store/provider/operator evidence is evaluated independently.';
comment on function public.resolve_current_legal_bundle_id(uuid,text) is
  'Runtime legal bundle resolver: internal official-source/legal-language authority plus independent live operational, age, applicability and route evidence. No external-counsel prerequisite.';
