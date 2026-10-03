-- Complete pet-profile deletion flow. Queue detached private media before cascading relational deletion,
-- and remove polymorphic moderation queue rows that do not have foreign keys.
create or replace function public.delete_pet_profile(p_pet_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('pet_delete',5,86400);
  perform 1 from public.pets where id=p_pet_id and owner_id=auth.uid() for update;
  if not found then raise exception 'pet_not_found'; end if;

  -- Objects that are not covered by storage-detach triggers must be queued explicitly.
  insert into public.storage_gc_queue(bucket,storage_path,queued_at,not_before,attempts,last_error)
  select 'pet-verification',r.storage_path,now(),now(),0,null
  from public.pet_verification_requests r where r.pet_id=p_pet_id
  on conflict(bucket,storage_path) do update
    set queued_at=excluded.queued_at,not_before=least(public.storage_gc_queue.not_before,excluded.not_before),attempts=0,last_error=null;

  insert into public.storage_gc_queue(bucket,storage_path,queued_at,not_before,attempts,last_error)
  select i.bucket,i.storage_path,now(),now(),0,null
  from public.upload_intents i where i.pet_id=p_pet_id
  on conflict(bucket,storage_path) do update
    set queued_at=excluded.queued_at,not_before=least(public.storage_gc_queue.not_before,excluded.not_before),attempts=0,last_error=null;

  -- Polymorphic moderation rows would otherwise become orphaned after cascades.
  delete from public.moderation_items mi
  where (mi.target_type='pet_text' and mi.target_id=p_pet_id)
     or (mi.target_type='pet_photo' and exists(select 1 from public.pet_photos ph where ph.id=mi.target_id and ph.pet_id=p_pet_id))
     or (mi.target_type='health_document' and exists(select 1 from public.health_documents hd where hd.id=mi.target_id and hd.pet_id=p_pet_id))
     or (mi.target_type='post_text' and exists(select 1 from public.posts po where po.id=mi.target_id and po.pet_id=p_pet_id))
     or (mi.target_type='post_media' and exists(select 1 from public.post_media pm join public.posts po on po.id=pm.post_id where pm.id=mi.target_id and po.pet_id=p_pet_id))
     or (mi.target_type='comment_text' and exists(select 1 from public.comments c where c.id=mi.target_id and c.pet_id=p_pet_id))
     or (mi.target_type='story' and exists(select 1 from public.stories s where s.id=mi.target_id and s.pet_id=p_pet_id))
     or (mi.target_type='event_text' and exists(select 1 from public.pet_events e where e.id=mi.target_id and e.creator_pet_id=p_pet_id));

  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id)
  values(auth.uid(),p_pet_id,'pet_profile_deleted','pet',p_pet_id);

  delete from public.pets where id=p_pet_id and owner_id=auth.uid();
  if not found then raise exception 'pet_not_found'; end if;
end $$;
revoke all on function public.delete_pet_profile(uuid) from public,anon;
grant execute on function public.delete_pet_profile(uuid) to authenticated;

