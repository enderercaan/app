-- M/E scale hardening for time-ordered social surfaces. These page RPCs preserve the
-- existing visibility rules while bounding signed-media hydration and event aggregation work.
create index if not exists idx_stories_active_page
  on public.stories(created_at desc,id desc)
  where moderation_status='approved';
create index if not exists idx_events_upcoming_page
  on public.pet_events(starts_at,id)
  where moderation_status='approved';

create or replace function public.get_active_stories_page(
  p_pet_id uuid,
  p_limit integer default 40,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'petId',s.pet_id,'petName',p.name,
    'avatarUrl',(select ph.storage_path from public.pet_photos ph where ph.pet_id=p.id and ph.sort_order=1 and ph.moderation_status='approved'),
    'mediaUrl',s.storage_path,'createdAt',s.created_at,'expiresAt',s.expires_at,
    'seen',exists(select 1 from public.story_views v where v.story_id=s.id and v.viewer_pet_id=p_pet_id)
  ) order by s.created_at desc,s.id desc),'[]'::jsonb)
  from (
    select s.*
    from public.stories s
    join public.pets p on p.id=s.pet_id
    join public.users u on u.id=p.owner_id
    where public.owns_pet(p_pet_id)
      and s.expires_at>now()
      and s.moderation_status='approved'
      and p.moderation_status='approved'
      and u.suspended_at is null and u.paused_at is null
      and not public.is_blocked(p_pet_id,s.pet_id)
      and (s.pet_id=p_pet_id or exists(select 1 from public.follows f where f.from_pet_id=p_pet_id and f.to_pet_id=s.pet_id))
      and (p_before_created_at is null or (s.created_at,s.id)<(p_before_created_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by s.created_at desc,s.id desc
    limit least(greatest(p_limit,1),80)
  ) s
  join public.pets p on p.id=s.pet_id;
$$;
revoke all on function public.get_active_stories_page(uuid,integer,timestamptz,uuid) from public,anon;
grant execute on function public.get_active_stories_page(uuid,integer,timestamptz,uuid) to authenticated;

create or replace function public.get_pet_events_page(
  p_pet_id uuid,
  p_limit integer default 30,
  p_after_starts_at timestamptz default null,
  p_after_id uuid default null
)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'creatorPetId',e.creator_pet_id,'title',e.title,'description',e.description,
    'city',e.city,'district',e.district,'neighborhood',e.neighborhood,'startsAt',e.starts_at,'endsAt',e.ends_at,'capacity',e.capacity,
    'attendeeCount',(select count(*) from public.event_attendees a where a.event_id=e.id),
    'myStatus',(select a.status from public.event_attendees a where a.event_id=e.id and a.pet_id=p_pet_id)
  ) order by e.starts_at,e.id),'[]'::jsonb)
  from (
    select e.*
    from public.pet_events e
    join public.pets creator on creator.id=e.creator_pet_id
    join public.users u on u.id=creator.owner_id
    where public.owns_pet(p_pet_id)
      and e.moderation_status='approved'
      and e.starts_at>now()
      and creator.moderation_status='approved'
      and u.suspended_at is null and u.paused_at is null
      and not public.is_blocked(p_pet_id,e.creator_pet_id)
      and (p_after_starts_at is null or (e.starts_at,e.id)>(p_after_starts_at,coalesce(p_after_id,'00000000-0000-0000-0000-000000000000'::uuid)))
    order by e.starts_at,e.id
    limit least(greatest(p_limit,1),50)
  ) e;
$$;
revoke all on function public.get_pet_events_page(uuid,integer,timestamptz,uuid) from public,anon;
grant execute on function public.get_pet_events_page(uuid,integer,timestamptz,uuid) to authenticated;

-- Trust & Safety hardening: meetup UGC must be moderated/reportable, and pet prompt keys are server-whitelisted.
-- Existing meetup rows predate this moderation layer, so they are backfilled as approved; new rows default to pending.
alter table public.meetup_requests add column if not exists moderation_status public.moderation_state not null default 'approved';
alter table public.meetup_requests add column if not exists moderation_reason text;
alter table public.meetup_requests alter column moderation_status set default 'pending';

alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('pet','post','comment','message','story','event','meetup')) not valid;
alter table public.reports validate constraint reports_target_type_check;

alter table public.moderation_items drop constraint if exists moderation_items_target_type_check;
alter table public.moderation_items add constraint moderation_items_target_type_check
  check (target_type in ('pet_photo','post_media','story','pet_text','post_text','comment_text','event_text','meetup_text','health_document')) not valid;
