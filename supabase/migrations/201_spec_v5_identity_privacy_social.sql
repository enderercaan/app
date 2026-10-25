-- Tailmance migration 201: Spec v5.0 identity, privacy and social controls (2026-10-25).
--
-- Spec v5.0 §2.2 (unique @handle), §2.3 (private profile + follow requests), §29.1/36.2 (mute),
-- §3.3/29.3 (comment replies and comment likes), §6.3 (default quiet hours 22:00-08:00).
--
-- Design notes
-- * Follow requests live in their own table so every existing reader of public.follows keeps meaning
--   "accepted follow" without change.
-- * Private-profile visibility is enforced in the single gate public.social_content_visible_to_viewer, which
--   feed, reels, cached rehydration, shareable reels and storage object reads already call.
-- * Mute is a viewer preference: muted pets are removed from the viewer's feed and reels only; direct profile
--   views are unaffected (mute is not block).
-- * Existing function bodies are patched with an exact-once text replacement that aborts the migration if the
--   anchor is missing or ambiguous, so the patch can never apply partially.

-- ---------------------------------------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------------------------------------
alter table public.pets add column if not exists handle text;
alter table public.pets add column if not exists is_private boolean not null default false;
alter table public.pets add constraint pets_handle_format_check
  check (handle is null or handle ~ '^[a-z0-9](?:[a-z0-9._]{1,28}[a-z0-9])$');
create unique index if not exists pets_handle_unique_idx on public.pets(handle) where handle is not null;

