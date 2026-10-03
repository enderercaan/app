-- Tailmance v19 R8 — private Realtime authorization must honor the same
-- authenticated-session revocation and enrolled-MFA boundary as RPC traffic.

create or replace function public.can_access_tailmance_realtime_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid;
  v_conversation_id uuid;
begin
  perform public.require_active_authenticated_session();
  v_user_id:=auth.uid();
  if p_topic is null then return false; end if;

  if p_topic ~ '^conversation:[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' then
    v_conversation_id:=split_part(p_topic,':',2)::uuid;
    return exists(
      select 1
      from public.conversations c
      join public.pet_matches m on m.id=c.match_id and m.unmatched_at is null
      join public.pets p on p.owner_id=v_user_id and p.id in(m.pet_low_id,m.pet_high_id)
      where c.id=v_conversation_id
        and not public.is_blocked(m.pet_low_id,m.pet_high_id)
    );
  end if;

  return false;
exception when invalid_text_representation then
  return false;
end $$;

revoke all on function public.can_access_tailmance_realtime_topic(text) from public,anon;
grant execute on function public.can_access_tailmance_realtime_topic(text) to authenticated;
