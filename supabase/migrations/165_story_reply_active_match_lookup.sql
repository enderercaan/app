-- Tailmance v19 R8 — pagination-independent active-match lookup for Story replies.
-- Story UI must not depend on whether an active match happened to be loaded in the
-- first client page. The server remains authoritative for ownership, block state,
-- match activity and recipient account availability.

create or replace function public.get_active_match_with_pet(
  p_pet_id uuid,
  p_other_pet_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'id',m.id,
    'conversationId',c.id,
    'otherPet',public.pet_json(p_other_pet_id,p_pet_id),
    'matchedAt',m.matched_at,
    'commonPurposes',coalesce(cp.purposes,'[]'::jsonb),
    'lastMessage',lm.body,
    'lastMessageAt',lm.created_at,
    'unreadCount',coalesce(uc.unread_count,0)
  )
  from public.pet_matches m
  join public.conversations c on c.match_id=m.id
  join public.pets other_pet on other_pet.id=p_other_pet_id
  join public.users other_user on other_user.id=other_pet.owner_id
  left join lateral (
    select jsonb_agg(a.purpose order by a.purpose) as purposes
    from public.pet_purposes a
    join public.pet_purposes b on b.purpose=a.purpose
    where a.pet_id=p_pet_id
      and a.purpose<>'mating'
      and b.pet_id=p_other_pet_id
  ) cp on true
  left join lateral (
    select msg.body,msg.created_at
    from public.messages msg
    where msg.conversation_id=c.id
      and (msg.moderation_status='approved' or (msg.sender_pet_id=p_pet_id and msg.moderation_status='pending'))
    order by msg.created_at desc,msg.id desc
    limit 1
  ) lm on true
  left join lateral (
    select count(*)::bigint as unread_count
    from public.messages msg
    where msg.conversation_id=c.id
      and msg.sender_pet_id<>p_pet_id
      and msg.read_at is null
      and msg.moderation_status='approved'
  ) uc on true
  where public.owns_pet(p_pet_id)
    and p_other_pet_id is distinct from p_pet_id
    and m.unmatched_at is null
    and m.pet_low_id=least(p_pet_id,p_other_pet_id)
    and m.pet_high_id=greatest(p_pet_id,p_other_pet_id)
    and not public.is_blocked(p_pet_id,p_other_pet_id)
    and other_user.suspended_at is null
    and other_user.paused_at is null
  limit 1;
$$;

revoke all on function public.get_active_match_with_pet(uuid,uuid) from public,anon;
grant execute on function public.get_active_match_with_pet(uuid,uuid) to authenticated;
