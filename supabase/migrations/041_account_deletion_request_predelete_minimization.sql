-- Tailmance TUR 2: authenticated hard-delete must not leave a prior web deletion
-- request holding plain email / IP-derived abuse metadata after the Auth identity is gone.
-- Minimize before destructive deletion, while binding the request to the already-authenticated user
-- so a failed hard-delete remains safely retryable without retaining the original PII.

create or replace function public.minimize_account_deletion_requests_for_user(
  p_user_id uuid,
  p_email_hash text default null
) returns integer
language plpgsql security definer set search_path=''
as $$
declare
  v_updated integer;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_user_id is null then raise exception 'invalid_user_id'; end if;

  update public.account_deletion_requests
  set target_user_id=p_user_id,
      identity_verified_at=coalesce(identity_verified_at,now()),
      verification_reference=coalesce(verification_reference,'authenticated_account_deletion'),
      email=null,
      email_hash=null,
      ip_hash=null,
      request_fingerprint=null
  where status in ('pending','verifying')
    and (
      target_user_id=p_user_id
      or (p_email_hash is not null and email_hash=p_email_hash)
    );
  get diagnostics v_updated=row_count;
  return v_updated;
end;
$$;
revoke all on function public.minimize_account_deletion_requests_for_user(uuid,text) from public,anon,authenticated;
grant execute on function public.minimize_account_deletion_requests_for_user(uuid,text) to service_role;

-- A request whose target was bound by an authenticated delete attempt no longer needs to retain
-- email PII. The service operator still must explicitly attest identity verification to claim it.
create or replace function public.claim_web_account_deletion_request(
  p_request_id uuid,
  p_identity_verified boolean,
  p_verification_reference text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_row public.account_deletion_requests%rowtype;
  v_token uuid:=gen_random_uuid();
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_identity_verified is distinct from true then raise exception 'identity_verification_required'; end if;
  if p_verification_reference is null or char_length(trim(p_verification_reference)) not between 1 and 255 then raise exception 'verification_reference_required'; end if;

  select * into v_row from public.account_deletion_requests where id=p_request_id for update;
  if v_row.id is null then return jsonb_build_object('claimed',false,'status','not_found'); end if;
  if v_row.status in ('completed','rejected') then return jsonb_build_object('claimed',false,'status',v_row.status); end if;
  if v_row.target_user_id is null and (v_row.email_hash is null or v_row.email is null) then raise exception 'request_identity_missing'; end if;
  if v_row.status='verifying' and v_row.claimed_at is not null and v_row.claimed_at>now()-interval '15 minutes' then
    return jsonb_build_object('claimed',false,'status','verifying');
  end if;

  update public.account_deletion_requests
  set status='verifying',claim_token=v_token,claimed_at=now(),identity_verified_at=coalesce(identity_verified_at,now()),
      verification_reference=left(trim(p_verification_reference),255)
  where id=p_request_id;

  return jsonb_build_object(
    'claimed',true,'claimToken',v_token,'status','verifying','emailHash',v_row.email_hash,
    'email',v_row.email,'targetUserId',v_row.target_user_id
  );
end;
$$;
revoke all on function public.claim_web_account_deletion_request(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_web_account_deletion_request(uuid,boolean,text) to service_role;
