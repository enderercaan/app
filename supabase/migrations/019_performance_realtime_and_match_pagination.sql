-- Query-cost hardening for long-lived accounts and high-volume conversations.
-- These indexes do not change product semantics; they support existing unread/export/deletion queries.
create index if not exists idx_messages_unread_conversation_sender
  on public.messages(conversation_id,sender_pet_id)
  where read_at is null;

create index if not exists idx_audit_events_user_created
  on public.audit_events(user_id,created_at desc)
  where user_id is not null;

create index if not exists idx_audit_events_pet_created
  on public.audit_events(pet_id,created_at desc)
  where pet_id is not null;

create index if not exists idx_billing_webhook_events_user_ids_gin
  on public.billing_webhook_events using gin(user_ids);

-- Realtime correctness: the mobile client subscribes to Postgres Changes for messages and notifications.
-- Keep publication wiring source-controlled instead of relying on an undocumented dashboard toggle.
do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages') then
      execute 'alter publication supabase_realtime add table public.messages';
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
      execute 'alter publication supabase_realtime add table public.notifications';
    end if;
  else
    raise exception 'supabase_realtime publication is missing';
  end if;
end $$;

-- M/E performance hardening: preserve the exact get_matches response contract while
-- eliminating repeated correlated conversation/last-message lookups per match.
-- This still returns the full active-match list; keyset pagination remains a release-scale
-- follow-up because silently LIMITing this RPC would hide older conversations in the UI.
create or replace function public.get_matches(p_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,
    'conversationId',c.id,
    'otherPet',public.pet_json(case when m.pet_low_id=p_pet_id then m.pet_high_id else m.pet_low_id end,p_pet_id),
    'matchedAt',m.matched_at,
    'commonPurposes',coalesce(cp.purposes,'[]'::jsonb),
    'lastMessage',lm.body,
    'lastMessageAt',lm.created_at,
    'unreadCount',coalesce(uc.unread_count,0)
  ) order by m.matched_at desc),'[]'::jsonb)
  from public.pet_matches m
  left join public.conversations c on c.match_id=m.id
  left join lateral (
    select jsonb_agg(a.purpose order by a.purpose) as purposes
    from public.pet_purposes a
    join public.pet_purposes b on b.purpose=a.purpose
    where a.pet_id=p_pet_id
      and a.purpose<>'mating'
      and b.pet_id=case when m.pet_low_id=p_pet_id then m.pet_high_id else m.pet_low_id end
  ) cp on true
  left join lateral (
    select msg.body,msg.created_at
    from public.messages msg
    where msg.conversation_id=c.id
    order by msg.created_at desc
    limit 1
  ) lm on true
  left join lateral (
    select count(*)::bigint as unread_count
    from public.messages msg
    where msg.conversation_id=c.id
      and msg.sender_pet_id<>p_pet_id
      and msg.read_at is null
  ) uc on true
  where public.owns_pet(p_pet_id)
    and m.unmatched_at is null
    and (m.pet_low_id=p_pet_id or m.pet_high_id=p_pet_id)
    and not public.is_blocked(m.pet_low_id,m.pet_high_id);
$$;
revoke all on function public.get_matches(uuid) from public,anon;
grant execute on function public.get_matches(uuid) to authenticated;


-- M/E scale hardening: keyset pagination for long-lived match lists plus an aggregate
-- unread counter and exact conversation lookup so pagination does not break badges or
-- notification deep links. The legacy get_matches RPC remains for backward compatibility.
create index if not exists idx_pet_matches_low_active_page
  on public.pet_matches(pet_low_id,matched_at desc,id desc)
  where unmatched_at is null;
create index if not exists idx_pet_matches_high_active_page
  on public.pet_matches(pet_high_id,matched_at desc,id desc)
  where unmatched_at is null;

