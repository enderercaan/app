-- Tailmance v19 pre-registration legal presentation binding.
-- UI language is never jurisdiction. Before account creation the user declares a country signal solely so
-- registration-time privacy/terms/community information can be selected from an approved country+UI-locale
-- route. The declaration is non-authoritative and never replaces post-registration legal-country resolution.

create table if not exists public.pre_registration_legal_bundles (
  pre_registration_bundle_id uuid primary key default gen_random_uuid(),
  declared_country_code text not null check (declared_country_code ~ '^[A-Z]{2}$'),
  ui_locale text not null check (char_length(ui_locale) between 2 and 16),
  document_locale text not null check (char_length(document_locale) between 2 and 16),
  terms_version text not null check (char_length(terms_version) between 1 and 64),
  terms_url text not null check (terms_url ~ '^https://'),
  terms_sha256 text not null check (terms_sha256 ~ '^[0-9a-f]{64}$'),
  privacy_notice_version text not null check (char_length(privacy_notice_version) between 1 and 64),
  privacy_notice_url text not null check (privacy_notice_url ~ '^https://'),
  privacy_notice_sha256 text not null check (privacy_notice_sha256 ~ '^[0-9a-f]{64}$'),
  community_guidelines_version text not null check (char_length(community_guidelines_version) between 1 and 64),
  community_guidelines_url text not null check (community_guidelines_url ~ '^https://'),
  community_guidelines_sha256 text not null check (community_guidelines_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'active' check (status in ('active','revoked')),
  source_evidence_reference jsonb not null check (jsonb_typeof(source_evidence_reference)='array' and jsonb_array_length(source_evidence_reference)>0),
  counsel_evidence_reference jsonb not null check (jsonb_typeof(counsel_evidence_reference)='array' and jsonb_array_length(counsel_evidence_reference)>0),
  localization_evidence_reference jsonb not null check (jsonb_typeof(localization_evidence_reference)='array' and jsonb_array_length(localization_evidence_reference)>0),
  reviewer text not null check (char_length(trim(reviewer)) between 1 and 160),
  reviewed_at timestamptz not null,
  effective_at timestamptz not null,
  valid_until timestamptz not null,
  created_at timestamptz not null default now(),
  check (effective_at>=reviewed_at-interval '5 minutes'),
  check (valid_until>reviewed_at and valid_until<=reviewed_at+interval '90 days')
);
create unique index if not exists pre_registration_legal_bundle_active_route_uq
  on public.pre_registration_legal_bundles(declared_country_code,ui_locale) where status='active';
alter table public.pre_registration_legal_bundles enable row level security;
revoke all on table public.pre_registration_legal_bundles from public,anon,authenticated;
grant select,insert,update on table public.pre_registration_legal_bundles to service_role;

drop trigger if exists trg_pre_registration_legal_bundles_immutable on public.pre_registration_legal_bundles;
create trigger trg_pre_registration_legal_bundles_immutable before update or delete on public.pre_registration_legal_bundles
for each row execute function public.prevent_append_only_legal_event_update();

create table if not exists public.pre_registration_legal_presentations (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  pre_registration_bundle_id uuid not null references public.pre_registration_legal_bundles(pre_registration_bundle_id),
  declared_country_code text not null check (declared_country_code ~ '^[A-Z]{2}$'),
  ui_locale text not null check (char_length(ui_locale) between 2 and 16),
  document_locale text not null check (char_length(document_locale) between 2 and 16),
  presentation_sha256 text not null check (presentation_sha256 ~ '^[0-9a-f]{64}$'),
  privacy_notice_sha256 text not null check (privacy_notice_sha256 ~ '^[0-9a-f]{64}$'),
  source text not null check (source='signup_exact_public_presentation'),
  presented_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(user_id,pre_registration_bundle_id,presentation_sha256)
);
create index if not exists pre_registration_legal_presentations_user_idx on public.pre_registration_legal_presentations(user_id,presented_at desc,id desc);
alter table public.pre_registration_legal_presentations enable row level security;
revoke all on table public.pre_registration_legal_presentations from public,anon,authenticated;
grant select,insert on table public.pre_registration_legal_presentations to service_role;
drop trigger if exists trg_pre_registration_legal_presentations_append_only on public.pre_registration_legal_presentations;
create trigger trg_pre_registration_legal_presentations_append_only before update or delete on public.pre_registration_legal_presentations
for each row execute function public.prevent_append_only_legal_event_update();

create or replace function public.pre_registration_legal_bundle_current(p_bundle_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(exists(
    select 1
    from public.pre_registration_legal_bundles b
    join public.legal_jurisdiction_policies p on p.legal_country_code=b.declared_country_code
    where b.pre_registration_bundle_id=p_bundle_id
      and b.status='active'
      and b.reviewed_at<=now() and b.reviewed_at>=now()-interval '90 days'
      and b.effective_at<=now() and b.valid_until>now() and b.valid_until<=b.reviewed_at+interval '90 days'
      and jsonb_array_length(b.source_evidence_reference)>0
      and jsonb_array_length(b.counsel_evidence_reference)>0
      and jsonb_array_length(b.localization_evidence_reference)>0
      and public.legal_document_url_allowed(b.terms_url)
      and public.legal_document_url_allowed(b.privacy_notice_url)
      and public.legal_document_url_allowed(b.community_guidelines_url)
      and p.release_status='approved'
      and p.legal_review_status='approved_by_external_counsel'
      and p.language_review_status='approved'
      and p.legal_reviewed_at is not null and p.legal_reviewed_at<=now()
      and p.next_review_due_at is not null and p.next_review_due_at>now()
      and b.document_locale=any(p.approved_document_locales)
  ),false);
$$;
revoke all on function public.pre_registration_legal_bundle_current(uuid) from public,anon,authenticated;
grant execute on function public.pre_registration_legal_bundle_current(uuid) to service_role;

create or replace function public.pre_registration_legal_presentation_sha256(p_bundle_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select case when not public.pre_registration_legal_bundle_current(p_bundle_id) then null else
    encode(extensions.digest(convert_to(jsonb_build_object(
      'preRegistrationBundleId',b.pre_registration_bundle_id::text,
      'declaredCountryCode',b.declared_country_code,
      'uiLocale',b.ui_locale,
      'documentLocale',b.document_locale,
      'terms',jsonb_build_array(b.terms_version,b.terms_url,b.terms_sha256),
      'privacy',jsonb_build_array(b.privacy_notice_version,b.privacy_notice_url,b.privacy_notice_sha256),
      'community',jsonb_build_array(b.community_guidelines_version,b.community_guidelines_url,b.community_guidelines_sha256)
    )::text,'UTF8'),'sha256'),'hex') end
  from public.pre_registration_legal_bundles b where b.pre_registration_bundle_id=p_bundle_id;
$$;
revoke all on function public.pre_registration_legal_presentation_sha256(uuid) from public,anon,authenticated;
grant execute on function public.pre_registration_legal_presentation_sha256(uuid) to service_role;

-- Public/anonymous read surface returns only the approved presentation, never counsel/source evidence.
create or replace function public.get_pre_registration_legal_presentation(p_declared_country_code text,p_ui_locale text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_country text:=upper(trim(coalesce(p_declared_country_code,'')));
  v_locale text:=trim(coalesce(p_ui_locale,''));
  v_bundle public.pre_registration_legal_bundles;
  v_sha text;
begin
  if v_country !~ '^[A-Z]{2}$' then return jsonb_build_object('status','blocked_invalid_declared_country'); end if;
  if char_length(v_locale) not between 2 and 16 then return jsonb_build_object('status','blocked_unsupported_ui_locale','declaredCountryCode',v_country); end if;
  select * into v_bundle from public.pre_registration_legal_bundles b
    where b.declared_country_code=v_country and b.ui_locale=v_locale and b.status='active'
    order by b.effective_at desc,b.created_at desc limit 1;
  if not found or not public.pre_registration_legal_bundle_current(v_bundle.pre_registration_bundle_id) then
    return jsonb_build_object('status','blocked_pre_registration_legal_presentation_unavailable','declaredCountryCode',v_country,'uiLocale',v_locale);
  end if;
  v_sha:=public.pre_registration_legal_presentation_sha256(v_bundle.pre_registration_bundle_id);
  if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status','blocked_pre_registration_legal_presentation_unavailable','declaredCountryCode',v_country,'uiLocale',v_locale);
  end if;
  return jsonb_build_object(
    'status','ready',
    'preRegistrationBundleId',v_bundle.pre_registration_bundle_id,
    'declaredCountryCode',v_bundle.declared_country_code,
    'uiLocale',v_bundle.ui_locale,
    'documentLocale',v_bundle.document_locale,
    'termsUrl',v_bundle.terms_url,
    'privacyNoticeUrl',v_bundle.privacy_notice_url,
    'communityGuidelinesUrl',v_bundle.community_guidelines_url,
    'presentationSha256',v_sha,
    'registrationPrivacyNoticeApplies',true,
    'bindingTermsAcceptanceDeferredUntilVerifiedJurisdiction',true,
    'declaredCountryIsNotFinalLegalJurisdiction',true
  );
end $$;
revoke all on function public.get_pre_registration_legal_presentation(text,text) from public;
grant execute on function public.get_pre_registration_legal_presentation(text,text) to anon,authenticated;

-- Bind account creation to the exact current pre-registration presentation shown by the client. Direct
-- signups that omit or stale this evidence fail closed. The declared country remains only evidence/signal;
-- it does not populate legal_country_runtime and cannot confer product access.
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_locale text;
  v_attested boolean;
  v_statement_version text;
  v_declared_country text;
  v_pre_bundle_id uuid;
  v_presented_sha text;
  v_current_sha text;
  v_pre public.pre_registration_legal_bundles;
begin
  v_attested:=lower(coalesce(new.raw_user_meta_data->>'prelegal_age_attested','false')) in ('true','1','yes');
  v_statement_version:=coalesce(new.raw_user_meta_data->>'prelegal_age_attestation_version','');
  v_locale:=coalesce(new.raw_user_meta_data->>'prelegal_age_attestation_locale','');
  v_declared_country:=upper(trim(coalesce(new.raw_user_meta_data->>'pre_registration_declared_country_code','')));
  v_presented_sha:=lower(trim(coalesce(new.raw_user_meta_data->>'pre_registration_presentation_sha256','')));

  if v_attested is distinct from true or v_statement_version<>'tailmance_age18_signup_v1' then raise exception 'prelegal_age_attestation_required'; end if;
  if v_locale !~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$' or char_length(v_locale) not between 2 and 16 then raise exception 'invalid_prelegal_locale'; end if;
  if v_declared_country !~ '^[A-Z]{2}$' then raise exception 'pre_registration_declared_country_required'; end if;
  if v_presented_sha !~ '^[0-9a-f]{64}$' then raise exception 'pre_registration_presentation_hash_required'; end if;
  begin v_pre_bundle_id:=(new.raw_user_meta_data->>'pre_registration_bundle_id')::uuid;
  exception when others then raise exception 'pre_registration_bundle_required'; end;

  select * into v_pre from public.pre_registration_legal_bundles b where b.pre_registration_bundle_id=v_pre_bundle_id;
  if not found or v_pre.declared_country_code<>v_declared_country or v_pre.ui_locale<>v_locale then raise exception 'pre_registration_presentation_context_mismatch'; end if;
  if not public.pre_registration_legal_bundle_current(v_pre_bundle_id) then raise exception 'pre_registration_legal_presentation_unavailable'; end if;
  v_current_sha:=public.pre_registration_legal_presentation_sha256(v_pre_bundle_id);
  if v_current_sha is null or v_current_sha<>v_presented_sha then raise exception 'pre_registration_legal_presentation_changed'; end if;

  insert into public.users(id,age_18_confirmed,legal_version)
  values(new.id,false,null)
  on conflict(id) do nothing;

  insert into public.prelegal_age_attestations(user_id,age_threshold,statement_version,ui_locale,source,attested_at)
  values(new.id,18,v_statement_version,v_locale,'signup_checkbox',now())
  on conflict(user_id,statement_version) do nothing;

  insert into public.pre_registration_legal_presentations(
    user_id,pre_registration_bundle_id,declared_country_code,ui_locale,document_locale,presentation_sha256,privacy_notice_sha256,source,presented_at
  ) values(
    new.id,v_pre.pre_registration_bundle_id,v_pre.declared_country_code,v_pre.ui_locale,v_pre.document_locale,v_current_sha,v_pre.privacy_notice_sha256,
    'signup_exact_public_presentation',now()
  ) on conflict(user_id,pre_registration_bundle_id,presentation_sha256) do nothing;

  return new;
end $$;
revoke all on function public.handle_new_auth_user() from public,anon,authenticated;
