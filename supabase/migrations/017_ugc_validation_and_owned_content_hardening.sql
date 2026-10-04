-- Correctness hardening: reject oversized content instead of silently truncating, and keep event/feedback analytics consistent.
alter table public.pet_events drop constraint if exists pet_events_city_length_check;
alter table public.pet_events add constraint pet_events_city_length_check check (char_length(trim(city)) between 1 and 80) not valid;
alter table public.pet_events validate constraint pet_events_city_length_check;
alter table public.pet_events drop constraint if exists pet_events_district_length_check;
alter table public.pet_events add constraint pet_events_district_length_check check (char_length(trim(district)) between 1 and 80) not valid;
alter table public.pet_events validate constraint pet_events_district_length_check;
alter table public.pet_events drop constraint if exists pet_events_neighborhood_length_check;
alter table public.pet_events add constraint pet_events_neighborhood_length_check check (neighborhood is null or char_length(trim(neighborhood)) between 1 and 80) not valid;
alter table public.pet_events validate constraint pet_events_neighborhood_length_check;

create or replace function public.create_post(p_pet_id uuid,p_caption text,p_media_paths text[] default '{}')
returns uuid language plpgsql security definer set search_path='' as $$
declare v_post uuid; v_path text; v_i int:=0; v_media_id uuid; v_caption text:=trim(coalesce(p_caption,''));
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('create_post',20,86400);
  if char_length(v_caption)>2200 then raise exception 'caption_too_long'; end if;
  if coalesce(array_length(p_media_paths,1),0)>5 then raise exception 'too_many_media'; end if;
  if v_caption='' and coalesce(array_length(p_media_paths,1),0)=0 then raise exception 'empty_post'; end if;
  foreach v_path in array coalesce(p_media_paths,'{}') loop
    perform public.consume_upload_intent(p_pet_id,'social-media','post_media',v_path);
  end loop;
  insert into public.posts(pet_id,caption,moderation_status) values(p_pet_id,v_caption,'pending') returning id into v_post;
  foreach v_path in array coalesce(p_media_paths,'{}') loop
    v_i:=v_i+1;
    insert into public.post_media(post_id,storage_path,sort_order,moderation_status) values(v_post,v_path,v_i,'pending') returning id into v_media_id;
    insert into public.moderation_items(target_type,target_id,status) values('post_media',v_media_id,'pending') on conflict do nothing;
  end loop;
  insert into public.moderation_items(target_type,target_id,status) values('post_text',v_post,'pending') on conflict do nothing;
  return v_post;
end $$;
revoke all on function public.create_post(uuid,text,text[]) from public,anon;
grant execute on function public.create_post(uuid,text,text[]) to authenticated;

