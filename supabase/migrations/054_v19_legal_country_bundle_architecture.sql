-- Tailmance v19 legal-country / immutable-document-bundle architecture.
-- UI locale is never treated as jurisdiction. Legal country is server-controlled evidence,
-- while each acceptance points to an immutable country + UI/document-locale bundle.

create table if not exists public.legal_document_bundles (
  bundle_id uuid primary key default gen_random_uuid(),
  legal_country_code text not null check (legal_country_code ~ '^[A-Z]{2}$'),
  legal_subnational_code text check (
    legal_subnational_code is null or
    (char_length(legal_subnational_code) between 1 and 32 and legal_subnational_code ~ '^[A-Z0-9-]+$')
  ),
  ui_locale text not null check (char_length(ui_locale) between 2 and 16),
  document_locale text not null check (char_length(document_locale) between 2 and 16),
  legal_version text not null check (char_length(legal_version) between 1 and 64),
  terms_version text not null check (char_length(terms_version) between 1 and 64),
  community_guidelines_version text not null check (char_length(community_guidelines_version) between 1 and 64),
  privacy_notice_version text not null check (char_length(privacy_notice_version) between 1 and 64),
  marketing_push_consent_version text not null check (char_length(marketing_push_consent_version) between 1 and 64),
  terms_url text not null check (terms_url ~ '^https://'),
  community_guidelines_url text not null check (community_guidelines_url ~ '^https://'),
  privacy_notice_url text not null check (privacy_notice_url ~ '^https://'),
  marketing_push_consent_url text not null check (marketing_push_consent_url ~ '^https://'),
  terms_sha256 text not null check (terms_sha256 ~ '^[0-9a-f]{64}$'),
  community_guidelines_sha256 text not null check (community_guidelines_sha256 ~ '^[0-9a-f]{64}$'),
  privacy_notice_sha256 text not null check (privacy_notice_sha256 ~ '^[0-9a-f]{64}$'),
  marketing_push_consent_sha256 text not null check (marketing_push_consent_sha256 ~ '^[0-9a-f]{64}$'),
  effective_at timestamptz not null,
  source_evidence_reference jsonb not null default '[]'::jsonb check (jsonb_typeof(source_evidence_reference)='array'),
  counsel_evidence_reference jsonb not null default '[]'::jsonb check (jsonb_typeof(counsel_evidence_reference)='array'),
  localization_evidence_reference jsonb not null default '[]'::jsonb check (jsonb_typeof(localization_evidence_reference)='array'),
  created_by text not null check (char_length(trim(created_by)) between 1 and 160),
  created_at timestamptz not null default now()
);
create index if not exists legal_document_bundles_context_idx
  on public.legal_document_bundles(legal_country_code,legal_subnational_code,ui_locale,effective_at desc);
alter table public.legal_document_bundles enable row level security;
revoke all on table public.legal_document_bundles from public,anon,authenticated;

-- Current routing is deliberately separate from the immutable bundle payload. A bundle is never
-- rewritten in place. Replacing or withdrawing legal text means routing to a new immutable bundle,
-- or blocking the route.
create table if not exists public.legal_document_bundle_routes (
  legal_country_code text not null check (legal_country_code ~ '^[A-Z]{2}$'),
  legal_subnational_code text not null default '' check (
    legal_subnational_code='' or
    (char_length(legal_subnational_code) between 1 and 32 and legal_subnational_code ~ '^[A-Z0-9-]+$')
  ),
  ui_locale text not null check (char_length(ui_locale) between 2 and 16),
  current_bundle_id uuid references public.legal_document_bundles(bundle_id) on delete restrict,
  route_status text not null default 'blocked' check (route_status in ('blocked','active')),
  effective_at timestamptz,
  evidence_reference jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_reference)='array'),
  updated_by text not null check (char_length(trim(updated_by)) between 1 and 160),
  updated_at timestamptz not null default now(),
  primary key(legal_country_code,legal_subnational_code,ui_locale),
  check ((route_status='active' and current_bundle_id is not null and effective_at is not null and jsonb_array_length(evidence_reference)>0)
      or (route_status='blocked'))
);
alter table public.legal_document_bundle_routes enable row level security;
revoke all on table public.legal_document_bundle_routes from public,anon,authenticated;

