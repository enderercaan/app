-- Executed-Postgres verification fix (2026-10-03): PL/pgSQL ends an IF condition at the first THEN, so
-- inline CASE expressions inside IF conditions are parenthesized to compile on a real PostgreSQL server.
-- Tailmance v19 applicable-law document user-action evidence.
-- An applicable-jurisdiction supplement being published is not automatically proof that the user performed
-- any legally required action. Each overlay document declares whether it is informational only, requires
-- acknowledgement, or requires affirmative acceptance. Required actions are append-only and hash-bound.

alter table public.legal_bundle_overlay_documents
  add column if not exists user_action_requirement text not null default 'none'
    check (user_action_requirement in ('none','acknowledgement','affirmative_acceptance'));

-- Optional marketing permission is never bundled into mandatory social-access acceptance.
-- Privacy notices/supplements may require acknowledgement but are never represented as affirmative consent.
alter table public.legal_bundle_overlay_documents drop constraint if exists legal_overlay_document_action_semantics;
alter table public.legal_bundle_overlay_documents add constraint legal_overlay_document_action_semantics check (
  (document_type='marketing_push_consent' and user_action_requirement='none') or
  (document_type in ('privacy_notice','jurisdiction_privacy_supplement') and user_action_requirement in ('none','acknowledgement')) or
  (document_type not in ('marketing_push_consent','privacy_notice','jurisdiction_privacy_supplement'))
) not valid;

alter table public.legal_acceptances add column if not exists applicability_matrix_id uuid references public.legal_applicability_matrices(matrix_id) on delete cascade;
alter table public.legal_acceptances add column if not exists overlay_document_set_sha256 text check (overlay_document_set_sha256 is null or overlay_document_set_sha256 ~ '^[0-9a-f]{64}$');
alter table public.privacy_notice_acknowledgements add column if not exists applicability_matrix_id uuid references public.legal_applicability_matrices(matrix_id) on delete cascade;
alter table public.privacy_notice_acknowledgements add column if not exists overlay_document_set_sha256 text check (overlay_document_set_sha256 is null or overlay_document_set_sha256 ~ '^[0-9a-f]{64}$');
alter table public.marketing_consent_events add column if not exists applicability_matrix_id uuid references public.legal_applicability_matrices(matrix_id) on delete cascade;
alter table public.marketing_consent_events add column if not exists consent_document_set_sha256 text check (consent_document_set_sha256 is null or consent_document_set_sha256 ~ '^[0-9a-f]{64}$');
create index if not exists legal_acceptances_matrix_idx on public.legal_acceptances(user_id,applicability_matrix_id,bundle_id,accepted_at desc);
create index if not exists privacy_ack_matrix_idx on public.privacy_notice_acknowledgements(user_id,applicability_matrix_id,bundle_id,acknowledged_at desc);
create index if not exists marketing_consent_matrix_idx on public.marketing_consent_events(user_id,applicability_matrix_id,bundle_id,created_at desc);


-- A document cannot point at an overlay that belongs to a different applicability matrix.
alter table public.legal_applicability_overlays drop constraint if exists legal_applicability_overlays_matrix_overlay_uq;
alter table public.legal_applicability_overlays add constraint legal_applicability_overlays_matrix_overlay_uq unique(matrix_id,overlay_id);
alter table public.legal_bundle_overlay_documents drop constraint if exists legal_overlay_document_matrix_overlay_fk;
alter table public.legal_bundle_overlay_documents add constraint legal_overlay_document_matrix_overlay_fk
  foreign key(matrix_id,overlay_id) references public.legal_applicability_overlays(matrix_id,overlay_id) on delete cascade not valid;

-- Evidence is append/read only from service code. Account erasure still works via FK cascades.
revoke delete on table public.legal_applicability_matrices from service_role;
revoke delete on table public.legal_applicability_overlays from service_role;
revoke delete on table public.legal_bundle_overlay_documents from service_role;

create table if not exists public.legal_overlay_document_actions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  matrix_id uuid not null references public.legal_applicability_matrices(matrix_id) on delete cascade,
  overlay_id uuid not null references public.legal_applicability_overlays(overlay_id) on delete cascade,
  bundle_id uuid not null references public.legal_document_bundles(bundle_id) on delete restrict,
  overlay_document_id uuid not null references public.legal_bundle_overlay_documents(overlay_document_id) on delete cascade,
  document_type text not null,
  document_locale text not null,
  document_version text not null,
  document_sha256 text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
  action_type text not null check (action_type in ('acknowledged','accepted')),
  accepted_source text not null check (char_length(trim(accepted_source)) between 1 and 120),
  accepted_at timestamptz not null default now(),
  unique(user_id,overlay_document_id,document_sha256,action_type)
);
create index if not exists legal_overlay_actions_user_bundle_idx
  on public.legal_overlay_document_actions(user_id,bundle_id,accepted_at desc,id desc);
