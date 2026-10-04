-- Tailmance v19 R8 ultra-deep audit: idempotency receipts are transient operational
-- records. Keep the retry window useful without allowing unbounded per-account growth,
-- and expose an explicit service-role purge for inactive accounts.

create index if not exists idx_client_mutation_receipts_user_created_at
  on public.client_mutation_receipts(user_id,created_at desc);

create or replace function public.bound_client_mutation_receipts()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  delete from public.client_mutation_receipts
  where user_id=new.user_id
    and created_at < now()-interval '30 days';

  delete from public.client_mutation_receipts r
  where r.ctid in (
    select x.ctid
    from public.client_mutation_receipts x
    where x.user_id=new.user_id
    order by x.created_at desc,x.action,x.operation_id
    offset 1000
  );
  return new;
end $$;
revoke all on function public.bound_client_mutation_receipts() from public,anon,authenticated;

drop trigger if exists trg_bound_client_mutation_receipts on public.client_mutation_receipts;
create trigger trg_bound_client_mutation_receipts
after insert on public.client_mutation_receipts
for each row execute function public.bound_client_mutation_receipts();

create or replace function public.purge_client_mutation_receipts(p_before timestamptz)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare v_deleted integer:=0;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_before is null or p_before>now()-interval '24 hours' then raise exception 'invalid_cutoff'; end if;
  delete from public.client_mutation_receipts where created_at<p_before;
  get diagnostics v_deleted=row_count;
  return v_deleted;
end $$;
revoke all on function public.purge_client_mutation_receipts(timestamptz) from public,anon,authenticated;
grant execute on function public.purge_client_mutation_receipts(timestamptz) to service_role;
