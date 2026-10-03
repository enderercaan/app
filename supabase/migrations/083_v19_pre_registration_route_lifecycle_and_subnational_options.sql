-- Tailmance v19 pre-registration legal-route lifecycle and exact subnational option discovery.
-- Legal document payloads are immutable. Current publication state lives in a separate service-owned route
-- table so replacing/withdrawing a registration notice never mutates or deletes historical bundle evidence.
-- Route revisions are included in the presentation digest so a route change invalidates an already displayed
-- signup presentation before account creation.

-- The bundle payload is truly immutable. The earlier append-only helper intentionally permitted service-role
-- deletes for some event tables; that behavior is not appropriate for legal document payloads referenced by
-- historical presentation evidence.
drop trigger if exists trg_pre_registration_legal_bundles_immutable on public.pre_registration_legal_bundles;
create trigger trg_pre_registration_legal_bundles_immutable
before update or delete on public.pre_registration_legal_bundles
for each row execute function public.prevent_immutable_legal_bundle_mutation();

-- Publication moves to a mutable pointer, matching the main immutable legal-bundle architecture.
drop index if exists public.pre_registration_legal_bundle_active_route_uq;

create table if not exists public.pre_registration_legal_bundle_routes (
  declared_country_code text not null check (declared_country_code ~ '^[A-Z]{2}$'),
  ui_locale text not null check (char_length(ui_locale) between 2 and 16),
  declared_subnational_code text not null default '' check (
    declared_subnational_code='' or (
      char_length(declared_subnational_code) between 4 and 32 and
      declared_subnational_code ~ '^[A-Z]{2}-[A-Z0-9-]+$' and
      left(declared_subnational_code,3)=declared_country_code||'-'
    )
  ),
  display_name text,
  current_bundle_id uuid references public.pre_registration_legal_bundles(pre_registration_bundle_id) on delete restrict,
  route_status text not null default 'blocked' check (route_status in ('blocked','active')),
  effective_at timestamptz,
  evidence_reference jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_reference)='array'),
  route_revision uuid not null default gen_random_uuid(),
  updated_by text not null check (char_length(trim(updated_by)) between 1 and 160),
  updated_at timestamptz not null default now(),
  primary key(declared_country_code,ui_locale,declared_subnational_code),
  check (declared_subnational_code='' or (display_name is not null and char_length(trim(display_name)) between 1 and 160)),
  check (
    (route_status='active' and current_bundle_id is not null and effective_at is not null and jsonb_array_length(evidence_reference)>0)
    or route_status='blocked'
  )
);
alter table public.pre_registration_legal_bundle_routes enable row level security;
revoke all on table public.pre_registration_legal_bundle_routes from public,anon,authenticated,service_role;
grant select on table public.pre_registration_legal_bundle_routes to service_role;

create table if not exists public.pre_registration_legal_route_events (
  id bigint generated always as identity primary key,
  declared_country_code text not null check (declared_country_code ~ '^[A-Z]{2}$'),
  ui_locale text not null check (char_length(ui_locale) between 2 and 16),
  declared_subnational_code text not null default '',
  previous_bundle_id uuid references public.pre_registration_legal_bundles(pre_registration_bundle_id) on delete restrict,
  current_bundle_id uuid references public.pre_registration_legal_bundles(pre_registration_bundle_id) on delete restrict,
  previous_status text check (previous_status is null or previous_status in ('blocked','active')),
  current_status text not null check (current_status in ('blocked','active')),
  route_revision uuid not null,
  evidence_reference jsonb not null check (jsonb_typeof(evidence_reference)='array' and jsonb_array_length(evidence_reference)>0),
  changed_by text not null check (char_length(trim(changed_by)) between 1 and 160),
  created_at timestamptz not null default now()
);
create index if not exists pre_registration_legal_route_events_context_idx
  on public.pre_registration_legal_route_events(declared_country_code,ui_locale,declared_subnational_code,created_at desc,id desc);
alter table public.pre_registration_legal_route_events enable row level security;
revoke all on table public.pre_registration_legal_route_events from public,anon,authenticated,service_role;
grant select on table public.pre_registration_legal_route_events to service_role;
drop trigger if exists trg_pre_registration_legal_route_events_append_only on public.pre_registration_legal_route_events;
create trigger trg_pre_registration_legal_route_events_append_only before update or delete on public.pre_registration_legal_route_events
for each row execute function public.prevent_immutable_legal_bundle_mutation();

