-- Tailmance v19 subscription pre-contract presentation evidence.
-- This records that the authenticated user reviewed the exact current subscription/consumer document set
-- immediately before the native store purchase flow. It is not marketing consent, privacy consent, or a waiver.

create table if not exists public.subscription_precontract_presentations (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  bundle_id uuid not null references public.legal_document_bundles(bundle_id) on delete restrict,
  applicability_matrix_id uuid not null references public.legal_applicability_matrices(matrix_id) on delete restrict,
  ui_locale text not null check (char_length(trim(ui_locale)) between 2 and 16),
  document_set_sha256 text not null check (document_set_sha256 ~ '^[0-9a-f]{64}$'),
  store_platform text not null check (store_platform in ('ios','android')),
  store_product_id text not null check (char_length(trim(store_product_id)) between 1 and 200),
  presentation_source text not null default 'premium_precontract_review_checkbox' check (presentation_source='premium_precontract_review_checkbox'),
  acknowledged_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists subscription_precontract_presentations_user_idx
  on public.subscription_precontract_presentations(user_id,acknowledged_at desc,id desc);
alter table public.subscription_precontract_presentations enable row level security;
revoke all on table public.subscription_precontract_presentations from public,anon,authenticated;
grant select,insert on table public.subscription_precontract_presentations to service_role;

drop trigger if exists trg_subscription_precontract_presentations_append_only on public.subscription_precontract_presentations;
create trigger trg_subscription_precontract_presentations_append_only
before update or delete on public.subscription_precontract_presentations
for each row execute function public.prevent_append_only_legal_event_update();

create or replace function public.record_current_subscription_precontract_presentation(
  p_bundle_id uuid,
  p_applicability_matrix_id uuid,
  p_ui_locale text,
  p_expected_document_set_sha256 text,
  p_store_platform text,
  p_store_product_id text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user_id uuid:=auth.uid();
  v_runtime public.legal_country_runtime;
  v_current_bundle uuid;
  v_current_sha text;
  v_product_id text:=trim(coalesce(p_store_product_id,''));
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if not public.current_user_has_product_access() then raise exception 'product_access_required'; end if;
  if p_bundle_id is null or p_applicability_matrix_id is null then raise exception 'subscription_precontract_context_required'; end if;
  if char_length(trim(coalesce(p_ui_locale,''))) not between 2 and 16 then raise exception 'subscription_precontract_locale_invalid'; end if;
  if coalesce(p_expected_document_set_sha256,'') !~ '^[0-9a-f]{64}$' then raise exception 'subscription_precontract_document_set_invalid'; end if;
  if p_store_platform not in ('ios','android') then raise exception 'subscription_precontract_platform_invalid'; end if;
  if char_length(v_product_id) not between 1 and 200 then raise exception 'subscription_precontract_product_invalid'; end if;

  select * into v_runtime from public.legal_country_runtime where user_id=v_user_id;
  if not found or v_runtime.current_applicability_matrix_id is distinct from p_applicability_matrix_id then raise exception 'subscription_precontract_context_changed'; end if;
  v_current_bundle:=public.resolve_current_legal_bundle_id(v_user_id,p_ui_locale);
  if v_current_bundle is distinct from p_bundle_id then raise exception 'subscription_precontract_bundle_changed'; end if;
  v_current_sha:=public.current_subscription_purchase_document_set_sha256(v_user_id,p_bundle_id);
  if v_current_sha is null or v_current_sha<>p_expected_document_set_sha256 then raise exception 'subscription_precontract_documents_changed'; end if;

  insert into public.subscription_precontract_presentations(
    user_id,bundle_id,applicability_matrix_id,ui_locale,document_set_sha256,store_platform,store_product_id,presentation_source,acknowledged_at
  ) values(
    v_user_id,p_bundle_id,p_applicability_matrix_id,p_ui_locale,v_current_sha,p_store_platform,v_product_id,'premium_precontract_review_checkbox',now()
  );
  return jsonb_build_object('ok',true,'bundleId',p_bundle_id,'applicabilityMatrixId',p_applicability_matrix_id,'documentSetSha256',v_current_sha);
end $$;
revoke all on function public.record_current_subscription_precontract_presentation(uuid,uuid,text,text,text,text) from public,anon;
grant execute on function public.record_current_subscription_precontract_presentation(uuid,uuid,text,text,text,text) to authenticated;
