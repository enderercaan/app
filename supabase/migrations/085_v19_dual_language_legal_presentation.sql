-- Tailmance v19 dual-language legal presentation hardening.
-- The binding/statutory document language remains authoritative. When the UI language differs,
-- a source-hash-bound comprehension mirror in the UI language is additionally required and displayed.
-- A comprehension mirror never replaces, weakens, or changes the governing document or jurisdiction.

create table if not exists public.legal_bundle_comprehension_documents (
  comprehension_document_id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null,
  source_document_type text not null,
  document_locale text not null check (char_length(document_locale) between 2 and 16),
  source_document_version text not null check (char_length(trim(source_document_version)) between 1 and 64),
  source_document_sha256 text not null check (source_document_sha256 ~ '^[0-9a-f]{64}$'),
  translation_version text not null check (char_length(trim(translation_version)) between 1 and 64),
  document_url text not null check (document_url ~ '^https://'),
  document_sha256 text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
  source_evidence_reference jsonb not null check (jsonb_typeof(source_evidence_reference)='array' and jsonb_array_length(source_evidence_reference)>0),
  localization_evidence_reference jsonb not null check (jsonb_typeof(localization_evidence_reference)='array' and jsonb_array_length(localization_evidence_reference)>0),
  reviewer text not null check (char_length(trim(reviewer)) between 1 and 160),
  reviewed_at timestamptz not null,
  valid_until timestamptz not null,
  created_at timestamptz not null default now(),
  unique(bundle_id,source_document_type,document_locale),
  foreign key(bundle_id,source_document_type) references public.legal_bundle_documents(bundle_id,document_type) on delete restrict,
  check (valid_until>reviewed_at and valid_until<=reviewed_at+interval '90 days')
);
create index if not exists legal_bundle_comprehension_documents_lookup_idx
  on public.legal_bundle_comprehension_documents(bundle_id,document_locale,source_document_type);
alter table public.legal_bundle_comprehension_documents enable row level security;
revoke all on table public.legal_bundle_comprehension_documents from public,anon,authenticated;
grant select,insert on table public.legal_bundle_comprehension_documents to service_role;
revoke update,delete on table public.legal_bundle_comprehension_documents from service_role;
drop trigger if exists trg_legal_bundle_comprehension_documents_immutable on public.legal_bundle_comprehension_documents;
create trigger trg_legal_bundle_comprehension_documents_immutable
before update or delete on public.legal_bundle_comprehension_documents
for each row execute function public.prevent_immutable_legal_bundle_document_mutation();

create table if not exists public.legal_overlay_comprehension_documents (
  comprehension_document_id uuid primary key default gen_random_uuid(),
  source_overlay_document_id uuid not null references public.legal_bundle_overlay_documents(overlay_document_id) on delete restrict,
  bundle_id uuid not null references public.legal_document_bundles(bundle_id) on delete restrict,
  document_locale text not null check (char_length(document_locale) between 2 and 16),
  source_document_version text not null check (char_length(trim(source_document_version)) between 1 and 64),
  source_document_sha256 text not null check (source_document_sha256 ~ '^[0-9a-f]{64}$'),
  translation_version text not null check (char_length(trim(translation_version)) between 1 and 64),
  document_url text not null check (document_url ~ '^https://'),
  document_sha256 text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
  source_evidence_reference jsonb not null check (jsonb_typeof(source_evidence_reference)='array' and jsonb_array_length(source_evidence_reference)>0),
  localization_evidence_reference jsonb not null check (jsonb_typeof(localization_evidence_reference)='array' and jsonb_array_length(localization_evidence_reference)>0),
  reviewer text not null check (char_length(trim(reviewer)) between 1 and 160),
  reviewed_at timestamptz not null,
  valid_until timestamptz not null,
  created_at timestamptz not null default now(),
  unique(source_overlay_document_id,document_locale),
  check (valid_until>reviewed_at and valid_until<=reviewed_at+interval '90 days')
);
create index if not exists legal_overlay_comprehension_documents_lookup_idx
  on public.legal_overlay_comprehension_documents(bundle_id,document_locale,source_overlay_document_id);
