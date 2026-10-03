-- Tailmance v19 atomic moderation decision + statement-of-reasons hardening.
-- Restriction decisions must not commit without their attributable user-facing statement-of-reasons.
-- Legacy service RPCs remain callable only for account restriction removal; new restrictions use the v2 atomic paths.

create or replace function public._record_moderation_restriction_decision_core(
  p_target_type text,
  p_target_id uuid,
  p_source text,
  p_user_visible_reason text,
  p_source_reference text
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_user_id uuid;
  v_formal_target_type text;
  v_id uuid;
  v_pet_id uuid;
  v_post_id uuid;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_source not in ('automated','manual') then raise exception 'invalid_decision_source'; end if;
  if p_target_id is null then raise exception 'target_id_required'; end if;
  if p_user_visible_reason is null or char_length(trim(p_user_visible_reason)) not between 3 and 2000 then raise exception 'user_visible_reason_required'; end if;
  if p_source_reference is null or char_length(trim(p_source_reference)) not between 3 and 200 then raise exception 'source_reference_required'; end if;

  select id into v_id from public.moderation_decisions where source_reference=p_source_reference;
  if v_id is not null then return v_id; end if;

  if p_target_type='pet_text' then
    v_formal_target_type:='pet';
    select owner_id into v_user_id from public.pets where id=p_target_id;
  elsif p_target_type='pet_photo' then
    v_formal_target_type:='pet_photo';
    select pet_id into v_pet_id from public.pet_photos where id=p_target_id;
    select owner_id into v_user_id from public.pets where id=v_pet_id;
  elsif p_target_type='post_text' then
    v_formal_target_type:='post';
    select pet_id into v_pet_id from public.posts where id=p_target_id;
    select owner_id into v_user_id from public.pets where id=v_pet_id;
  elsif p_target_type='post_media' then
    v_formal_target_type:='post_media';
    select post_id into v_post_id from public.post_media where id=p_target_id;
    select pet_id into v_pet_id from public.posts where id=v_post_id;
    select owner_id into v_user_id from public.pets where id=v_pet_id;
  elsif p_target_type='comment_text' then
    v_formal_target_type:='comment';
    select pet_id into v_pet_id from public.comments where id=p_target_id;
    select owner_id into v_user_id from public.pets where id=v_pet_id;
  elsif p_target_type='message_text' then
    v_formal_target_type:='message';
    select sender_pet_id into v_pet_id from public.messages where id=p_target_id;
    select owner_id into v_user_id from public.pets where id=v_pet_id;
  elsif p_target_type='story' then
    v_formal_target_type:='story';
    select pet_id into v_pet_id from public.stories where id=p_target_id;
    select owner_id into v_user_id from public.pets where id=v_pet_id;
  elsif p_target_type='event_text' then
    v_formal_target_type:='event';
    select creator_pet_id into v_pet_id from public.pet_events where id=p_target_id;
    select owner_id into v_user_id from public.pets where id=v_pet_id;
  elsif p_target_type='meetup_text' then
    v_formal_target_type:='meetup';
    select proposed_by_pet_id into v_pet_id from public.meetup_requests where id=p_target_id;
    select owner_id into v_user_id from public.pets where id=v_pet_id;
  elsif p_target_type='health_document' then
    v_formal_target_type:='health_document';
    select pet_id into v_pet_id from public.health_documents where id=p_target_id;
    select owner_id into v_user_id from public.pets where id=v_pet_id;
  elsif p_target_type='pet_verification' then
    v_formal_target_type:='pet_verification';
    select owner_id into v_user_id from public.pet_verification_requests where id=p_target_id;
  else
    raise exception 'unsupported_moderation_target_type';
  end if;

  if v_user_id is null then raise exception 'moderation_target_owner_not_found'; end if;
  insert into public.moderation_decisions(
    affected_user_id,target_type,target_id,action,source,user_visible_reason,status,restoration_required,source_reference
  ) values(
    v_user_id,v_formal_target_type,p_target_id,'content_removed',p_source,trim(p_user_visible_reason),'active',true,trim(p_source_reference)
  ) returning id into v_id;
  return v_id;
end $$;
revoke all on function public._record_moderation_restriction_decision_core(text,uuid,text,text,text) from public,anon,authenticated;

create or replace function public.record_moderation_restriction_decision_v2(
  p_target_type text,
  p_target_id uuid,
  p_source text,
  p_user_visible_reason text,
  p_source_reference text,
  p_basis_type text,
  p_legal_ground_reference text,
  p_terms_ground_reference text,
  p_facts_summary text,
  p_territorial_scope text[],
  p_automated_detection_used boolean,
  p_automated_decision_used boolean
)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_statement_id uuid;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  v_id:=public._record_moderation_restriction_decision_core(
    p_target_type,p_target_id,p_source,p_user_visible_reason,p_source_reference
  );
  v_statement_id:=public.record_moderation_statement_of_reasons(
    v_id,p_basis_type,p_legal_ground_reference,p_terms_ground_reference,p_facts_summary,
    p_territorial_scope,p_automated_detection_used,p_automated_decision_used
  );
  if v_statement_id is null then raise exception 'moderation_statement_required'; end if;
  return v_id;
end $$;
revoke all on function public.record_moderation_restriction_decision_v2(text,uuid,text,text,text,text,text,text,text,text[],boolean,boolean) from public,anon,authenticated;
grant execute on function public.record_moderation_restriction_decision_v2(text,uuid,text,text,text,text,text,text,text,text[],boolean,boolean) to service_role;

-- Prevent future service code from creating a restriction decision without the atomic statement path.
create or replace function public.record_moderation_restriction_decision(
  p_target_type text,
  p_target_id uuid,
  p_source text,
  p_user_visible_reason text,
  p_source_reference text
)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  raise exception 'structured_statement_required_use_record_moderation_restriction_decision_v2';
end $$;
revoke all on function public.record_moderation_restriction_decision(text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.record_moderation_restriction_decision(text,uuid,text,text,text) to service_role;

create or replace function public._admin_set_account_restriction_core(
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
  if p_source<>'manual' then raise exception 'account_restriction_lifecycle_requires_human_decision'; end if;
  if nullif(trim(coalesce(p_reviewer_reference,'')),'') is null then raise exception 'account_restriction_requires_human_reviewer_reference'; end if;
  if p_user_visible_reason is null or char_length(trim(p_user_visible_reason)) not between 3 and 2000 then raise exception 'user_visible_reason_required'; end if;

  select suspended_at is not null into v_was_suspended from public.users where id=p_user_id for update;
  if not found then raise exception 'user_not_found'; end if;
  select count(*) into v_active_count from public.moderation_decisions
    where affected_user_id=p_user_id and action='account_restricted' and status in ('active','upheld');

  if p_restricted then
    if not v_was_suspended then update public.users set suspended_at=now(),updated_at=now() where id=p_user_id; end if;
    select id into v_decision_id from public.moderation_decisions
      where affected_user_id=p_user_id and action='account_restricted' and status in ('active','upheld')
      order by decided_at desc,id desc limit 1;
    if v_decision_id is null then
      insert into public.moderation_decisions(affected_user_id,target_type,target_id,action,source,user_visible_reason,internal_reason,reviewer_reference,restoration_required)
      values(p_user_id,'account',p_user_id,'account_restricted','manual',trim(p_user_visible_reason),
        case when v_was_suspended then 'Restriction predated v19 decision evidence; reason supplied during v19 reconciliation.' else null end,
        trim(p_reviewer_reference),true)
      returning id into v_decision_id;
    end if;
  else
    if v_active_count>1 then raise exception 'multiple_active_account_restrictions_require_targeted_resolution'; end if;
    if v_active_count=0 and v_was_suspended then
      insert into public.moderation_decisions(affected_user_id,target_type,target_id,action,source,user_visible_reason,internal_reason,reviewer_reference,restoration_required)
      values(p_user_id,'account',p_user_id,'account_restricted','manual',trim(p_user_visible_reason),
        'Restriction predated v19 decision evidence; reconciled at removal.',trim(p_reviewer_reference),true)
      returning id into v_decision_id;
    else
      select id into v_decision_id from public.moderation_decisions
        where affected_user_id=p_user_id and action='account_restricted' and status in ('active','upheld')
        order by decided_at desc,id desc limit 1;
    end if;
    update public.users set suspended_at=null,updated_at=now() where id=p_user_id;
    if v_decision_id is not null then
      update public.moderation_decisions
        set restoration_completed_at=coalesce(restoration_completed_at,now()),status='reversed',reversed_at=coalesce(reversed_at,now()),
            reviewer_reference=coalesce(nullif(trim(p_reviewer_reference),''),reviewer_reference)
        where id=v_decision_id;
    end if;
  end if;

  insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
  values(p_user_id,case when p_restricted then 'account_restricted' else 'account_restriction_removed' end,'user',p_user_id,
    jsonb_build_object('decisionId',v_decision_id,'source','manual','reviewerReference',p_reviewer_reference));
  return jsonb_build_object('ok',true,'restricted',p_restricted,'decisionId',v_decision_id);
end $$;
revoke all on function public._admin_set_account_restriction_core(uuid,boolean,text,text,text) from public,anon,authenticated;

create or replace function public.admin_set_account_restriction_v2(
  p_user_id uuid,
  p_restricted boolean,
  p_user_visible_reason text,
  p_reviewer_reference text,
  p_basis_type text default null,
  p_legal_ground_reference text default null,
  p_terms_ground_reference text default null,
  p_facts_summary text default null,
  p_territorial_scope text[] default '{}'::text[]
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_decision_id uuid; v_statement_id uuid;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_restricted and (p_basis_type is null or p_facts_summary is null) then raise exception 'structured_statement_required_for_account_restriction'; end if;
  v_result:=public._admin_set_account_restriction_core(p_user_id,p_restricted,p_user_visible_reason,'manual',p_reviewer_reference);
  v_decision_id:=nullif(v_result->>'decisionId','')::uuid;
  if p_restricted then
    v_statement_id:=public.record_moderation_statement_of_reasons(
      v_decision_id,p_basis_type,p_legal_ground_reference,p_terms_ground_reference,p_facts_summary,
      p_territorial_scope,false,false
    );
    if v_statement_id is null then raise exception 'moderation_statement_required'; end if;
  end if;
  return v_result;
end $$;
revoke all on function public.admin_set_account_restriction_v2(uuid,boolean,text,text,text,text,text,text,text[]) from public,anon,authenticated;
grant execute on function public.admin_set_account_restriction_v2(uuid,boolean,text,text,text,text,text,text,text[]) to service_role;

-- Legacy restriction creation is blocked so a new active account restriction cannot bypass the structured statement.
-- Human-reviewed removal remains available for operational recovery/appeal reversal.
create or replace function public.admin_set_account_restriction(
  p_user_id uuid,p_restricted boolean,p_user_visible_reason text,p_source text,p_reviewer_reference text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_restricted then raise exception 'structured_statement_required_use_admin_set_account_restriction_v2'; end if;
  return public._admin_set_account_restriction_core(p_user_id,false,p_user_visible_reason,p_source,p_reviewer_reference);
end $$;
revoke all on function public.admin_set_account_restriction(uuid,boolean,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_set_account_restriction(uuid,boolean,text,text,text) to service_role;
