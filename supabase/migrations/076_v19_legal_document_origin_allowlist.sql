-- Tailmance v19 legal-document origin allowlist hardening.
-- HTTPS alone is not a sufficient trust boundary for binding legal content. Release-active base and overlay
-- legal documents must resolve only to explicitly approved HTTPS origins with attributable, fresh evidence.

create table if not exists public.legal_document_origins (
  origin text primary key,
  status text not null default 'active' check (status in ('active','revoked')),
  evidence_reference jsonb not null check (jsonb_typeof(evidence_reference)='array' and jsonb_array_length(evidence_reference)>0),
  reviewer text not null check (char_length(trim(reviewer)) between 1 and 160),
  reviewed_at timestamptz not null,
  valid_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (origin=lower(origin)),
  check (origin ~ '^https://[a-z0-9][a-z0-9.-]*[a-z0-9](:[1-9][0-9]{0,4})?$'),
  check (position('.' in split_part(substring(origin from 9),':',1))>0),
  check (substring(origin from 9) !~ '[/#?@]'),
  check (origin !~ '\.\.'),
  check (valid_until>reviewed_at and valid_until<=reviewed_at+interval '90 days')
);
alter table public.legal_document_origins enable row level security;
revoke all on table public.legal_document_origins from public,anon,authenticated;
grant select,insert,update on table public.legal_document_origins to service_role;

create or replace function public.legal_document_url_allowed(p_url text)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(
    p_url ~ '^https://'
    and p_url !~ '[[:cntrl:]]'
    and exists(
      select 1 from public.legal_document_origins o
      where o.status='active'
        and o.reviewed_at<=now()
        and o.reviewed_at>=now()-interval '90 days'
        and o.valid_until>now()
        and o.valid_until<=o.reviewed_at+interval '90 days'
        and jsonb_array_length(o.evidence_reference)>0
        and (p_url=o.origin or p_url like o.origin||'/%')
    ),false
  );
$$;
revoke all on function public.legal_document_url_allowed(text) from public,anon,authenticated;
grant execute on function public.legal_document_url_allowed(text) to service_role;

-- Rebind the canonical base-document completeness gate so every consumer of the legal resolver inherits
-- the origin trust requirement automatically.
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

  foreach v_type in array v_policy.required_document_types loop
    select * into v_doc from public.legal_bundle_documents where bundle_id=p_bundle_id and document_type=v_type;
    if not found then return false; end if;
    if v_doc.document_locale<>v_bundle.document_locale then return false; end if;
    if not public.legal_document_url_allowed(v_doc.document_url) then return false; end if;
    if v_doc.reviewed_at>now()+interval '5 minutes' or v_doc.reviewed_at<now()-interval '90 days' then return false; end if;
    if v_doc.valid_until<=now() or v_doc.valid_until>v_doc.reviewed_at+interval '90 days' then return false; end if;
    if jsonb_array_length(v_doc.source_evidence_reference)=0 or jsonb_array_length(v_doc.counsel_evidence_reference)=0 or jsonb_array_length(v_doc.localization_evidence_reference)=0 then return false; end if;
    if v_type='terms' and (v_doc.document_version<>v_bundle.terms_version or v_doc.document_url<>v_bundle.terms_url or v_doc.document_sha256<>v_bundle.terms_sha256) then return false; end if;
    if v_type='privacy_notice' and (v_doc.document_version<>v_bundle.privacy_notice_version or v_doc.document_url<>v_bundle.privacy_notice_url or v_doc.document_sha256<>v_bundle.privacy_notice_sha256) then return false; end if;
    if v_type='community_guidelines' and (v_doc.document_version<>v_bundle.community_guidelines_version or v_doc.document_url<>v_bundle.community_guidelines_url or v_doc.document_sha256<>v_bundle.community_guidelines_sha256) then return false; end if;
    if v_type='marketing_push_consent' and (v_doc.document_version<>v_bundle.marketing_push_consent_version or v_doc.document_url<>v_bundle.marketing_push_consent_url or v_doc.document_sha256<>v_bundle.marketing_push_consent_sha256) then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function public.legal_bundle_document_manifest_complete(uuid) from public,anon,authenticated;
grant execute on function public.legal_bundle_document_manifest_complete(uuid) to service_role;

-- Overlay completeness inherits the same origin boundary. A malicious/misconfigured supplemental URL may
-- not become release-active merely because its hash/counsel/localization fields are populated.
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
              and d.reviewed_at<=now() and d.reviewed_at>=now()-interval '90 days'
              and d.valid_until>now() and d.valid_until<=d.reviewed_at+interval '90 days'
              and jsonb_array_length(d.source_evidence_reference)>0
              and jsonb_array_length(d.counsel_evidence_reference)>0
              and jsonb_array_length(d.localization_evidence_reference)>0
          ) then return false; end if;
        end loop;
      end loop;
    end if;
  end loop;
  return true;
end $$;
revoke all on function public.legal_applicability_bundle_satisfied(uuid,uuid) from public,anon,authenticated;
grant execute on function public.legal_applicability_bundle_satisfied(uuid,uuid) to service_role;