alter table public.legal_overlay_comprehension_documents enable row level security;
revoke all on table public.legal_overlay_comprehension_documents from public,anon,authenticated;
grant select,insert on table public.legal_overlay_comprehension_documents to service_role;
revoke update,delete on table public.legal_overlay_comprehension_documents from service_role;
drop trigger if exists trg_legal_overlay_comprehension_documents_immutable on public.legal_overlay_comprehension_documents;
create trigger trg_legal_overlay_comprehension_documents_immutable
before update or delete on public.legal_overlay_comprehension_documents
for each row execute function public.prevent_immutable_legal_bundle_document_mutation();

create or replace function public.legal_comprehension_documents_complete(p_bundle_id uuid,p_ui_locale text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_locale text:=trim(coalesce(p_ui_locale,''));v_source public.legal_bundle_documents;
begin
  if p_bundle_id is null or char_length(v_locale) not between 2 and 16 then return false; end if;
  for v_source in select * from public.legal_bundle_documents where bundle_id=p_bundle_id loop
    if v_source.document_locale<>v_locale and not exists(
      select 1 from public.legal_bundle_comprehension_documents c
      where c.bundle_id=p_bundle_id and c.source_document_type=v_source.document_type and c.document_locale=v_locale
        and c.source_document_version=v_source.document_version and c.source_document_sha256=v_source.document_sha256
        and public.legal_document_url_allowed(c.document_url)
        and c.reviewed_at<=now() and c.reviewed_at>=now()-interval '90 days'
        and c.valid_until>now() and c.valid_until<=c.reviewed_at+interval '90 days'
        and jsonb_array_length(c.source_evidence_reference)>0 and jsonb_array_length(c.localization_evidence_reference)>0
    ) then return false; end if;
  end loop;
  return exists(select 1 from public.legal_bundle_documents where bundle_id=p_bundle_id);
end $$;
revoke all on function public.legal_comprehension_documents_complete(uuid,text) from public,anon,authenticated;
grant execute on function public.legal_comprehension_documents_complete(uuid,text) to service_role;

create or replace function public.legal_overlay_comprehension_documents_complete(p_user_id uuid,p_bundle_id uuid,p_ui_locale text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_locale text:=trim(coalesce(p_ui_locale,''));v_matrix_id uuid;v_source record;
begin
  if p_user_id is null or p_bundle_id is null or char_length(v_locale) not between 2 and 16 then return false; end if;
  select current_applicability_matrix_id into v_matrix_id from public.legal_country_runtime where user_id=p_user_id;
  if v_matrix_id is null then return false; end if;
  for v_source in
    select d.* from public.legal_bundle_overlay_documents d
    join public.legal_applicability_overlays o on o.overlay_id=d.overlay_id and o.matrix_id=d.matrix_id and o.applicability_status='applicable'
    where d.matrix_id=v_matrix_id and d.bundle_id=p_bundle_id
  loop
    if v_source.document_locale<>v_locale and not exists(
      select 1 from public.legal_overlay_comprehension_documents c
      where c.source_overlay_document_id=v_source.overlay_document_id and c.bundle_id=p_bundle_id and c.document_locale=v_locale
        and c.source_document_version=v_source.document_version and c.source_document_sha256=v_source.document_sha256
        and public.legal_document_url_allowed(c.document_url)
        and c.reviewed_at<=now() and c.reviewed_at>=now()-interval '90 days'
        and c.valid_until>now() and c.valid_until<=c.reviewed_at+interval '90 days'
        and jsonb_array_length(c.source_evidence_reference)>0 and jsonb_array_length(c.localization_evidence_reference)>0
    ) then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function public.legal_overlay_comprehension_documents_complete(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.legal_overlay_comprehension_documents_complete(uuid,uuid,text) to service_role;

create or replace function public.current_legal_comprehension_documents(p_bundle_id uuid,p_ui_locale text)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when not public.legal_comprehension_documents_complete(p_bundle_id,p_ui_locale) then '[]'::jsonb else coalesce(jsonb_agg(jsonb_build_object(
    'comprehensionDocumentId',c.comprehension_document_id,'sourceDocumentType',c.source_document_type,
    'sourceDocumentLocale',d.document_locale,'sourceDocumentVersion',c.source_document_version,'sourceDocumentSha256',c.source_document_sha256,
    'documentLocale',c.document_locale,'translationVersion',c.translation_version,'documentUrl',c.document_url,'documentSha256',c.document_sha256
  ) order by c.source_document_type,c.document_locale),'[]'::jsonb) end
  from public.legal_bundle_documents d
  left join public.legal_bundle_comprehension_documents c
    on c.bundle_id=d.bundle_id and c.source_document_type=d.document_type and c.document_locale=trim(coalesce(p_ui_locale,''))
    and d.document_locale<>trim(coalesce(p_ui_locale,''))
  where d.bundle_id=p_bundle_id and (d.document_locale=trim(coalesce(p_ui_locale,'')) or c.comprehension_document_id is not null)
    and c.comprehension_document_id is not null;
$$;
revoke all on function public.current_legal_comprehension_documents(uuid,text) from public,anon,authenticated;
grant execute on function public.current_legal_comprehension_documents(uuid,text) to service_role;

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
  join public.legal_overlay_comprehension_documents c on c.source_overlay_document_id=d.overlay_document_id and c.bundle_id=p_bundle_id
    and c.document_locale=trim(coalesce(p_ui_locale,'')) and d.document_locale<>trim(coalesce(p_ui_locale,''))
  where r.user_id=p_user_id;
$$;
revoke all on function public.current_legal_overlay_comprehension_documents(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.current_legal_overlay_comprehension_documents(uuid,uuid,text) to service_role;

create or replace function public.current_legal_acceptance_comprehension_document_set_sha256(p_user_id uuid,p_bundle_id uuid,p_ui_locale text)
returns text language plpgsql stable security definer set search_path='' as $$
declare v_base jsonb;v_overlay jsonb;
begin
  if not public.legal_comprehension_documents_complete(p_bundle_id,p_ui_locale)
     or not public.legal_overlay_comprehension_documents_complete(p_user_id,p_bundle_id,p_ui_locale) then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_array(c.source_document_type,c.source_document_version,c.source_document_sha256,c.document_locale,c.translation_version,c.document_url,c.document_sha256) order by c.source_document_type),'[]'::jsonb)
    into v_base from public.legal_bundle_comprehension_documents c
    where c.bundle_id=p_bundle_id and c.document_locale=trim(p_ui_locale)
      and c.source_document_type=any(array['terms','privacy_notice','community_guidelines','jurisdiction_privacy_supplement']::text[]);
  select coalesce(jsonb_agg(jsonb_build_array(c.source_overlay_document_id::text,c.source_document_version,c.source_document_sha256,c.document_locale,c.translation_version,c.document_url,c.document_sha256) order by c.source_overlay_document_id::text),'[]'::jsonb)
    into v_overlay
    from public.legal_country_runtime r
    join public.legal_bundle_overlay_documents d on d.matrix_id=r.current_applicability_matrix_id and d.bundle_id=p_bundle_id and d.document_type<>'marketing_push_consent'
    join public.legal_applicability_overlays o on o.overlay_id=d.overlay_id and o.matrix_id=d.matrix_id and o.applicability_status='applicable'
    join public.legal_overlay_comprehension_documents c on c.source_overlay_document_id=d.overlay_document_id and c.document_locale=trim(p_ui_locale)
    where r.user_id=p_user_id;
  return encode(extensions.digest(convert_to(jsonb_build_object('bundleId',p_bundle_id,'uiLocale',trim(p_ui_locale),'base',v_base,'overlays',v_overlay)::text,'UTF8'),'sha256'),'hex');
end $$;
revoke all on function public.current_legal_acceptance_comprehension_document_set_sha256(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.current_legal_acceptance_comprehension_document_set_sha256(uuid,uuid,text) to service_role;

-- Rebind route resolution: statutory/base-language documents remain required, and a differing UI language
-- additionally requires complete source-hash-bound comprehension mirrors. No cross-language silent fallback.
create or replace function public.resolve_current_legal_bundle_id(p_user_id uuid,p_ui_locale text)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_runtime public.legal_country_runtime;v_policy public.legal_jurisdiction_policies;v_locale text:=trim(coalesce(p_ui_locale,''));v_bundle_id uuid;
begin
  if p_user_id is null or char_length(v_locale) not between 2 and 16 then return null; end if;
  select * into v_runtime from public.legal_country_runtime where user_id=p_user_id;
  if not found or v_runtime.resolution_status<>'verified' or v_runtime.legal_country_code is null then return null; end if;
  if v_runtime.legal_subnational_code is not null and left(v_runtime.legal_subnational_code,3)<>v_runtime.legal_country_code||'-' then return null; end if;
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
  if not public.legal_applicability_matrix_satisfied(p_user_id) then return null; end if;
  select r.current_bundle_id into v_bundle_id
  from public.legal_document_bundle_routes r join public.legal_document_bundles b on b.bundle_id=r.current_bundle_id
  where r.legal_country_code=v_runtime.legal_country_code
    and r.legal_subnational_code=case when v_policy.subnational_review_required then coalesce(v_runtime.legal_subnational_code,'') else '' end
    and r.ui_locale=v_locale and r.route_status='active' and r.effective_at is not null and r.effective_at<=now() and jsonb_array_length(r.evidence_reference)>0
    and b.legal_country_code=r.legal_country_code and coalesce(b.legal_subnational_code,'')=r.legal_subnational_code and b.ui_locale=r.ui_locale
    and (b.legal_subnational_code is null or left(b.legal_subnational_code,3)=b.legal_country_code||'-')
    and b.document_locale=any(v_policy.approved_document_locales) and b.effective_at<=now()
    and jsonb_array_length(b.source_evidence_reference)>0 and jsonb_array_length(b.counsel_evidence_reference)>0 and jsonb_array_length(b.localization_evidence_reference)>0
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

-- Mandatory acceptance hash contains both governing documents and the exact comprehension mirrors shown.
create or replace function public.legal_acceptance_presentation_payload(p_user_id uuid,p_bundle_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_matrix_id uuid;v_base jsonb;v_overlay jsonb;v_ui text;v_comp jsonb;v_overlay_comp jsonb;v_comp_sha text;
begin
  if p_user_id is null or p_bundle_id is null then return null; end if;
  select current_applicability_matrix_id into v_matrix_id from public.legal_country_runtime where user_id=p_user_id;
  select ui_locale into v_ui from public.legal_document_bundles where bundle_id=p_bundle_id;
  if v_matrix_id is null or v_ui is null then return null; end if;
  if public.resolve_current_legal_bundle_id(p_user_id,v_ui) is distinct from p_bundle_id then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('documentType',d.document_type,'documentLocale',d.document_locale,'documentVersion',d.document_version,'documentUrl',d.document_url,'documentSha256',d.document_sha256) order by d.document_type),'[]'::jsonb)
    into v_base from public.legal_bundle_documents d where d.bundle_id=p_bundle_id and d.document_type=any(array['terms','privacy_notice','community_guidelines','jurisdiction_privacy_supplement']::text[]);
  v_overlay:=public.current_legal_overlay_documents(p_user_id,p_bundle_id);
  select coalesce(jsonb_agg(x order by x->>'sourceDocumentType'),'[]'::jsonb) into v_comp
    from jsonb_array_elements(public.current_legal_comprehension_documents(p_bundle_id,v_ui)) x
    where x->>'sourceDocumentType'=any(array['terms','privacy_notice','community_guidelines','jurisdiction_privacy_supplement']::text[]);
  select coalesce(jsonb_agg(x order by x->>'sourceOverlayDocumentId'),'[]'::jsonb) into v_overlay_comp
    from jsonb_array_elements(public.current_legal_overlay_comprehension_documents(p_user_id,p_bundle_id,v_ui)) x
    where x->>'sourceDocumentType'<>'marketing_push_consent';
  v_comp_sha:=public.current_legal_acceptance_comprehension_document_set_sha256(p_user_id,p_bundle_id,v_ui);
  if v_comp_sha is null then return null; end if;
  return jsonb_build_object('matrixId',v_matrix_id,'bundleId',p_bundle_id,
    'overlayDocumentSetSha256',public.current_legal_overlay_document_set_sha256(p_user_id,p_bundle_id),
    'comprehensionDocumentSetSha256',v_comp_sha,'baseDocuments',v_base,'overlayDocuments',v_overlay,
    'comprehensionDocuments',v_comp,'comprehensionOverlayDocuments',v_overlay_comp);
end $$;
revoke all on function public.legal_acceptance_presentation_payload(uuid,uuid) from public,anon,authenticated;
grant execute on function public.legal_acceptance_presentation_payload(uuid,uuid) to service_role;

-- Subscription pre-contract digest also binds user-language mirrors of every source document shown.
create or replace function public.current_subscription_purchase_document_set_sha256(p_user_id uuid,p_bundle_id uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare v_matrix_id uuid;v_ui text;v_base jsonb;v_overlay jsonb;v_comp jsonb;v_overlay_comp jsonb;
begin
  if p_user_id is null or p_bundle_id is null then return null; end if;
  select current_applicability_matrix_id into v_matrix_id from public.legal_country_runtime where user_id=p_user_id;
  select ui_locale into v_ui from public.legal_document_bundles where bundle_id=p_bundle_id;
  if v_matrix_id is null or v_ui is null or public.resolve_current_legal_bundle_id(p_user_id,v_ui) is distinct from p_bundle_id then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_array(d.document_type,d.document_locale,d.document_version,d.document_url,d.document_sha256) order by d.document_type),'[]'::jsonb) into v_base
    from public.legal_bundle_documents d where d.bundle_id=p_bundle_id and d.document_type=any(array['terms','privacy_notice','subscription_consumer']::text[]);
  select coalesce(jsonb_agg(jsonb_build_array(d.overlay_document_id::text,o.jurisdiction_country_code,coalesce(o.jurisdiction_subnational_code,''),o.applicability_basis,d.document_type,d.document_locale,d.document_version,d.document_url,d.document_sha256) order by o.jurisdiction_country_code,coalesce(o.jurisdiction_subnational_code,''),o.applicability_basis,d.document_type,d.document_locale,d.overlay_document_id::text),'[]'::jsonb) into v_overlay
    from public.legal_bundle_overlay_documents d join public.legal_applicability_overlays o on o.overlay_id=d.overlay_id and o.matrix_id=d.matrix_id and o.applicability_status='applicable'
    where d.matrix_id=v_matrix_id and d.bundle_id=p_bundle_id and d.document_type=any(array['subscription_consumer','jurisdiction_consumer_supplement']::text[]);
  select coalesce(jsonb_agg(x order by x->>'sourceDocumentType'),'[]'::jsonb) into v_comp from jsonb_array_elements(public.current_legal_comprehension_documents(p_bundle_id,v_ui)) x
    where x->>'sourceDocumentType'=any(array['terms','privacy_notice','subscription_consumer']::text[]);
  select coalesce(jsonb_agg(x order by x->>'sourceOverlayDocumentId'),'[]'::jsonb) into v_overlay_comp from jsonb_array_elements(public.current_legal_overlay_comprehension_documents(p_user_id,p_bundle_id,v_ui)) x
    where x->>'sourceDocumentType'=any(array['subscription_consumer','jurisdiction_consumer_supplement']::text[]);
  return encode(extensions.digest(convert_to(jsonb_build_object('matrixId',v_matrix_id,'bundleId',p_bundle_id,'baseDocuments',v_base,'overlayDocuments',v_overlay,'comprehensionDocuments',v_comp,'comprehensionOverlayDocuments',v_overlay_comp)::text,'UTF8'),'sha256'),'hex');
end $$;
revoke all on function public.current_subscription_purchase_document_set_sha256(uuid,uuid) from public,anon,authenticated;
grant execute on function public.current_subscription_purchase_document_set_sha256(uuid,uuid) to service_role;

-- Marketing consent remains optional and separately evidenced, but its digest now also binds comprehension mirrors.
create or replace function public.current_marketing_consent_document_set_sha256(p_user_id uuid,p_bundle_id uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare v_bundle public.legal_document_bundles;v_overlays jsonb;v_base_comp jsonb;v_overlay_comp jsonb;
begin
  if p_user_id is null or p_bundle_id is null then return null; end if;
  if not public.marketing_consent_overlay_documents_complete(p_user_id,p_bundle_id) then return null; end if;
  select * into v_bundle from public.legal_document_bundles where bundle_id=p_bundle_id;
  if not found or not public.legal_comprehension_documents_complete(p_bundle_id,v_bundle.ui_locale)
      or not public.legal_overlay_comprehension_documents_complete(p_user_id,p_bundle_id,v_bundle.ui_locale) then return null; end if;
  v_overlays:=public.current_marketing_consent_documents(p_user_id,p_bundle_id);
  select coalesce(jsonb_agg(x order by x->>'sourceDocumentType'),'[]'::jsonb) into v_base_comp from jsonb_array_elements(public.current_legal_comprehension_documents(p_bundle_id,v_bundle.ui_locale)) x where x->>'sourceDocumentType'='marketing_push_consent';
  select coalesce(jsonb_agg(x order by x->>'sourceOverlayDocumentId'),'[]'::jsonb) into v_overlay_comp from jsonb_array_elements(public.current_legal_overlay_comprehension_documents(p_user_id,p_bundle_id,v_bundle.ui_locale)) x where x->>'sourceDocumentType'='marketing_push_consent';
  return encode(extensions.digest(convert_to(jsonb_build_object(
    'base',jsonb_build_array(v_bundle.bundle_id::text,v_bundle.marketing_push_consent_version,v_bundle.document_locale,v_bundle.marketing_push_consent_sha256),
    'overlays',coalesce((select jsonb_agg(jsonb_build_array(x->>'overlayDocumentId',x->>'jurisdictionCountryCode',coalesce(x->>'jurisdictionSubnationalCode',''),x->>'applicabilityBasis',x->>'documentLocale',x->>'documentVersion',x->>'documentUrl',x->>'documentSha256') order by x->>'jurisdictionCountryCode',coalesce(x->>'jurisdictionSubnationalCode',''),x->>'applicabilityBasis',x->>'documentLocale',x->>'overlayDocumentId') from jsonb_array_elements(v_overlays) x),'[]'::jsonb),
    'comprehensionDocuments',v_base_comp,'comprehensionOverlayDocuments',v_overlay_comp
  )::text,'UTF8'),'sha256'),'hex');
end $$;
revoke all on function public.current_marketing_consent_document_set_sha256(uuid,uuid) from public,anon,authenticated;
grant execute on function public.current_marketing_consent_document_set_sha256(uuid,uuid) to service_role;

create or replace function public.get_current_marketing_consent_presentation(p_ui_locale text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_user_id uuid:=auth.uid();v_locale text:=trim(coalesce(p_ui_locale,''));v_context jsonb;v_bundle_id uuid;v_bundle public.legal_document_bundles;v_base jsonb;v_overlays jsonb;v_base_comp jsonb;v_overlay_comp jsonb;v_sha text;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if not public.current_session_satisfies_mfa_if_enrolled() then raise exception 'mfa_required'; end if;
  if char_length(v_locale) not between 2 and 16 then raise exception 'invalid_locale'; end if;
  v_context:=public.get_current_legal_context(v_locale);
  if coalesce(v_context->>'status','')<>'ready' then return jsonb_build_object('status',coalesce(v_context->>'status','blocked_legal_context'),'legalCountryCode',v_context->>'legalCountryCode','uiLocale',v_locale); end if;
  if not public.current_user_has_product_access() then return jsonb_build_object('status','blocked_current_legal_acceptance_required','uiLocale',v_locale); end if;
  begin v_bundle_id:=(v_context->>'bundleId')::uuid; exception when others then return jsonb_build_object('status','blocked_legal_bundle_missing','uiLocale',v_locale); end;
  select * into v_bundle from public.legal_document_bundles where bundle_id=v_bundle_id;
  if not found or v_bundle.ui_locale<>v_locale then return jsonb_build_object('status','blocked_legal_bundle_context_mismatch','uiLocale',v_locale); end if;
  select jsonb_build_object('documentType',d.document_type,'documentLocale',d.document_locale,'documentVersion',d.document_version,'documentUrl',d.document_url,'documentSha256',d.document_sha256) into v_base
    from public.legal_bundle_documents d where d.bundle_id=v_bundle_id and d.document_type='marketing_push_consent' limit 1;
  if v_base is null then return jsonb_build_object('status','blocked_marketing_consent_document_missing','bundleId',v_bundle_id,'uiLocale',v_locale); end if;
  v_overlays:=public.current_marketing_consent_documents(v_user_id,v_bundle_id);
  select x into v_base_comp from jsonb_array_elements(public.current_legal_comprehension_documents(v_bundle_id,v_locale)) x where x->>'sourceDocumentType'='marketing_push_consent' limit 1;
  select coalesce(jsonb_agg(x order by x->>'sourceOverlayDocumentId'),'[]'::jsonb) into v_overlay_comp from jsonb_array_elements(public.current_legal_overlay_comprehension_documents(v_user_id,v_bundle_id,v_locale)) x where x->>'sourceDocumentType'='marketing_push_consent';
  v_sha:=public.current_marketing_consent_document_set_sha256(v_user_id,v_bundle_id);
  if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' then return jsonb_build_object('status','blocked_marketing_consent_document_set_unavailable','bundleId',v_bundle_id,'uiLocale',v_locale); end if;
  return jsonb_build_object('status','ready','bundleId',v_bundle.bundle_id,'applicabilityMatrixId',v_context->>'applicabilityMatrixId','legalCountryCode',v_bundle.legal_country_code,
    'legalSubnationalCode',v_bundle.legal_subnational_code,'uiLocale',v_bundle.ui_locale,'documentLocale',v_bundle.document_locale,'consentVersion',v_bundle.marketing_push_consent_version,
    'baseDocument',v_base,'overlayDocuments',v_overlays,'comprehensionDocument',v_base_comp,'comprehensionOverlayDocuments',v_overlay_comp,'consentDocumentSetSha256',v_sha);
end $$;
revoke all on function public.get_current_marketing_consent_presentation(text) from public,anon;
grant execute on function public.get_current_marketing_consent_presentation(text) to authenticated;

-- Context surfaces both authoritative and user-language documents, and explains precisely when mirrors are missing.
create or replace function public.get_current_legal_context(p_ui_locale text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_user_id uuid:=auth.uid();v_runtime public.legal_country_runtime;v_policy public.legal_jurisdiction_policies;v_bundle public.legal_document_bundles;v_bundle_id uuid;v_candidate_id uuid;v_locale text:=trim(coalesce(p_ui_locale,''));
  v_accepted boolean:=false;v_privacy_ack boolean:=false;v_overlay_actions boolean:=false;v_presentation_complete boolean:=false;
  v_docs jsonb:='{}'::jsonb;v_overlay_docs jsonb:='[]'::jsonb;v_comp_docs jsonb:='[]'::jsonb;v_overlay_comp_docs jsonb:='[]'::jsonb;
  v_presentation_sha text;v_overlay_sha text;v_marketing_sha text;v_subscription_sha text;v_comp_sha text;
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
    where r.legal_country_code=v_runtime.legal_country_code and r.legal_subnational_code=case when v_policy.subnational_review_required then coalesce(v_runtime.legal_subnational_code,'') else '' end
      and r.ui_locale=v_locale and r.route_status='active' and r.effective_at is not null and r.effective_at<=now() and b.legal_country_code=r.legal_country_code and coalesce(b.legal_subnational_code,'')=r.legal_subnational_code and b.ui_locale=r.ui_locale limit 1;
  if v_candidate_id is not null and not public.legal_bundle_document_manifest_complete(v_candidate_id) then return jsonb_build_object('status','blocked_legal_document_manifest_incomplete','legalCountryCode',v_runtime.legal_country_code,'legalSubnationalCode',v_runtime.legal_subnational_code,'uiLocale',v_locale); end if;
  if v_candidate_id is not null and not public.legal_subnational_language_requirements_satisfied(v_candidate_id) then return jsonb_build_object('status','blocked_subnational_language_requirement_incomplete','legalCountryCode',v_runtime.legal_country_code,'legalSubnationalCode',v_runtime.legal_subnational_code,'uiLocale',v_locale); end if;
  if v_candidate_id is not null and not public.legal_applicability_bundle_satisfied(v_user_id,v_candidate_id) then return jsonb_build_object('status','blocked_legal_applicability_documents_incomplete','legalCountryCode',v_runtime.legal_country_code,'legalSubnationalCode',v_runtime.legal_subnational_code,'uiLocale',v_locale,'applicabilityMatrixId',v_runtime.current_applicability_matrix_id); end if;
  if v_candidate_id is not null and (not public.legal_comprehension_documents_complete(v_candidate_id,v_locale) or not public.legal_overlay_comprehension_documents_complete(v_user_id,v_candidate_id,v_locale)) then
    return jsonb_build_object('status','blocked_legal_comprehension_documents_incomplete','legalCountryCode',v_runtime.legal_country_code,'legalSubnationalCode',v_runtime.legal_subnational_code,'uiLocale',v_locale);
  end if;
  v_bundle_id:=public.resolve_current_legal_bundle_id(v_user_id,v_locale);
  if v_bundle_id is null then return jsonb_build_object('status','blocked_legal_bundle_missing','legalCountryCode',v_runtime.legal_country_code,'legalSubnationalCode',v_runtime.legal_subnational_code,'uiLocale',v_locale); end if;
  select * into v_bundle from public.legal_document_bundles where bundle_id=v_bundle_id;
  select coalesce(jsonb_object_agg(document_type,document_url),'{}'::jsonb) into v_docs from public.legal_bundle_documents where bundle_id=v_bundle_id;
  v_overlay_docs:=public.current_legal_overlay_documents(v_user_id,v_bundle_id);
  v_comp_docs:=public.current_legal_comprehension_documents(v_bundle_id,v_locale);
  v_overlay_comp_docs:=public.current_legal_overlay_comprehension_documents(v_user_id,v_bundle_id,v_locale);
  v_overlay_sha:=public.current_legal_overlay_document_set_sha256(v_user_id,v_bundle_id);
  v_comp_sha:=public.current_legal_acceptance_comprehension_document_set_sha256(v_user_id,v_bundle_id,v_locale);
  v_marketing_sha:=public.current_marketing_consent_document_set_sha256(v_user_id,v_bundle_id);
  v_subscription_sha:=public.current_subscription_purchase_document_set_sha256(v_user_id,v_bundle_id);
  v_presentation_sha:=public.legal_acceptance_presentation_sha256(v_user_id,v_bundle_id);
  select exists(select 1 from public.legal_acceptances a where a.user_id=v_user_id and a.bundle_id=v_bundle_id and a.applicability_matrix_id=v_runtime.current_applicability_matrix_id and a.overlay_document_set_sha256=v_overlay_sha) into v_accepted;
  select exists(select 1 from public.privacy_notice_acknowledgements p where p.user_id=v_user_id and p.bundle_id=v_bundle_id and p.applicability_matrix_id=v_runtime.current_applicability_matrix_id and p.overlay_document_set_sha256=v_overlay_sha) into v_privacy_ack;
  v_overlay_actions:=public.legal_overlay_document_actions_complete(v_user_id,v_bundle_id);v_presentation_complete:=public.legal_acceptance_presentation_complete(v_user_id,v_bundle_id);
  return jsonb_build_object('status','ready','accepted',v_accepted and v_privacy_ack and v_overlay_actions and v_presentation_complete,'bundleId',v_bundle.bundle_id,
    'legalCountryCode',v_bundle.legal_country_code,'legalSubnationalCode',v_bundle.legal_subnational_code,'uiLocale',v_bundle.ui_locale,'documentLocale',v_bundle.document_locale,
    'legalVersion',v_bundle.legal_version,'termsVersion',v_bundle.terms_version,'communityGuidelinesVersion',v_bundle.community_guidelines_version,'privacyNoticeVersion',v_bundle.privacy_notice_version,'marketingPushConsentVersion',v_bundle.marketing_push_consent_version,
    'termsUrl',v_docs->>'terms','privacyNoticeUrl',v_docs->>'privacy_notice','communityGuidelinesUrl',v_docs->>'community_guidelines','marketingPushConsentUrl',v_docs->>'marketing_push_consent','subscriptionConsumerUrl',v_docs->>'subscription_consumer',
    'moderationAppealsUrl',v_docs->>'moderation_appeals','intellectualPropertyUrl',v_docs->>'intellectual_property','accessibilityUrl',v_docs->>'accessibility','accountDeletionUrl',v_docs->>'account_deletion','supportUrl',v_docs->>'support','jurisdictionPrivacySupplementUrl',v_docs->>'jurisdiction_privacy_supplement','legalDocumentUrls',v_docs,
    'applicabilityMatrixId',v_runtime.current_applicability_matrix_id,'overlayDocuments',v_overlay_docs,'comprehensionDocuments',v_comp_docs,'comprehensionOverlayDocuments',v_overlay_comp_docs,
    'overlayActionsComplete',v_overlay_actions,'overlayDocumentSetSha256',v_overlay_sha,'comprehensionDocumentSetSha256',v_comp_sha,'marketingConsentDocumentSetSha256',v_marketing_sha,'subscriptionPurchaseDocumentSetSha256',v_subscription_sha,
    'acceptancePresentationSha256',v_presentation_sha,'presentationAcceptanceComplete',v_presentation_complete,'effectiveAt',v_bundle.effective_at,'ageAssuranceMode',v_policy.age_assurance_mode,'minimumUserAge',v_policy.minimum_user_age);
end $$;
revoke all on function public.get_current_legal_context(text) from public,anon;
grant execute on function public.get_current_legal_context(text) to authenticated;
