-- M/E pagination hardening: comments open on the newest approved page and older rows
-- are fetched with a stable (created_at,id) cursor instead of becoming unreachable.
create index if not exists idx_comments_post_visible_page
  on public.comments(post_id,created_at desc,id desc)
  where deleted_at is null and moderation_status='approved';

create or replace function public.get_post_comments_page(
  p_pet_id uuid,
  p_post_id uuid,
  p_limit integer default 40,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.owns_pet(p_pet_id) then coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'postId',c.post_id,'pet',public.pet_json(c.pet_id,p_pet_id),'body',c.body,'createdAt',c.created_at
  ) order by c.created_at asc,c.id asc),'[]'::jsonb) else null end
  from (
    select c.*
    from public.comments c
    join public.posts po on po.id=c.post_id
    join public.pets comment_pet on comment_pet.id=c.pet_id
    join public.users comment_user on comment_user.id=comment_pet.owner_id
    join public.pets post_pet on post_pet.id=po.pet_id
    join public.users post_user on post_user.id=post_pet.owner_id
    where c.post_id=p_post_id
      and comment_user.suspended_at is null and comment_user.paused_at is null
      and post_user.suspended_at is null and post_user.paused_at is null
      and c.deleted_at is null
      and c.moderation_status='approved'
      and po.deleted_at is null
      and po.moderation_status='approved'
      and not public.is_blocked(p_pet_id,po.pet_id)
      and not public.is_blocked(p_pet_id,c.pet_id)
      and (
        p_before_created_at is null
        or (c.created_at,c.id)<(p_before_created_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
      )
    order by c.created_at desc,c.id desc
    limit least(greatest(p_limit,1),100)
  ) c;
$$;
revoke all on function public.get_post_comments_page(uuid,uuid,integer,timestamptz,uuid) from public,anon;
grant execute on function public.get_post_comments_page(uuid,uuid,integer,timestamptz,uuid) to authenticated;

-- Bound Premium incoming-like hydration with keyset pagination. The legacy RPC remains for older clients.
create index if not exists idx_pet_likes_to_created_from
  on public.pet_likes(to_pet_id,created_at desc,from_pet_id desc);

create or replace function public.get_incoming_likes_page(
  p_pet_id uuid,
  p_limit integer default 40,
  p_before_created_at timestamptz default null,
  p_before_from_pet_id uuid default null
) returns jsonb language sql stable security definer set search_path='' as $$
  select case
    when not public.owns_pet(p_pet_id) then null
    when not exists(select 1 from public.users where id=auth.uid() and tier='premium') then jsonb_build_object('error','premium_required')
    else coalesce((
      select jsonb_agg(public.pet_json(q.from_pet_id,p_pet_id) || jsonb_build_object('likedAt',q.created_at,'likeKind',q.kind) order by q.created_at desc,q.from_pet_id desc)
      from (
        select l.from_pet_id,l.created_at,l.kind
        from public.pet_likes l
        join public.pets source_pet on source_pet.id=l.from_pet_id
        join public.users source_user on source_user.id=source_pet.owner_id
        where l.to_pet_id=p_pet_id
          and source_user.suspended_at is null and source_user.paused_at is null and source_user.discoverable
          and source_pet.moderation_status='approved'
          and not exists(select 1 from public.pet_matches m where m.unmatched_at is null and m.pet_low_id=least(l.from_pet_id,p_pet_id) and m.pet_high_id=greatest(l.from_pet_id,p_pet_id))
          and not public.is_blocked(l.from_pet_id,p_pet_id)
          and (
            p_before_created_at is null
            or (l.created_at,l.from_pet_id)<(p_before_created_at,coalesce(p_before_from_pet_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
          )
        order by l.created_at desc,l.from_pet_id desc
        limit least(greatest(p_limit,1),80)
      ) q
    ),'[]'::jsonb)
  end;
$$;
revoke all on function public.get_incoming_likes_page(uuid,integer,timestamptz,uuid) from public,anon;
grant execute on function public.get_incoming_likes_page(uuid,integer,timestamptz,uuid) to authenticated;

-- Bound account-control histories without hiding older records.
create index if not exists idx_blocks_blocker_created_page
  on public.blocks(blocker_pet_id,created_at desc,blocked_pet_id desc);
create index if not exists idx_reports_reporter_created_page
  on public.reports(reporter_user_id,created_at desc,id desc);

create or replace function public.get_blocked_pets_page(
  p_pet_id uuid,
  p_limit integer default 40,
  p_before_created_at timestamptz default null,
  p_before_blocked_pet_id uuid default null
) returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.owns_pet(p_pet_id) then coalesce((
    select jsonb_agg(public.pet_json(q.blocked_pet_id,p_pet_id) || jsonb_build_object('blockedAt',q.created_at) order by q.created_at desc,q.blocked_pet_id desc)
    from (
      select b.blocked_pet_id,b.created_at
      from public.blocks b
      where b.blocker_pet_id=p_pet_id
        and (
          p_before_created_at is null
          or (b.created_at,b.blocked_pet_id)<(p_before_created_at,coalesce(p_before_blocked_pet_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
        )
      order by b.created_at desc,b.blocked_pet_id desc
      limit least(greatest(p_limit,1),80)
    ) q
  ),'[]'::jsonb) else null end;
$$;
revoke all on function public.get_blocked_pets_page(uuid,integer,timestamptz,uuid) from public,anon;
grant execute on function public.get_blocked_pets_page(uuid,integer,timestamptz,uuid) to authenticated;

create or replace function public.get_my_reports_page(
  p_limit integer default 40,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'targetType',r.target_type,'targetId',r.target_id,'reason',r.reason,
    'details',r.details,'status',r.status,'createdAt',r.created_at
  ) order by r.created_at desc,r.id desc),'[]'::jsonb)
  from (
    select * from public.reports
    where reporter_user_id=auth.uid()
      and (p_before_created_at is null or (created_at,id)<(p_before_created_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by created_at desc,id desc
    limit least(greatest(p_limit,1),100)
  ) r;
$$;
revoke all on function public.get_my_reports_page(integer,timestamptz,uuid) from public,anon;
grant execute on function public.get_my_reports_page(integer,timestamptz,uuid) to authenticated;

-- Queue vaccination reminders in one deduplicated database operation so high-volume due dates cannot starve behind a fixed worker limit.
create index if not exists idx_vaccinations_due_reminder
  on public.pet_vaccinations(next_due_date,id)
  where next_due_date is not null and verification_status<>'rejected';

create or replace function public.enqueue_vaccination_reminders()
returns integer language plpgsql security definer set search_path='' as $$
declare v_queued integer:=0;
begin
  with candidates as (
    select v.id,v.pet_id,v.vaccine_name,v.next_due_date,p.owner_id,p.name as pet_name,(v.next_due_date-current_date)::integer as days_until
    from public.pet_vaccinations v
    join public.pets p on p.id=v.pet_id
    join public.users u on u.id=p.owner_id and u.suspended_at is null and u.paused_at is null
    where v.next_due_date is not null
      and v.verification_status<>'rejected'
      and (v.next_due_date-current_date) in (0,1,3,7)
      and not exists (
        select 1 from public.notifications n
        where n.dedupe_key=format('vaccination:%s:%s:%s',v.id,v.next_due_date,(v.next_due_date-current_date)::integer)
      )
  )
  insert into public.notifications(user_id,type,title,body,entity_id,dedupe_key)
  select owner_id,'health',
    format('Vaccination reminder for %s',pet_name),
    format('The next %s dose is due %s. Check your veterinarian''s plan.',vaccine_name,
      case days_until when 0 then 'today' when 1 then 'in 1 day' else format('in %s days',days_until) end),
    pet_id,
    format('vaccination:%s:%s:%s',id,next_due_date,days_until)
  from candidates
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_queued=row_count;
  return v_queued;
end $$;
revoke all on function public.enqueue_vaccination_reminders() from public,anon,authenticated;
grant execute on function public.enqueue_vaccination_reminders() to service_role;

-- N observability hardening: source-controlled worker liveness and PII-free operational health.
-- This does not replace production alert routing or a third-party/native crash provider.
create table if not exists public.worker_heartbeats (
  worker text primary key check(worker in ('push-dispatch','push-receipts','storage-gc','external-deletion-worker','vaccination-reminders','moderate-media')),
  last_started_at timestamptz,
  last_completed_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.worker_heartbeats enable row level security;
revoke all on public.worker_heartbeats from anon,authenticated;

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
    ('vaccination-reminders'::text, interval '26 hours')
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
    'billingStuckProcessing',(select count(*) from public.billing_webhook_events where status='processing' and received_at<now()-interval '15 minutes')
  );

  return jsonb_build_object('generatedAt',now(),'workers',v_workers,'queues',v_queues);
end $$;
revoke all on function public.get_ops_health_snapshot() from public,anon,authenticated;
grant execute on function public.get_ops_health_snapshot() to service_role;

