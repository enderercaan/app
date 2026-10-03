-- Tailmance v19 significant automated-moderation decision hardening.
-- Content may be provisionally moderated by the bounded automated worker, but a full account suspension is a
-- significant service-access decision and must carry an attributable human decision/reviewer reference.

create or replace function public.admin_set_account_restriction(
  p_user_id uuid,p_restricted boolean,p_user_visible_reason text,p_source text,p_reviewer_reference text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_decision_id uuid;
  v_was_suspended boolean;
  v_active_count integer;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_user_id is null or p_restricted is null then raise exception 'invalid_account_restriction_request'; end if;
  if p_source not in ('automated','manual') then raise exception 'invalid_decision_source'; end if;
  if p_restricted and p_source<>'manual' then raise exception 'account_restriction_requires_human_decision'; end if;
  if p_restricted and nullif(trim(coalesce(p_reviewer_reference,'')),'') is null then raise exception 'account_restriction_requires_human_reviewer_reference'; end if;
  if p_user_visible_reason is null or char_length(trim(p_user_visible_reason)) not between 3 and 2000 then raise exception 'user_visible_reason_required'; end if;

  select suspended_at is not null into v_was_suspended from public.users where id=p_user_id for update;
  if not found then raise exception 'user_not_found'; end if;
  select count(*) into v_active_count from public.moderation_decisions
    where affected_user_id=p_user_id and action='account_restricted' and status in ('active','upheld');

  if p_restricted then
    if not v_was_suspended then
      update public.users set suspended_at=now(),updated_at=now() where id=p_user_id;
    end if;
    select id into v_decision_id from public.moderation_decisions
      where affected_user_id=p_user_id and action='account_restricted' and status in ('active','upheld')
      order by decided_at desc,id desc limit 1;
    if v_decision_id is null then
      insert into public.moderation_decisions(affected_user_id,target_type,target_id,action,source,user_visible_reason,internal_reason,reviewer_reference,restoration_required)
      values(p_user_id,'account',p_user_id,'account_restricted',p_source,trim(p_user_visible_reason),
        case when v_was_suspended then 'Restriction predated v19 decision evidence; reason supplied during v19 reconciliation.' else null end,
        p_reviewer_reference,true)
      returning id into v_decision_id;
    end if;
  else
    if v_active_count>1 then raise exception 'multiple_active_account_restrictions_require_targeted_resolution'; end if;
    if v_active_count=0 and v_was_suspended then
      insert into public.moderation_decisions(affected_user_id,target_type,target_id,action,source,user_visible_reason,internal_reason,reviewer_reference,restoration_required)
      values(p_user_id,'account',p_user_id,'account_restricted',p_source,trim(p_user_visible_reason),
        'Restriction predated v19 decision evidence; reconciled at removal.',p_reviewer_reference,true)
      returning id into v_decision_id;
    else
      select id into v_decision_id from public.moderation_decisions
        where affected_user_id=p_user_id and action='account_restricted' and status in ('active','upheld')
        order by decided_at desc,id desc limit 1;
    end if;

    update public.users set suspended_at=null,updated_at=now() where id=p_user_id;
    if v_decision_id is not null then
      update public.moderation_decisions
        set restoration_completed_at=coalesce(restoration_completed_at,now()),
            status='reversed',reversed_at=coalesce(reversed_at,now()),
            reviewer_reference=coalesce(nullif(trim(p_reviewer_reference),''),reviewer_reference)
        where id=v_decision_id;
    end if;
  end if;

  insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
  values(p_user_id,case when p_restricted then 'account_restricted' else 'account_restriction_removed' end,'user',p_user_id,
    jsonb_build_object('decisionId',v_decision_id,'source',p_source,'reviewerReference',p_reviewer_reference));
  return jsonb_build_object('ok',true,'restricted',p_restricted,'decisionId',v_decision_id);
end $$;
revoke all on function public.admin_set_account_restriction(uuid,boolean,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_set_account_restriction(uuid,boolean,text,text,text) to service_role;
