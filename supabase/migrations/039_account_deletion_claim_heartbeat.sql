-- TUR 2: destructive account deletion can legitimately outlive the stale-claim window on
-- large accounts. Active workers renew their token-bound claim so another device/worker
-- cannot recover it while the original deletion is still progressing.
create or replace function public.renew_account_deletion_claim(p_user_id uuid,p_claim_token uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_updated integer;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_user_id is null or p_claim_token is null then raise exception 'invalid_claim'; end if;
  update public.account_deletion_claims
  set claimed_at=now()
  where user_id=p_user_id and claim_token=p_claim_token;
  get diagnostics v_updated=row_count;
  return v_updated=1;
end $$;
revoke all on function public.renew_account_deletion_claim(uuid,uuid) from public,anon,authenticated;
grant execute on function public.renew_account_deletion_claim(uuid,uuid) to service_role;
