-- Tailmance v19 R8 ultra-deep audit: semantic idempotency for mutations whose first
-- commit can be followed by a lost HTTP response. Exact retries return the already
-- committed state instead of consuming quota twice, duplicating evidence, or showing
-- a false failure. Different terminal intents still fail closed.

create or replace function public.report_content(p_reporter_pet_id uuid,p_target_type text,p_target_id uuid,p_reason text,p_details text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_exists boolean:=false; v_reason text:=trim(coalesce(p_reason,'')); v_details text:=nullif(trim(coalesce(p_details,'')),'');
begin
  if not public.owns_pet(p_reporter_pet_id) then raise exception 'forbidden'; end if;
  if p_target_type not in ('pet','post','comment','message','story','event','meetup') then raise exception 'invalid_target_type'; end if;
  if char_length(v_reason) not between 1 and 100 then raise exception 'invalid_reason'; end if;
  if char_length(coalesce(v_details,''))>2000 then raise exception 'invalid_details'; end if;

  -- Serialize exact reporter/target submissions so simultaneous retries cannot both insert.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'report:'||auth.uid()::text||':'||p_reporter_pet_id::text||':'||p_target_type||':'||p_target_id::text,0));

  if p_target_type='pet' then select exists(select 1 from public.pets where id=p_target_id and owner_id<>auth.uid()) into v_exists;
  elsif p_target_type='post' then select exists(select 1 from public.posts po join public.pets p on p.id=po.pet_id where po.id=p_target_id and p.owner_id<>auth.uid()) into v_exists;
  elsif p_target_type='comment' then select exists(select 1 from public.comments c join public.pets p on p.id=c.pet_id where c.id=p_target_id and p.owner_id<>auth.uid()) into v_exists;
  elsif p_target_type='message' then
    select exists(
      select 1 from public.messages msg
      join public.conversations c on c.id=msg.conversation_id
      join public.pet_matches m on m.id=c.match_id
      where msg.id=p_target_id and msg.sender_pet_id<>p_reporter_pet_id and p_reporter_pet_id in(m.pet_low_id,m.pet_high_id)
    ) into v_exists;
  elsif p_target_type='story' then select exists(select 1 from public.stories s join public.pets p on p.id=s.pet_id where s.id=p_target_id and p.owner_id<>auth.uid()) into v_exists;
  elsif p_target_type='event' then select exists(select 1 from public.pet_events e join public.pets p on p.id=e.creator_pet_id where e.id=p_target_id and p.owner_id<>auth.uid()) into v_exists;
  elsif p_target_type='meetup' then
    select exists(
      select 1 from public.meetup_requests r
      join public.pet_matches m on m.id=r.match_id
      where r.id=p_target_id and p_reporter_pet_id in(m.pet_low_id,m.pet_high_id) and r.proposed_by_pet_id<>p_reporter_pet_id
    ) into v_exists;
  end if;
  if not v_exists then raise exception 'invalid_target'; end if;

  select id into v_id
  from public.reports
  where reporter_user_id=auth.uid()
    and reporter_pet_id=p_reporter_pet_id
    and target_type=p_target_type
    and target_id=p_target_id
    and reason=v_reason
    and details is not distinct from v_details
    and status in ('open','reviewing')
  order by created_at desc,id desc limit 1;
  if v_id is not null then return v_id; end if;

  perform public.rate_limit('report',20,86400);
  insert into public.reports(reporter_user_id,reporter_pet_id,target_type,target_id,reason,details)
  values(auth.uid(),p_reporter_pet_id,p_target_type,p_target_id,v_reason,v_details) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.report_content(uuid,text,uuid,text,text) from public,anon;
grant execute on function public.report_content(uuid,text,uuid,text,text) to authenticated;

create or replace function public.submit_moderation_appeal(p_decision_id uuid,p_statement text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_decision public.moderation_decisions; v_role text; v_appeal public.moderation_appeals; v_statement text:=trim(coalesce(p_statement,''));
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not public.current_session_satisfies_mfa_if_enrolled() then raise exception 'mfa_required'; end if;
  if char_length(v_statement) not between 3 and 4000 then raise exception 'invalid_appeal_statement'; end if;
  select * into v_decision from public.moderation_decisions where id=p_decision_id;
  if v_decision.id is null then raise exception 'decision_not_found'; end if;
  if v_decision.affected_user_id=auth.uid() then v_role:='content_owner';
  elsif v_decision.reporter_user_id=auth.uid() then v_role:='reporter';
  else raise exception 'forbidden'; end if;
  if now()>v_decision.decided_at+interval '6 months' then raise exception 'appeal_window_closed'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('moderation_appeal:'||p_decision_id::text||':'||auth.uid()::text,0));
  select * into v_appeal from public.moderation_appeals where decision_id=p_decision_id and appellant_user_id=auth.uid() for update;
  if v_appeal.id is not null then
    if v_appeal.statement<>v_statement then raise exception 'appeal_already_submitted'; end if;
    return jsonb_build_object('id',v_appeal.id,'decisionId',p_decision_id,'status',v_appeal.status,'submittedAt',v_appeal.submitted_at);
  end if;

  perform public.rate_limit('moderation_appeal',10,86400);
  insert into public.moderation_appeals(decision_id,appellant_user_id,appellant_role,statement)
  values(p_decision_id,auth.uid(),v_role,v_statement) returning * into v_appeal;
  insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'moderation_appeal_submitted','moderation_decision',p_decision_id,jsonb_build_object('appealId',v_appeal.id,'role',v_role));
  return jsonb_build_object('id',v_appeal.id,'decisionId',p_decision_id,'status',v_appeal.status,'submittedAt',v_appeal.submitted_at);