-- Admin/service operations that must not partially succeed are executed atomically inside Postgres.
create or replace function public.apply_owner_verification_result(p_request_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session public.owner_verification_sessions; v_now timestamptz:=now();
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_status not in ('verified','failed','expired','cancelled') then raise exception 'invalid_status'; end if;
  select * into v_session from public.owner_verification_sessions where id=p_request_id for update;
  if v_session.id is null then raise exception 'verification_session_not_found'; end if;

  if v_session.status<>'pending' then
    return jsonb_build_object('ok',true,'idempotent',v_session.status=p_status,'stale',v_session.status<>p_status,'status',v_session.status);
  end if;

  update public.owner_verification_sessions set status=p_status,updated_at=v_now where id=p_request_id;
  if p_status='verified' then
    update public.users set identity_verified=true,identity_verified_at=v_now where id=v_session.user_id;
    if not found then raise exception 'verification_user_not_found'; end if;
    insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
    values(v_session.user_id,'owner_identity_verified','user',v_session.user_id,jsonb_build_object('requestId',p_request_id));
  end if;
  return jsonb_build_object('ok',true,'idempotent',false,'stale',false,'status',p_status);
end $$;
revoke all on function public.apply_owner_verification_result(uuid,text) from public,anon,authenticated;
grant execute on function public.apply_owner_verification_result(uuid,text) to service_role;

create or replace function public.admin_update_report_status(p_report_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_report public.reports;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_status not in ('reviewing','resolved','dismissed') then raise exception 'invalid_status'; end if;
  update public.reports set status=p_status where id=p_report_id returning * into v_report;
  if v_report.id is null then raise exception 'report_not_found'; end if;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id,metadata)
  values(null,null,'report_status_update','report',p_report_id,jsonb_build_object('status',p_status));
  return jsonb_build_object('id',v_report.id,'status',v_report.status);
end $$;
revoke all on function public.admin_update_report_status(uuid,text) from public,anon,authenticated;
grant execute on function public.admin_update_report_status(uuid,text) to service_role;

-- Owned-content deletion must be explicit, auditable, and storage-clean.
create or replace function public.delete_owned_content(p_pet_id uuid,p_target_type text,p_target_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_exists boolean:=false;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_target_type not in ('post','comment','story','event') then raise exception 'invalid_target_type'; end if;
  perform public.rate_limit('content_delete',60,86400);

  if p_target_type='post' then
    select exists(select 1 from public.posts where id=p_target_id and pet_id=p_pet_id and deleted_at is null) into v_exists;
    if not v_exists then raise exception 'content_not_found'; end if;
    delete from public.moderation_items mi
    where (mi.target_type='post_text' and mi.target_id=p_target_id)
       or (mi.target_type='post_media' and exists(select 1 from public.post_media pm where pm.id=mi.target_id and pm.post_id=p_target_id));
    -- Deleting media rows triggers delayed private Storage GC.
    delete from public.post_media where post_id=p_target_id;
    update public.posts set deleted_at=now(),updated_at=now() where id=p_target_id and pet_id=p_pet_id and deleted_at is null;
  elsif p_target_type='comment' then
    update public.comments set deleted_at=now() where id=p_target_id and pet_id=p_pet_id and deleted_at is null;
    if not found then raise exception 'content_not_found'; end if;
    delete from public.moderation_items where target_type='comment_text' and target_id=p_target_id;
    v_exists:=true;
  elsif p_target_type='story' then
    delete from public.moderation_items where target_type='story' and target_id=p_target_id;
    delete from public.stories where id=p_target_id and pet_id=p_pet_id;
    if not found then raise exception 'content_not_found'; end if;
    v_exists:=true;
  elsif p_target_type='event' then
    delete from public.moderation_items where target_type='event_text' and target_id=p_target_id;
    delete from public.pet_events where id=p_target_id and creator_pet_id=p_pet_id;
    if not found then raise exception 'content_not_found'; end if;
    v_exists:=true;
  end if;

  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id)
  values(auth.uid(),p_pet_id,'owned_content_deleted',p_target_type,p_target_id);
end $$;
revoke all on function public.delete_owned_content(uuid,text,uuid) from public,anon;
grant execute on function public.delete_owned_content(uuid,text,uuid) to authenticated;

-- Health records reject invalid or silently-truncated data and respect the pet's birth date.
create or replace function public.upsert_vaccination(p_pet_id uuid,p_vaccination_id uuid,p_vaccine_name text,p_dose_date date,p_next_due_date date)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid:=p_vaccination_id; v_name text:=trim(coalesce(p_vaccine_name,'')); v_birth_date date;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('vaccination_write',30,3600);
  if char_length(v_name) not between 2 and 120 then raise exception 'invalid_vaccine_name'; end if;
  select birth_date into v_birth_date from public.pets where id=p_pet_id;
  if p_dose_date is not null and p_dose_date>current_date then raise exception 'dose_date_in_future'; end if;
  if p_dose_date is not null and v_birth_date is not null and p_dose_date<v_birth_date then raise exception 'dose_date_before_birth'; end if;
  if p_next_due_date is not null and p_dose_date is not null and p_next_due_date<p_dose_date then raise exception 'invalid_due_date'; end if;
  if v_id is null then
    insert into public.pet_vaccinations(pet_id,vaccine_name,dose_date,next_due_date,verification_status)
    values(p_pet_id,v_name,p_dose_date,p_next_due_date,'pending') returning id into v_id;
  else
    update public.pet_vaccinations set vaccine_name=v_name,dose_date=p_dose_date,next_due_date=p_next_due_date,
      verification_status='pending',verification_source=null,updated_at=now()
    where id=v_id and pet_id=p_pet_id;
    if not found then raise exception 'vaccination_not_found'; end if;
  end if;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id)
  values(auth.uid(),p_pet_id,'vaccination_upsert','vaccination',v_id);
  return v_id;
end $$;
revoke all on function public.upsert_vaccination(uuid,uuid,text,date,date) from public,anon;
grant execute on function public.upsert_vaccination(uuid,uuid,text,date,date) to authenticated;

create or replace function public.delete_vaccination(p_pet_id uuid,p_vaccination_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('vaccination_delete',30,3600);
  delete from public.pet_vaccinations where id=p_vaccination_id and pet_id=p_pet_id;
  if not found then raise exception 'vaccination_not_found'; end if;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id)
  values(auth.uid(),p_pet_id,'vaccination_deleted','vaccination',p_vaccination_id);
end $$;
revoke all on function public.delete_vaccination(uuid,uuid) from public,anon;
grant execute on function public.delete_vaccination(uuid,uuid) to authenticated;

