-- PawLink production polish: user controls, notification preferences, report transparency and reminder dedupe.

alter table public.users
  add column if not exists notification_preferences jsonb not null default '{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false}'::jsonb;

alter table public.notifications add column if not exists dedupe_key text;
create unique index if not exists notifications_dedupe_key_unique on public.notifications(dedupe_key) where dedupe_key is not null;

create or replace function public.get_account_settings()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'tier',u.tier,'freeMessagesSent',u.free_messages_sent,'discoverable',u.discoverable,
    'incognito',u.incognito,'age18Confirmed',u.age_18_confirmed,'legalVersion',u.legal_version,
    'identityVerified',coalesce(u.identity_verified,false),
    'notificationPreferences',coalesce(u.notification_preferences,'{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false}'::jsonb)
  ) from public.users u where u.id=auth.uid();
$$;

create or replace function public.update_notification_preferences(p_preferences jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_allowed jsonb;
begin
  perform public.rate_limit('notification_preferences',30,3600);
  v_allowed := jsonb_build_object(
    'matches',coalesce((p_preferences->>'matches')::boolean,true),
    'messages',coalesce((p_preferences->>'messages')::boolean,true),
    'social',coalesce((p_preferences->>'social')::boolean,true),
    'events',coalesce((p_preferences->>'events')::boolean,true),
    'health',coalesce((p_preferences->>'health')::boolean,true),
    'marketing',coalesce((p_preferences->>'marketing')::boolean,false)
  );
  update public.users set notification_preferences=v_allowed,updated_at=now() where id=auth.uid();
  return v_allowed;
end $$;

create or replace function public.get_blocked_pets(p_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.owns_pet(p_pet_id) then coalesce(jsonb_agg(public.pet_json(b.blocked_pet_id,p_pet_id) order by b.created_at desc),'[]'::jsonb) else null end
  from public.blocks b where b.blocker_pet_id=p_pet_id;
$$;

create or replace function public.unblock_pet(p_blocker_pet_id uuid,p_blocked_pet_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_blocker_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('unblock_pet',60,3600);
  delete from public.blocks where blocker_pet_id=p_blocker_pet_id and blocked_pet_id=p_blocked_pet_id;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id)
  values(auth.uid(),p_blocker_pet_id,'pet_unblocked','pet',p_blocked_pet_id);
end $$;

create or replace function public.get_my_reports(p_limit integer default 100)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'targetType',r.target_type,'targetId',r.target_id,'reason',r.reason,
    'details',r.details,'status',r.status,'createdAt',r.created_at
  ) order by r.created_at desc),'[]'::jsonb)
  from (select * from public.reports where reporter_user_id=auth.uid() order by created_at desc limit least(greatest(p_limit,1),200)) r;
$$;

revoke all on function public.get_account_settings() from public,anon;
grant execute on function public.get_account_settings() to authenticated;
revoke all on function public.update_notification_preferences(jsonb) from public,anon;
grant execute on function public.update_notification_preferences(jsonb) to authenticated;
revoke all on function public.get_blocked_pets(uuid) from public,anon;
grant execute on function public.get_blocked_pets(uuid) to authenticated;
revoke all on function public.unblock_pet(uuid,uuid) from public,anon;
grant execute on function public.unblock_pet(uuid,uuid) to authenticated;
revoke all on function public.get_my_reports(integer) from public,anon;
grant execute on function public.get_my_reports(integer) to authenticated;
