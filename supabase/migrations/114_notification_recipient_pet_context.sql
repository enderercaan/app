-- v19 R8 deep blind-spot continuation: bind pet-scoped notifications to the recipient pet.
alter table public.notifications add column if not exists recipient_pet_id uuid references public.pets(id) on delete set null;
create index if not exists idx_notifications_recipient_pet on public.notifications(recipient_pet_id) where recipient_pet_id is not null;

create or replace function public.bind_notification_recipient_pet()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_pet uuid;
begin
  if new.recipient_pet_id is not null then
    if not exists(select 1 from public.pets p where p.id=new.recipient_pet_id and p.owner_id=new.user_id) then
      raise exception 'notification_recipient_pet_owner_mismatch';
    end if;
    return new;
  end if;

  if new.type='health' and new.entity_id is not null then
    select p.id into v_pet from public.pets p where p.id=new.entity_id and p.owner_id=new.user_id;
  elsif new.type='comment' and new.entity_id is not null then
    -- Current comment notifications use the comment id; historical rows used the post id.
    select p.id into v_pet
    from public.comments c join public.posts po on po.id=c.post_id join public.pets p on p.id=po.pet_id
    where c.id=new.entity_id and p.owner_id=new.user_id;
    if v_pet is null then
      select p.id into v_pet from public.posts po join public.pets p on p.id=po.pet_id
      where po.id=new.entity_id and p.owner_id=new.user_id;
    end if;
  elsif new.type='match' and new.entity_id is not null then
    select p.id into v_pet
    from public.pet_matches m join public.pets p on p.id in (m.pet_low_id,m.pet_high_id)
    where m.id=new.entity_id and p.owner_id=new.user_id
    order by p.id limit 1;
  elsif new.type='message' and new.entity_id is not null then
    select p.id into v_pet
    from public.conversations c join public.pet_matches m on m.id=c.match_id
    join public.pets p on p.id in (m.pet_low_id,m.pet_high_id)
    where c.id=new.entity_id and p.owner_id=new.user_id
    order by p.id limit 1;
  elsif new.type='like' then
    select l.to_pet_id into v_pet
    from public.pet_likes l join public.pets p on p.id=l.to_pet_id
    where l.from_pet_id=coalesce(new.actor_pet_id,new.entity_id) and p.owner_id=new.user_id
    order by l.created_at desc,l.to_pet_id desc limit 1;
  elsif new.type='follow' and new.entity_id is not null then
    select f.to_pet_id into v_pet
    from public.follows f join public.pets p on p.id=f.to_pet_id
    where f.from_pet_id=new.entity_id and p.owner_id=new.user_id
    order by f.created_at desc,f.to_pet_id desc limit 1;
  end if;

  new.recipient_pet_id:=v_pet;
  return new;
end $$;
revoke all on function public.bind_notification_recipient_pet() from public,anon,authenticated;

drop trigger if exists trg_bind_notification_recipient_pet on public.notifications;
create trigger trg_bind_notification_recipient_pet
before insert or update of user_id,type,entity_id,actor_pet_id,recipient_pet_id on public.notifications
for each row execute function public.bind_notification_recipient_pet();

-- Backfill only where the relationship is deterministically recoverable. Null remains the
-- honest value for account-wide or inherently non-pet-specific notifications.
update public.notifications set recipient_pet_id=recipient_pet_id where recipient_pet_id is null;

create or replace function public.get_notifications_page(p_limit integer default 40,p_before_created_at timestamptz default null,p_before_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.current_session_satisfies_mfa_if_enrolled() then coalesce(jsonb_agg(jsonb_build_object(
    'id',n.id,'type',n.type,'title',n.title,'body',n.body,'createdAt',n.created_at,'readAt',n.read_at,'entityId',n.entity_id,
    'recipientPetId',n.recipient_pet_id,'templateKey',n.template_key,'templateParams',n.template_params
  ) order by n.created_at desc,n.id desc),'[]'::jsonb) else '[]'::jsonb end
  from (
    select * from public.notifications
    where user_id=auth.uid()
      and (p_before_created_at is null or (created_at,id)<(p_before_created_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by created_at desc,id desc
    limit least(greatest(p_limit,1),100)
  ) n;
$$;
revoke all on function public.get_notifications_page(integer,timestamptz,uuid) from public,anon;
grant execute on function public.get_notifications_page(integer,timestamptz,uuid) to authenticated;

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
  actor_pet_id uuid,
  recipient_pet_id uuid
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
  returning n.id,n.user_id,n.title,n.body,n.type,n.entity_id,n.push_attempts,n.template_key,n.template_params,n.actor_pet_id,n.recipient_pet_id;
end $$;
revoke all on function public.claim_pending_notifications(integer) from public,anon,authenticated;
grant execute on function public.claim_pending_notifications(integer) to service_role;
