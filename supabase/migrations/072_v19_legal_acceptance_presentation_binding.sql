-- Tailmance v19 exact legal-presentation binding.
-- Records the exact immutable legal presentation shown to a user and prevents stale/unbound clients
-- from creating a binding acceptance after the jurisdiction matrix or document set changes.

create table if not exists public.legal_acceptance_presentations (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  matrix_id uuid not null references public.legal_applicability_matrices(matrix_id) on delete cascade,
  bundle_id uuid not null references public.legal_document_bundles(bundle_id) on delete restrict,
  presentation_sha256 text not null check (presentation_sha256 ~ '^[0-9a-f]{64}$'),
  accepted_source text not null check (char_length(trim(accepted_source)) between 1 and 120),
  accepted_at timestamptz not null default now(),
  unique(user_id,matrix_id,bundle_id,presentation_sha256)
);
create index if not exists legal_acceptance_presentations_user_bundle_idx
  on public.legal_acceptance_presentations(user_id,bundle_id,accepted_at desc,id desc);
alter table public.legal_acceptance_presentations enable row level security;
revoke all on table public.legal_acceptance_presentations from public,anon,authenticated;
grant select,insert on table public.legal_acceptance_presentations to service_role;

drop trigger if exists trg_legal_acceptance_presentations_append_only on public.legal_acceptance_presentations;
create trigger trg_legal_acceptance_presentations_append_only
before update or delete on public.legal_acceptance_presentations
for each row execute function public.prevent_append_only_legal_event_update();

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

  return jsonb_build_object(
    'matrixId',v_matrix_id,'bundleId',p_bundle_id,
    'overlayDocumentSetSha256',public.current_legal_overlay_document_set_sha256(p_user_id,p_bundle_id),
    'baseDocuments',v_base,'overlayDocuments',v_overlay
  );
end $$;
revoke all on function public.legal_acceptance_presentation_payload(uuid,uuid) from public,anon,authenticated;
grant execute on function public.legal_acceptance_presentation_payload(uuid,uuid) to service_role;

create or replace function public.legal_acceptance_presentation_sha256(p_user_id uuid,p_bundle_id uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare v_payload jsonb;
begin
  v_payload:=public.legal_acceptance_presentation_payload(p_user_id,p_bundle_id);
  if v_payload is null then return null; end if;
  return encode(extensions.digest(convert_to(v_payload::text,'UTF8'),'sha256'),'hex');
end $$;
revoke all on function public.legal_acceptance_presentation_sha256(uuid,uuid) from public,anon,authenticated;
grant execute on function public.legal_acceptance_presentation_sha256(uuid,uuid) to service_role;

create or replace function public.legal_acceptance_presentation_complete(p_user_id uuid,p_bundle_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_matrix_id uuid;v_sha text;
begin
  select current_applicability_matrix_id into v_matrix_id from public.legal_country_runtime where user_id=p_user_id;
  if v_matrix_id is null then return false; end if;
  v_sha:=public.legal_acceptance_presentation_sha256(p_user_id,p_bundle_id);
  if v_sha is null then return false; end if;
  return exists(select 1 from public.legal_acceptance_presentations p
    where p.user_id=p_user_id and p.matrix_id=v_matrix_id and p.bundle_id=p_bundle_id and p.presentation_sha256=v_sha);
end $$;
revoke all on function public.legal_acceptance_presentation_complete(uuid,uuid) from public,anon,authenticated;
grant execute on function public.legal_acceptance_presentation_complete(uuid,uuid) to service_role;

-- Only the presentation-bound overload may create a new acceptance. The old four-argument route from
-- legacy clients remains blocked by migration 071; this overload delegates to the exact overlay-set implementation.
revoke execute on function public.accept_current_legal_bundle(uuid,uuid,text,boolean) from service_role;
create or replace function public.accept_current_legal_bundle(
  p_user_id uuid,p_bundle_id uuid,p_ui_locale text,p_age_18_confirmed boolean,
  p_expected_applicability_matrix_id uuid,p_expected_presentation_sha256 text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_runtime public.legal_country_runtime;v_sha text;v_overlay_sha text;v_result jsonb;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden'; end if;
  if p_expected_applicability_matrix_id is null then raise exception 'expected_applicability_matrix_required'; end if;
  if coalesce(p_expected_presentation_sha256,'') !~ '^[0-9a-f]{64}$' then raise exception 'expected_legal_presentation_required'; end if;
  select * into v_runtime from public.legal_country_runtime where user_id=p_user_id for update;
  if not found then raise exception 'legal_country_unresolved'; end if;
  if v_runtime.current_applicability_matrix_id is distinct from p_expected_applicability_matrix_id then raise exception 'legal_presentation_context_changed'; end if;
  if not public.legal_applicability_matrix_satisfied(p_user_id) then raise exception 'legal_applicability_review_incomplete'; end if;
  v_sha:=public.legal_acceptance_presentation_sha256(p_user_id,p_bundle_id);
  if v_sha is null or v_sha<>p_expected_presentation_sha256 then raise exception 'legal_presentation_changed'; end if;
  v_overlay_sha:=public.current_legal_overlay_document_set_sha256(p_user_id,p_bundle_id);
  v_result:=public.accept_current_legal_bundle(p_user_id,p_bundle_id,p_ui_locale,p_age_18_confirmed,v_overlay_sha);
  insert into public.legal_acceptance_presentations(user_id,matrix_id,bundle_id,presentation_sha256,accepted_source,accepted_at)
  values(p_user_id,p_expected_applicability_matrix_id,p_bundle_id,v_sha,'verified_session_exact_presentation',now())
  on conflict(user_id,matrix_id,bundle_id,presentation_sha256) do nothing;
  if not public.legal_acceptance_presentation_complete(p_user_id,p_bundle_id) then raise exception 'legal_presentation_acceptance_not_recorded'; end if;
  return v_result||jsonb_build_object('presentationSha256',v_sha);
end $$;
revoke all on function public.accept_current_legal_bundle(uuid,uuid,text,boolean,uuid,text) from public,anon,authenticated;
grant execute on function public.accept_current_legal_bundle(uuid,uuid,text,boolean,uuid,text) to service_role;

-- Optional marketing consent is valid only after the exact current binding presentation was accepted.
create or replace function public.enforce_marketing_requires_complete_legal_actions()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_current_matrix uuid;v_previous_matrix uuid;
begin
  if new.granted=true then
    select current_applicability_matrix_id into v_current_matrix from public.legal_country_runtime where user_id=new.user_id;
    if v_current_matrix is null or not public.legal_applicability_matrix_record_satisfied(new.user_id,v_current_matrix) then raise exception 'current_applicability_matrix_required_before_marketing_consent'; end if;
    if new.bundle_id is null or not public.legal_overlay_document_actions_complete(new.user_id,new.bundle_id) then raise exception 'current_overlay_legal_actions_required_before_marketing_consent'; end if;
    if not public.legal_acceptance_presentation_complete(new.user_id,new.bundle_id) then raise exception 'current_legal_presentation_acceptance_required_before_marketing_consent'; end if;
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
