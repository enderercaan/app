-- Tailmance v19 R8 security hardening: preserve trustworthy negative platform-integrity
-- verdicts as bounded audit evidence and provide a service-role emergency revocation path.
-- Local root/debug/emulator heuristics remain untrusted risk signals and never revoke accounts by themselves.

create or replace function public.service_revoke_user_sessions(
  p_user_id uuid,
  p_reason text default 'security_incident'
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_reason text:=left(trim(coalesce(p_reason,'security_incident')),80);
  v_count integer:=0;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_user_id is null or not exists(select 1 from auth.users u where u.id=p_user_id) then
    raise exception 'user_not_found';
  end if;
  if char_length(v_reason)<2 then v_reason:='security_incident'; end if;

  insert into public.security_user_revocation_state(user_id,revoked_before,reason,updated_at)
  values(p_user_id,v_now,v_reason,v_now)
  on conflict(user_id) do update set
    revoked_before=greatest(public.security_user_revocation_state.revoked_before,excluded.revoked_before),
    reason=excluded.reason,
    updated_at=v_now;

  insert into public.security_revoked_sessions(session_id,user_id,revoked_at,reason)
  select s.id,p_user_id,v_now,v_reason
  from auth.sessions s
  where s.user_id=p_user_id
  on conflict(session_id) do update set
    user_id=excluded.user_id,
    revoked_at=greatest(public.security_revoked_sessions.revoked_at,excluded.revoked_at),
    reason=excluded.reason;
  get diagnostics v_count=row_count;

  return jsonb_build_object(
    'userId',p_user_id,
    'revokedAt',v_now,
    'knownSessions',v_count,
    'reason',v_reason
  );
end;
$$;
revoke all on function public.service_revoke_user_sessions(uuid,text) from public,anon,authenticated;
grant execute on function public.service_revoke_user_sessions(uuid,text) to service_role;

comment on function public.service_revoke_user_sessions(uuid,text) is
  'Service-role emergency revocation. Marks every currently known GoTrue session ID plus a per-user revocation watermark so already-issued JWTs are denied immediately by Tailmance authorization boundaries. Does not trust client-side root/debug heuristics as an automatic revocation decision.';