create or replace function public.create_comment(p_pet_id uuid,p_post_id uuid,p_body text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_owner uuid; v_author_pet uuid; v_body text:=trim(coalesce(p_body,''));
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select po.pet_id,p.owner_id into v_author_pet,v_owner
  from public.posts po join public.pets p on p.id=po.pet_id join public.users au on au.id=p.owner_id
  where po.id=p_post_id and po.deleted_at is null and po.moderation_status='approved' and au.suspended_at is null and au.paused_at is null;
  if v_author_pet is null or public.is_blocked(p_pet_id,v_author_pet) then raise exception 'not_found'; end if;
  if char_length(v_body)=0 then raise exception 'empty_comment'; end if;
  if char_length(v_body)>1000 then raise exception 'comment_too_long'; end if;
  perform public.rate_limit('comment',80,3600);
  insert into public.comments(post_id,pet_id,body,moderation_status) values(p_post_id,p_pet_id,v_body,'pending') returning id into v_id;
  if v_owner<>auth.uid() then insert into public.notifications(user_id,type,title,body,entity_id) values(v_owner,'comment','New comment','A pet commented on your post.',p_post_id); end if;
  insert into public.moderation_items(target_type,target_id,status) values('comment_text',v_id,'pending') on conflict do nothing;
  return v_id;
end $$;
revoke all on function public.create_comment(uuid,uuid,text) from public,anon;
grant execute on function public.create_comment(uuid,uuid,text) to authenticated;

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
  if char_length(v_title) not between 3 and 120 then raise exception 'invalid_title'; end if;
  if char_length(v_description)>1500 then raise exception 'description_too_long'; end if;
  if char_length(v_city) not between 1 and 80 or char_length(v_district) not between 1 and 80 then raise exception 'invalid_location'; end if;
  if char_length(v_neighborhood)>80 then raise exception 'invalid_neighborhood'; end if;
  if p_starts_at<=now() then raise exception 'future_time_required'; end if;
  if p_ends_at is not null and p_ends_at<=p_starts_at then raise exception 'invalid_end_time'; end if;
  if p_capacity is not null and (p_capacity<2 or p_capacity>500) then raise exception 'invalid_capacity'; end if;
  insert into public.pet_events(creator_pet_id,title,description,city,district,neighborhood,starts_at,ends_at,capacity,moderation_status)
  values(p_pet_id,v_title,v_description,v_city,v_district,nullif(v_neighborhood,''),p_starts_at,p_ends_at,p_capacity,'pending') returning id into v_id;
  insert into public.moderation_items(target_type,target_id,status) values('event_text',v_id,'pending') on conflict do nothing;
  return v_id;
end $$;
revoke all on function public.create_pet_event(uuid,text,text,text,text,text,timestamptz,timestamptz,integer) from public,anon;
grant execute on function public.create_pet_event(uuid,text,text,text,text,text,timestamptz,timestamptz,integer) to authenticated;

create or replace function public.submit_meetup_feedback(
  p_request_id uuid,p_reviewer_pet_id uuid,p_met boolean,p_felt_safe boolean default null,
  p_would_meet_again boolean default null,p_issue_category text default null,p_private_note text default null
) returns void language plpgsql security definer set search_path='' as $$
declare v_match uuid; v_issue text:=nullif(trim(coalesce(p_issue_category,'')),''); v_note text:=nullif(trim(coalesce(p_private_note,'')),'');
begin
  if not public.owns_pet(p_reviewer_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('meetup_feedback',20,86400);
  select match_id into v_match from public.meetup_requests
  where id=p_request_id and status='accepted' and moderation_status='approved' and starts_at<now();
  if v_match is null then raise exception 'feedback_not_available'; end if;
  if not exists(select 1 from public.pet_matches m where m.id=v_match and p_reviewer_pet_id in(m.pet_low_id,m.pet_high_id)) then raise exception 'forbidden'; end if;
  if v_note is not null and char_length(v_note)>1000 then raise exception 'feedback_note_too_long'; end if;
  if v_issue is not null and v_issue not in ('safety_concern') then raise exception 'invalid_issue_category'; end if;
  if not p_met then
    p_felt_safe:=null; p_would_meet_again:=null; v_issue:=null;
  elsif p_felt_safe=false and v_issue is null then
    v_issue:='safety_concern';
  end if;
  insert into public.meetup_feedback(meetup_request_id,reviewer_pet_id,met,felt_safe,would_meet_again,issue_category,private_note)
  values(p_request_id,p_reviewer_pet_id,p_met,p_felt_safe,p_would_meet_again,v_issue,v_note)
  on conflict(meetup_request_id,reviewer_pet_id) do update
  set met=excluded.met,felt_safe=excluded.felt_safe,would_meet_again=excluded.would_meet_again,
      issue_category=excluded.issue_category,private_note=excluded.private_note,created_at=now();
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id)
  values(auth.uid(),p_reviewer_pet_id,'meetup_feedback','meetup_request',p_request_id);
end $$;
revoke all on function public.submit_meetup_feedback(uuid,uuid,boolean,boolean,boolean,text,text) from public,anon;
grant execute on function public.submit_meetup_feedback(uuid,uuid,boolean,boolean,boolean,text,text) to authenticated;

-- UGC write boundaries: reject malformed/oversized content instead of silently truncating it.
create or replace function public.create_post(p_pet_id uuid,p_caption text,p_media_paths text[] default '{}')
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_post uuid;
  v_path text;
  v_i integer:=0;
  v_media_id uuid;
  v_caption text:=trim(coalesce(p_caption,''));
  v_paths text[]:=coalesce(p_media_paths,'{}'::text[]);
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('create_post',20,86400);
  if char_length(v_caption)>2200 then raise exception 'caption_too_long'; end if;
  if coalesce(array_length(v_paths,1),0)>5 then raise exception 'too_many_media'; end if;
  if v_caption='' and coalesce(array_length(v_paths,1),0)=0 then raise exception 'empty_post'; end if;
  if exists(select 1 from unnest(v_paths) p where nullif(trim(p),'') is null) then raise exception 'invalid_media_path'; end if;
  if (select count(*) from unnest(v_paths))<>(select count(distinct p) from unnest(v_paths) p) then raise exception 'duplicate_media_path'; end if;

  foreach v_path in array v_paths loop
    perform public.consume_upload_intent(p_pet_id,'social-media','post_media',v_path);
  end loop;

  insert into public.posts(pet_id,caption,moderation_status)
  values(p_pet_id,v_caption,'pending') returning id into v_post;

  foreach v_path in array v_paths loop
    v_i:=v_i+1;
    insert into public.post_media(post_id,storage_path,sort_order,moderation_status)
    values(v_post,v_path,v_i,'pending') returning id into v_media_id;
    insert into public.moderation_items(target_type,target_id,status)
    values('post_media',v_media_id,'pending') on conflict do nothing;
  end loop;
  insert into public.moderation_items(target_type,target_id,status)
  values('post_text',v_post,'pending') on conflict do nothing;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id)
  values(auth.uid(),p_pet_id,'post_created','post',v_post);
  return v_post;
