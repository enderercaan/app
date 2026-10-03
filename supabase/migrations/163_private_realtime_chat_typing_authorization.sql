-- Tailmance v19 R8 — private Realtime authorization for ephemeral chat typing.
-- Do NOT ALTER realtime.messages RLS here: Supabase owns that table and RLS is already enabled.
-- Policies authorize only authenticated members of an active conversation topic.

create or replace function public.can_access_tailmance_realtime_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_conversation_id uuid;
begin
  if v_user_id is null or p_topic is null then return false; end if;

  if p_topic ~ '^conversation:[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' then
    v_conversation_id:=split_part(p_topic,':',2)::uuid;
    return exists(
      select 1
      from public.conversations c
      join public.pet_matches m on m.id=c.match_id and m.unmatched_at is null
      join public.pets p on p.owner_id=v_user_id and p.id in(m.pet_low_id,m.pet_high_id)
      where c.id=v_conversation_id
    );
  end if;

  return false;
exception when invalid_text_representation then
  return false;
end $$;

revoke all on function public.can_access_tailmance_realtime_topic(text) from public,anon;
grant execute on function public.can_access_tailmance_realtime_topic(text) to authenticated;

drop policy if exists tailmance_private_chat_broadcast_read on realtime.messages;
create policy tailmance_private_chat_broadcast_read
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension='broadcast'
  and public.can_access_tailmance_realtime_topic((select realtime.topic()))
);

drop policy if exists tailmance_private_chat_broadcast_send on realtime.messages;
create policy tailmance_private_chat_broadcast_send
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension='broadcast'
  and public.can_access_tailmance_realtime_topic((select realtime.topic()))
);
