-- Tailmance TUR 2: a pending/rejected comment must never notify its recipient.
-- Moderation state and the resulting social notification are finalized atomically.

alter table public.notifications add column if not exists actor_pet_id uuid references public.pets(id) on delete set null;
create index if not exists idx_notifications_actor_pet on public.notifications(actor_pet_id) where actor_pet_id is not null;

create or replace function public.create_comment(p_pet_id uuid,p_post_id uuid,p_body text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_author_pet uuid; v_body text:=trim(coalesce(p_body,''));
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if char_length(v_body) not between 1 and 1000 then raise exception 'invalid_comment_length'; end if;
  select po.pet_id into v_author_pet
  from public.posts po
  join public.pets p on p.id=po.pet_id
  join public.users au on au.id=p.owner_id
  where po.id=p_post_id and po.deleted_at is null and po.moderation_status='approved'
    and au.suspended_at is null and au.paused_at is null;
  if v_author_pet is null or public.is_blocked(p_pet_id,v_author_pet) then raise exception 'not_found'; end if;
  perform public.rate_limit('comment',80,3600);
  insert into public.comments(post_id,pet_id,body,moderation_status)
  values(p_post_id,p_pet_id,v_body,'pending') returning id into v_id;
  insert into public.moderation_items(target_type,target_id,status)
  values('comment_text',v_id,'pending') on conflict do nothing;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id)
  values(auth.uid(),p_pet_id,'comment_created','comment',v_id);
  return v_id;
end $$;
revoke all on function public.create_comment(uuid,uuid,text) from public,anon;
grant execute on function public.create_comment(uuid,uuid,text) to authenticated;

create or replace function public.finalize_comment_moderation(
  p_item_id uuid,
  p_status text,
  p_provider text default null,
  p_reason text default null,
  p_score jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_item public.moderation_items%rowtype;
  v_comment public.comments%rowtype;
  v_comment_owner uuid;
  v_post_owner uuid;
  v_post_pet uuid;
  v_post_status public.moderation_state;
  v_post_deleted timestamptz;
  v_commenter_paused timestamptz;
  v_commenter_suspended timestamptz;
  v_post_owner_paused timestamptz;
  v_post_owner_suspended timestamptz;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_status not in ('approved','rejected') then raise exception 'invalid_moderation_status'; end if;
  if p_reason is not null and char_length(p_reason)>500 then raise exception 'reason_too_long'; end if;
  if jsonb_typeof(coalesce(p_score,'{}'::jsonb))<>'object' or pg_column_size(coalesce(p_score,'{}'::jsonb))>8192 then raise exception 'invalid_score'; end if;

  select * into v_item from public.moderation_items where id=p_item_id for update;
  if v_item.id is null or v_item.target_type<>'comment_text' then raise exception 'moderation_item_not_found'; end if;
  if v_item.status in ('approved','rejected') then return v_item.status=p_status; end if;

  select * into v_comment from public.comments where id=v_item.target_id for update;
  if v_comment.id is null then
    delete from public.moderation_items where id=v_item.id;
    return false;
  end if;

  update public.moderation_items
  set status=p_status::public.moderation_state,
      provider=left(nullif(trim(coalesce(p_provider,'')),''),120),
      reason=left(nullif(trim(coalesce(p_reason,'')),''),500),
      score=coalesce(p_score,'{}'::jsonb),
      reviewed_at=now(),next_attempt_at=null
  where id=v_item.id;

  update public.comments set moderation_status=p_status::public.moderation_state where id=v_comment.id;

  if p_status='approved' and v_comment.deleted_at is null then
    select cp.owner_id,cu.paused_at,cu.suspended_at,
           pp.owner_id,po.pet_id,po.moderation_status,po.deleted_at,pu.paused_at,pu.suspended_at
    into v_comment_owner,v_commenter_paused,v_commenter_suspended,
         v_post_owner,v_post_pet,v_post_status,v_post_deleted,v_post_owner_paused,v_post_owner_suspended
    from public.pets cp
    join public.users cu on cu.id=cp.owner_id
    join public.posts po on po.id=v_comment.post_id
    join public.pets pp on pp.id=po.pet_id
    join public.users pu on pu.id=pp.owner_id
    where cp.id=v_comment.pet_id;

    if v_post_owner is not null
       and v_comment_owner<>v_post_owner
       and v_commenter_paused is null and v_commenter_suspended is null
       and v_post_owner_paused is null and v_post_owner_suspended is null
       and v_post_deleted is null and v_post_status='approved'
       and not public.is_blocked(v_comment.pet_id,v_post_pet) then
      insert into public.notifications(user_id,type,title,body,entity_id,dedupe_key,template_key,template_params,actor_pet_id)
      values(v_post_owner,'comment','New comment','A pet commented on your post.',v_comment.id,
             format('comment:%s',v_comment.id),'comment','{}'::jsonb,v_comment.pet_id)
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end if;
  end if;
  return true;
end;
$$;
revoke all on function public.finalize_comment_moderation(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.finalize_comment_moderation(uuid,text,text,text,jsonb) to service_role;

-- Executed-Postgres verification fix (2026-10-03): CREATE OR REPLACE cannot change this function's
-- result row type or parameter names on a real PostgreSQL server; drop the prior signature first.
drop function if exists public.claim_pending_notifications(integer);
create or replace function public.claim_pending_notifications(p_limit integer default 100)
returns table(
  id uuid,
  user_id uuid,
  title text,
  body text,
  type public.notification_type,
  entity_id uuid,
  push_attempts smallint,
  template_key text,
  template_params jsonb,
  actor_pet_id uuid
) language plpgsql security definer set search_path='' as $$
begin
  update public.notifications n
  set push_status=case when n.push_attempts+1>=6 then 'failed' else 'pending' end,
      push_attempts=least(n.push_attempts+1,32767)::smallint,
      next_push_attempt_at=now(),push_claimed_at=null
  where n.push_status='processing' and n.push_claimed_at<now()-interval '5 minutes';

  return query
  with candidates as (
    select n.id from public.notifications n
    where n.push_status='pending' and n.push_attempts<6 and n.next_push_attempt_at<=now()
    order by n.created_at asc,n.id asc
    for update skip locked
    limit least(greatest(coalesce(p_limit,100),1),100)
  )
  update public.notifications n
  set push_status='processing',push_claimed_at=now()
  from candidates c where n.id=c.id
  returning n.id,n.user_id,n.title,n.body,n.type,n.entity_id,n.push_attempts,n.template_key,n.template_params,n.actor_pet_id;
end $$;
revoke all on function public.claim_pending_notifications(integer) from public,anon,authenticated;
grant execute on function public.claim_pending_notifications(integer) to service_role;
