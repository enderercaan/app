-- Tailmance v19 due-process hardening.
-- 1) A successful appeal never reverses a restriction by itself.
-- 2) Restoration evidence is recorded only after the real product state is observed restored.
-- 3) Repeated report resolution is idempotent instead of creating duplicate formal decisions.
-- 4) Account reopening never uses a multi-row UPDATE ... RETURNING INTO path.

create or replace function public.assert_moderation_restoration_safe(p_source_reference text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_decision public.moderation_decisions;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_source_reference is null or char_length(trim(p_source_reference)) not between 3 and 200 then
    raise exception 'source_reference_required';
  end if;

  select * into v_decision
  from public.moderation_decisions
  where source_reference=trim(p_source_reference)
  for update;

  if v_decision.id is null then
    return jsonb_build_object('ok',true,'decisionFound',false,'safeToRestore',true);
  end if;

  if exists(
    select 1 from public.moderation_decisions d
    where d.id<>v_decision.id
      and d.target_type=v_decision.target_type
      and d.target_id is not distinct from v_decision.target_id
      and d.restoration_required=true
      and d.status in ('active','upheld')
  ) then
    raise exception 'independent_active_restriction_remains';
  end if;

  return jsonb_build_object('ok',true,'decisionFound',true,'decisionId',v_decision.id,'safeToRestore',true);
end $$;
revoke all on function public.assert_moderation_restoration_safe(text) from public,anon,authenticated;
grant execute on function public.assert_moderation_restoration_safe(text) to service_role;

create or replace function public.confirm_moderation_restoration_for_source(
  p_source_reference text,
  p_reviewer_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_decision public.moderation_decisions;
  v_restored boolean:=false;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_source_reference is null or char_length(trim(p_source_reference)) not between 3 and 200 then
    raise exception 'source_reference_required';
  end if;
  if p_reviewer_reference is not null and char_length(trim(p_reviewer_reference)) not between 1 and 200 then
    raise exception 'invalid_reviewer_reference';
  end if;

  select * into v_decision
  from public.moderation_decisions
  where source_reference=trim(p_source_reference)
  for update;

  if v_decision.id is null then
    return jsonb_build_object('ok',true,'decisionFound',false,'restorationConfirmed',false);
  end if;
  if not v_decision.restoration_required then
    return jsonb_build_object('ok',true,'decisionFound',true,'decisionId',v_decision.id,'restorationConfirmed',true);
  end if;

  if exists(
    select 1 from public.moderation_decisions d
    where d.id<>v_decision.id
      and d.target_type=v_decision.target_type
      and d.target_id is not distinct from v_decision.target_id
      and d.restoration_required=true
      and d.status in ('active','upheld')
  ) then
    return jsonb_build_object('ok',true,'decisionFound',true,'decisionId',v_decision.id,'restorationConfirmed',false,'reason','independent_active_restriction_remains');
  end if;

  if v_decision.target_type='account' then
    select exists(select 1 from public.users u where u.id=v_decision.target_id and u.suspended_at is null) into v_restored;
  elsif v_decision.target_type='pet' then
    select exists(select 1 from public.pets p where p.id=v_decision.target_id and p.moderation_status='approved') into v_restored;
  elsif v_decision.target_type='pet_photo' then
    select exists(select 1 from public.pet_photos p where p.id=v_decision.target_id and p.moderation_status='approved') into v_restored;
  elsif v_decision.target_type='post' then
    select exists(select 1 from public.posts p where p.id=v_decision.target_id and p.deleted_at is null and p.moderation_status='approved') into v_restored;
  elsif v_decision.target_type='post_media' then
    select exists(select 1 from public.post_media p where p.id=v_decision.target_id and p.moderation_status='approved') into v_restored;
  elsif v_decision.target_type='comment' then
    select exists(select 1 from public.comments c where c.id=v_decision.target_id and c.deleted_at is null and c.moderation_status='approved') into v_restored;
  elsif v_decision.target_type='message' then
    select exists(select 1 from public.messages m where m.id=v_decision.target_id and m.moderation_status='approved') into v_restored;
  elsif v_decision.target_type='story' then
    select exists(select 1 from public.stories s where s.id=v_decision.target_id and s.moderation_status='approved') into v_restored;
  elsif v_decision.target_type='event' then
    select exists(select 1 from public.pet_events e where e.id=v_decision.target_id and e.moderation_status='approved') into v_restored;
  elsif v_decision.target_type='meetup' then
    select exists(select 1 from public.meetup_requests m where m.id=v_decision.target_id and m.moderation_status='approved') into v_restored;
  elsif v_decision.target_type='health_document' then
    select exists(select 1 from public.health_documents h where h.id=v_decision.target_id and h.verification_status='verified') into v_restored;
  elsif v_decision.target_type='pet_verification' then
    select exists(select 1 from public.pet_verification_requests r where r.id=v_decision.target_id and r.status='approved') into v_restored;
  end if;

  if v_restored then
    update public.moderation_decisions
      set restoration_completed_at=coalesce(restoration_completed_at,now()),
          reviewer_reference=coalesce(nullif(trim(p_reviewer_reference),''),reviewer_reference)
      where id=v_decision.id;
    insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
    values(v_decision.affected_user_id,'moderation_restoration_confirmed','moderation_decision',v_decision.id,
      jsonb_build_object('sourceReference',p_source_reference,'reviewerReference',p_reviewer_reference));
  end if;

  return jsonb_build_object('ok',true,'decisionFound',true,'decisionId',v_decision.id,'restorationConfirmed',v_restored);
end $$;
revoke all on function public.confirm_moderation_restoration_for_source(text,text) from public,anon,authenticated;
grant execute on function public.confirm_moderation_restoration_for_source(text,text) to service_role;

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

create or replace function public.admin_update_report_status(
  p_report_id uuid,p_status text,p_user_visible_explanation text,p_reviewer_reference text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_report public.reports;
  v_decision public.moderation_decisions;
  v_decision_id uuid;
  v_action text;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_status not in ('reviewing','resolved','dismissed') then raise exception 'invalid_status'; end if;
  if p_status in ('resolved','dismissed') and (p_user_visible_explanation is null or char_length(trim(p_user_visible_explanation)) not between 3 and 2000) then
    raise exception 'resolution_explanation_required';
  end if;

  select * into v_report from public.reports where id=p_report_id for update;
  if v_report.id is null then raise exception 'report_not_found'; end if;

  if v_report.moderation_decision_id is not null then
    select * into v_decision from public.moderation_decisions where id=v_report.moderation_decision_id for update;
  end if;

  if p_status='reviewing' then
    if v_decision.id is not null and v_decision.status in ('active','upheld') then
      update public.moderation_decisions set status='reversed',reversed_at=now(),reviewer_reference=coalesce(nullif(trim(p_reviewer_reference),''),reviewer_reference)
      where id=v_decision.id;
    end if;
    update public.reports set status='reviewing',resolution_explanation=null,resolved_at=null,moderation_decision_id=null where id=p_report_id;
    v_decision_id:=null;
  else
    v_action:=case when p_status='resolved' then 'report_resolved' else 'report_dismissed' end;
    if v_decision.id is not null and v_decision.report_id=p_report_id and v_decision.action=v_action and v_decision.status in ('active','upheld') then
      update public.moderation_decisions
        set user_visible_reason=trim(p_user_visible_explanation),source='manual',reviewer_reference=coalesce(nullif(trim(p_reviewer_reference),''),reviewer_reference)
        where id=v_decision.id;
      v_decision_id:=v_decision.id;
    else
      if v_decision.id is not null and v_decision.status in ('active','upheld') then
        update public.moderation_decisions set status='reversed',reversed_at=now(),reviewer_reference=coalesce(nullif(trim(p_reviewer_reference),''),reviewer_reference)
        where id=v_decision.id;
      end if;
      insert into public.moderation_decisions(reporter_user_id,report_id,target_type,target_id,action,source,user_visible_reason,reviewer_reference,restoration_required)
      values(v_report.reporter_user_id,v_report.id,
        case when v_report.target_type='event' then 'event' else v_report.target_type end,
        v_report.target_id,v_action,'manual',trim(p_user_visible_explanation),p_reviewer_reference,false)
      returning id into v_decision_id;
    end if;
    update public.reports set status=p_status,resolution_explanation=trim(p_user_visible_explanation),resolved_at=now(),moderation_decision_id=v_decision_id where id=p_report_id;
  end if;

  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id,metadata)
  values(null,null,'report_status_update','report',p_report_id,
    jsonb_build_object('status',p_status,'decisionId',v_decision_id,'hasUserVisibleExplanation',p_user_visible_explanation is not null));
  return jsonb_build_object('id',v_report.id,'status',p_status,'decisionId',v_decision_id);
end $$;
revoke all on function public.admin_update_report_status(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_update_report_status(uuid,text,text,text) to service_role;