alter table public.legal_overlay_document_actions enable row level security;
revoke all on table public.legal_overlay_document_actions from public,anon,authenticated;
grant select,insert on table public.legal_overlay_document_actions to service_role;

drop trigger if exists trg_legal_overlay_document_actions_append_only on public.legal_overlay_document_actions;
create trigger trg_legal_overlay_document_actions_append_only
before update or delete on public.legal_overlay_document_actions
for each row execute function public.prevent_append_only_legal_event_update();

create or replace function public.legal_overlay_document_actions_complete(p_user_id uuid,p_bundle_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.legal_applicability_bundle_satisfied(p_user_id,p_bundle_id)
    and not exists(
      select 1
      from public.legal_country_runtime r
      join public.legal_bundle_overlay_documents d
        on d.matrix_id=r.current_applicability_matrix_id and d.bundle_id=p_bundle_id
      where r.user_id=p_user_id
        and d.user_action_requirement<>'none'
        and not exists(
          select 1 from public.legal_overlay_document_actions a
          where a.user_id=p_user_id and a.matrix_id=d.matrix_id and a.overlay_id=d.overlay_id
            and a.bundle_id=d.bundle_id and a.overlay_document_id=d.overlay_document_id
            and a.document_sha256=d.document_sha256 and a.document_locale=d.document_locale
            and a.document_version=d.document_version
            and a.action_type=case when d.user_action_requirement='affirmative_acceptance' then 'accepted' else 'acknowledged' end
        )
    );
$$;
revoke all on function public.legal_overlay_document_actions_complete(uuid,uuid) from public,anon,authenticated;
grant execute on function public.legal_overlay_document_actions_complete(uuid,uuid) to service_role;

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
  ) order by o.jurisdiction_country_code,o.jurisdiction_subnational_code,d.document_type,d.document_locale),'[]'::jsonb)
  from public.legal_country_runtime r
  join public.legal_bundle_overlay_documents d on d.matrix_id=r.current_applicability_matrix_id and d.bundle_id=p_bundle_id
  join public.legal_applicability_overlays o on o.overlay_id=d.overlay_id and o.matrix_id=d.matrix_id and o.applicability_status='applicable'
  where r.user_id=p_user_id
    and d.document_type<>'marketing_push_consent';
$$;
revoke all on function public.current_legal_overlay_documents(uuid,uuid) from public,anon,authenticated;
grant execute on function public.current_legal_overlay_documents(uuid,uuid) to service_role;


-- Historical function name retained for API compatibility. The digest now binds the complete mandatory
-- legal presentation: exact applicability matrix, immutable base bundle/context, the binding base
-- documents shown for acceptance, and all non-marketing applicable-law supplements. Optional marketing
-- consent has its own independent digest and must never be bundled into mandatory product access.
create or replace function public.current_legal_overlay_document_set_sha256(p_user_id uuid,p_bundle_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'matrixId',r.current_applicability_matrix_id::text,
    'bundleId',b.bundle_id::text,
    'legalCountryCode',b.legal_country_code,
    'legalSubnationalCode',coalesce(b.legal_subnational_code,''),
    'uiLocale',b.ui_locale,
    'documentLocale',b.document_locale,
    'baseDocuments',coalesce((
      select jsonb_agg(jsonb_build_array(
        d.document_type,d.document_locale,d.document_version,d.document_url,d.document_sha256
      ) order by d.document_type)
      from public.legal_bundle_documents d
      where d.bundle_id=b.bundle_id
        and d.document_type in ('terms','privacy_notice','community_guidelines','jurisdiction_privacy_supplement')
    ),'[]'::jsonb),
    'overlayDocuments',coalesce((
      select jsonb_agg(jsonb_build_array(
        d.overlay_document_id::text,o.jurisdiction_country_code,coalesce(o.jurisdiction_subnational_code,''),o.applicability_basis,
        d.document_type,d.document_locale,d.document_version,d.document_url,d.document_sha256,d.user_action_requirement
      ) order by o.jurisdiction_country_code,coalesce(o.jurisdiction_subnational_code,''),o.applicability_basis,d.document_type,d.document_locale,d.overlay_document_id::text)
      from public.legal_bundle_overlay_documents d
      join public.legal_applicability_overlays o on o.overlay_id=d.overlay_id and o.matrix_id=d.matrix_id and o.applicability_status='applicable'
      where d.matrix_id=r.current_applicability_matrix_id
        and d.bundle_id=b.bundle_id
        and d.document_type<>'marketing_push_consent'
    ),'[]'::jsonb)
  )::text,'UTF8'),'sha256'),'hex')
  from public.legal_country_runtime r
  join public.legal_document_bundles b on b.bundle_id=p_bundle_id
  where r.user_id=p_user_id
    and r.current_applicability_matrix_id is not null;
