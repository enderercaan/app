-- Tailmance v19 R8: bind AI decision metadata to the health-document privacy lifecycle.
-- The inference ledger is exportable metadata, but remains private to clients at runtime.
-- Deleting the underlying health document must erase its AI-processing history as well.

create or replace function public.trg_erase_health_ai_inference_logs()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  delete from public.ai_inference_logs
   where target_type='health_document' and target_id=old.id;
  return old;
end $$;
revoke all on function public.trg_erase_health_ai_inference_logs() from public,anon,authenticated;

drop trigger if exists trg_health_document_erase_ai_logs on public.health_documents;
create trigger trg_health_document_erase_ai_logs
before delete on public.health_documents
for each row execute function public.trg_erase_health_ai_inference_logs();

create or replace function public.service_purge_ai_inference_logs(p_before timestamptz default now()-interval '180 days')
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare v_deleted integer;
begin
  delete from public.ai_inference_logs
   where created_at < least(coalesce(p_before,now()-interval '180 days'),now()-interval '30 days');
  get diagnostics v_deleted=row_count;
  return v_deleted;
end $$;
revoke all on function public.service_purge_ai_inference_logs(timestamptz) from public,anon,authenticated;
grant execute on function public.service_purge_ai_inference_logs(timestamptz) to service_role;