-- Legal country is a trusted runtime fact, never inferred from UI language. The resolver/integration
-- that populates this table is external-evidence gated in production; clients have no direct write.
create table if not exists public.legal_country_runtime (
  user_id uuid primary key references auth.users(id) on delete cascade,
  legal_country_code text check (legal_country_code is null or legal_country_code ~ '^[A-Z]{2}$'),
  legal_subnational_code text check (
    legal_subnational_code is null or
    (char_length(legal_subnational_code) between 1 and 32 and legal_subnational_code ~ '^[A-Z0-9-]+$')
  ),
  resolution_status text not null default 'pending' check (resolution_status in ('pending','verified','blocked')),
  resolution_source text not null default 'unresolved' check (
    resolution_source in ('unresolved','storefront_verified','service_country_verified','identity_verified','manual_legal_review')
  ),
  storefront_country_code text check (storefront_country_code is null or storefront_country_code ~ '^[A-Z]{2}$'),
  operational_country_code text check (operational_country_code is null or operational_country_code ~ '^[A-Z]{2}$'),
  country_mismatch_reviewed boolean not null default false,
  evidence_reference jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_reference)='array'),
  resolved_by text,
  resolved_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  check (
    resolution_status<>'verified' or
    (legal_country_code is not null and resolution_source<>'unresolved' and resolved_by is not null and resolved_at is not null and jsonb_array_length(evidence_reference)>0)
  )
);
alter table public.legal_country_runtime enable row level security;
revoke all on table public.legal_country_runtime from public,anon,authenticated;

create or replace function public.prevent_immutable_legal_bundle_mutation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception 'immutable_legal_document_bundle';
end $$;
revoke all on function public.prevent_immutable_legal_bundle_mutation() from public,anon,authenticated;
drop trigger if exists trg_legal_document_bundles_immutable on public.legal_document_bundles;
create trigger trg_legal_document_bundles_immutable
before update or delete on public.legal_document_bundles
for each row execute function public.prevent_immutable_legal_bundle_mutation();