end $$;
revoke all on function public.submit_moderation_appeal(uuid,text) from public,anon;
grant execute on function public.submit_moderation_appeal(uuid,text) to authenticated;

create or replace function public.respond_meetup_request(p_request_id uuid,p_pet_id uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $$
declare r public.meetup_requests; m public.pet_matches; v_match_id uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_status not in ('accepted','declined','cancelled') then raise exception 'invalid_status'; end if;
  select match_id into v_match_id from public.meetup_requests where id=p_request_id;
  if v_match_id is null then raise exception 'not_found'; end if;
  select * into m from public.pet_matches where id=v_match_id and unmatched_at is null for share;
  if m.id is null or p_pet_id not in(m.pet_low_id,m.pet_high_id) or public.is_blocked(m.pet_low_id,m.pet_high_id) then raise exception 'not_found'; end if;
  if exists(select 1 from public.pets p join public.users u on u.id=p.owner_id where p.id in(m.pet_low_id,m.pet_high_id) and (u.suspended_at is not null or u.paused_at is not null)) then raise exception 'participant_unavailable'; end if;
  select * into r from public.meetup_requests where id=p_request_id and match_id=v_match_id for update;
  if r.id is null then raise exception 'not_found'; end if;
  if p_status='cancelled' and r.proposed_by_pet_id<>p_pet_id then raise exception 'forbidden'; end if;
  if p_status in ('accepted','declined') then
    if r.proposed_by_pet_id=p_pet_id then raise exception 'other_pet_must_respond'; end if;
    if r.moderation_status<>'approved' then raise exception 'meetup_not_approved'; end if;
  end if;
  if r.status=p_status then return; end if;
  if r.status<>'pending' then raise exception 'request_not_pending'; end if;
  perform public.rate_limit('meetup_response',40,3600);
  update public.meetup_requests set status=p_status where id=p_request_id;
end $$;
revoke all on function public.respond_meetup_request(uuid,uuid,text) from public,anon;
grant execute on function public.respond_meetup_request(uuid,uuid,text) to authenticated;

create or replace function public.resolve_lost_pet_alert(p_alert_id uuid,p_pet_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_alert public.lost_pet_alerts;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select * into v_alert from public.lost_pet_alerts
  where id=p_alert_id and pet_id=p_pet_id and owner_user_id=auth.uid() for update;
  if v_alert.id is null then raise exception 'active_alert_not_found'; end if;
  if v_alert.status='resolved' then return; end if;
  if v_alert.status<>'active' then raise exception 'active_alert_not_found'; end if;
  update public.lost_pet_alerts set status='resolved',resolved_at=now() where id=p_alert_id;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id)
  values(auth.uid(),p_pet_id,'lost_pet_alert_resolved','lost_pet_alert',p_alert_id);
end $$;
revoke all on function public.resolve_lost_pet_alert(uuid,uuid) from public,anon;
grant execute on function public.resolve_lost_pet_alert(uuid,uuid) to authenticated;

create or replace function public.activate_pet_boost(p_pet_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_tier public.account_tier; v_source text; v_id uuid; v_ends timestamptz; v_existing public.pet_boosts;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.pets where id=p_pet_id and species='dog') then raise exception 'boost_discovery_dogs_only'; end if;
  select tier into v_tier from public.users where id=auth.uid() for update;
  if not found then raise exception 'forbidden'; end if;

  select * into v_existing from public.pet_boosts
  where pet_id=p_pet_id and user_id=auth.uid() and ends_at>now()
  order by starts_at desc,id desc limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('id',v_existing.id,'source',v_existing.source,'endsAt',v_existing.ends_at);
  end if;

  perform public.rate_limit('activate_boost',10,86400);
  if v_tier='premium' and not exists(
    select 1 from public.pet_boosts where user_id=auth.uid() and source='premium_weekly' and starts_at>=date_trunc('week',now())
  ) then
    v_source:='premium_weekly';
  else
    update public.consumable_balances set boost_credits=boost_credits-1,updated_at=now()
      where user_id=auth.uid() and boost_credits>0;
    if not found then raise exception 'boost_credit_required'; end if;
    v_source:='consumable_credit';
  end if;
  v_ends:=now()+interval '30 minutes';
  insert into public.pet_boosts(pet_id,user_id,source,ends_at) values(p_pet_id,auth.uid(),v_source,v_ends) returning id into v_id;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id)
  values(auth.uid(),p_pet_id,'pet_boost_activated','pet_boost',v_id);
  return jsonb_build_object('id',v_id,'source',v_source,'endsAt',v_ends);
end $$;
revoke all on function public.activate_pet_boost(uuid) from public,anon;
grant execute on function public.activate_pet_boost(uuid) to authenticated;

create or replace function public.submit_pet_verification(p_pet_id uuid,p_storage_path text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_path text:=coalesce(p_storage_path,'');
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  -- Serialize with identity/photo changes and retry reconciliation.
  perform 1 from public.pets where id=p_pet_id for update;
  select id into v_id from public.pet_verification_requests
  where pet_id=p_pet_id and owner_id=auth.uid() and storage_path=v_path
  order by created_at desc,id desc limit 1;
  if v_id is not null then return v_id; end if;

  perform public.rate_limit('pet_verification',5,86400);
  perform public.consume_upload_intent(p_pet_id,'pet-verification','pet_verification',v_path);
  perform public.cancel_pending_pet_verification(p_pet_id,'superseded_by_new_request');
  insert into public.pet_verification_requests(pet_id,owner_id,storage_path,status)
  values(p_pet_id,auth.uid(),v_path,'pending') returning id into v_id;
  update public.pets set profile_verified=false where id=p_pet_id;
  return v_id;
end $$;
revoke all on function public.submit_pet_verification(uuid,text) from public,anon;
grant execute on function public.submit_pet_verification(uuid,text) to authenticated;