create table if not exists public.follow_requests(
  from_pet_id uuid not null references public.pets(id) on delete cascade,
  to_pet_id uuid not null references public.pets(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(from_pet_id,to_pet_id),
  constraint follow_requests_not_self check (from_pet_id<>to_pet_id)
);
create index if not exists follow_requests_to_idx on public.follow_requests(to_pet_id,created_at desc);
alter table public.follow_requests enable row level security;
revoke all on public.follow_requests from public,anon,authenticated;

create table if not exists public.pet_mutes(
  muter_pet_id uuid not null references public.pets(id) on delete cascade,
  muted_pet_id uuid not null references public.pets(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(muter_pet_id,muted_pet_id),
  constraint pet_mutes_not_self check (muter_pet_id<>muted_pet_id)
);
alter table public.pet_mutes enable row level security;
revoke all on public.pet_mutes from public,anon,authenticated;

alter table public.comments add column if not exists parent_comment_id uuid references public.comments(id) on delete cascade;
create index if not exists comments_parent_idx on public.comments(parent_comment_id) where parent_comment_id is not null;

create table if not exists public.comment_likes(
  comment_id uuid not null references public.comments(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(comment_id,pet_id)
);
create index if not exists comment_likes_pet_idx on public.comment_likes(pet_id);
alter table public.comment_likes enable row level security;
revoke all on public.comment_likes from public,anon,authenticated;

alter table public.users alter column notification_preferences set default
  '{"events": true, "health": true, "social": true, "matches": true, "messages": true, "marketing": false,
    "quietEnabled": true, "quietStartMinutes": 1320, "quietEndMinutes": 480, "timeZone": "UTC"}'::jsonb;

-- ---------------------------------------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.pet_is_muted_by(p_viewer_pet_id uuid,p_target_pet_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.pet_mutes m where m.muter_pet_id=p_viewer_pet_id and m.muted_pet_id=p_target_pet_id);
$$;
revoke all on function public.pet_is_muted_by(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pet_is_muted_by(uuid,uuid) to service_role;

create or replace function public.tm201_patch_function(p_signature regprocedure,p_anchor text,p_replacement text)
returns void language plpgsql set search_path='' as $$
declare v_def text:=pg_catalog.pg_get_functiondef(p_signature); v_count int;
begin
  v_count:=(length(v_def)-length(replace(v_def,p_anchor,'')))/greatest(length(p_anchor),1);
  if v_count<>1 then raise exception 'tm201_patch_anchor_count %:% for %',v_count,left(p_anchor,60),p_signature; end if;
  execute replace(v_def,p_anchor,p_replacement);
end $$;
revoke all on function public.tm201_patch_function(regprocedure,text,text) from public,anon,authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- 3. Private-profile visibility gate
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.social_content_visible_to_viewer(p_viewer_pet_id uuid, p_target_pet_id uuid)
returns boolean language sql stable security definer set search_path='' as $function$
  select exists(
    select 1
    from public.pets target
    join public.users owner on owner.id=target.owner_id
    where target.id=p_target_pet_id
      and owner.suspended_at is null
      and owner.paused_at is null
      and target.moderation_status='approved'
      and (
        target.owner_id=auth.uid()
        or (
          owner.discoverable
          and (
            not owner.incognito
            or exists(
              select 1 from public.pet_likes prior
              where prior.from_pet_id=p_target_pet_id and prior.to_pet_id=p_viewer_pet_id
            )
            or exists(
              select 1 from public.follows f
              where f.from_pet_id=p_target_pet_id and f.to_pet_id=p_viewer_pet_id
            )
            or exists(
              select 1 from public.pet_matches m
              where m.unmatched_at is null
                and m.pet_low_id=least(p_viewer_pet_id,p_target_pet_id)
                and m.pet_high_id=greatest(p_viewer_pet_id,p_target_pet_id)
            )
          )
          and (
            not target.is_private
            or exists(
              select 1 from public.follows f
              where f.from_pet_id=p_viewer_pet_id and f.to_pet_id=p_target_pet_id
            )
            or exists(
              select 1 from public.pet_matches m
              where m.unmatched_at is null
                and m.pet_low_id=least(p_viewer_pet_id,p_target_pet_id)
                and m.pet_high_id=greatest(p_viewer_pet_id,p_target_pet_id)
            )
          )
        )
      )
  );
$function$;

-- Mute filter for feed + reels (live and cached paths).
select public.tm201_patch_function('public.get_feed_page(uuid,text,integer,timestamp with time zone,numeric,timestamp with time zone,uuid)'::regprocedure,
  'public.social_content_visible_to_viewer(p_pet_id,p.pet_id)',
  'public.social_content_visible_to_viewer(p_pet_id,p.pet_id) and not public.pet_is_muted_by(p_pet_id,p.pet_id)');
select public.tm201_patch_function('public.get_reels_page(uuid,integer,timestamp with time zone,numeric,timestamp with time zone,uuid)'::regprocedure,
  'public.social_content_visible_to_viewer(p_pet_id,p.pet_id)',
  'public.social_content_visible_to_viewer(p_pet_id,p.pet_id) and not public.pet_is_muted_by(p_pet_id,p.pet_id)');
do $$
declare r record;
begin
  for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname in ('rehydrate_cached_feed_page','rehydrate_cached_reels_page') loop
    perform public.tm201_patch_function(r.sig,
      'public.social_content_visible_to_viewer(p_pet_id,p.pet_id)',
      'public.social_content_visible_to_viewer(p_pet_id,p.pet_id) and not public.pet_is_muted_by(p_pet_id,p.pet_id)');
  end loop;
end $$;

-- pet_json: expose handle, privacy and relationship state.
select public.tm201_patch_function('public.pet_json(uuid,uuid)'::regprocedure,
  '''isFavorite'',case',
  '''handle'',p.handle,''isPrivate'',p.is_private,'
  ||'''followRequested'',case when p_viewer_pet_id is null then false else exists(select 1 from public.follow_requests fr where fr.from_pet_id=p_viewer_pet_id and fr.to_pet_id=p.id) end,'
  ||'''isMuted'',case when p_viewer_pet_id is null then false else exists(select 1 from public.pet_mutes pm where pm.muter_pet_id=p_viewer_pet_id and pm.muted_pet_id=p.id) end,'
  ||'''isFavorite'',case');

-- ---------------------------------------------------------------------------------------------------------
-- 4. Handle
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.normalize_pet_handle(p_handle text)
returns text language sql immutable set search_path='' as $$
  select nullif(lower(regexp_replace(trim(coalesce(p_handle,'')),'^@','')),'');
$$;
grant execute on function public.normalize_pet_handle(text) to authenticated,service_role;

create or replace function public.pet_handle_available(p_handle text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v text:=public.normalize_pet_handle(p_handle);
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if v is null or v !~ '^[a-z0-9](?:[a-z0-9._]{1,28}[a-z0-9])$' or v ~ '\.\.' then return false; end if;
  return not exists(select 1 from public.pets where handle=v);
end $$;
revoke all on function public.pet_handle_available(text) from public,anon;
grant execute on function public.pet_handle_available(text) to authenticated,service_role;

create or replace function public.set_pet_handle(p_pet_id uuid,p_handle text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v text:=public.normalize_pet_handle(p_handle);
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if v is null or v !~ '^[a-z0-9](?:[a-z0-9._]{1,28}[a-z0-9])$' or v ~ '\.\.' then raise exception 'invalid_handle'; end if;
  if public.contains_prohibited_pet_commerce_intent(v) or public.contains_prohibited_human_dating_intent(v) then raise exception 'handle_not_allowed'; end if;
  perform public.rate_limit('pet_handle_change',10,86400);
  begin
    update public.pets set handle=v,updated_at=now() where id=p_pet_id;
  exception when unique_violation then raise exception 'handle_taken';
  end;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id) values(auth.uid(),p_pet_id,'pet_handle_set','pet',p_pet_id);
  return jsonb_build_object('handle',v);
end $$;
revoke all on function public.set_pet_handle(uuid,text) from public,anon;
grant execute on function public.set_pet_handle(uuid,text) to authenticated,service_role;

-- ---------------------------------------------------------------------------------------------------------
-- 5. Privacy + follow requests
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.set_pet_privacy(p_pet_id uuid,p_private boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_accepted int:=0;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('pet_privacy_change',20,86400);
  update public.pets set is_private=coalesce(p_private,false),updated_at=now() where id=p_pet_id;
  if not coalesce(p_private,false) then
    with moved as (
      delete from public.follow_requests r where r.to_pet_id=p_pet_id and not public.is_blocked(r.from_pet_id,r.to_pet_id)
      returning r.from_pet_id,r.to_pet_id
    )
    insert into public.follows(from_pet_id,to_pet_id) select from_pet_id,to_pet_id from moved on conflict do nothing;
    get diagnostics v_accepted = row_count;
  end if;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id) values(auth.uid(),p_pet_id,'pet_privacy_set','pet',p_pet_id);
  return jsonb_build_object('isPrivate',coalesce(p_private,false),'autoAccepted',v_accepted);
end $$;
revoke all on function public.set_pet_privacy(uuid,boolean) from public,anon;
grant execute on function public.set_pet_privacy(uuid,boolean) to authenticated,service_role;

create or replace function public.set_follow_pet(p_from_pet_id uuid, p_to_pet_id uuid, p_following boolean)
returns boolean language plpgsql security definer set search_path='' as $function$
declare v_owner uuid; v_private boolean;
begin
  if not public.owns_pet(p_from_pet_id) or p_from_pet_id=p_to_pet_id then raise exception 'forbidden'; end if;
  perform public.lock_owner_safety_relation(p_from_pet_id,p_to_pet_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('follow:'||p_from_pet_id::text||':'||p_to_pet_id::text,0));
  if not coalesce(p_following,false) then
    delete from public.follows where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id;
    delete from public.follow_requests where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id;
    return false;
  end if;
  if exists(select 1 from public.follows where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id) then return true; end if;
  if public.is_blocked(p_from_pet_id,p_to_pet_id) then raise exception 'forbidden'; end if;
  select p.owner_id,p.is_private into v_owner,v_private from public.pets p join public.users u on u.id=p.owner_id
  where p.id=p_to_pet_id and p.owner_id<>auth.uid() and p.moderation_status='approved' and p.discovery_enabled
    and u.suspended_at is null and u.paused_at is null and u.discoverable
    and (not u.incognito or exists(select 1 from public.pet_likes prior where prior.from_pet_id=p_to_pet_id and prior.to_pet_id=p_from_pet_id));
  if v_owner is null then raise exception 'target_unavailable'; end if;
  perform public.rate_limit('follow',150,86400);
  if v_private then
    insert into public.follow_requests(from_pet_id,to_pet_id) values(p_from_pet_id,p_to_pet_id) on conflict do nothing;
    if found then insert into public.notifications(user_id,type,title,body,entity_id,actor_pet_id,recipient_pet_id,template_key)
      values(v_owner,'follow','Follow request','A pet wants to follow your pet.',p_from_pet_id,p_from_pet_id,p_to_pet_id,'follow_request'); end if;
    return false;
  end if;
  insert into public.follows(from_pet_id,to_pet_id) values(p_from_pet_id,p_to_pet_id) on conflict(from_pet_id,to_pet_id) do nothing;
  if found then insert into public.notifications(user_id,type,title,body,entity_id,actor_pet_id,recipient_pet_id)
    values(v_owner,'follow','New follower','A pet started following your pet.',p_from_pet_id,p_from_pet_id,p_to_pet_id); end if;
  return true;
end $function$;

create or replace function public.get_follow_state(p_from_pet_id uuid,p_to_pet_id uuid)
returns text language plpgsql stable security definer set search_path='' as $$
begin
  if not public.owns_pet(p_from_pet_id) then raise exception 'forbidden'; end if;
  if exists(select 1 from public.follows where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id) then return 'following'; end if;
  if exists(select 1 from public.follow_requests where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id) then return 'requested'; end if;
  return 'none';
end $$;
revoke all on function public.get_follow_state(uuid,uuid) from public,anon;
grant execute on function public.get_follow_state(uuid,uuid) to authenticated,service_role;

create or replace function public.get_follow_requests(p_pet_id uuid,p_limit integer default 50)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.owns_pet(p_pet_id) then coalesce((
    select jsonb_agg(jsonb_build_object('pet',public.pet_json(x.from_pet_id,p_pet_id),'createdAt',x.created_at) order by x.created_at desc)
    from (
      select r.* from public.follow_requests r
      join public.pets fp on fp.id=r.from_pet_id join public.users fu on fu.id=fp.owner_id
      where r.to_pet_id=p_pet_id and fu.suspended_at is null and fu.paused_at is null
        and not public.is_blocked(p_pet_id,r.from_pet_id)
      order by r.created_at desc limit least(greatest(p_limit,1),100)
    ) x),'[]'::jsonb) else null end;
$$;
revoke all on function public.get_follow_requests(uuid,integer) from public,anon;
grant execute on function public.get_follow_requests(uuid,integer) to authenticated,service_role;

create or replace function public.respond_follow_request(p_pet_id uuid,p_from_pet_id uuid,p_accept boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_from_owner uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  delete from public.follow_requests where from_pet_id=p_from_pet_id and to_pet_id=p_pet_id;
  if not found then raise exception 'not_found'; end if;
  if coalesce(p_accept,false) and not public.is_blocked(p_pet_id,p_from_pet_id) then
    insert into public.follows(from_pet_id,to_pet_id) values(p_from_pet_id,p_pet_id) on conflict do nothing;
    select owner_id into v_from_owner from public.pets where id=p_from_pet_id;
    if v_from_owner is not null then
      insert into public.notifications(user_id,type,title,body,entity_id,actor_pet_id,recipient_pet_id,template_key)
      values(v_from_owner,'follow','Follow request accepted','Your follow request was accepted.',p_pet_id,p_pet_id,p_from_pet_id,'follow_accepted');
    end if;
    return jsonb_build_object('status','accepted');
  end if;
  return jsonb_build_object('status','declined');
end $$;
revoke all on function public.respond_follow_request(uuid,uuid,boolean) from public,anon;
grant execute on function public.respond_follow_request(uuid,uuid,boolean) to authenticated,service_role;

-- Followers can be removed by the followed pet (needed for private accounts).
create or replace function public.remove_follower(p_pet_id uuid,p_follower_pet_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  delete from public.follows where from_pet_id=p_follower_pet_id and to_pet_id=p_pet_id;
  return found;
end $$;
revoke all on function public.remove_follower(uuid,uuid) from public,anon;
grant execute on function public.remove_follower(uuid,uuid) to authenticated,service_role;

-- ---------------------------------------------------------------------------------------------------------
-- 6. Mute
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.set_pet_mute(p_pet_id uuid,p_target_pet_id uuid,p_muted boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) or p_pet_id=p_target_pet_id then raise exception 'forbidden'; end if;
  if not coalesce(p_muted,false) then
    delete from public.pet_mutes where muter_pet_id=p_pet_id and muted_pet_id=p_target_pet_id;
    return false;
  end if;
  if not exists(select 1 from public.pets where id=p_target_pet_id) then raise exception 'not_found'; end if;
  perform public.rate_limit('pet_mute',200,86400);
  insert into public.pet_mutes(muter_pet_id,muted_pet_id) values(p_pet_id,p_target_pet_id) on conflict do nothing;
  return true;
end $$;
revoke all on function public.set_pet_mute(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_pet_mute(uuid,uuid,boolean) to authenticated,service_role;

create or replace function public.get_muted_pets(p_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.owns_pet(p_pet_id) then coalesce((
    select jsonb_agg(jsonb_build_object('pet',public.pet_json(m.muted_pet_id,p_pet_id),'createdAt',m.created_at) order by m.created_at desc)
    from public.pet_mutes m where m.muter_pet_id=p_pet_id),'[]'::jsonb) else null end;
$$;
revoke all on function public.get_muted_pets(uuid) from public,anon;
grant execute on function public.get_muted_pets(uuid) to authenticated,service_role;

-- ---------------------------------------------------------------------------------------------------------
-- 7. Comment replies + likes
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.create_comment_reply(p_pet_id uuid,p_parent_comment_id uuid,p_body text,p_client_operation_id text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_parent public.comments; v_id uuid; v_op text:=trim(coalesce(p_client_operation_id,'')); v_body text:=trim(coalesce(p_body,''));
  v_hash text; v_receipt public.client_mutation_receipts%rowtype;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if v_op !~ '^[A-Za-z0-9_-]{16,96}$' then raise exception 'invalid_client_operation_id'; end if;
  v_hash:=public.client_mutation_hash(jsonb_build_object('petId',p_pet_id,'parentCommentId',p_parent_comment_id,'body',v_body));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':create_comment_reply:'||v_op,0));
  select * into v_receipt from public.client_mutation_receipts where user_id=auth.uid() and action='create_comment_reply' and operation_id=v_op;
  if v_receipt.user_id is not null then
    if v_receipt.request_hash<>v_hash then raise exception 'client_operation_id_reused'; end if;
    return (v_receipt.result->>'id')::uuid;
  end if;
  select * into v_parent from public.comments where id=p_parent_comment_id and deleted_at is null and moderation_status='approved';
  if v_parent.id is null or public.is_blocked(p_pet_id,v_parent.pet_id) then raise exception 'not_found'; end if;
  -- One reply level: replying to a reply attaches to the thread root. create_comment enforces post
  -- availability, block, private-profile visibility, length, rate limit and moderation queueing.
  v_id:=public.create_comment(p_pet_id,v_parent.post_id,v_body);
  update public.comments set parent_comment_id=coalesce(v_parent.parent_comment_id,v_parent.id) where id=v_id;
  insert into public.client_mutation_receipts(user_id,action,operation_id,request_hash,result)
  values(auth.uid(),'create_comment_reply',v_op,v_hash,jsonb_build_object('id',v_id));
  return v_id;
end $$;
revoke all on function public.create_comment_reply(uuid,uuid,text,text) from public,anon;
grant execute on function public.create_comment_reply(uuid,uuid,text,text) to authenticated,service_role;

create or replace function public.set_comment_like(p_pet_id uuid,p_comment_id uuid,p_liked boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_comment public.comments;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select c.* into v_comment from public.comments c join public.posts po on po.id=c.post_id
  where c.id=p_comment_id and c.deleted_at is null and c.moderation_status='approved' and po.deleted_at is null and po.moderation_status='approved';
  if v_comment.id is null or public.is_blocked(p_pet_id,v_comment.pet_id)
     or not public.social_content_visible_to_viewer(p_pet_id,(select po.pet_id from public.posts po where po.id=v_comment.post_id)) then
    raise exception 'not_found';
  end if;
  if coalesce(p_liked,false) then
    perform public.rate_limit('comment_like',600,3600);
    insert into public.comment_likes(comment_id,pet_id) values(p_comment_id,p_pet_id) on conflict do nothing;
  else
    delete from public.comment_likes where comment_id=p_comment_id and pet_id=p_pet_id;
  end if;
  return jsonb_build_object('liked',coalesce(p_liked,false),'likeCount',(select count(*) from public.comment_likes where comment_id=p_comment_id));
end $$;
revoke all on function public.set_comment_like(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_comment_like(uuid,uuid,boolean) to authenticated,service_role;

-- Comment page: reply/like fields and private-profile gate.
select public.tm201_patch_function('public.get_post_comments_page(uuid,uuid,integer,timestamp with time zone,uuid)'::regprocedure,
  '''body'',c.body,''createdAt'',c.created_at',
  '''body'',c.body,''createdAt'',c.created_at,''parentCommentId'',c.parent_comment_id,'
  ||'''likeCount'',(select count(*) from public.comment_likes cl where cl.comment_id=c.id),'
  ||'''likedByMe'',exists(select 1 from public.comment_likes cl where cl.comment_id=c.id and cl.pet_id=p_pet_id)');
select public.tm201_patch_function('public.get_post_comments_page(uuid,uuid,integer,timestamp with time zone,uuid)'::regprocedure,
  'and not public.is_blocked(p_pet_id,po.pet_id)',
  'and not public.is_blocked(p_pet_id,po.pet_id) and public.social_content_visible_to_viewer(p_pet_id,po.pet_id)');

-- Write paths on posts honour the private-profile gate (comment, like, save).
do $$
declare v_sig text;
begin
  foreach v_sig in array array['public.create_comment(uuid,uuid,text)','public.set_post_like(uuid,uuid,boolean)','public.set_saved_post(uuid,uuid,boolean)'] loop
    perform public.tm201_patch_function(v_sig::regprocedure,
      'if v_author_pet is null or public.is_blocked(p_pet_id,v_author_pet) then',
      'if v_author_pet is null or public.is_blocked(p_pet_id,v_author_pet) or not public.social_content_visible_to_viewer(p_pet_id,v_author_pet) then');
  end loop;
end $$;

-- Legacy readers superseded by get_feed_page / get_post_comments_page and not called by the app or any
-- edge function; they predate the visibility gate, so clients lose access to them.
revoke all on function public.get_feed(uuid,integer) from public,anon,authenticated;
grant execute on function public.get_feed(uuid,integer) to service_role;
revoke all on function public.get_feed(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.get_feed(uuid,integer,text) to service_role;
revoke all on function public.get_post_comments(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.get_post_comments(uuid,uuid,integer) to service_role;

drop function public.tm201_patch_function(regprocedure,text,text);
