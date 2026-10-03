-- Tailmance v19 R8 security hardening: immediate product/Edge revocation for globally signed-out sessions.
-- Supabase global sign-out revokes refresh tokens, but an already-issued access JWT remains valid
-- until exp. We therefore persist the exact auth.sessions IDs being revoked and make the shared
-- product authorization boundary reject those session IDs immediately. JWT lifetime is separately
-- reduced to 15 minutes in config.toml to bound residual direct-read exposure.

create table if not exists public.security_revoked_sessions(
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  revoked_at timestamptz not null default now(),
  reason text not null default 'global_sign_out' check(char_length(reason) between 2 and 80),
  created_at timestamptz not null default now()
);
create index if not exists security_revoked_sessions_user_idx on public.security_revoked_sessions(user_id,revoked_at desc);

create table if not exists public.security_user_revocation_state(
  user_id uuid primary key references auth.users(id) on delete cascade,
  revoked_before timestamptz not null,
  reason text not null check(char_length(reason) between 2 and 80),
  updated_at timestamptz not null default now()
);

alter table public.security_revoked_sessions enable row level security;
alter table public.security_user_revocation_state enable row level security;
revoke all on table public.security_revoked_sessions,public.security_user_revocation_state from public,anon,authenticated;
grant select,insert,update,delete on table public.security_revoked_sessions,public.security_user_revocation_state to service_role;

create or replace function public.current_session_not_revoked()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select case
    when auth.role()='service_role' then true
    when auth.uid() is null then false
    else
      not exists(
        select 1 from public.security_revoked_sessions r
        where r.user_id=auth.uid()
          and r.session_id::text=coalesce(auth.jwt()->>'session_id','')
      )
      and not exists(
        select 1 from public.security_user_revocation_state s
        where s.user_id=auth.uid()
          and coalesce((auth.jwt()->>'iat')::bigint,0) < floor(extract(epoch from s.revoked_before))::bigint
      )
  end;
$$;
revoke all on function public.current_session_not_revoked() from public,anon,authenticated;
grant execute on function public.current_session_not_revoked() to service_role;

-- Product/MFA authorization becomes the single central session-revocation boundary for RPCs.
create or replace function public.current_session_satisfies_mfa_if_enrolled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_session_not_revoked()
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
-- RLS policies evaluate this boolean gate in the authenticated caller context. Expose only the
-- boolean gate itself; the underlying revocation tables/helpers remain service-role only.
grant execute on function public.current_session_satisfies_mfa_if_enrolled() to authenticated,service_role;

-- Before asking GoTrue to revoke refresh tokens, snapshot every live auth session ID for the user.
-- This closes the access-token grace window for product RPCs and authenticated Edge Functions.
create or replace function public.mark_all_sessions_revoked(p_reason text default 'global_sign_out')
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_reason text:=left(trim(coalesce(p_reason,'global_sign_out')),80);
  v_count integer:=0;
  v_current_session uuid;
begin
  if auth.role()<>'authenticated' or v_user is null then raise exception 'authentication_required'; end if;
  if char_length(v_reason)<2 then v_reason:='global_sign_out'; end if;

  insert into public.security_user_revocation_state(user_id,revoked_before,reason,updated_at)
  values(v_user,now(),v_reason,now())
  on conflict(user_id) do update set revoked_before=excluded.revoked_before,reason=excluded.reason,updated_at=now();

  insert into public.security_revoked_sessions(session_id,user_id,revoked_at,reason)
  select s.id,v_user,now(),v_reason from auth.sessions s where s.user_id=v_user
  on conflict(session_id) do update set user_id=excluded.user_id,revoked_at=excluded.revoked_at,reason=excluded.reason;
  get diagnostics v_count=row_count;

  begin
    v_current_session:=nullif(auth.jwt()->>'session_id','')::uuid;
  exception when others then
    v_current_session:=null;
  end;
  if v_current_session is not null then
    insert into public.security_revoked_sessions(session_id,user_id,revoked_at,reason)
    values(v_current_session,v_user,now(),v_reason)
    on conflict(session_id) do update set user_id=excluded.user_id,revoked_at=excluded.revoked_at,reason=excluded.reason;
  end if;

  return jsonb_build_object('revokedAt',now(),'knownSessions',v_count,'currentSessionCaptured',v_current_session is not null);
end;
$$;
revoke all on function public.mark_all_sessions_revoked(text) from public,anon;
grant execute on function public.mark_all_sessions_revoked(text) to authenticated;

-- Edge Functions authenticate JWTs with GoTrue and then call this service-role helper using the
-- JWT session_id + iat. A revoked refresh token can therefore not keep using an old access JWT.
create or replace function public.service_session_token_allowed(p_user_id uuid,p_session_id uuid,p_iat bigint)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select auth.role()='service_role'
    and p_user_id is not null
    and p_session_id is not null
    and p_iat is not null
    and not exists(
      select 1 from public.security_revoked_sessions r
      where r.user_id=p_user_id and r.session_id=p_session_id
    )
    and not exists(
      select 1 from public.security_user_revocation_state s
      where s.user_id=p_user_id
        and p_iat < floor(extract(epoch from s.revoked_before))::bigint
    );
$$;
revoke all on function public.service_session_token_allowed(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.service_session_token_allowed(uuid,uuid,bigint) to service_role;

-- Direct message/notification reads are the only meaningful table-read policies exposed to users;
-- bind them to the same session revocation boundary. Storage policies already call the product gate.
drop policy if exists messages_participant_read on public.messages;
create policy messages_participant_read on public.messages for select to authenticated using (
  public.current_session_satisfies_mfa_if_enrolled()
  and exists(
    select 1
    from public.conversations c
    join public.pet_matches m on m.id=c.match_id
    join public.pets mine on mine.owner_id=auth.uid() and mine.id in(m.pet_low_id,m.pet_high_id)
    where c.id=messages.conversation_id
      and m.unmatched_at is null
      and not public.is_blocked(m.pet_low_id,m.pet_high_id)
      and (
        messages.moderation_status='approved'
        or exists(select 1 from public.pets sender where sender.id=messages.sender_pet_id and sender.owner_id=auth.uid())
      )
  )
);

drop policy if exists notifications_owner_read on public.notifications;
create policy notifications_owner_read on public.notifications for select to authenticated using(
  user_id=auth.uid() and public.current_session_satisfies_mfa_if_enrolled()
);

-- Bounded cleanup after GoTrue has removed the underlying session. Open incident holds preserve data.
create or replace function public.service_cleanup_revoked_sessions(p_min_age_days integer default 7)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare v_deleted integer:=0; v_hold boolean:=false;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_min_age_days not between 1 and 90 then raise exception 'invalid_revocation_retention'; end if;
  select exists(select 1 from public.security_incidents where evidence_hold=true and status<>'resolved') into v_hold;
  if v_hold then return 0; end if;
  delete from public.security_revoked_sessions r
  where r.revoked_at<now()-make_interval(days=>p_min_age_days)
    and not exists(select 1 from auth.sessions s where s.id=r.session_id);
  get diagnostics v_deleted=row_count;
  return v_deleted;
end;
$$;
revoke all on function public.service_cleanup_revoked_sessions(integer) from public,anon,authenticated;
grant execute on function public.service_cleanup_revoked_sessions(integer) to service_role;
