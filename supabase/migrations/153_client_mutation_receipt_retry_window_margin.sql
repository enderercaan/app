-- Tailmance v19 R8: keep server-side idempotency receipts beyond the client's
-- durable retry window. This prevents a boundary race where a 24-hour client
-- operation ID is still retryable while its server receipt has just been purged.

create or replace function public.purge_client_mutation_receipts(p_before timestamptz)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare v_deleted integer:=0;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  -- Client durable operation IDs live for 24 hours. Keep at least a full extra
  -- day of server replay evidence so clock/network boundary effects cannot turn
  -- an ambiguous retry into a second mutation.
  if p_before is null or p_before>now()-interval '48 hours' then raise exception 'invalid_cutoff'; end if;
  delete from public.client_mutation_receipts where created_at<p_before;
  get diagnostics v_deleted=row_count;
  return v_deleted;
end $$;

revoke all on function public.purge_client_mutation_receipts(timestamptz) from public,anon,authenticated;
grant execute on function public.purge_client_mutation_receipts(timestamptz) to service_role;
