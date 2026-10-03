-- Tailmance TUR 2: retention is a policy/counsel decision, not an application guess.
-- This service-only primitive applies an externally approved cutoff without hard-coding a legal duration.

create or replace function public.purge_resolved_account_deletion_requests(p_before timestamptz)
returns integer
language plpgsql security definer set search_path=''
as $$
declare
  v_deleted integer;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_before is null or p_before>now() then raise exception 'invalid_cutoff'; end if;

  delete from public.account_deletion_requests
  where status in ('completed','rejected')
    and resolved_at is not null
    and resolved_at<p_before;
  get diagnostics v_deleted=row_count;
  return v_deleted;
end;
$$;
revoke all on function public.purge_resolved_account_deletion_requests(timestamptz) from public,anon,authenticated;
grant execute on function public.purge_resolved_account_deletion_requests(timestamptz) to service_role;