-- Explicit service-only setter. A legal-country change invalidates product/legal state and marketing
-- preference immediately; old acceptance/consent rows remain as historical evidence only.
create or replace function public.service_set_legal_country_runtime(
  p_user_id uuid,
  p_legal_country_code text,
  p_legal_subnational_code text,
  p_resolution_status text,
  p_resolution_source text,
  p_storefront_country_code text,
  p_operational_country_code text,
  p_country_mismatch_reviewed boolean,
  p_evidence_reference jsonb,
  p_resolved_by text,
  p_expires_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_country text:=upper(trim(coalesce(p_legal_country_code,'')));
  v_subnational text:=upper(trim(coalesce(p_legal_subnational_code,'')));
  v_storefront text:=upper(trim(coalesce(p_storefront_country_code,'')));
  v_operational text:=upper(trim(coalesce(p_operational_country_code,'')));
  v_previous_country text;
  v_previous_subnational text;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden'; end if;
  if p_user_id is null then raise exception 'user_required'; end if;
  if p_resolution_status not in ('pending','verified','blocked') then raise exception 'invalid_resolution_status'; end if;
  if p_resolution_source not in ('unresolved','storefront_verified','service_country_verified','identity_verified','manual_legal_review') then raise exception 'invalid_resolution_source'; end if;
  if v_country<>'' and v_country !~ '^[A-Z]{2}$' then raise exception 'invalid_legal_country'; end if;
  if v_subnational<>'' and (char_length(v_subnational)>32 or v_subnational !~ '^[A-Z0-9-]+$') then raise exception 'invalid_legal_subnational'; end if;
  if v_storefront<>'' and v_storefront !~ '^[A-Z]{2}$' then raise exception 'invalid_storefront_country'; end if;
  if v_operational<>'' and v_operational !~ '^[A-Z]{2}$' then raise exception 'invalid_operational_country'; end if;
  if p_resolution_status='verified' and (
    v_country='' or p_resolution_source='unresolved' or nullif(trim(coalesce(p_resolved_by,'')),'') is null or
    p_evidence_reference is null or jsonb_typeof(p_evidence_reference)<>'array' or jsonb_array_length(p_evidence_reference)=0
  ) then raise exception 'verified_country_requires_attributable_evidence'; end if;
  if v_storefront<>'' and v_operational<>'' and v_storefront<>v_operational and p_country_mismatch_reviewed is distinct from true then
    raise exception 'country_mismatch_review_required';
  end if;

  select legal_country_code,legal_subnational_code into v_previous_country,v_previous_subnational
  from public.legal_country_runtime where user_id=p_user_id for update;

  insert into public.legal_country_runtime(
    user_id,legal_country_code,legal_subnational_code,resolution_status,resolution_source,
    storefront_country_code,operational_country_code,country_mismatch_reviewed,evidence_reference,resolved_by,resolved_at,expires_at,updated_at
  ) values(
    p_user_id,nullif(v_country,''),nullif(v_subnational,''),p_resolution_status,p_resolution_source,
    nullif(v_storefront,''),nullif(v_operational,''),coalesce(p_country_mismatch_reviewed,false),coalesce(p_evidence_reference,'[]'::jsonb),
    nullif(trim(coalesce(p_resolved_by,'')),''),case when p_resolution_status='verified' then now() else null end,p_expires_at,now()
  ) on conflict(user_id) do update set
    legal_country_code=excluded.legal_country_code,
    legal_subnational_code=excluded.legal_subnational_code,
    resolution_status=excluded.resolution_status,
    resolution_source=excluded.resolution_source,
    storefront_country_code=excluded.storefront_country_code,
    operational_country_code=excluded.operational_country_code,
    country_mismatch_reviewed=excluded.country_mismatch_reviewed,
    evidence_reference=excluded.evidence_reference,
    resolved_by=excluded.resolved_by,
    resolved_at=excluded.resolved_at,
    expires_at=excluded.expires_at,
    updated_at=now();

  if v_previous_country is distinct from nullif(v_country,'') or v_previous_subnational is distinct from nullif(v_subnational,'') or p_resolution_status<>'verified' then
    update public.users
      set legal_version=null,
          notification_preferences=jsonb_set(coalesce(notification_preferences,'{}'::jsonb),'{marketing}','false'::jsonb,true),
          updated_at=now()
    where id=p_user_id;
  end if;

  insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
  values(p_user_id,'legal_country_runtime_changed','user',p_user_id,jsonb_build_object(
    'previousCountry',v_previous_country,'previousSubnational',v_previous_subnational,
    'legalCountry',nullif(v_country,''),'legalSubnational',nullif(v_subnational,''),
    'resolutionStatus',p_resolution_status,'resolutionSource',p_resolution_source,
    'storefrontCountry',nullif(v_storefront,''),'operationalCountry',nullif(v_operational,''),
    'countryMismatchReviewed',coalesce(p_country_mismatch_reviewed,false)
  ));

  return jsonb_build_object('ok',true,'legalCountryCode',nullif(v_country,''),'legalSubnationalCode',nullif(v_subnational,''),'resolutionStatus',p_resolution_status);
end $$;
revoke all on function public.service_set_legal_country_runtime(uuid,text,text,text,text,text,text,boolean,jsonb,text,timestamptz) from public,anon,authenticated;
grant execute on function public.service_set_legal_country_runtime(uuid,text,text,text,text,text,text,boolean,jsonb,text,timestamptz) to service_role;
