-- Tailmance v19 R8: distinguish ordinary Expo push registrations from iOS
-- PushKit VoIP registrations so call delivery can never route a VoIP token through
-- the Expo Push API. Existing registrations remain ordinary Expo transports.

alter table public.push_tokens
  add column if not exists transport text not null default 'expo';

alter table public.push_tokens
  drop constraint if exists push_tokens_transport_check;
alter table public.push_tokens
  add constraint push_tokens_transport_check
  check (transport in ('expo','apns_voip'));

alter table public.push_tokens
  drop constraint if exists push_tokens_voip_platform_check;
alter table public.push_tokens
  add constraint push_tokens_voip_platform_check
  check (transport <> 'apns_voip' or platform = 'ios');

create index if not exists idx_push_tokens_user_transport_enabled
  on public.push_tokens(user_id,transport,enabled,last_seen_at desc,id desc);

revoke all on function public.register_push_token(text,text,uuid) from public,anon,authenticated;
drop function if exists public.register_push_token(text,text,uuid);

create or replace function public.register_push_token(
  p_token text,
  p_platform text,
  p_active_pet_id uuid default null,
  p_transport text default 'expo'
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_token text:=trim(coalesce(p_token,''));
  v_transport text:=lower(trim(coalesce(p_transport,'expo')));
  v_existing public.push_tokens%rowtype;
begin
  perform public.require_active_authenticated_session();
  if not public.current_user_has_product_access() then raise exception 'product_access_required'; end if;
  if p_platform not in ('ios','android') then raise exception 'invalid_platform'; end if;
  if v_transport not in ('expo','apns_voip') then raise exception 'invalid_push_transport'; end if;
  if v_transport='apns_voip' and p_platform<>'ios' then raise exception 'invalid_push_transport_platform'; end if;
  if length(v_token)<20 or length(v_token)>512 then raise exception 'invalid_push_token'; end if;
  if p_active_pet_id is not null and not public.owns_pet(p_active_pet_id) then raise exception 'forbidden'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('push-token:'||v_token,0)
  );

  select * into v_existing
  from public.push_tokens
  where token=v_token
  for update;

  if v_existing.id is not null
     and v_existing.user_id<>auth.uid()
     and v_existing.enabled then
    raise exception 'push_token_in_use';
  end if;

  if v_existing.id is not null
     and v_existing.user_id=auth.uid()
     and v_existing.platform=p_platform
     and v_existing.transport=v_transport
     and v_existing.active_pet_id is not distinct from p_active_pet_id
     and v_existing.enabled then
    if v_existing.last_seen_at<now()-interval '6 hours' then
      update public.push_tokens set last_seen_at=now() where id=v_existing.id;
    end if;
    return;
  end if;

  perform public.rate_limit('push_token_register',60,86400);

  insert into public.push_tokens(user_id,token,platform,transport,active_pet_id,enabled)
  values(auth.uid(),v_token,p_platform,v_transport,p_active_pet_id,true)
  on conflict(token) do update set
    user_id=auth.uid(),
    platform=excluded.platform,
    transport=excluded.transport,
    active_pet_id=excluded.active_pet_id,
    enabled=true,
    last_seen_at=now();

  -- Keep transport families independent. Rotating a PushKit token must never
  -- disable the user's ordinary notification token (or vice versa).
  update public.push_tokens
  set enabled=false
  where user_id=auth.uid()
    and transport=v_transport
    and enabled
    and id not in (
      select id from public.push_tokens
      where user_id=auth.uid() and transport=v_transport and enabled
      order by last_seen_at desc,id desc
      limit case when v_transport='apns_voip' then 4 else 10 end
    );
end;
$$;
revoke all on function public.register_push_token(text,text,uuid,text) from public,anon;
grant execute on function public.register_push_token(text,text,uuid,text) to authenticated;