alter table public.moderation_items validate constraint moderation_items_target_type_check;

create index if not exists idx_meetup_requests_moderation_pending
  on public.meetup_requests(moderation_status,created_at) where moderation_status='pending';

create or replace function public.upsert_pet_prompts(p_pet_id uuid,p_prompts jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_item jsonb; v_order int:=0; v_answer text; v_key text;
  -- Stable language-independent keys are canonical. The legacy Turkish labels remain
  -- temporarily accepted so older installed clients can save existing prompt answers safely.
  v_allowed constant text[]:=array[
    'favoriteGame','firstMeet','happyThing','atPark','likeInPets','threeWords',
    'En sevdiğim oyun','İlk tanışmada ben','Beni mutlu eden şey',
    'Parkta beni bulursan','Diğer petlerde sevdiğim şey','Beni en iyi anlatan üç kelime'
  ];
  v_seen text[]:='{}';
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('pet_prompts',30,3600);
  if jsonb_typeof(coalesce(p_prompts,'[]'::jsonb)) <> 'array' then raise exception 'invalid_prompts'; end if;
  if jsonb_array_length(coalesce(p_prompts,'[]'::jsonb)) > 3 then raise exception 'too_many_prompts'; end if;

  -- Validate the complete payload before deleting existing prompts, so malformed input cannot erase good data.
  for v_item in select * from jsonb_array_elements(coalesce(p_prompts,'[]'::jsonb)) loop
    if jsonb_typeof(v_item)<>'object' then raise exception 'invalid_prompt'; end if;
    v_key:=trim(coalesce(v_item->>'promptKey',''));
    v_answer:=trim(coalesce(v_item->>'answer',''));
    if v_answer='' then continue; end if;
    if not (v_key=any(v_allowed)) then raise exception 'invalid_prompt_key'; end if;
    if v_key=any(v_seen) then raise exception 'duplicate_prompt_key'; end if;
    if char_length(v_answer)>240 then raise exception 'prompt_answer_too_long'; end if;
    v_seen:=array_append(v_seen,v_key);
  end loop;

  delete from public.pet_prompts where pet_id=p_pet_id;
  for v_item in select * from jsonb_array_elements(coalesce(p_prompts,'[]'::jsonb)) loop
    v_key:=trim(coalesce(v_item->>'promptKey',''));
    v_answer:=trim(coalesce(v_item->>'answer',''));
    if v_answer<>'' then
      v_order:=v_order+1;
      insert into public.pet_prompts(pet_id,prompt_key,answer,sort_order)
      values(p_pet_id,v_key,v_answer,v_order);
    end if;
  end loop;
  update public.pets set moderation_status='pending',updated_at=now() where id=p_pet_id;
  insert into public.moderation_items(target_type,target_id,status) values('pet_text',p_pet_id,'pending')
  on conflict(target_type,target_id) do update set status='pending',reason=null,reviewed_at=null;
end $$;
revoke all on function public.upsert_pet_prompts(uuid,jsonb) from public,anon;
grant execute on function public.upsert_pet_prompts(uuid,jsonb) to authenticated;

create or replace function public.create_meetup_request(
  p_match_id uuid,p_proposed_by_pet_id uuid,p_starts_at timestamptz,p_public_place_label text,p_note text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_match public.pet_matches; v_place text:=trim(coalesce(p_public_place_label,'')); v_note text:=trim(coalesce(p_note,''));
begin
  if not public.owns_pet(p_proposed_by_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('meetup_request',10,86400);
  if p_starts_at<=now() then raise exception 'future_time_required'; end if;
  if char_length(v_place) not between 2 and 160 then raise exception 'invalid_place_label'; end if;
  if char_length(v_note)>500 then raise exception 'invalid_note'; end if;

  select * into v_match
  from public.pet_matches
  where id=p_match_id and unmatched_at is null
  for share;
  if v_match.id is null or p_proposed_by_pet_id not in(v_match.pet_low_id,v_match.pet_high_id)
     or public.is_blocked(v_match.pet_low_id,v_match.pet_high_id) then
    raise exception 'active_match_required';
  end if;

  insert into public.meetup_requests(match_id,proposed_by_pet_id,starts_at,public_place_label,note,moderation_status)
  values(p_match_id,p_proposed_by_pet_id,p_starts_at,v_place,nullif(v_note,''),'pending')
  returning id into v_id;
  insert into public.moderation_items(target_type,target_id,status)
  values('meetup_text',v_id,'pending')
  on conflict(target_type,target_id) do update set status='pending',reason=null,reviewed_at=null;
  return v_id;
end $$;
revoke all on function public.create_meetup_request(uuid,uuid,timestamptz,text,text) from public,anon;
grant execute on function public.create_meetup_request(uuid,uuid,timestamptz,text,text) to authenticated;

create or replace function public.get_meetup_requests(p_pet_id uuid,p_match_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.owns_pet(p_pet_id) then coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'matchId',r.match_id,'proposedByPetId',r.proposed_by_pet_id,'startsAt',r.starts_at,
    'publicPlaceLabel',r.public_place_label,'note',r.note,'status',r.status,'createdAt',r.created_at
  ) order by r.created_at desc),'[]'::jsonb) else null end
  from public.meetup_requests r
  join public.pet_matches m on m.id=r.match_id
  where (m.pet_low_id=p_pet_id or m.pet_high_id=p_pet_id)
    and m.unmatched_at is null
    and not public.is_blocked(m.pet_low_id,m.pet_high_id)
    and (p_match_id is null or r.match_id=p_match_id)
    and r.moderation_status<>'rejected'
    and (r.proposed_by_pet_id=p_pet_id or r.moderation_status='approved');
$$;
revoke all on function public.get_meetup_requests(uuid,uuid) from public,anon;
grant execute on function public.get_meetup_requests(uuid,uuid) to authenticated;

create or replace function public.respond_meetup_request(p_request_id uuid,p_pet_id uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $$
declare r public.meetup_requests; m public.pet_matches; v_match_id uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_status not in ('accepted','declined','cancelled') then raise exception 'invalid_status'; end if;
  perform public.rate_limit('meetup_response',40,3600);
  select match_id into v_match_id from public.meetup_requests where id=p_request_id;
  if v_match_id is null then raise exception 'not_found'; end if;
  select * into m from public.pet_matches where id=v_match_id and unmatched_at is null for share;
  if m.id is null or p_pet_id not in(m.pet_low_id,m.pet_high_id) or public.is_blocked(m.pet_low_id,m.pet_high_id) then raise exception 'not_found'; end if;
  if exists(select 1 from public.pets p join public.users u on u.id=p.owner_id where p.id in(m.pet_low_id,m.pet_high_id) and (u.suspended_at is not null or u.paused_at is not null)) then raise exception 'participant_unavailable'; end if;
  select * into r from public.meetup_requests where id=p_request_id and match_id=v_match_id for update;
  if r.id is null or r.status<>'pending' then raise exception 'request_not_pending'; end if;
  if p_status='cancelled' and r.proposed_by_pet_id<>p_pet_id then raise exception 'forbidden'; end if;
  if p_status in ('accepted','declined') then
    if r.proposed_by_pet_id=p_pet_id then raise exception 'other_pet_must_respond'; end if;
    if r.moderation_status<>'approved' then raise exception 'meetup_not_approved'; end if;
  end if;
  update public.meetup_requests set status=p_status where id=p_request_id;
end $$;
revoke all on function public.respond_meetup_request(uuid,uuid,text) from public,anon;
grant execute on function public.respond_meetup_request(uuid,uuid,text) to authenticated;

create or replace function public.report_content(p_reporter_pet_id uuid,p_target_type text,p_target_id uuid,p_reason text,p_details text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_exists boolean:=false; v_reason text:=trim(coalesce(p_reason,''));
begin
  if not public.owns_pet(p_reporter_pet_id) then raise exception 'forbidden'; end if;
  if p_target_type not in ('pet','post','comment','message','story','event','meetup') then raise exception 'invalid_target_type'; end if;
  if char_length(v_reason) not between 1 and 100 then raise exception 'invalid_reason'; end if;
  if char_length(coalesce(p_details,''))>2000 then raise exception 'invalid_details'; end if;
  perform public.rate_limit('report',20,86400);
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
  insert into public.reports(reporter_user_id,reporter_pet_id,target_type,target_id,reason,details)
  values(auth.uid(),p_reporter_pet_id,p_target_type,p_target_id,v_reason,nullif(trim(coalesce(p_details,'')),'')) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.report_content(uuid,text,uuid,text,text) from public,anon;
grant execute on function public.report_content(uuid,text,uuid,text,text) to authenticated;

