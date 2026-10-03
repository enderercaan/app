-- Owner verification is revocable. A previously verified provider session must not leave
-- a permanent trust badge after the provider later reports revocation or expiry.

create or replace function public.apply_owner_verification_result(p_request_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_session public.owner_verification_sessions;
  v_now timestamptz:=now();
  v_still_verified boolean:=false;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_status not in ('verified','failed','expired','cancelled','revoked') then raise exception 'invalid_status'; end if;
  select * into v_session from public.owner_verification_sessions where id=p_request_id for update;
  if v_session.id is null then raise exception 'verification_session_not_found'; end if;

  if v_session.status='verified' and p_status in ('revoked','expired') then
    update public.owner_verification_sessions set status=p_status,updated_at=v_now where id=p_request_id;
    select exists(select 1 from public.owner_verification_sessions s where s.user_id=v_session.user_id and s.id<>p_request_id and s.status='verified') into v_still_verified;
    update public.users
      set identity_verified=v_still_verified,
          identity_verified_at=case when v_still_verified then identity_verified_at else null end
      where id=v_session.user_id;
    if not found then raise exception 'verification_user_not_found'; end if;
    insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
    values(v_session.user_id,'owner_identity_verification_revoked','user',v_session.user_id,jsonb_build_object('requestId',p_request_id,'status',p_status,'stillVerified',v_still_verified));
    return jsonb_build_object('ok',true,'idempotent',false,'stale',false,'status',p_status,'identityVerified',v_still_verified);
  end if;

  if v_session.status<>'pending' then
    return jsonb_build_object('ok',true,'idempotent',v_session.status=p_status,'stale',v_session.status<>p_status,'status',v_session.status);
  end if;

  update public.owner_verification_sessions set status=p_status,updated_at=v_now where id=p_request_id;
  if p_status='verified' then
    update public.users set identity_verified=true,identity_verified_at=v_now where id=v_session.user_id;
    if not found then raise exception 'verification_user_not_found'; end if;
    insert into public.audit_events(user_id,action,entity_type,entity_id,metadata)
    values(v_session.user_id,'owner_identity_verified','user',v_session.user_id,jsonb_build_object('requestId',p_request_id));
  end if;
  return jsonb_build_object('ok',true,'idempotent',false,'stale',false,'status',p_status);
end $$;
revoke all on function public.apply_owner_verification_result(uuid,text) from public,anon,authenticated;
grant execute on function public.apply_owner_verification_result(uuid,text) to service_role;
