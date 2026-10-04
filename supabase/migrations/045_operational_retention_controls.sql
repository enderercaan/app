-- Tailmance TUR 2: service-role-only operational retention controls.
-- Retention duration is deliberately NOT hard-coded here. Operations/counsel provide
-- approved cutoffs. This function only deletes transient technical records whose
-- lifecycle is already complete and which are not authoritative audit/billing/moderation records.

create or replace function public.purge_operational_records(
  p_rate_limits_before timestamptz,
  p_push_receipts_before timestamptz,
  p_client_errors_before timestamptz,
  p_upload_intents_before timestamptz,
  p_export_tokens_before timestamptz
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_rate_limits integer:=0;
  v_push_receipts integer:=0;
  v_client_errors integer:=0;
  v_upload_intents integer:=0;
  v_export_tokens integer:=0;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_rate_limits_before is null or p_rate_limits_before>now()
     or p_push_receipts_before is null or p_push_receipts_before>now()
     or p_client_errors_before is null or p_client_errors_before>now()
     or p_upload_intents_before is null or p_upload_intents_before>now()
     or p_export_tokens_before is null or p_export_tokens_before>now() then
    raise exception 'invalid_cutoff';
  end if;

  delete from public.rate_limits
  where window_start<p_rate_limits_before
    and window_start<now()-interval '24 hours';
  get diagnostics v_rate_limits=row_count;

  delete from public.push_receipts pr
  using public.notifications n
  where pr.notification_id=n.id
    and pr.created_at<p_push_receipts_before
    and n.push_status in ('sent','failed','skipped');
  get diagnostics v_push_receipts=row_count;

  delete from public.client_error_events where occurred_at<p_client_errors_before;
  get diagnostics v_client_errors=row_count;

  delete from public.upload_intents
  where (consumed_at is not null and consumed_at<p_upload_intents_before)
     or (cancelled_at is not null and cancelled_at<p_upload_intents_before);
  get diagnostics v_upload_intents=row_count;

  delete from public.account_export_download_tokens where expires_at<p_export_tokens_before;
  get diagnostics v_export_tokens=row_count;

  return jsonb_build_object(
    'rateLimits',v_rate_limits,
    'pushReceipts',v_push_receipts,
    'clientErrors',v_client_errors,
    'uploadIntents',v_upload_intents,
    'exportTokens',v_export_tokens
  );
end;
$$;
revoke all on function public.purge_operational_records(timestamptz,timestamptz,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.purge_operational_records(timestamptz,timestamptz,timestamptz,timestamptz,timestamptz) to service_role;