-- Event creation validates complete payloads instead of relying on truncation or downstream constraints.
create or replace function public.create_pet_event(
  p_pet_id uuid,p_title text,p_description text,p_city text,p_district text,p_neighborhood text,
  p_starts_at timestamptz,p_ends_at timestamptz default null,p_capacity integer default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_id uuid; v_title text:=trim(coalesce(p_title,'')); v_description text:=coalesce(p_description,'');
  v_city text:=trim(coalesce(p_city,'')); v_district text:=trim(coalesce(p_district,'')); v_neighborhood text:=trim(coalesce(p_neighborhood,''));
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('create_event',10,86400);
  if char_length(v_title) not between 3 and 120 then raise exception 'invalid_event_title'; end if;
  if char_length(v_description)>1500 then raise exception 'event_description_too_long'; end if;
  if char_length(v_city) not between 1 and 80 or char_length(v_district) not between 1 and 80 or char_length(v_neighborhood)>80 then raise exception 'invalid_event_location'; end if;
  if p_starts_at<=now() then raise exception 'future_time_required'; end if;
  if p_ends_at is not null and p_ends_at<=p_starts_at then raise exception 'invalid_event_end'; end if;
  if p_capacity is not null and p_capacity not between 2 and 500 then raise exception 'invalid_capacity'; end if;
  insert into public.pet_events(creator_pet_id,title,description,city,district,neighborhood,starts_at,ends_at,capacity,moderation_status)
  values(p_pet_id,v_title,v_description,v_city,v_district,nullif(v_neighborhood,''),p_starts_at,p_ends_at,p_capacity,'pending') returning id into v_id;
  insert into public.moderation_items(target_type,target_id,status) values('event_text',v_id,'pending') on conflict do nothing;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id)
  values(auth.uid(),p_pet_id,'event_created','event',v_id);
  return v_id;
end $$;
revoke all on function public.create_pet_event(uuid,text,text,text,text,text,timestamptz,timestamptz,integer) from public,anon;
grant execute on function public.create_pet_event(uuid,text,text,text,text,text,timestamptz,timestamptz,integer) to authenticated;

create or replace function public.create_meetup_request(
  p_match_id uuid,p_proposed_by_pet_id uuid,p_starts_at timestamptz,p_public_place_label text,p_note text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_match public.pet_matches; v_place text:=trim(coalesce(p_public_place_label,'')); v_note text:=trim(coalesce(p_note,''));
begin
  if not public.owns_pet(p_proposed_by_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('meetup_request',10,86400);
  if p_starts_at<=now() then raise exception 'future_time_required'; end if;
  if char_length(v_place) not between 2 and 160 then raise exception 'invalid_place_label'; end if;
  if char_length(v_note)>500 then raise exception 'meetup_note_too_long'; end if;
  select * into v_match from public.pet_matches where id=p_match_id and unmatched_at is null for share;
  if v_match.id is null or p_proposed_by_pet_id not in(v_match.pet_low_id,v_match.pet_high_id) or public.is_blocked(v_match.pet_low_id,v_match.pet_high_id) then raise exception 'active_match_required'; end if;
  if exists(
    select 1 from public.pets p join public.users u on u.id=p.owner_id
    where p.id in(v_match.pet_low_id,v_match.pet_high_id) and (u.suspended_at is not null or u.paused_at is not null)
  ) then raise exception 'participant_unavailable'; end if;
  insert into public.meetup_requests(match_id,proposed_by_pet_id,starts_at,public_place_label,note)
  values(p_match_id,p_proposed_by_pet_id,p_starts_at,v_place,nullif(v_note,'')) returning id into v_id;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id)
  values(auth.uid(),p_proposed_by_pet_id,'meetup_requested','meetup_request',v_id);
  return v_id;
end $$;
revoke all on function public.create_meetup_request(uuid,uuid,timestamptz,text,text) from public,anon;
grant execute on function public.create_meetup_request(uuid,uuid,timestamptz,text,text) to authenticated;

-- Server-side workers that authenticate a user but run with service-role need an explicit-user rate limiter.
create or replace function public.service_rate_limit_user(p_user_id uuid,p_action text,p_limit integer,p_window_seconds integer)
returns void language plpgsql security definer set search_path='' as $$
declare v_window timestamptz; v_count integer;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_user_id is null or char_length(trim(coalesce(p_action,''))) not between 1 and 80 or p_limit<1 or p_limit>10000 or p_window_seconds<1 or p_window_seconds>604800 then
    raise exception 'invalid_rate_limit';
  end if;
  v_window:=to_timestamp(floor(extract(epoch from now())/p_window_seconds)*p_window_seconds);
  insert into public.rate_limits(user_id,action,window_start,count) values(p_user_id,p_action,v_window,1)
  on conflict(user_id,action,window_start) do update set count=public.rate_limits.count+1 returning count into v_count;
  if coalesce(v_count,1)>p_limit then raise exception 'rate_limit_exceeded'; end if;
end $$;
revoke all on function public.service_rate_limit_user(uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.service_rate_limit_user(uuid,text,integer,integer) to service_role;