create or replace function public.get_matches_page(
  p_pet_id uuid,
  p_limit integer default 30,
  p_before_matched_at timestamptz default null,
  p_before_id uuid default null
)
returns jsonb language sql stable security definer set search_path='' as $$
  with candidates as (
    select m.*,c.id as conversation_id,lm.body as last_message,lm.created_at as last_message_at,
      coalesce(lm.created_at,m.matched_at) as activity_at
    from public.pet_matches m
    join public.conversations c on c.match_id=m.id
    left join lateral (
      select msg.body,msg.created_at
      from public.messages msg
      where msg.conversation_id=c.id
      order by msg.created_at desc,msg.id desc
      limit 1
    ) lm on true
    where public.owns_pet(p_pet_id)
      and m.unmatched_at is null
      and (m.pet_low_id=p_pet_id or m.pet_high_id=p_pet_id)
      and not public.is_blocked(m.pet_low_id,m.pet_high_id)
      and exists(select 1 from public.pets op join public.users ou on ou.id=op.owner_id where op.id=case when m.pet_low_id=p_pet_id then m.pet_high_id else m.pet_low_id end and ou.suspended_at is null and ou.paused_at is null)
  ),
  page as (
    select * from candidates
    where p_before_matched_at is null
      or (activity_at,id)<(p_before_matched_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
    order by activity_at desc,id desc
    limit least(greatest(p_limit,1),50)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,
    'conversationId',m.conversation_id,
    'otherPet',public.pet_json(case when m.pet_low_id=p_pet_id then m.pet_high_id else m.pet_low_id end,p_pet_id),
    'matchedAt',m.matched_at,
    'commonPurposes',coalesce(cp.purposes,'[]'::jsonb),
    'lastMessage',m.last_message,
    'lastMessageAt',m.last_message_at,
    'unreadCount',coalesce(uc.unread_count,0)
  ) order by m.activity_at desc,m.id desc),'[]'::jsonb)
  from page m
  left join lateral (
    select jsonb_agg(a.purpose order by a.purpose) as purposes
    from public.pet_purposes a
    join public.pet_purposes b on b.purpose=a.purpose
    where a.pet_id=p_pet_id
      and a.purpose<>'mating'
      and b.pet_id=case when m.pet_low_id=p_pet_id then m.pet_high_id else m.pet_low_id end
  ) cp on true
  left join lateral (
    select count(*)::bigint as unread_count
    from public.messages msg
    where msg.conversation_id=m.conversation_id
      and msg.sender_pet_id<>p_pet_id
      and msg.read_at is null
  ) uc on true;
$$;
revoke all on function public.get_matches_page(uuid,integer,timestamptz,uuid) from public,anon;
grant execute on function public.get_matches_page(uuid,integer,timestamptz,uuid) to authenticated;

create or replace function public.get_unread_match_message_count(p_pet_id uuid)
returns bigint language sql stable security definer set search_path='' as $$
  select count(*)::bigint
  from public.messages msg
  join public.conversations c on c.id=msg.conversation_id
  join public.pet_matches m on m.id=c.match_id
  where public.owns_pet(p_pet_id)
    and m.unmatched_at is null
    and (m.pet_low_id=p_pet_id or m.pet_high_id=p_pet_id)
    and not public.is_blocked(m.pet_low_id,m.pet_high_id)
    and msg.sender_pet_id<>p_pet_id
    and msg.read_at is null;
$$;
revoke all on function public.get_unread_match_message_count(uuid) from public,anon;
grant execute on function public.get_unread_match_message_count(uuid) to authenticated;

create or replace function public.get_match_by_conversation(p_pet_id uuid,p_conversation_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'id',m.id,
    'conversationId',c.id,
    'otherPet',public.pet_json(case when m.pet_low_id=p_pet_id then m.pet_high_id else m.pet_low_id end,p_pet_id),
    'matchedAt',m.matched_at,
    'commonPurposes',coalesce(cp.purposes,'[]'::jsonb),
    'lastMessage',lm.body,
    'lastMessageAt',lm.created_at,
    'unreadCount',coalesce(uc.unread_count,0)
  )
  from public.conversations c
  join public.pet_matches m on m.id=c.match_id
  left join lateral (
    select jsonb_agg(a.purpose order by a.purpose) as purposes
    from public.pet_purposes a
    join public.pet_purposes b on b.purpose=a.purpose
    where a.pet_id=p_pet_id
      and a.purpose<>'mating'
      and b.pet_id=case when m.pet_low_id=p_pet_id then m.pet_high_id else m.pet_low_id end
  ) cp on true
  left join lateral (
    select msg.body,msg.created_at
    from public.messages msg
    where msg.conversation_id=c.id
    order by msg.created_at desc,msg.id desc
    limit 1
  ) lm on true
  left join lateral (
    select count(*)::bigint as unread_count
    from public.messages msg
    where msg.conversation_id=c.id
      and msg.sender_pet_id<>p_pet_id
      and msg.read_at is null
  ) uc on true
  where c.id=p_conversation_id
    and public.owns_pet(p_pet_id)
    and m.unmatched_at is null
    and p_pet_id in(m.pet_low_id,m.pet_high_id)
    and not public.is_blocked(m.pet_low_id,m.pet_high_id)
    and exists(select 1 from public.pets op join public.users ou on ou.id=op.owner_id where op.id=case when m.pet_low_id=p_pet_id then m.pet_high_id else m.pet_low_id end and ou.suspended_at is null and ou.paused_at is null)
  limit 1;
$$;
revoke all on function public.get_match_by_conversation(uuid,uuid) from public,anon;
grant execute on function public.get_match_by_conversation(uuid,uuid) to authenticated;