$$;
revoke all on function public.current_legal_overlay_document_set_sha256(uuid,uuid) from public,anon,authenticated;
grant execute on function public.current_legal_overlay_document_set_sha256(uuid,uuid) to service_role;

create or replace function public.current_marketing_consent_document_set_sha256(p_user_id uuid,p_bundle_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'base',jsonb_build_array(b.bundle_id::text,b.marketing_push_consent_version,b.document_locale,b.marketing_push_consent_sha256),
    'overlays',coalesce((select jsonb_agg(jsonb_build_array(
      d.overlay_document_id::text,o.jurisdiction_country_code,coalesce(o.jurisdiction_subnational_code,''),o.applicability_basis,
      d.document_locale,d.document_version,d.document_url,d.document_sha256
    ) order by o.jurisdiction_country_code,coalesce(o.jurisdiction_subnational_code,''),o.applicability_basis,d.document_locale,d.overlay_document_id::text)
    from public.legal_country_runtime r
    join public.legal_bundle_overlay_documents d on d.matrix_id=r.current_applicability_matrix_id and d.bundle_id=p_bundle_id and d.document_type='marketing_push_consent'
    join public.legal_applicability_overlays o on o.overlay_id=d.overlay_id and o.matrix_id=d.matrix_id and o.applicability_status='applicable'
    where r.user_id=p_user_id),'[]'::jsonb)
  )::text,'UTF8'),'sha256'),'hex')
  from public.legal_document_bundles b where b.bundle_id=p_bundle_id;
$$;
revoke all on function public.current_marketing_consent_document_set_sha256(uuid,uuid) from public,anon,authenticated;
grant execute on function public.current_marketing_consent_document_set_sha256(uuid,uuid) to service_role;

-- Rebind exact-bundle acceptance so one explicit user action records every required current supplement
-- against its immutable URL/version/hash. Informational-only supplements are presented but are not falsely
-- recorded as consent or acknowledgement.
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
  if not exists(select 1 from auth.users au where au.id=p_user_id and au.email_confirmed_at is not null) then raise exception 'email_verification_required_before_legal_acceptance'; end if;

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

-- Optional marketing permission cannot be granted before every required current legal-document action is complete.
create or replace function public.enforce_marketing_requires_complete_legal_actions()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_current_matrix uuid;v_previous_matrix uuid;
begin
  if new.granted=true then
    select current_applicability_matrix_id into v_current_matrix from public.legal_country_runtime where user_id=new.user_id;
    if v_current_matrix is null or not public.legal_applicability_matrix_record_satisfied(new.user_id,v_current_matrix) then raise exception 'current_applicability_matrix_required_before_marketing_consent'; end if;
    if new.bundle_id is null or not public.legal_overlay_document_actions_complete(new.user_id,new.bundle_id) then raise exception 'current_overlay_legal_actions_required_before_marketing_consent'; end if;
    if new.applicability_matrix_id is not null and new.applicability_matrix_id<>v_current_matrix then raise exception 'marketing_consent_applicability_matrix_mismatch'; end if;
    new.applicability_matrix_id:=v_current_matrix;
  else
    if new.applicability_matrix_id is null then
      select e.applicability_matrix_id into v_previous_matrix from public.marketing_consent_events e
      where e.user_id=new.user_id and e.channel=new.channel and e.purpose=new.purpose and e.granted=true
      order by e.created_at desc,e.id desc limit 1;
      new.applicability_matrix_id:=v_previous_matrix;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.enforce_marketing_requires_complete_legal_actions() from public,anon,authenticated;
drop trigger if exists trg_marketing_requires_complete_legal_actions on public.marketing_consent_events;
create trigger trg_marketing_requires_complete_legal_actions before insert on public.marketing_consent_events
for each row execute function public.enforce_marketing_requires_complete_legal_actions();

