-- Tailmance v19 moderation due-process model: user-visible reasons, auditable decisions,
-- six-month appeal window, human review metadata, and fail-safe restoration semantics.

create table if not exists public.moderation_decisions (
  id uuid primary key default gen_random_uuid(),
  affected_user_id uuid references auth.users(id) on delete set null,
  reporter_user_id uuid references auth.users(id) on delete set null,
  report_id uuid references public.reports(id) on delete set null,
  target_type text not null check (target_type in ('account','pet','pet_photo','post','post_media','comment','message','story','event','meetup','health_document','pet_verification')),
  target_id uuid,
  action text not null check (action in ('account_restricted','content_removed','content_restricted','report_resolved','report_dismissed')),
  source text not null check (source in ('automated','manual')),
  user_visible_reason text not null check (char_length(trim(user_visible_reason)) between 3 and 2000),
  internal_reason text check (internal_reason is null or char_length(internal_reason)<=4000),
  reviewer_reference text check (reviewer_reference is null or char_length(reviewer_reference)<=200),
  status text not null default 'active' check (status in ('active','upheld','reversed')),
  restoration_required boolean not null default false,
  restoration_completed_at timestamptz,
  decided_at timestamptz not null default now(),
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  check (status<>'reversed' or restoration_required=false or restoration_completed_at is not null),
  check (status<>'reversed' or reversed_at is not null)
);
create index if not exists moderation_decisions_affected_idx on public.moderation_decisions(affected_user_id,decided_at desc);
create index if not exists moderation_decisions_reporter_idx on public.moderation_decisions(reporter_user_id,decided_at desc);
create index if not exists moderation_decisions_report_idx on public.moderation_decisions(report_id);
alter table public.moderation_decisions enable row level security;
revoke all on table public.moderation_decisions from public,anon,authenticated;

create table if not exists public.moderation_appeals (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.moderation_decisions(id) on delete cascade,
  appellant_user_id uuid not null references auth.users(id) on delete cascade,
  appellant_role text not null check (appellant_role in ('content_owner','reporter')),
  statement text not null check (char_length(trim(statement)) between 3 and 4000),
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  reviewer_reference text check (reviewer_reference is null or char_length(trim(reviewer_reference)) between 1 and 200),
  outcome_explanation text check (outcome_explanation is null or char_length(trim(outcome_explanation)) between 3 and 2000),
  unique(decision_id,appellant_user_id)
);
create index if not exists moderation_appeals_status_idx on public.moderation_appeals(status,submitted_at);
alter table public.moderation_appeals enable row level security;
revoke all on table public.moderation_appeals from public,anon,authenticated;

alter table public.reports add column if not exists resolution_explanation text;
alter table public.reports add column if not exists resolved_at timestamptz;
alter table public.reports add column if not exists moderation_decision_id uuid references public.moderation_decisions(id) on delete set null;

create or replace function public.get_my_moderation_decisions()
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.current_session_satisfies_mfa_if_enrolled() then coalesce(jsonb_agg(jsonb_build_object(
    'id',d.id,'targetType',d.target_type,'targetId',d.target_id,'action',d.action,'source',d.source,
    'reason',d.user_visible_reason,'status',d.status,'decidedAt',d.decided_at,
    'appealDeadline',d.decided_at+interval '6 months',
    'appeal',(select jsonb_build_object('id',a.id,'role',a.appellant_role,'statement',a.statement,'status',a.status,'submittedAt',a.submitted_at,'decidedAt',a.decided_at,'outcomeExplanation',a.outcome_explanation)
      from public.moderation_appeals a where a.decision_id=d.id and a.appellant_user_id=auth.uid())
  ) order by d.decided_at desc),'[]'::jsonb) else '[]'::jsonb end
  from public.moderation_decisions d
  where d.affected_user_id=auth.uid() or d.reporter_user_id=auth.uid();
$$;
revoke all on function public.get_my_moderation_decisions() from public,anon;
grant execute on function public.get_my_moderation_decisions() to authenticated;

create or replace function public.submit_moderation_appeal(p_decision_id uuid,p_statement text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_decision public.moderation_decisions; v_role text; v_appeal public.moderation_appeals;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not public.current_session_satisfies_mfa_if_enrolled() then raise exception 'mfa_required'; end if;
  if p_statement is null or char_length(trim(p_statement)) not between 3 and 4000 then raise exception 'invalid_appeal_statement'; end if;
  select * into v_decision from public.moderation_decisions where id=p_decision_id;
  if v_decision.id is null then raise exception 'decision_not_found'; end if;
  if v_decision.affected_user_id=auth.uid() then v_role:='content_owner';
  elsif v_decision.reporter_user_id=auth.uid() then v_role:='reporter';
  else raise exception 'forbidden'; end if;
  if now()>v_decision.decided_at+interval '6 months' then raise exception 'appeal_window_closed'; end if;
  if exists(select 1 from public.moderation_appeals where decision_id=p_decision_id and appellant_user_id=auth.uid()) then raise exception 'appeal_already_submitted'; end if;
  perform public.rate_limit('moderation_appeal',10,86400);
  insert into public.moderation_appeals(decision_id,appellant_user_id,appellant_role,statement)
  values(p_decision_id,auth.uid(),v_role,trim(p_statement)) returning * into v_appeal;
  insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'moderation_appeal_submitted','moderation_decision',p_decision_id,jsonb_build_object('appealId',v_appeal.id,'role',v_role));
  return jsonb_build_object('id',v_appeal.id,'decisionId',p_decision_id,'status',v_appeal.status,'submittedAt',v_appeal.submitted_at);