-- Content/policy freshness without publication-state recursion.
create or replace function public.pre_registration_legal_bundle_content_current(p_bundle_id uuid)
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
      and jsonb_array_length(b.subnational_scope_evidence_reference)>0
      and public.legal_document_url_allowed(b.terms_url)
      and public.legal_document_url_allowed(b.privacy_notice_url)
      and public.legal_document_url_allowed(b.community_guidelines_url)
      and p.release_status='approved'
      and p.legal_review_status='approved_by_external_counsel'
      and p.language_review_status='approved'
      and p.legal_reviewed_at is not null and p.legal_reviewed_at<=now()
      and p.next_review_due_at is not null and p.next_review_due_at>now()
      and b.document_locale=any(p.approved_document_locales)
      and (
        (p.subnational_review_required=false and b.subnational_scope_mode='not_required_with_counsel_evidence' and b.declared_subnational_code is null) or
        (p.subnational_review_required=true and b.subnational_scope_mode='countrywide_notice_counsel_approved' and b.declared_subnational_code is null) or
        (p.subnational_review_required=true and b.subnational_scope_mode='exact_subnational_route' and b.declared_subnational_code is not null)
      )
  ),false);
$$;
revoke all on function public.pre_registration_legal_bundle_content_current(uuid) from public,anon,authenticated;
grant execute on function public.pre_registration_legal_bundle_content_current(uuid) to service_role;

-- Backfill the previously implicit active publication pointer. It is intentionally blocked unless the
-- bundle/policy is current at migration time; no source row is self-promoted by the migration.
insert into public.pre_registration_legal_bundle_routes(
  declared_country_code,ui_locale,declared_subnational_code,display_name,current_bundle_id,route_status,effective_at,evidence_reference,updated_by,updated_at
)
select
  b.declared_country_code,b.ui_locale,coalesce(b.declared_subnational_code,''),
  case when b.declared_subnational_code is null then null else b.declared_subnational_code end,
  b.pre_registration_bundle_id,
  case when public.pre_registration_legal_bundle_content_current(b.pre_registration_bundle_id) then 'active' else 'blocked' end,
  b.effective_at,
  jsonb_build_array(jsonb_build_object('migration','083','basis','backfill_from_pre_registration_bundle','bundleId',b.pre_registration_bundle_id::text)),
  'migration_083_backfill',now()
from public.pre_registration_legal_bundles b
where b.status='active'
on conflict(declared_country_code,ui_locale,declared_subnational_code) do nothing;

create or replace function public.guard_pre_registration_legal_route()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_bundle public.pre_registration_legal_bundles;
begin
  new.declared_country_code:=upper(trim(new.declared_country_code));
  new.ui_locale:=trim(new.ui_locale);
  new.declared_subnational_code:=upper(trim(coalesce(new.declared_subnational_code,'')));
  new.display_name:=nullif(trim(coalesce(new.display_name,'')),'');
  new.updated_by:=trim(new.updated_by);
  new.updated_at:=now();
  if new.route_status='active' then
    if new.current_bundle_id is null or new.effective_at is null or jsonb_array_length(new.evidence_reference)=0 then
      raise exception 'active_pre_registration_route_requires_bundle_effective_date_and_evidence';
    end if;
    select * into v_bundle from public.pre_registration_legal_bundles b where b.pre_registration_bundle_id=new.current_bundle_id;
    if not found then raise exception 'pre_registration_bundle_not_found'; end if;
    if v_bundle.status<>'active'
      or v_bundle.declared_country_code<>new.declared_country_code
      or v_bundle.ui_locale<>new.ui_locale
      or coalesce(v_bundle.declared_subnational_code,'')<>new.declared_subnational_code then
      raise exception 'pre_registration_route_bundle_context_mismatch';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_pre_registration_legal_route() from public,anon,authenticated;

drop trigger if exists trg_pre_registration_legal_bundle_routes_guard on public.pre_registration_legal_bundle_routes;
create trigger trg_pre_registration_legal_bundle_routes_guard
before insert or update on public.pre_registration_legal_bundle_routes
for each row execute function public.guard_pre_registration_legal_route();

