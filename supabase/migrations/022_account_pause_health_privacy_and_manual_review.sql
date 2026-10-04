-- O trust hardening: exact duplicate pet-photo fingerprints are private moderation signals.
-- This is NOT liveness/deepfake detection; it only catches byte-identical reused images and routes them to manual review.
create table if not exists public.pet_photo_fingerprints (
  photo_id uuid primary key references public.pet_photos(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create index if not exists idx_pet_photo_fingerprints_sha256 on public.pet_photo_fingerprints(sha256);
alter table public.pet_photo_fingerprints enable row level security;
revoke all on public.pet_photo_fingerprints from anon,authenticated;

-- O account-pause hardening: user pause is distinct from administrative suspension.
create or replace function public.set_account_paused(p_paused boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_paused_at timestamptz;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  perform public.rate_limit('account_pause',20,3600);
  if p_paused then
    update public.users
    set paused_at=coalesce(paused_at,now()),discoverable=false,updated_at=now()
    where id=auth.uid() and suspended_at is null
    returning paused_at into v_paused_at;
    if not found then raise exception 'account_unavailable'; end if;
  else
    update public.users set paused_at=null,updated_at=now()
    where id=auth.uid() and suspended_at is null
    returning paused_at into v_paused_at;
    if not found then raise exception 'account_unavailable'; end if;
  end if;
  insert into public.audit_events(user_id,action,entity_type)
  values(auth.uid(),case when p_paused then 'account_paused' else 'account_resumed' end,'user');
  return jsonb_build_object('paused',p_paused);
end $$;
revoke all on function public.set_account_paused(boolean) from public,anon;
grant execute on function public.set_account_paused(boolean) to authenticated;

create or replace function public.get_account_settings()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'tier',u.tier,'freeMessagesSent',u.free_messages_sent,'discoverable',u.discoverable,
    'incognito',u.incognito,'paused',u.paused_at is not null,'suspended',u.suspended_at is not null,'age18Confirmed',u.age_18_confirmed,'legalVersion',u.legal_version,
    'identityVerified',coalesce(u.identity_verified,false),'preferredLocale',u.preferred_locale,
    'notificationPreferences',('{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb || coalesce(u.notification_preferences,'{}'::jsonb))
  ) from public.users u where u.id=auth.uid();
$$;
revoke all on function public.get_account_settings() from public,anon;
grant execute on function public.get_account_settings() to authenticated;

-- Keep backward-compatible read RPCs aligned with pause semantics so an older client or direct RPC call
-- cannot surface a paused account after the paginated replacements were hardened.
create or replace function public.get_feed(p_pet_id uuid,p_limit integer default 50,p_mode text default 'for_you')
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.owns_pet(p_pet_id) then coalesce(jsonb_agg(jsonb_build_object(
    'id',po.id,'pet',public.pet_json(po.pet_id,p_pet_id),'caption',po.caption,
    'mediaUrls',coalesce((select jsonb_agg(pm.storage_path order by pm.sort_order) from public.post_media pm where pm.post_id=po.id and pm.moderation_status='approved'),'[]'::jsonb),
    'createdAt',po.created_at,'likeCount',(select count(*) from public.post_likes l where l.post_id=po.id),
    'commentCount',(select count(*) from public.comments c join public.pets cp on cp.id=c.pet_id join public.users cu on cu.id=cp.owner_id where c.post_id=po.id and c.deleted_at is null and c.moderation_status='approved' and cu.suspended_at is null and cu.paused_at is null),
    'likedByMe',exists(select 1 from public.post_likes l where l.post_id=po.id and l.pet_id=p_pet_id),
    'savedByMe',exists(select 1 from public.saved_posts sp where sp.post_id=po.id and sp.pet_id=p_pet_id)
  ) order by po.rank_score desc,po.created_at desc),'[]'::jsonb) else null end
  from (
    select p.*,(
      case when p.pet_id=p_pet_id then 6 else 0 end +
      case when exists(select 1 from public.follows f where f.from_pet_id=p_pet_id and f.to_pet_id=p.pet_id) then 12 else 0 end +
      greatest(0,5-extract(epoch from (now()-p.created_at))/86400.0)
    )::numeric rank_score
    from public.posts p
    join public.pets author on author.id=p.pet_id
    join public.users au on au.id=author.owner_id and au.suspended_at is null and au.paused_at is null
    where p.deleted_at is null and p.moderation_status='approved' and not public.is_blocked(p_pet_id,p.pet_id)
      and (p_mode<>'following' or p.pet_id=p_pet_id or exists(select 1 from public.follows f where f.from_pet_id=p_pet_id and f.to_pet_id=p.pet_id))
    order by rank_score desc,p.created_at desc
    limit least(greatest(p_limit,1),100)
  ) po;
$$;
revoke all on function public.get_feed(uuid,integer,text) from public,anon;
grant execute on function public.get_feed(uuid,integer,text) to authenticated;

create or replace function public.get_matches(p_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'conversationId',c.id,
    'otherPet',public.pet_json(case when m.pet_low_id=p_pet_id then m.pet_high_id else m.pet_low_id end,p_pet_id),
    'matchedAt',m.matched_at,'commonPurposes',coalesce(cp.purposes,'[]'::jsonb),
    'lastMessage',lm.body,'lastMessageAt',lm.created_at,'unreadCount',coalesce(uc.unread_count,0)
  ) order by m.matched_at desc),'[]'::jsonb)
  from public.pet_matches m
  left join public.conversations c on c.match_id=m.id
  left join lateral (
    select jsonb_agg(a.purpose order by a.purpose) as purposes
    from public.pet_purposes a join public.pet_purposes b on b.purpose=a.purpose
    where a.pet_id=p_pet_id and a.purpose<>'mating' and b.pet_id=case when m.pet_low_id=p_pet_id then m.pet_high_id else m.pet_low_id end
  ) cp on true
  left join lateral (
    select msg.body,msg.created_at from public.messages msg where msg.conversation_id=c.id order by msg.created_at desc,msg.id desc limit 1
  ) lm on true
  left join lateral (
    select count(*)::bigint as unread_count from public.messages msg where msg.conversation_id=c.id and msg.sender_pet_id<>p_pet_id and msg.read_at is null
  ) uc on true
  where public.owns_pet(p_pet_id)
    and m.unmatched_at is null
    and p_pet_id in(m.pet_low_id,m.pet_high_id)
    and not public.is_blocked(m.pet_low_id,m.pet_high_id)
    and exists(
      select 1 from public.pets op join public.users ou on ou.id=op.owner_id
      where op.id=case when m.pet_low_id=p_pet_id then m.pet_high_id else m.pet_low_id end
        and ou.suspended_at is null and ou.paused_at is null
    );
$$;
revoke all on function public.get_matches(uuid) from public,anon;
grant execute on function public.get_matches(uuid) to authenticated;

create or replace function public.get_unread_match_message_count(p_pet_id uuid)
returns bigint language sql stable security definer set search_path='' as $$
  select count(*)::bigint
  from public.messages msg
  join public.conversations c on c.id=msg.conversation_id
  join public.pet_matches m on m.id=c.match_id
  where public.owns_pet(p_pet_id)
    and m.unmatched_at is null
    and p_pet_id in(m.pet_low_id,m.pet_high_id)
    and not public.is_blocked(m.pet_low_id,m.pet_high_id)
    and msg.sender_pet_id<>p_pet_id and msg.read_at is null
    and exists(
      select 1 from public.pets op join public.users ou on ou.id=op.owner_id
      where op.id=case when m.pet_low_id=p_pet_id then m.pet_high_id else m.pet_low_id end
        and ou.suspended_at is null and ou.paused_at is null
    );
$$;
revoke all on function public.get_unread_match_message_count(uuid) from public,anon;
grant execute on function public.get_unread_match_message_count(uuid) to authenticated;

-- Paused authors disappear from active feed surfaces. Their stored data is preserved for resume/export/deletion.
create or replace function public.get_feed_page(p_pet_id uuid,p_mode text default 'for_you',p_limit integer default 20,p_snapshot_at timestamptz default null,p_before_rank numeric default null,p_before_created_at timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_snapshot timestamptz:=coalesce(p_snapshot_at,now()); v_items jsonb;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  with ranked as (
    select p.*, (case when p.pet_id=p_pet_id then 6 else 0 end + case when exists(select 1 from public.follows f where f.from_pet_id=p_pet_id and f.to_pet_id=p.pet_id) then 12 else 0 end + greatest(0,5-extract(epoch from (v_snapshot-p.created_at))/86400.0))::numeric rank_score
    from public.posts p
    join public.pets author on author.id=p.pet_id
    join public.users au on au.id=author.owner_id and au.suspended_at is null and au.paused_at is null
    where p.deleted_at is null and p.moderation_status='approved' and p.created_at<=v_snapshot and not public.is_blocked(p_pet_id,p.pet_id)
      and (p_mode<>'following' or p.pet_id=p_pet_id or exists(select 1 from public.follows f where f.from_pet_id=p_pet_id and f.to_pet_id=p.pet_id))
  ), page as (
    select * from ranked where p_before_rank is null or (rank_score,created_at,id)<(p_before_rank,p_before_created_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)) order by rank_score desc,created_at desc,id desc limit least(greatest(p_limit,1),50)
  ) select coalesce(jsonb_agg(jsonb_build_object(
    'id',po.id,'pet',public.pet_json(po.pet_id,p_pet_id),'caption',po.caption,
    'mediaUrls',coalesce((select jsonb_agg(pm.storage_path order by pm.sort_order) from public.post_media pm where pm.post_id=po.id and pm.moderation_status='approved'),'[]'::jsonb),
    'createdAt',po.created_at,'rankScore',po.rank_score,'likeCount',(select count(*) from public.post_likes l where l.post_id=po.id),'commentCount',(select count(*) from public.comments c join public.pets cp on cp.id=c.pet_id join public.users cu on cu.id=cp.owner_id where c.post_id=po.id and c.deleted_at is null and c.moderation_status='approved' and cu.suspended_at is null and cu.paused_at is null),
    'likedByMe',exists(select 1 from public.post_likes l where l.post_id=po.id and l.pet_id=p_pet_id),'savedByMe',exists(select 1 from public.saved_posts sp where sp.post_id=po.id and sp.pet_id=p_pet_id)
  ) order by po.rank_score desc,po.created_at desc,po.id desc),'[]'::jsonb) into v_items from page po;
  return jsonb_build_object('snapshotAt',v_snapshot,'items',v_items);
end $$;
revoke all on function public.get_feed_page(uuid,text,integer,timestamptz,numeric,timestamptz,uuid) from public,anon;
grant execute on function public.get_feed_page(uuid,text,integer,timestamptz,numeric,timestamptz,uuid) to authenticated;


-- D/L/O health-document privacy/operations hardening: health records are sensitive and the generic
-- media/text moderation worker intentionally has no health_document provider contract. Route newly
-- attached health documents straight to the protected manual-review queue instead of wasting five
-- automated retries or sending medical records to a generic moderation provider.
create or replace function public.attach_health_document(p_pet_id uuid,p_document_type text,p_storage_path text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if char_length(trim(coalesce(p_document_type,''))) not between 1 and 80 then raise exception 'invalid_document_type'; end if;
  perform public.rate_limit('health_document_attach',10,3600);
  perform public.consume_upload_intent(p_pet_id,'health-documents','health_document',p_storage_path);
  insert into public.health_documents(pet_id,document_type,storage_path,verification_status)
  values(p_pet_id,trim(p_document_type),p_storage_path,'pending') returning id into v_id;
  insert into public.moderation_items(
    target_type,target_id,status,manual_review_required,next_attempt_at,last_error_code
  ) values(
    'health_document',v_id,'pending',true,null,'manual_health_review_required'
  )
  on conflict(target_type,target_id) do update set
    status='pending',reason=null,reviewed_at=null,manual_review_required=true,
    next_attempt_at=null,last_error_code='manual_health_review_required';
  return v_id;
end $$;
revoke all on function public.attach_health_document(uuid,text,text) from public,anon;
grant execute on function public.attach_health_document(uuid,text,text) to authenticated;


