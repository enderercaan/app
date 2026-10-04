-- Additional abuse, concurrency and legacy-state reconciliation hardening.

-- Bound abandoned uploads and make file extensions server-derived from the declared MIME type.
-- This reduces storage-cost abuse and prevents extension/MIME mismatches from reaching moderation tooling.
create or replace function public.create_upload_intent(
  p_pet_id uuid,p_bucket text,p_purpose text,p_mime_type text,p_extension text default 'jpg'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_path text; v_ext text; v_allowed boolean:=false; v_active integer;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('upload_intent',40,3600);
  select count(*)::integer into v_active from public.upload_intents
  where user_id=auth.uid() and consumed_at is null and cancelled_at is null and expires_at>now();
  if v_active>=12 then raise exception 'too_many_active_uploads'; end if;

  v_allowed :=
    (p_bucket='pet-photos' and p_purpose in ('pet_photo_1','pet_photo_2','pet_photo_3') and p_mime_type in ('image/jpeg','image/png','image/webp','image/heic','image/heif')) or
    (p_bucket='social-media' and p_purpose in ('post_media','story_media') and p_mime_type in ('image/jpeg','image/png','image/webp','image/heic','image/heif')) or
    (p_bucket='health-documents' and p_purpose='health_document' and p_mime_type in ('application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif')) or
    (p_bucket='pet-verification' and p_purpose='pet_verification' and p_mime_type in ('image/jpeg','image/png','image/webp','image/heic','image/heif'));
  if not v_allowed then raise exception 'invalid_upload_intent'; end if;

  v_ext:=case p_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    when 'image/heic' then 'heic'
    when 'image/heif' then 'heif'
    when 'application/pdf' then 'pdf'
    else 'bin' end;
  v_id:=gen_random_uuid();
  v_path:=p_pet_id::text||'/intents/'||v_id::text||'.'||v_ext;
  insert into public.upload_intents(id,user_id,pet_id,bucket,purpose,storage_path,mime_type)
  values(v_id,auth.uid(),p_pet_id,p_bucket,p_purpose,v_path,p_mime_type);
  return jsonb_build_object('id',v_id,'bucket',p_bucket,'path',v_path,'expiresAt',now()+interval '15 minutes');
end $$;
revoke all on function public.create_upload_intent(uuid,text,text,text,text) from public,anon;
grant execute on function public.create_upload_intent(uuid,text,text,text,text) to authenticated;


-- Push registration is an authenticated write surface and must not allow unbounded rows per account.
create or replace function public.register_push_token(p_token text,p_platform text,p_active_pet_id uuid default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_platform not in ('ios','android') then raise exception 'invalid_platform'; end if;
  if length(trim(coalesce(p_token,'')))<20 or length(p_token)>512 then raise exception 'invalid_push_token'; end if;
  if p_active_pet_id is not null and not public.owns_pet(p_active_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('push_token_register',40,86400);

  insert into public.push_tokens(user_id,token,platform,active_pet_id,enabled)
  values(auth.uid(),trim(p_token),p_platform,p_active_pet_id,true)
  on conflict(token) do update set
    user_id=auth.uid(),platform=excluded.platform,active_pet_id=excluded.active_pet_id,enabled=true,last_seen_at=now();

  -- Retain only the ten most recently seen enabled registrations for this account.
  update public.push_tokens
  set enabled=false
  where user_id=auth.uid() and enabled
    and id not in (
      select id from public.push_tokens
      where user_id=auth.uid() and enabled
      order by last_seen_at desc,id desc
      limit 10
    );
end $$;
revoke all on function public.register_push_token(text,text,uuid) from public,anon;
grant execute on function public.register_push_token(text,text,uuid) to authenticated;

-- Location refresh is private but still a write-amplification surface.
create or replace function public.update_pet_private_location(p_pet_id uuid,p_latitude double precision,p_longitude double precision)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then raise exception 'invalid_coordinates'; end if;
  perform public.rate_limit('private_location_update',120,86400);
  insert into public.pet_private(pet_id,latitude,longitude) values(p_pet_id,p_latitude,p_longitude)
  on conflict(pet_id) do update set latitude=excluded.latitude,longitude=excluded.longitude,updated_at=now();
end $$;
revoke all on function public.update_pet_private_location(uuid,double precision,double precision) from public,anon;
grant execute on function public.update_pet_private_location(uuid,double precision,double precision) to authenticated;

-- A locked meetup request must still be pending when the response is applied. Otherwise two
-- concurrent responses can both return success even though only the first transition happened.
create or replace function public.respond_meetup_request(p_request_id uuid,p_pet_id uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $$
declare r public.meetup_requests; m public.pet_matches;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_status not in ('accepted','declined','cancelled') then raise exception 'invalid_status'; end if;
  perform public.rate_limit('meetup_response',40,3600);
  select * into r from public.meetup_requests where id=p_request_id for update;
  if r.id is null or r.status<>'pending' then raise exception 'request_not_pending'; end if;
  select * into m from public.pet_matches where id=r.match_id and unmatched_at is null;
  if m.id is null or p_pet_id not in(m.pet_low_id,m.pet_high_id) or public.is_blocked(m.pet_low_id,m.pet_high_id) then raise exception 'active_match_required'; end if;
  if p_status='cancelled' and r.proposed_by_pet_id<>p_pet_id then raise exception 'forbidden'; end if;
  if p_status in ('accepted','declined') and r.proposed_by_pet_id=p_pet_id then raise exception 'other_pet_must_respond'; end if;
  update public.meetup_requests set status=p_status where id=p_request_id;
end $$;
revoke all on function public.respond_meetup_request(uuid,uuid,text) from public,anon;
grant execute on function public.respond_meetup_request(uuid,uuid,text) to authenticated;

-- Defence in depth: legacy active matches must never surface through a pre-existing owner-level block.
create or replace function public.get_matches(p_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'conversationId',(select c.id from public.conversations c where c.match_id=m.id),'otherPet',public.pet_json(case when m.pet_low_id=p_pet_id then m.pet_high_id else m.pet_low_id end,p_pet_id),
    'matchedAt',m.matched_at,'commonPurposes',coalesce((select jsonb_agg(a.purpose) from public.pet_purposes a join public.pet_purposes b on a.purpose=b.purpose where a.pet_id=p_pet_id and a.purpose<>'mating' and b.pet_id=case when m.pet_low_id=p_pet_id then m.pet_high_id else m.pet_low_id end),'[]'::jsonb),
    'lastMessage',(select msg.body from public.conversations c join public.messages msg on msg.conversation_id=c.id where c.match_id=m.id order by msg.created_at desc limit 1),
    'lastMessageAt',(select msg.created_at from public.conversations c join public.messages msg on msg.conversation_id=c.id where c.match_id=m.id order by msg.created_at desc limit 1),
    'unreadCount',(select count(*) from public.conversations c join public.messages msg on msg.conversation_id=c.id where c.match_id=m.id and msg.sender_pet_id<>p_pet_id and msg.read_at is null)
  ) order by m.matched_at desc),'[]'::jsonb)
  from public.pet_matches m
  where public.owns_pet(p_pet_id) and m.unmatched_at is null
    and (m.pet_low_id=p_pet_id or m.pet_high_id=p_pet_id)
    and not public.is_blocked(m.pet_low_id,m.pet_high_id)
    and exists(select 1 from public.pets op join public.users ou on ou.id=op.owner_id where op.id=case when m.pet_low_id=p_pet_id then m.pet_high_id else m.pet_low_id end and ou.suspended_at is null and ou.paused_at is null);
$$;
revoke all on function public.get_matches(uuid) from public,anon;
grant execute on function public.get_matches(uuid) to authenticated;

-- Reconcile relationships that were created before owner-level block semantics existed.
update public.meetup_requests r set status='cancelled'
where r.status in ('pending','accepted') and exists(
  select 1 from public.pet_matches m
  where m.id=r.match_id and public.is_blocked(m.pet_low_id,m.pet_high_id)
);

update public.pet_matches m set unmatched_at=coalesce(m.unmatched_at,now())
where m.unmatched_at is null and public.is_blocked(m.pet_low_id,m.pet_high_id);

delete from public.follows f
where exists(select 1 from public.pets a,public.pets b where a.id=f.from_pet_id and b.id=f.to_pet_id and public.is_blocked(a.id,b.id));
delete from public.pet_likes l
where public.is_blocked(l.from_pet_id,l.to_pet_id);
delete from public.pet_favorites f
where public.is_blocked(f.from_pet_id,f.to_pet_id);
delete from public.pet_passes p
where public.is_blocked(p.from_pet_id,p.to_pet_id);

-- Reverse-direction lookups are common for owner-level safety checks and follower counts.
create index if not exists idx_blocks_blocked_pet on public.blocks(blocked_pet_id,blocker_pet_id);
create index if not exists idx_follows_to on public.follows(to_pet_id,from_pet_id);
create index if not exists idx_reports_reporter_created on public.reports(reporter_user_id,created_at desc);
create index if not exists idx_post_likes_pet_created on public.post_likes(pet_id,created_at desc);
create index if not exists idx_saved_posts_pet_created on public.saved_posts(pet_id,created_at desc);
create index if not exists idx_story_views_viewer_created on public.story_views(viewer_pet_id,viewed_at desc);

-- Moderation retries must not let a poisoned provider item monopolize the head of the queue.
-- Rebase these columns into the true canonical migration chain before release.
alter table public.moderation_items add column if not exists attempts integer not null default 0;
alter table public.moderation_items add column if not exists last_attempt_at timestamptz;
alter table public.moderation_items add column if not exists next_attempt_at timestamptz;
alter table public.moderation_items add column if not exists last_error_code text;
alter table public.moderation_items add column if not exists manual_review_required boolean not null default false;
create index if not exists idx_moderation_retry_queue on public.moderation_items(manual_review_required,next_attempt_at,created_at) where status='pending';

-- Push workers need narrow indexes that match the hardened pending-only dispatch query.
create index if not exists idx_notifications_push_pending_due on public.notifications(next_push_attempt_at,created_at) where push_status='pending' and push_attempts<6;
create index if not exists idx_push_tokens_user_enabled_seen on public.push_tokens(user_id,last_seen_at desc) where enabled=true;
create index if not exists idx_push_receipts_notification_status on public.push_receipts(notification_id,receipt_status);

