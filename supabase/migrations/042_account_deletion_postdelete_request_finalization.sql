-- Tailmance TUR 2: use the durable external-deletion queue as the recovery anchor for
-- post-Auth-delete cleanup. A deleted identity must not leave a web deletion request
-- retaining target_user_id or an open/verifying status indefinitely.

create or replace function public.finalize_account_deletion_requests_for_deleted_user(p_user_id uuid)
returns integer
language plpgsql security definer set search_path=''
as $$
declare
  v_updated integer;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_user_id is null then raise exception 'invalid_user_id'; end if;

  update public.account_deletion_requests
  set status=case when status in ('pending','verifying') then 'completed' else status end,
      resolved_at=case when status in ('pending','verifying') then coalesce(resolved_at,now()) else resolved_at end,
      resolution_note=case when status in ('pending','verifying') then coalesce(resolution_note,'account_deleted') else resolution_note end,
      claim_token=null,
      claimed_at=null,
      target_user_id=null,
      verification_reference=null,
      email=null,
      email_hash=null,
      ip_hash=null,
      request_fingerprint=null
  where target_user_id=p_user_id;
  get diagnostics v_updated=row_count;
  return v_updated;
end;
$$;
revoke all on function public.finalize_account_deletion_requests_for_deleted_user(uuid) from public,anon,authenticated;
grant execute on function public.finalize_account_deletion_requests_for_deleted_user(uuid) to service_role;