end $$;
revoke all on function public.create_post(uuid,text,text[]) from public,anon;
grant execute on function public.create_post(uuid,text,text[]) to authenticated;

create or replace function public.create_comment(p_pet_id uuid,p_post_id uuid,p_body text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_owner uuid; v_author_pet uuid; v_body text:=trim(coalesce(p_body,''));
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if char_length(v_body) not between 1 and 1000 then raise exception 'invalid_comment_length'; end if;
  select po.pet_id,p.owner_id into v_author_pet,v_owner
  from public.posts po join public.pets p on p.id=po.pet_id join public.users au on au.id=p.owner_id
  where po.id=p_post_id and po.deleted_at is null and po.moderation_status='approved' and au.suspended_at is null and au.paused_at is null;
  if v_author_pet is null or public.is_blocked(p_pet_id,v_author_pet) then raise exception 'not_found'; end if;
  perform public.rate_limit('comment',80,3600);
  insert into public.comments(post_id,pet_id,body,moderation_status)
  values(p_post_id,p_pet_id,v_body,'pending') returning id into v_id;
  if v_owner<>auth.uid() then
    insert into public.notifications(user_id,type,title,body,entity_id)
    values(v_owner,'comment','New comment','A pet commented on your post.',p_post_id);
  end if;
  insert into public.moderation_items(target_type,target_id,status)
  values('comment_text',v_id,'pending') on conflict do nothing;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id)
  values(auth.uid(),p_pet_id,'comment_created','comment',v_id);
  return v_id;
end $$;
revoke all on function public.create_comment(uuid,uuid,text) from public,anon;
grant execute on function public.create_comment(uuid,uuid,text) to authenticated;

create or replace function public.toggle_save_post(p_pet_id uuid,p_post_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_author_pet uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  -- Cleanup remains available if a previously saved author later pauses or is suspended.
  if exists(select 1 from public.saved_posts where post_id=p_post_id and pet_id=p_pet_id) then
    delete from public.saved_posts where post_id=p_post_id and pet_id=p_pet_id;
    return false;
  end if;
  select po.pet_id into v_author_pet
  from public.posts po
  join public.pets author on author.id=po.pet_id
  join public.users au on au.id=author.owner_id
  where po.id=p_post_id and po.deleted_at is null and po.moderation_status='approved'
    and au.suspended_at is null and au.paused_at is null;
  if v_author_pet is null or public.is_blocked(p_pet_id,v_author_pet) then raise exception 'not_found'; end if;
  perform public.rate_limit('post_save',300,86400);
  insert into public.saved_posts(post_id,pet_id) values(p_post_id,p_pet_id);
  return true;
end $$;
revoke all on function public.toggle_save_post(uuid,uuid) from public,anon;
grant execute on function public.toggle_save_post(uuid,uuid) to authenticated;