-- Product access cannot be satisfied by base Terms/Privacy evidence alone when an applicability overlay
-- requires a separate acknowledgement or affirmative acceptance.
create or replace function public.current_user_has_product_access()
returns boolean language sql stable security definer set search_path='' as $$
  select public.current_session_satisfies_mfa_if_enrolled() and exists(
    select 1 from public.users u
    join auth.users au on au.id=u.id and au.email_confirmed_at is not null
    join public.app_security_config c on c.singleton=true
    join public.legal_document_bundles b on b.bundle_id=public.resolve_current_legal_bundle_id(u.id,coalesce(u.preferred_locale,'en'))
    where u.id=auth.uid() and u.suspended_at is null and u.paused_at is null and u.age_18_confirmed=true
      and u.legal_version=b.legal_version and b.legal_version=c.current_legal_version and b.terms_version=c.current_terms_version
      and b.community_guidelines_version=c.current_community_guidelines_version and b.privacy_notice_version=c.current_privacy_notice_version
      and exists(select 1 from public.legal_acceptances a where a.user_id=u.id and a.bundle_id=b.bundle_id and a.legal_version=b.legal_version and a.terms_version=b.terms_version and a.community_guidelines_version=b.community_guidelines_version and a.terms_sha256=b.terms_sha256 and a.community_guidelines_sha256=b.community_guidelines_sha256 and a.accepted_ui_locale=b.ui_locale and a.accepted_country_code=b.legal_country_code and coalesce(a.accepted_subnational_code,'')=coalesce(b.legal_subnational_code,'') and a.document_locale=b.document_locale and a.applicability_matrix_id=(select r.current_applicability_matrix_id from public.legal_country_runtime r where r.user_id=u.id) and a.overlay_document_set_sha256=public.current_legal_overlay_document_set_sha256(u.id,b.bundle_id))
      and exists(select 1 from public.privacy_notice_acknowledgements p where p.user_id=u.id and p.bundle_id=b.bundle_id and p.notice_version=b.privacy_notice_version and p.notice_sha256=b.privacy_notice_sha256 and p.locale=b.ui_locale and p.country_code=b.legal_country_code and coalesce(p.legal_subnational_code,'')=coalesce(b.legal_subnational_code,'') and p.document_locale=b.document_locale and p.applicability_matrix_id=(select r.current_applicability_matrix_id from public.legal_country_runtime r where r.user_id=u.id) and p.overlay_document_set_sha256=public.current_legal_overlay_document_set_sha256(u.id,b.bundle_id))
      and public.legal_overlay_document_actions_complete(u.id,b.bundle_id)
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
  join auth.users au on au.id=u.id and au.email_confirmed_at is not null
  join public.app_security_config c on c.singleton=true
  join public.legal_document_bundles b on b.bundle_id=public.resolve_current_legal_bundle_id(u.id,coalesce(u.preferred_locale,'en'))
  where u.id=any(p_user_ids) and u.suspended_at is null and u.paused_at is null and u.age_18_confirmed=true
    and u.legal_version=b.legal_version and b.legal_version=c.current_legal_version and b.terms_version=c.current_terms_version
    and b.community_guidelines_version=c.current_community_guidelines_version and b.privacy_notice_version=c.current_privacy_notice_version
    and exists(select 1 from public.legal_acceptances a where a.user_id=u.id and a.bundle_id=b.bundle_id and a.terms_sha256=b.terms_sha256 and a.community_guidelines_sha256=b.community_guidelines_sha256 and a.applicability_matrix_id=(select r.current_applicability_matrix_id from public.legal_country_runtime r where r.user_id=u.id) and a.overlay_document_set_sha256=public.current_legal_overlay_document_set_sha256(u.id,b.bundle_id))
    and exists(select 1 from public.privacy_notice_acknowledgements p where p.user_id=u.id and p.bundle_id=b.bundle_id and p.notice_sha256=b.privacy_notice_sha256 and p.applicability_matrix_id=(select r.current_applicability_matrix_id from public.legal_country_runtime r where r.user_id=u.id) and p.overlay_document_set_sha256=public.current_legal_overlay_document_set_sha256(u.id,b.bundle_id))
    and public.legal_overlay_document_actions_complete(u.id,b.bundle_id);
end $$;
revoke all on function public.service_product_access_user_ids(uuid[]) from public,anon,authenticated;
grant execute on function public.service_product_access_user_ids(uuid[]) to service_role;

-- Supersede legal context one more time so the consent UI receives only non-sensitive overlay-document
-- presentation data, and `accepted` reflects every required immutable action.
create or replace function public.get_current_legal_context(p_ui_locale text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_user_id uuid:=auth.uid();v_runtime public.legal_country_runtime;v_policy public.legal_jurisdiction_policies;
  v_bundle public.legal_document_bundles;v_bundle_id uuid;v_candidate_id uuid;v_locale text:=trim(coalesce(p_ui_locale,''));
  v_accepted boolean:=false;v_privacy_ack boolean:=false;v_overlay_actions boolean:=false;v_docs jsonb:='{}'::jsonb;v_overlay_docs jsonb:='[]'::jsonb;v_overlay_set_sha256 text;v_marketing_set_sha256 text;
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
  where r.legal_country_code=v_runtime.legal_country_code
    and r.legal_subnational_code=case when v_policy.subnational_review_required then coalesce(v_runtime.legal_subnational_code,'') else '' end
    and r.ui_locale=v_locale and r.route_status='active' and r.effective_at is not null and r.effective_at<=now()
    and b.legal_country_code=r.legal_country_code and coalesce(b.legal_subnational_code,'')=r.legal_subnational_code and b.ui_locale=r.ui_locale limit 1;
  if v_candidate_id is not null and not public.legal_bundle_document_manifest_complete(v_candidate_id) then return jsonb_build_object('status','blocked_legal_document_manifest_incomplete','legalCountryCode',v_runtime.legal_country_code,'legalSubnationalCode',v_runtime.legal_subnational_code,'uiLocale',v_locale); end if;
  if v_candidate_id is not null and not public.legal_subnational_language_requirements_satisfied(v_candidate_id) then return jsonb_build_object('status','blocked_subnational_language_requirement_incomplete','legalCountryCode',v_runtime.legal_country_code,'legalSubnationalCode',v_runtime.legal_subnational_code,'uiLocale',v_locale); end if;
  if v_candidate_id is not null and not public.legal_applicability_bundle_satisfied(v_user_id,v_candidate_id) then return jsonb_build_object('status','blocked_legal_applicability_documents_incomplete','legalCountryCode',v_runtime.legal_country_code,'legalSubnationalCode',v_runtime.legal_subnational_code,'uiLocale',v_locale,'applicabilityMatrixId',v_runtime.current_applicability_matrix_id); end if;

  v_bundle_id:=public.resolve_current_legal_bundle_id(v_user_id,v_locale);
  if v_bundle_id is null then return jsonb_build_object('status','blocked_legal_bundle_missing','legalCountryCode',v_runtime.legal_country_code,'legalSubnationalCode',v_runtime.legal_subnational_code,'uiLocale',v_locale); end if;
  select * into v_bundle from public.legal_document_bundles where bundle_id=v_bundle_id;
  select coalesce(jsonb_object_agg(document_type,document_url),'{}'::jsonb) into v_docs from public.legal_bundle_documents where bundle_id=v_bundle_id;
  v_overlay_docs:=public.current_legal_overlay_documents(v_user_id,v_bundle_id);
  v_overlay_set_sha256:=public.current_legal_overlay_document_set_sha256(v_user_id,v_bundle_id);
  v_marketing_set_sha256:=public.current_marketing_consent_document_set_sha256(v_user_id,v_bundle_id);
  select exists(select 1 from public.legal_acceptances a where a.user_id=v_user_id and a.bundle_id=v_bundle_id and a.applicability_matrix_id=v_runtime.current_applicability_matrix_id and a.overlay_document_set_sha256=v_overlay_set_sha256) into v_accepted;
  select exists(select 1 from public.privacy_notice_acknowledgements p where p.user_id=v_user_id and p.bundle_id=v_bundle_id and p.applicability_matrix_id=v_runtime.current_applicability_matrix_id and p.overlay_document_set_sha256=v_overlay_set_sha256) into v_privacy_ack;
  v_overlay_actions:=public.legal_overlay_document_actions_complete(v_user_id,v_bundle_id);
  return jsonb_build_object(
    'status','ready','accepted',v_accepted and v_privacy_ack and v_overlay_actions,'bundleId',v_bundle.bundle_id,
    'legalCountryCode',v_bundle.legal_country_code,'legalSubnationalCode',v_bundle.legal_subnational_code,
    'uiLocale',v_bundle.ui_locale,'documentLocale',v_bundle.document_locale,'legalVersion',v_bundle.legal_version,
    'termsVersion',v_bundle.terms_version,'communityGuidelinesVersion',v_bundle.community_guidelines_version,
    'privacyNoticeVersion',v_bundle.privacy_notice_version,'marketingPushConsentVersion',v_bundle.marketing_push_consent_version,
    'termsUrl',v_docs->>'terms','privacyNoticeUrl',v_docs->>'privacy_notice','communityGuidelinesUrl',v_docs->>'community_guidelines',
    'marketingPushConsentUrl',v_docs->>'marketing_push_consent','subscriptionConsumerUrl',v_docs->>'subscription_consumer',
    'moderationAppealsUrl',v_docs->>'moderation_appeals','intellectualPropertyUrl',v_docs->>'intellectual_property',
    'accessibilityUrl',v_docs->>'accessibility','accountDeletionUrl',v_docs->>'account_deletion','supportUrl',v_docs->>'support',
    'jurisdictionPrivacySupplementUrl',v_docs->>'jurisdiction_privacy_supplement','legalDocumentUrls',v_docs,
    'applicabilityMatrixId',v_runtime.current_applicability_matrix_id,'overlayDocumentSetSha256',v_overlay_set_sha256,'marketingConsentDocumentSetSha256',v_marketing_set_sha256,'overlayDocuments',v_overlay_docs,'overlayActionsComplete',v_overlay_actions,
    'effectiveAt',v_bundle.effective_at,'ageAssuranceMode',v_policy.age_assurance_mode,'minimumUserAge',v_policy.minimum_user_age
  );
end $$;
revoke all on function public.get_current_legal_context(text) from public,anon;
grant execute on function public.get_current_legal_context(text) to authenticated;

-- Account settings must not resurrect a marketing grant from a previous applicability matrix.
create or replace function public.get_account_settings()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'tier',u.tier,'freeMessagesSent',u.free_messages_sent,'discoverable',u.discoverable,'incognito',u.incognito,
    'paused',u.paused_at is not null,'suspended',u.suspended_at is not null,'age18Confirmed',u.age_18_confirmed,'legalVersion',u.legal_version,
    'identityVerified',coalesce(u.identity_verified,false),'preferredLocale',u.preferred_locale,'measurementSystem',u.measurement_system,
    'legalContextCurrent',public.current_user_has_product_access(),'legalBundleAccepted',public.current_user_has_product_access(),
    'legalBundleId',public.resolve_current_legal_bundle_id(u.id,coalesce(u.preferred_locale,'en')),
    'legalCountry',r.legal_country_code,'legalCountryCode',r.legal_country_code,'legalSubnationalCode',r.legal_subnational_code,
    'legalCountryVerificationStatus',coalesce(r.resolution_status,'pending'),'legalCountryExpiresAt',r.expires_at,
    'legalApplicabilityMatrixId',r.current_applicability_matrix_id,
    'legalJurisdictionReleaseStatus',coalesce(j.release_status,'blocked'),'legalLanguageReviewStatus',coalesce(j.language_review_status,'pending_external_counsel'),'legalAgeAssuranceMode',coalesce(j.age_assurance_mode,'unresolved'),
    'legalUiLocale',b.ui_locale,'legalDocumentLocale',b.document_locale,
    'privacyNoticeVersion',(select p.notice_version from public.privacy_notice_acknowledgements p where p.user_id=u.id and p.applicability_matrix_id=r.current_applicability_matrix_id order by p.acknowledged_at desc,p.id desc limit 1),
    'marketingConsentVersion',(select e.consent_version from public.marketing_consent_events e where e.user_id=u.id and e.applicability_matrix_id=r.current_applicability_matrix_id and e.channel='push' and e.purpose='marketing_product_updates' order by e.created_at desc,e.id desc limit 1),
    'notificationPreferences',jsonb_set(
      ('{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb||coalesce(u.notification_preferences,'{}'::jsonb)),
      '{marketing}',to_jsonb(coalesce((select e.granted from public.marketing_consent_events e where e.user_id=u.id and e.bundle_id=b.bundle_id and e.applicability_matrix_id=r.current_applicability_matrix_id and e.channel='push' and e.purpose='marketing_product_updates' order by e.created_at desc,e.id desc limit 1),false)),true)
  ) from public.users u
  left join public.legal_country_runtime r on r.user_id=u.id
  left join public.legal_jurisdiction_policies j on j.legal_country_code=r.legal_country_code
  left join public.legal_document_bundles b on b.bundle_id=public.resolve_current_legal_bundle_id(u.id,coalesce(u.preferred_locale,'en'))
  where u.id=auth.uid() and public.current_session_satisfies_mfa_if_enrolled();
$$;
revoke all on function public.get_account_settings() from public,anon;
grant execute on function public.get_account_settings() to authenticated;


-- A stale Edge deployment using the old signature may not create new binding evidence.
create or replace function public.accept_current_legal_bundle(
  p_user_id uuid,p_bundle_id uuid,p_ui_locale text,p_age_18_confirmed boolean
)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' then raise exception 'forbidden'; end if;
  raise exception 'presented_overlay_document_set_hash_required';
end $$;
revoke all on function public.accept_current_legal_bundle(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.accept_current_legal_bundle(uuid,uuid,text,boolean) to service_role;

create or replace function public.set_marketing_push_consent(
  p_granted boolean,
  p_consent_version text,
  p_locale text default null,
  p_country_code text default null,
  p_presented_consent_document_set_sha256 text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user_id uuid:=auth.uid();
  v_locale text:=trim(coalesce(p_locale,''));
  v_bundle_id uuid;
  v_bundle public.legal_document_bundles;
  v_runtime public.legal_country_runtime;
  v_last public.marketing_consent_events;
  v_preferences jsonb;
  v_current_consent_document_set_sha256 text;
  v_current_overlay_document_set_sha256 text;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if not public.current_session_satisfies_mfa_if_enrolled() then raise exception 'mfa_required'; end if;
  if p_granted is null then raise exception 'invalid_consent_value'; end if;
  perform public.rate_limit('marketing_push_consent',20,3600);

  if p_granted=false then
    select * into v_last from public.marketing_consent_events e
      where e.user_id=v_user_id and e.channel='push' and e.purpose='marketing_product_updates'
      order by e.created_at desc,e.id desc limit 1;
    if found and v_last.granted=true then
      insert into public.marketing_consent_events(
        user_id,channel,purpose,consent_version,granted,locale,country_code,source,bundle_id,document_locale,
        consent_text_sha256,legal_subnational_code,applicability_matrix_id,consent_document_set_sha256
      ) values(
        v_user_id,'push','marketing_product_updates',v_last.consent_version,false,v_last.locale,v_last.country_code,
        'settings_withdrawal_original_context',v_last.bundle_id,v_last.document_locale,v_last.consent_text_sha256,v_last.legal_subnational_code,
        v_last.applicability_matrix_id,v_last.consent_document_set_sha256
      );
      insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
        values(v_user_id,'marketing_push_consent_withdrawn','marketing_consent_event',v_last.id::text,
          jsonb_build_object('channel','push','purpose','marketing_product_updates','withdrawnFromEventId',v_last.id,
            'bundleId',v_last.bundle_id,'consentVersion',v_last.consent_version,'consentTextSha256',v_last.consent_text_sha256,
            'consentDocumentSetSha256',v_last.consent_document_set_sha256,'applicabilityMatrixId',v_last.applicability_matrix_id,
            'legalCountry',v_last.country_code,'legalSubnational',v_last.legal_subnational_code,'uiLocale',v_last.locale,'documentLocale',v_last.document_locale));
    end if;
    update public.users set notification_preferences=jsonb_set(coalesce(notification_preferences,'{}'::jsonb),'{marketing}','false'::jsonb,true),updated_at=now()
      where id=v_user_id
      returning ('{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb || coalesce(notification_preferences,'{}'::jsonb)) into v_preferences;
    return jsonb_build_object('ok',true,'granted',false,'channel','push','purpose','marketing_product_updates',
      'consentVersion',case when v_last.id is null then null else v_last.consent_version end,
      'bundleId',case when v_last.id is null then null else v_last.bundle_id end,
      'legalCountryCode',case when v_last.id is null then null else v_last.country_code end,
      'uiLocale',case when v_last.id is null then null else v_last.locale end,
      'documentLocale',case when v_last.id is null then null else v_last.document_locale end,
      'consentDocumentSetSha256',case when v_last.id is null then null else v_last.consent_document_set_sha256 end,
      'notificationPreferences',v_preferences);
  end if;

  if char_length(v_locale) not between 2 and 16 then raise exception 'invalid_locale'; end if;
  select * into v_runtime from public.legal_country_runtime where user_id=v_user_id for update;
  if not found or v_runtime.resolution_status<>'verified' or v_runtime.current_applicability_matrix_id is null then raise exception 'legal_context_unresolved'; end if;
  if not public.legal_applicability_matrix_satisfied(v_user_id) then raise exception 'legal_applicability_review_incomplete'; end if;
  if p_country_code is not null and upper(trim(p_country_code))<>v_runtime.legal_country_code then raise exception 'client_country_mismatch'; end if;
  v_bundle_id:=public.resolve_current_legal_bundle_id(v_user_id,v_locale);
  if v_bundle_id is null then raise exception 'legal_bundle_not_current_for_context'; end if;
  select * into v_bundle from public.legal_document_bundles where bundle_id=v_bundle_id;
  if p_consent_version is distinct from v_bundle.marketing_push_consent_version then raise exception 'outdated_marketing_consent_version'; end if;
  v_current_overlay_document_set_sha256:=public.current_legal_overlay_document_set_sha256(v_user_id,v_bundle_id);
  if not exists(select 1 from public.legal_acceptances a where a.user_id=v_user_id and a.bundle_id=v_bundle_id
      and a.applicability_matrix_id=v_runtime.current_applicability_matrix_id and a.overlay_document_set_sha256=v_current_overlay_document_set_sha256) then
    raise exception 'current_legal_acceptance_required';
  end if;
  if not public.legal_overlay_document_actions_complete(v_user_id,v_bundle_id) then raise exception 'current_overlay_legal_actions_required_before_marketing_consent'; end if;
  v_current_consent_document_set_sha256:=public.current_marketing_consent_document_set_sha256(v_user_id,v_bundle_id);
  if p_presented_consent_document_set_sha256 is null or p_presented_consent_document_set_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'presented_marketing_document_set_hash_required'; end if;
  if p_presented_consent_document_set_sha256<>v_current_consent_document_set_sha256 then raise exception 'marketing_document_set_changed'; end if;

  insert into public.marketing_consent_events(
    user_id,channel,purpose,consent_version,granted,locale,country_code,source,bundle_id,document_locale,consent_text_sha256,
    legal_subnational_code,applicability_matrix_id,consent_document_set_sha256
  ) values(
    v_user_id,'push','marketing_product_updates',v_bundle.marketing_push_consent_version,true,v_bundle.ui_locale,v_bundle.legal_country_code,
    'settings_immutable_bundle_exact_document_set',v_bundle.bundle_id,v_bundle.document_locale,v_bundle.marketing_push_consent_sha256,
    v_bundle.legal_subnational_code,v_runtime.current_applicability_matrix_id,v_current_consent_document_set_sha256
  );
  update public.users set notification_preferences=jsonb_set(coalesce(notification_preferences,'{}'::jsonb),'{marketing}','true'::jsonb,true),updated_at=now()
    where id=v_user_id
    returning ('{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb || coalesce(notification_preferences,'{}'::jsonb)) into v_preferences;
  insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
    values(v_user_id,'marketing_push_consent_granted','legal_document_bundle',v_bundle.bundle_id,
      jsonb_build_object('channel','push','purpose','marketing_product_updates','bundleId',v_bundle.bundle_id,
        'consentVersion',v_bundle.marketing_push_consent_version,'consentTextSha256',v_bundle.marketing_push_consent_sha256,
        'consentDocumentSetSha256',v_current_consent_document_set_sha256,'applicabilityMatrixId',v_runtime.current_applicability_matrix_id,
        'legalCountry',v_bundle.legal_country_code,'legalSubnational',v_bundle.legal_subnational_code,
        'uiLocale',v_bundle.ui_locale,'documentLocale',v_bundle.document_locale));
  return jsonb_build_object('ok',true,'granted',true,'channel','push','purpose','marketing_product_updates',
    'consentVersion',v_bundle.marketing_push_consent_version,'bundleId',v_bundle.bundle_id,'legalCountryCode',v_bundle.legal_country_code,
    'uiLocale',v_bundle.ui_locale,'documentLocale',v_bundle.document_locale,'consentDocumentSetSha256',v_current_consent_document_set_sha256,
    'notificationPreferences',v_preferences);
end $$;
revoke all on function public.set_marketing_push_consent(boolean,text,text,text,text) from public,anon;
grant execute on function public.set_marketing_push_consent(boolean,text,text,text,text) to authenticated;

-- Stale clients may withdraw consent but cannot grant a new marketing permission without the exact document-set hash.
create or replace function public.set_marketing_push_consent(
  p_granted boolean,p_consent_version text,p_locale text default null,p_country_code text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_granted is distinct from false then raise exception 'presented_marketing_document_set_hash_required'; end if;
  return public.set_marketing_push_consent(false,p_consent_version,p_locale,p_country_code,null);
end $$;
revoke all on function public.set_marketing_push_consent(boolean,text,text,text) from public,anon;
grant execute on function public.set_marketing_push_consent(boolean,text,text,text) to authenticated;

-- Pre-R7 grants lack the current document-set evidence and are reset fail-closed.
update public.users set notification_preferences=jsonb_set(coalesce(notification_preferences,'{}'::jsonb),'{marketing}','false'::jsonb,true),updated_at=now()
where coalesce((notification_preferences->>'marketing')::boolean,false)=true;
