-- Deterministic account-deletion cleanup for user-bound append-only legal evidence.
-- Do not rely on the JWT role visible during an Auth schema FK cascade.

create or replace function public.prevent_moderation_statement_mutation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE'
     and old.affected_user_id is not null
     and new.affected_user_id is null
     and (to_jsonb(new)-'affected_user_id') = (to_jsonb(old)-'affected_user_id') then
    return new;
  end if;
  raise exception 'moderation_statement_of_reasons_is_append_only';
end $$;
revoke all on function public.prevent_moderation_statement_mutation() from public,anon,authenticated;

create or replace function public.prepare_account_legal_evidence_erasure(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_deleted bigint:=0;v_count bigint:=0;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_user_id is null then raise exception 'user_id_required'; end if;

  -- Preserve the immutable moderation statement itself while removing the direct Auth identity link.
  update public.moderation_statement_of_reasons set affected_user_id=null where affected_user_id=p_user_id;

  delete from public.legal_overlay_document_actions where user_id=p_user_id; get diagnostics v_count=row_count; v_deleted:=v_deleted+v_count;
  delete from public.legal_age_assurance_events where user_id=p_user_id; get diagnostics v_count=row_count; v_deleted:=v_deleted+v_count;
  delete from public.legal_acceptance_presentations where user_id=p_user_id; get diagnostics v_count=row_count; v_deleted:=v_deleted+v_count;
  delete from public.subscription_precontract_presentations where user_id=p_user_id; get diagnostics v_count=row_count; v_deleted:=v_deleted+v_count;
  delete from public.prelegal_age_attestations where user_id=p_user_id; get diagnostics v_count=row_count; v_deleted:=v_deleted+v_count;
  delete from public.pre_registration_legal_presentations where user_id=p_user_id; get diagnostics v_count=row_count; v_deleted:=v_deleted+v_count;
  delete from public.marketing_consent_events where user_id=p_user_id; get diagnostics v_count=row_count; v_deleted:=v_deleted+v_count;
  delete from public.privacy_notice_acknowledgements where user_id=p_user_id; get diagnostics v_count=row_count; v_deleted:=v_deleted+v_count;
  delete from public.legal_acceptances where user_id=p_user_id; get diagnostics v_count=row_count; v_deleted:=v_deleted+v_count;

  return jsonb_build_object('ok',true,'deletedEvidenceRows',v_deleted);
end $$;
revoke all on function public.prepare_account_legal_evidence_erasure(uuid) from public,anon,authenticated;
grant execute on function public.prepare_account_legal_evidence_erasure(uuid) to service_role;
