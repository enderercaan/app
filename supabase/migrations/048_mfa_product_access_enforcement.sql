-- Tailmance v18: MFA must be a server-side authorization boundary, not only a UI gate.
-- If a user has at least one verified factor, an AAL1 JWT must not be able to read or
-- mutate authenticated product data through RPCs that do not already pass owns_pet().

create or replace function public.current_session_satisfies_mfa_if_enrolled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and (
      not exists(
        select 1
        from auth.mfa_factors f
        where f.user_id = auth.uid() and f.status::text = 'verified'
      )
      or coalesce(auth.jwt()->>'aal','aal1') = 'aal2'
    );
$$;
revoke all on function public.current_session_satisfies_mfa_if_enrolled() from public,anon,authenticated;
grant execute on function public.current_session_satisfies_mfa_if_enrolled() to service_role;

-- Keep the existing legal/18+/email/account-state product gate and add the MFA session gate.
create or replace function public.current_user_has_product_access()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select public.current_session_satisfies_mfa_if_enrolled() and exists(
    select 1
    from public.users u
    join public.app_security_config c on c.singleton=true
    where u.id=auth.uid()
      and u.suspended_at is null
      and u.paused_at is null
      and u.age_18_confirmed=true
      and u.legal_version=c.current_legal_version
      and exists(
        select 1 from public.legal_acceptances a
        where a.user_id=u.id and a.legal_version=c.current_legal_version
      )
      and exists(
        select 1 from auth.users au
        where au.id=u.id and au.email_confirmed_at is not null
      )
  );
$$;
revoke all on function public.current_user_has_product_access() from public,anon,authenticated;
grant execute on function public.current_user_has_product_access() to service_role;

-- Account preference RPCs are SECURITY DEFINER functions. Protect their underlying user-row
-- mutations centrally so future preference RPCs cannot accidentally become an AAL1 bypass.
create or replace function public.enforce_authenticated_user_update_mfa()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if auth.role()='authenticated' and not public.current_session_satisfies_mfa_if_enrolled() then
    raise exception 'mfa_required';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_authenticated_user_update_mfa() from public,anon,authenticated;

drop trigger if exists trg_users_require_mfa_for_authenticated_update on public.users;
create trigger trg_users_require_mfa_for_authenticated_update
before update on public.users
for each row execute function public.enforce_authenticated_user_update_mfa();

-- Bootstrap reads happen before legal acceptance is checked, so gate these on MFA only rather
-- than full product access. Accounts with no enrolled factor continue through onboarding/legal.
create or replace function public.get_my_pets()
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.current_session_satisfies_mfa_if_enrolled() then
    coalesce(jsonb_agg(public.pet_json(p.id,p.id) order by p.created_at),'[]'::jsonb)
  else '[]'::jsonb end
  from public.pets p where p.owner_id=auth.uid();
$$;
revoke all on function public.get_my_pets() from public,anon;
grant execute on function public.get_my_pets() to authenticated;

create or replace function public.get_account_settings()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'tier',u.tier,'freeMessagesSent',u.free_messages_sent,'discoverable',u.discoverable,
    'incognito',u.incognito,'paused',u.paused_at is not null,'suspended',u.suspended_at is not null,'age18Confirmed',u.age_18_confirmed,'legalVersion',u.legal_version,
    'identityVerified',coalesce(u.identity_verified,false),'preferredLocale',u.preferred_locale,'measurementSystem',u.measurement_system,
    'notificationPreferences',('{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb || coalesce(u.notification_preferences,'{}'::jsonb))
  ) from public.users u
  where u.id=auth.uid() and public.current_session_satisfies_mfa_if_enrolled();
$$;
revoke all on function public.get_account_settings() from public,anon;
grant execute on function public.get_account_settings() to authenticated;

create or replace function public.get_verification_status()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'identityVerified',coalesce(u.identity_verified,false),
    'identityVerifiedAt',u.identity_verified_at,
    'latestStatus',coalesce((select s.status from public.owner_verification_sessions s where s.user_id=u.id order by s.created_at desc limit 1),'not_started'),
    'latestRequestedAt',(select s.created_at from public.owner_verification_sessions s where s.user_id=u.id order by s.created_at desc limit 1)
  ) from public.users u
  where u.id=auth.uid() and public.current_session_satisfies_mfa_if_enrolled();
$$;
revoke all on function public.get_verification_status() from public,anon;
grant execute on function public.get_verification_status() to authenticated;

create or replace function public.get_notifications_page(p_limit integer default 40,p_before_created_at timestamptz default null,p_before_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.current_session_satisfies_mfa_if_enrolled() then coalesce(jsonb_agg(jsonb_build_object(
    'id',n.id,'type',n.type,'title',n.title,'body',n.body,'createdAt',n.created_at,'readAt',n.read_at,'entityId',n.entity_id,
    'templateKey',n.template_key,'templateParams',n.template_params
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

create or replace function public.get_unread_notification_count()
returns bigint language sql stable security definer set search_path='' as $$
  select case when public.current_session_satisfies_mfa_if_enrolled() then count(*)::bigint else 0::bigint end
  from public.notifications
  where user_id=auth.uid() and read_at is null;
$$;
revoke all on function public.get_unread_notification_count() from public,anon;
grant execute on function public.get_unread_notification_count() to authenticated;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.current_session_satisfies_mfa_if_enrolled() then raise exception 'mfa_required'; end if;
  update public.notifications set read_at=coalesce(read_at,now()) where id=p_notification_id and user_id=auth.uid();
end;
$$;
revoke all on function public.mark_notification_read(uuid) from public,anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;

create or replace function public.mark_all_notifications_read()
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.current_session_satisfies_mfa_if_enrolled() then raise exception 'mfa_required'; end if;
  update public.notifications set read_at=coalesce(read_at,now()) where user_id=auth.uid() and read_at is null;
end;
$$;
revoke all on function public.mark_all_notifications_read() from public,anon;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- Push registration is not pet-owned when p_active_pet_id is null, so it needs an explicit
-- product/MFA gate in addition to the optional owns_pet() check.
create or replace function public.register_push_token(p_token text,p_platform text,p_active_pet_id uuid default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.current_user_has_product_access() then raise exception 'product_access_required'; end if;
  if p_platform not in ('ios','android') then raise exception 'invalid_platform'; end if;
  if length(trim(coalesce(p_token,'')))<20 or length(p_token)>512 then raise exception 'invalid_push_token'; end if;
  if p_active_pet_id is not null and not public.owns_pet(p_active_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('push_token_register',40,86400);

  insert into public.push_tokens(user_id,token,platform,active_pet_id,enabled)
  values(auth.uid(),trim(p_token),p_platform,p_active_pet_id,true)
  on conflict(token) do update set
    user_id=auth.uid(),platform=excluded.platform,active_pet_id=excluded.active_pet_id,enabled=true,last_seen_at=now();

  update public.push_tokens
  set enabled=false
  where user_id=auth.uid() and enabled
    and id not in (
      select id from public.push_tokens
      where user_id=auth.uid() and enabled
      order by last_seen_at desc,id desc
      limit 10
    );
end;
$$;
revoke all on function public.register_push_token(text,text,uuid) from public,anon;
grant execute on function public.register_push_token(text,text,uuid) to authenticated;
