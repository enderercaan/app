-- Tailmance v19 R8 security hardening: active GoTrue session binding + same-second revocation closure.
-- Access JWTs are accepted only while the referenced auth.sessions row is still active. Global
-- revocation state also denies tokens whose second-resolution iat falls in the revocation second,
-- closing the ambiguity created by JWT iat precision.

create or replace function public.current_session_not_revoked()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  with token as (
    select
      coalesce(auth.jwt()->>'session_id','') as session_id_text,
      case
        when coalesce(auth.jwt()->>'iat','') ~ '^[0-9]{1,20}$' then (auth.jwt()->>'iat')::bigint
        else 0::bigint
      end as issued_at
  )
  select case
    when auth.role()='service_role' then true
    when auth.role()<>'authenticated' or auth.uid() is null then false
    when not exists(
      select 1 from token t
      where t.session_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and t.issued_at>0
    ) then false
    else
      exists(
        select 1
        from token t
        join auth.sessions s on s.id=t.session_id_text::uuid
        where s.user_id=auth.uid()
      )
      and not exists(
        select 1 from public.security_revoked_sessions r, token t
        where r.user_id=auth.uid()
          and r.session_id::text=t.session_id_text
      )
      and not exists(
        select 1 from public.security_user_revocation_state s, token t
        where s.user_id=auth.uid()
          and t.issued_at <= floor(extract(epoch from s.revoked_before))::bigint
      )
  end;
$$;
revoke all on function public.current_session_not_revoked() from public,anon;
grant execute on function public.current_session_not_revoked() to authenticated,service_role;

create or replace function public.current_session_satisfies_mfa_if_enrolled()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select public.current_session_not_revoked()
    and (
      not exists(
        select 1
        from auth.mfa_factors f
        where f.user_id=auth.uid() and f.status::text='verified'
      )
      or coalesce(auth.jwt()->>'aal','aal1')='aal2'
    );
$$;
revoke all on function public.current_session_satisfies_mfa_if_enrolled() from public,anon;
grant execute on function public.current_session_satisfies_mfa_if_enrolled() to authenticated,service_role;

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
    and p_iat>0
    and exists(
      select 1 from auth.sessions s
      where s.id=p_session_id and s.user_id=p_user_id
    )
    and not exists(
      select 1 from public.security_revoked_sessions r
      where r.user_id=p_user_id and r.session_id=p_session_id
    )
    and not exists(
      select 1 from public.security_user_revocation_state s
      where s.user_id=p_user_id
        and p_iat <= floor(extract(epoch from s.revoked_before))::bigint
    );
$$;
revoke all on function public.service_session_token_allowed(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.service_session_token_allowed(uuid,uuid,bigint) to service_role;