end $$;
revoke all on function public.submit_moderation_appeal(uuid,text) from public,anon;
grant execute on function public.submit_moderation_appeal(uuid,text) to authenticated;

create or replace function public.admin_review_moderation_appeal(
  p_appeal_id uuid,p_outcome text,p_outcome_explanation text,p_reviewer_reference text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_appeal public.moderation_appeals; v_decision public.moderation_decisions;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_outcome not in ('accepted','rejected') then raise exception 'invalid_appeal_outcome'; end if;
  if p_outcome_explanation is null or char_length(trim(p_outcome_explanation)) not between 3 and 2000 then raise exception 'outcome_explanation_required'; end if;
  if p_reviewer_reference is null or char_length(trim(p_reviewer_reference)) not between 1 and 200 then raise exception 'human_reviewer_reference_required'; end if;
  select * into v_appeal from public.moderation_appeals where id=p_appeal_id for update;
  if v_appeal.id is null then raise exception 'appeal_not_found'; end if;
  if v_appeal.status<>'pending' then raise exception 'appeal_already_decided'; end if;
  select * into v_decision from public.moderation_decisions where id=v_appeal.decision_id for update;
  update public.moderation_appeals set status=p_outcome,decided_at=now(),reviewer_reference=trim(p_reviewer_reference),outcome_explanation=trim(p_outcome_explanation) where id=p_appeal_id;
  if p_outcome='rejected' then
    update public.moderation_decisions set status='upheld',reviewer_reference=trim(p_reviewer_reference) where id=v_decision.id and status<>'reversed';
  end if;
  -- An accepted appeal does NOT automatically restore content/account or mark the decision reversed.
  -- A separate restoration action must first change the real product state, then call the finalizer below.
  insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
  values(v_appeal.appellant_user_id,'moderation_appeal_reviewed','moderation_decision',v_decision.id,jsonb_build_object('appealId',p_appeal_id,'outcome',p_outcome,'reviewerReference',p_reviewer_reference));
  return jsonb_build_object('ok',true,'appealStatus',p_outcome,'decisionStatus',(select status from public.moderation_decisions where id=v_decision.id),'restorationRequired',v_decision.restoration_required);
end $$;
revoke all on function public.admin_review_moderation_appeal(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_review_moderation_appeal(uuid,text,text,text) to service_role;

create or replace function public.admin_finalize_decision_reversal(p_decision_id uuid,p_reviewer_reference text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_decision public.moderation_decisions;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  select * into v_decision from public.moderation_decisions where id=p_decision_id for update;
  if v_decision.id is null then raise exception 'decision_not_found'; end if;
  if not exists(select 1 from public.moderation_appeals a where a.decision_id=p_decision_id and a.status='accepted') then raise exception 'accepted_appeal_required'; end if;
  if v_decision.restoration_required and v_decision.restoration_completed_at is null then raise exception 'restore_product_state_before_reversal'; end if;
  update public.moderation_decisions set status='reversed',reversed_at=now(),reviewer_reference=coalesce(nullif(trim(p_reviewer_reference),''),reviewer_reference) where id=p_decision_id;
  insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
  values(v_decision.affected_user_id,'moderation_decision_reversed','moderation_decision',p_decision_id,jsonb_build_object('reviewerReference',p_reviewer_reference));
  return jsonb_build_object('ok',true,'decisionId',p_decision_id,'status','reversed');
end $$;
revoke all on function public.admin_finalize_decision_reversal(uuid,text) from public,anon,authenticated;
grant execute on function public.admin_finalize_decision_reversal(uuid,text) to service_role;

create or replace function public.admin_set_account_restriction(
  p_user_id uuid,p_restricted boolean,p_user_visible_reason text,p_source text,p_reviewer_reference text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_decision_id uuid; v_was_suspended boolean;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_user_id is null or p_restricted is null then raise exception 'invalid_account_restriction_request'; end if;
  if p_source not in ('automated','manual') then raise exception 'invalid_decision_source'; end if;
  if p_user_visible_reason is null or char_length(trim(p_user_visible_reason)) not between 3 and 2000 then raise exception 'user_visible_reason_required'; end if;
  select suspended_at is not null into v_was_suspended from public.users where id=p_user_id for update;
  if not found then raise exception 'user_not_found'; end if;

  if p_restricted then
    if not v_was_suspended then
      update public.users set suspended_at=now(),updated_at=now() where id=p_user_id;
      insert into public.moderation_decisions(affected_user_id,target_type,target_id,action,source,user_visible_reason,reviewer_reference,restoration_required)
      values(p_user_id,'account',p_user_id,'account_restricted',p_source,trim(p_user_visible_reason),p_reviewer_reference,true)
      returning id into v_decision_id;
    else
      select id into v_decision_id from public.moderation_decisions where affected_user_id=p_user_id and action='account_restricted' and status in ('active','upheld') order by decided_at desc limit 1;
      if v_decision_id is null then
        insert into public.moderation_decisions(affected_user_id,target_type,target_id,action,source,user_visible_reason,internal_reason,reviewer_reference,restoration_required)
        values(p_user_id,'account',p_user_id,'account_restricted',p_source,trim(p_user_visible_reason),'Restriction predated v19 decision evidence; reason supplied during v19 reconciliation.',p_reviewer_reference,true)
        returning id into v_decision_id;
      end if;
    end if;
  else
    -- Restore the actual product state first. Only those active account-restriction decisions are then eligible for reversal.
    update public.users set suspended_at=null,updated_at=now() where id=p_user_id;
    update public.moderation_decisions set restoration_completed_at=coalesce(restoration_completed_at,now())
      where affected_user_id=p_user_id and action='account_restricted' and status in ('active','upheld');
    update public.moderation_decisions set status='reversed',reversed_at=now(),reviewer_reference=coalesce(nullif(trim(p_reviewer_reference),''),reviewer_reference)
      where affected_user_id=p_user_id and action='account_restricted' and status in ('active','upheld') and restoration_completed_at is not null
      returning id into v_decision_id;
  end if;

  insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
  values(p_user_id,case when p_restricted then 'account_restricted' else 'account_restriction_removed' end,'user',p_user_id,jsonb_build_object('decisionId',v_decision_id,'source',p_source,'reviewerReference',p_reviewer_reference));
  return jsonb_build_object('ok',true,'restricted',p_restricted,'decisionId',v_decision_id);
end $$;
revoke all on function public.admin_set_account_restriction(uuid,boolean,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_set_account_restriction(uuid,boolean,text,text,text) to service_role;

-- Status closure now requires a user-visible explanation and creates a formal reporter-facing decision.
drop function if exists public.admin_update_report_status(uuid,text);
create or replace function public.admin_update_report_status(p_report_id uuid,p_status text,p_user_visible_explanation text,p_reviewer_reference text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_report public.reports; v_decision_id uuid; v_action text;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_status not in ('reviewing','resolved','dismissed') then raise exception 'invalid_status'; end if;
  if p_status in ('resolved','dismissed') and (p_user_visible_explanation is null or char_length(trim(p_user_visible_explanation)) not between 3 and 2000) then raise exception 'resolution_explanation_required'; end if;
  update public.reports set status=p_status,
    resolution_explanation=case when p_status in ('resolved','dismissed') then trim(p_user_visible_explanation) else resolution_explanation end,
    resolved_at=case when p_status in ('resolved','dismissed') then now() else null end
    where id=p_report_id returning * into v_report;
  if v_report.id is null then raise exception 'report_not_found'; end if;
  if p_status in ('resolved','dismissed') then
    v_action:=case when p_status='resolved' then 'report_resolved' else 'report_dismissed' end;
    insert into public.moderation_decisions(reporter_user_id,report_id,target_type,target_id,action,source,user_visible_reason,reviewer_reference,restoration_required)
    values(v_report.reporter_user_id,v_report.id,
      case when v_report.target_type='event' then 'event' else v_report.target_type end,
      v_report.target_id,v_action,'manual',trim(p_user_visible_explanation),p_reviewer_reference,false)
    returning id into v_decision_id;
    update public.reports set moderation_decision_id=v_decision_id where id=p_report_id;
  end if;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id,metadata)
  values(null,null,'report_status_update','report',p_report_id,jsonb_build_object('status',p_status,'decisionId',v_decision_id,'hasUserVisibleExplanation',p_user_visible_explanation is not null));
  return jsonb_build_object('id',v_report.id,'status',p_status,'decisionId',v_decision_id);
end $$;
revoke all on function public.admin_update_report_status(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_update_report_status(uuid,text,text,text) to service_role;

create or replace function public.get_my_reports_page(
  p_limit integer default 40,p_before_created_at timestamptz default null,p_before_id uuid default null
) returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.current_session_satisfies_mfa_if_enrolled() then coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'targetType',r.target_type,'targetId',r.target_id,'reason',r.reason,'details',r.details,
    'status',r.status,'resolutionExplanation',r.resolution_explanation,'resolvedAt',r.resolved_at,
    'moderationDecisionId',r.moderation_decision_id,'createdAt',r.created_at
  ) order by r.created_at desc,r.id desc),'[]'::jsonb) else '[]'::jsonb end
  from (
    select * from public.reports where reporter_user_id=auth.uid()
      and (p_before_created_at is null or (created_at,id)<(p_before_created_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by created_at desc,id desc limit least(greatest(p_limit,1),100)
  ) r;
$$;
revoke all on function public.get_my_reports_page(integer,timestamptz,uuid) from public,anon;
grant execute on function public.get_my_reports_page(integer,timestamptz,uuid) to authenticated;
