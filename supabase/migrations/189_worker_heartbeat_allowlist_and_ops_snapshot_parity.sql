-- Tailmance v19 R8: keep worker heartbeat storage and the operations snapshot in exact parity
-- with every scheduled source-controlled worker. This closes the runtime failure mode where a
-- newly-added worker calls markWorkerHeartbeat but an older CHECK constraint rejects the row.

alter table public.worker_heartbeats
  drop constraint if exists worker_heartbeats_worker_check;

alter table public.worker_heartbeats
  add constraint worker_heartbeats_worker_check check (
    worker in (
      'push-dispatch',
      'push-receipts',
      'storage-gc',
      'external-deletion-worker',
      'vaccination-reminders',
      'moderate-media',
      'health-ai-worker',
      'livekit-room-reaper'
    )
  );

create or replace function public.get_ops_health_snapshot()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_workers jsonb; v_queues jsonb;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'worker',e.worker,
    'lastStartedAt',h.last_started_at,
    'lastCompletedAt',h.last_completed_at,
    'maxAgeSeconds',extract(epoch from e.max_age)::integer,
    'stale',h.last_completed_at is null or h.last_completed_at < now()-e.max_age
  ) order by e.worker),'[]'::jsonb)
  into v_workers
  from (values
    ('push-dispatch'::text, interval '5 minutes'),
    ('push-receipts'::text, interval '15 minutes'),
    ('storage-gc'::text, interval '30 minutes'),
    ('external-deletion-worker'::text, interval '30 minutes'),
    ('moderate-media'::text, interval '5 minutes'),
    ('vaccination-reminders'::text, interval '26 hours'),
    ('health-ai-worker'::text, interval '5 minutes'),
    ('livekit-room-reaper'::text, interval '5 minutes')
  ) as e(worker,max_age)
  left join public.worker_heartbeats h on h.worker=e.worker;

  v_queues:=jsonb_build_object(
    'pushFailed',(select count(*) from public.notifications where push_status='failed'),
    'pushOverdue',(select count(*) from public.notifications where push_status='pending' and next_push_attempt_at<now()-interval '15 minutes'),
    'pushStuckProcessing',(select count(*) from public.notifications where push_status='processing' and push_claimed_at<now()-interval '5 minutes'),
    'pushReceiptErrors24h',(select count(*) from public.push_receipts where receipt_status='error' and created_at>=now()-interval '24 hours'),
    'storageGcExhausted',(select count(*) from public.storage_gc_queue where attempts>=8),
    'externalDeletionExhausted',(select count(*) from public.external_deletion_queue where attempts>=12),
    'moderationManualReview',(select count(*) from public.moderation_items where status='pending' and manual_review_required),
    'moderationOverdue',(select count(*) from public.moderation_items where status='pending' and not manual_review_required and coalesce(next_attempt_at,created_at)<now()-interval '15 minutes'),
    'billingFailed',(select count(*) from public.billing_webhook_events where status='failed'),
    'billingStuckProcessing',(select count(*) from public.billing_webhook_events where status='processing' and received_at<now()-interval '15 minutes'),
    'healthAiManualReviewOverdue',(select count(*) from public.health_ai_jobs where status='manual_review' and manual_review_due_at<=now()),
    'healthAiStuckProcessing',(select count(*) from public.health_ai_jobs where status='processing' and claimed_at<now()-interval '10 minutes'),
    'livekitTeardownOverdue',(select count(*) from public.livekit_room_teardown_queue where completed_at is null and status='pending' and next_attempt_at<now()-interval '5 minutes'),
    'livekitTeardownStuckProcessing',(select count(*) from public.livekit_room_teardown_queue where completed_at is null and status='processing' and coalesce(lease_until,'-infinity'::timestamptz)<now())
  );

  return jsonb_build_object('generatedAt',now(),'workers',v_workers,'queues',v_queues);
end $$;
revoke all on function public.get_ops_health_snapshot() from public,anon,authenticated;
grant execute on function public.get_ops_health_snapshot() to service_role;