create or replace function public.service_set_pre_registration_legal_route(
  p_declared_country_code text,
  p_ui_locale text,
  p_declared_subnational_code text,
  p_display_name text,
  p_current_bundle_id uuid,
  p_route_status text,
  p_effective_at timestamptz,
  p_evidence_reference jsonb,
  p_updated_by text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_country text:=upper(trim(coalesce(p_declared_country_code,'')));
  v_locale text:=trim(coalesce(p_ui_locale,''));
  v_sub text:=upper(trim(coalesce(p_declared_subnational_code,'')));
  v_actor text:=trim(coalesce(p_updated_by,''));
  v_existing public.pre_registration_legal_bundle_routes;
  v_revision uuid:=gen_random_uuid();
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if v_country !~ '^[A-Z]{2}$' then raise exception 'invalid_declared_country'; end if;
  if char_length(v_locale) not between 2 and 16 then raise exception 'invalid_ui_locale'; end if;
  if v_sub<>'' and (v_sub !~ '^[A-Z]{2}-[A-Z0-9-]+$' or left(v_sub,3)<>v_country||'-' or char_length(v_sub)>32) then raise exception 'invalid_declared_subnational_code'; end if;
  if p_route_status not in ('blocked','active') then raise exception 'invalid_route_status'; end if;
  if char_length(v_actor) not between 1 and 160 then raise exception 'updated_by_required'; end if;
  if p_evidence_reference is null or jsonb_typeof(p_evidence_reference)<>'array' or jsonb_array_length(p_evidence_reference)=0 then raise exception 'route_evidence_required'; end if;
  if v_sub<>'' and nullif(trim(coalesce(p_display_name,'')),'') is null then raise exception 'subnational_display_name_required'; end if;
  if p_route_status='active' and (p_current_bundle_id is null or p_effective_at is null) then raise exception 'active_route_requires_bundle_and_effective_at'; end if;

  select * into v_existing from public.pre_registration_legal_bundle_routes
  where declared_country_code=v_country and ui_locale=v_locale and declared_subnational_code=v_sub
  for update;

  insert into public.pre_registration_legal_bundle_routes(
    declared_country_code,ui_locale,declared_subnational_code,display_name,current_bundle_id,route_status,effective_at,evidence_reference,route_revision,updated_by,updated_at
  ) values(
    v_country,v_locale,v_sub,nullif(trim(coalesce(p_display_name,'')),''),p_current_bundle_id,p_route_status,p_effective_at,p_evidence_reference,v_revision,v_actor,now()
  )
  on conflict(declared_country_code,ui_locale,declared_subnational_code) do update set
    display_name=excluded.display_name,current_bundle_id=excluded.current_bundle_id,route_status=excluded.route_status,
    effective_at=excluded.effective_at,evidence_reference=excluded.evidence_reference,route_revision=excluded.route_revision,
    updated_by=excluded.updated_by,updated_at=now();

  insert into public.pre_registration_legal_route_events(
    declared_country_code,ui_locale,declared_subnational_code,previous_bundle_id,current_bundle_id,previous_status,current_status,
    route_revision,evidence_reference,changed_by,created_at
  ) values(
    v_country,v_locale,v_sub,v_existing.current_bundle_id,p_current_bundle_id,v_existing.route_status,p_route_status,
    v_revision,p_evidence_reference,v_actor,now()
  );
  return jsonb_build_object('ok',true,'routeRevision',v_revision,'routeStatus',p_route_status,'currentBundleId',p_current_bundle_id);
end $$;
revoke all on function public.service_set_pre_registration_legal_route(text,text,text,text,uuid,text,timestamptz,jsonb,text) from public,anon,authenticated;
grant execute on function public.service_set_pre_registration_legal_route(text,text,text,text,uuid,text,timestamptz,jsonb,text) to service_role;

create or replace function public.pre_registration_legal_bundle_current(p_bundle_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(public.pre_registration_legal_bundle_content_current(p_bundle_id) and exists(
    select 1
    from public.pre_registration_legal_bundles b
    join public.pre_registration_legal_bundle_routes r
      on r.declared_country_code=b.declared_country_code
     and r.ui_locale=b.ui_locale
     and r.declared_subnational_code=coalesce(b.declared_subnational_code,'')
    where b.pre_registration_bundle_id=p_bundle_id
      and r.current_bundle_id=b.pre_registration_bundle_id
      and r.route_status='active'
      and r.effective_at is not null and r.effective_at<=now()
      and jsonb_array_length(r.evidence_reference)>0
  ),false);
$$;
revoke all on function public.pre_registration_legal_bundle_current(uuid) from public,anon,authenticated;
grant execute on function public.pre_registration_legal_bundle_current(uuid) to service_role;

create or replace function public.pre_registration_legal_presentation_sha256(p_bundle_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select case when not public.pre_registration_legal_bundle_current(p_bundle_id) then null else
    encode(extensions.digest(convert_to(jsonb_build_object(
      'preRegistrationBundleId',b.pre_registration_bundle_id::text,
      'routeRevision',r.route_revision::text,
      'declaredCountryCode',b.declared_country_code,
      'declaredSubnationalCode',b.declared_subnational_code,
      'subnationalScopeMode',b.subnational_scope_mode,
      'subnationalScopeEvidenceSha256',public.pre_registration_subnational_scope_evidence_sha256(b.pre_registration_bundle_id),
      'uiLocale',b.ui_locale,
      'documentLocale',b.document_locale,
      'terms',jsonb_build_array(b.terms_version,b.terms_url,b.terms_sha256),
      'privacy',jsonb_build_array(b.privacy_notice_version,b.privacy_notice_url,b.privacy_notice_sha256),
      'community',jsonb_build_array(b.community_guidelines_version,b.community_guidelines_url,b.community_guidelines_sha256)
    )::text,'UTF8'),'sha256'),'hex') end
  from public.pre_registration_legal_bundles b
  join public.pre_registration_legal_bundle_routes r
    on r.declared_country_code=b.declared_country_code and r.ui_locale=b.ui_locale
   and r.declared_subnational_code=coalesce(b.declared_subnational_code,'') and r.current_bundle_id=b.pre_registration_bundle_id
  where b.pre_registration_bundle_id=p_bundle_id;
$$;
revoke all on function public.pre_registration_legal_presentation_sha256(uuid) from public,anon,authenticated;
grant execute on function public.pre_registration_legal_presentation_sha256(uuid) to service_role;

-- Anonymous option discovery exposes only currently publishable subdivision labels/codes, never bundle IDs,
-- route evidence, counsel records, hashes, reviewers or internal release metadata.
create or replace function public.get_pre_registration_subnational_options(p_declared_country_code text,p_ui_locale text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_country text:=upper(trim(coalesce(p_declared_country_code,'')));
  v_locale text:=trim(coalesce(p_ui_locale,''));
  v_options jsonb;
  v_countrywide_ready boolean:=false;
begin
  if v_country !~ '^[A-Z]{2}$' then return jsonb_build_object('status','blocked_invalid_declared_country'); end if;
  if char_length(v_locale) not between 2 and 16 then return jsonb_build_object('status','blocked_unsupported_ui_locale','declaredCountryCode',v_country); end if;

  select exists(
    select 1 from public.pre_registration_legal_bundle_routes r
    where r.declared_country_code=v_country and r.ui_locale=v_locale and r.declared_subnational_code=''
      and r.route_status='active' and r.effective_at<=now() and public.pre_registration_legal_bundle_current(r.current_bundle_id)
  ) into v_countrywide_ready;
  if v_countrywide_ready then
    return jsonb_build_object('status','selection_not_required','declaredCountryCode',v_country,'uiLocale',v_locale,'options','[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('code',r.declared_subnational_code,'label',r.display_name) order by r.display_name,r.declared_subnational_code),'[]'::jsonb)
  into v_options
  from public.pre_registration_legal_bundle_routes r
  where r.declared_country_code=v_country and r.ui_locale=v_locale and r.declared_subnational_code<>''
    and r.route_status='active' and r.effective_at<=now() and public.pre_registration_legal_bundle_current(r.current_bundle_id);

  if jsonb_array_length(v_options)=0 then
    return jsonb_build_object('status','blocked_pre_registration_legal_presentation_unavailable','declaredCountryCode',v_country,'uiLocale',v_locale,'options',v_options);
  end if;
  return jsonb_build_object('status','ready','declaredCountryCode',v_country,'uiLocale',v_locale,'options',v_options);
end $$;
revoke all on function public.get_pre_registration_subnational_options(text,text) from public;
grant execute on function public.get_pre_registration_subnational_options(text,text) to anon,authenticated;

create or replace function public.get_pre_registration_legal_presentation(
  p_declared_country_code text,p_ui_locale text,p_declared_subnational_code text
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_country text:=upper(trim(coalesce(p_declared_country_code,'')));
  v_locale text:=trim(coalesce(p_ui_locale,''));
  v_sub text:=upper(trim(coalesce(p_declared_subnational_code,'')));
  v_bundle public.pre_registration_legal_bundles;
  v_route public.pre_registration_legal_bundle_routes;
  v_sha text; v_scope_sha text; v_exact_route_exists boolean:=false; v_exact_ready boolean:=false;
begin
  if v_country !~ '^[A-Z]{2}$' then return jsonb_build_object('status','blocked_invalid_declared_country'); end if;
  if char_length(v_locale) not between 2 and 16 then return jsonb_build_object('status','blocked_unsupported_ui_locale','declaredCountryCode',v_country); end if;
  if v_sub<>'' and (v_sub !~ '^[A-Z]{2}-[A-Z0-9-]+$' or left(v_sub,3)<>v_country||'-' or char_length(v_sub)>32) then
    return jsonb_build_object('status','blocked_invalid_declared_subnational_code','declaredCountryCode',v_country,'uiLocale',v_locale);
  end if;

  if v_sub<>'' then
    select * into v_route from public.pre_registration_legal_bundle_routes r
      where r.declared_country_code=v_country and r.ui_locale=v_locale and r.declared_subnational_code=v_sub;
    v_exact_route_exists:=found;
    if v_exact_route_exists then
      v_exact_ready:=v_route.route_status='active' and v_route.current_bundle_id is not null and v_route.effective_at is not null and v_route.effective_at<=now()
        and public.pre_registration_legal_bundle_current(v_route.current_bundle_id);
      if not v_exact_ready then
        return jsonb_build_object('status','blocked_pre_registration_exact_subnational_presentation_unavailable','declaredCountryCode',v_country,'declaredSubnationalCode',v_sub,'uiLocale',v_locale);
      end if;
      select * into v_bundle from public.pre_registration_legal_bundles b where b.pre_registration_bundle_id=v_route.current_bundle_id;
    end if;
  end if;

  if not v_exact_route_exists then
    select * into v_route from public.pre_registration_legal_bundle_routes r
      where r.declared_country_code=v_country and r.ui_locale=v_locale and r.declared_subnational_code='';
    if found and v_route.route_status='active' and v_route.current_bundle_id is not null and v_route.effective_at is not null and v_route.effective_at<=now()
      and public.pre_registration_legal_bundle_current(v_route.current_bundle_id) then
      select * into v_bundle from public.pre_registration_legal_bundles b where b.pre_registration_bundle_id=v_route.current_bundle_id;
    else
      if exists(
        select 1 from public.pre_registration_legal_bundle_routes er
        where er.declared_country_code=v_country and er.ui_locale=v_locale and er.declared_subnational_code<>''
          and er.route_status='active' and er.effective_at<=now() and public.pre_registration_legal_bundle_current(er.current_bundle_id)
      ) then
        return jsonb_build_object('status','blocked_pre_registration_subnational_selection_required','declaredCountryCode',v_country,'uiLocale',v_locale);
      end if;
      return jsonb_build_object('status','blocked_pre_registration_legal_presentation_unavailable','declaredCountryCode',v_country,'uiLocale',v_locale);
    end if;
  end if;

  v_sha:=public.pre_registration_legal_presentation_sha256(v_bundle.pre_registration_bundle_id);
  v_scope_sha:=public.pre_registration_subnational_scope_evidence_sha256(v_bundle.pre_registration_bundle_id);
  if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' or v_scope_sha is null or v_scope_sha !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status','blocked_pre_registration_legal_presentation_unavailable','declaredCountryCode',v_country,'uiLocale',v_locale);
  end if;
  return jsonb_build_object(
    'status','ready',
    'preRegistrationBundleId',v_bundle.pre_registration_bundle_id,
    'routeRevision',v_route.route_revision,
    'declaredCountryCode',v_bundle.declared_country_code,
    'declaredSubnationalCode',v_bundle.declared_subnational_code,
    'subnationalScopeMode',v_bundle.subnational_scope_mode,
    'subnationalScopeEvidenceSha256',v_scope_sha,
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
revoke all on function public.get_pre_registration_legal_presentation(text,text,text) from public;
grant execute on function public.get_pre_registration_legal_presentation(text,text,text) to anon,authenticated;

create or replace function public.get_pre_registration_legal_presentation(p_declared_country_code text,p_ui_locale text)
returns jsonb language sql stable security definer set search_path='' as $$
  select public.get_pre_registration_legal_presentation(p_declared_country_code,p_ui_locale,null);
$$;
revoke all on function public.get_pre_registration_legal_presentation(text,text) from public;
grant execute on function public.get_pre_registration_legal_presentation(text,text) to anon,authenticated;
