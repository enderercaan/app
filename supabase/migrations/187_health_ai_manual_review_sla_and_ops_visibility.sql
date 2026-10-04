-- Tailmance v19 R8: health-AI manual-review SLA clock and service-only operations visibility.
-- The application can make the <24h obligation measurable and fail-loud, but cannot fabricate
-- real reviewer staffing evidence. A 23h source deadline leaves one hour of operational margin.

alter table public.health_ai_jobs
  add column if not exists manual_review_due_at timestamptz;

update public.health_ai_jobs
set manual_review_due_at = created_at + interval '23 hours'
where status='manual_review' and manual_review_due_at is null;

create or replace function public.enforce_health_ai_manual_review_deadline()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.status='manual_review' then
    new.manual_review_due_at := coalesce(new.manual_review_due_at,new.created_at + interval '23 hours');
    if new.manual_review_due_at > new.created_at + interval '23 hours' then
      raise exception 'health_ai_manual_review_deadline_too_late';
    end if;
  else
    new.manual_review_due_at := null;
  end if;
  return new;
end $$;
revoke all on function public.enforce_health_ai_manual_review_deadline() from public,anon,authenticated;

drop trigger if exists trg_health_ai_manual_review_deadline on public.health_ai_jobs;
create trigger trg_health_ai_manual_review_deadline
before insert or update of status,manual_review_due_at on public.health_ai_jobs
for each row execute function public.enforce_health_ai_manual_review_deadline();

alter table public.health_ai_jobs
  drop constraint if exists health_ai_jobs_manual_review_due_check;
alter table public.health_ai_jobs
  add constraint health_ai_jobs_manual_review_due_check check (
    (status='manual_review' and manual_review_due_at is not null and manual_review_due_at<=created_at+interval '23 hours')
    or (status<>'manual_review' and manual_review_due_at is null)
  ) not valid;
alter table public.health_ai_jobs validate constraint health_ai_jobs_manual_review_due_check;

create index if not exists idx_health_ai_manual_review_due
  on public.health_ai_jobs(manual_review_due_at,created_at,health_document_id)
  where status='manual_review';

create or replace function public.service_health_ai_manual_review_queue(p_limit integer default 100)
returns table(
  health_document_id uuid,
  created_at timestamptz,
  manual_review_due_at timestamptz,
  overdue boolean,
  last_error_code text
)
language sql
stable
security definer
set search_path=''
as $$
  select
    j.health_document_id,
    j.created_at,
    j.manual_review_due_at,
    j.manual_review_due_at<=now() as overdue,
    j.last_error_code
  from public.health_ai_jobs j
  join public.health_documents d on d.id=j.health_document_id
  where j.status='manual_review'
    and d.verification_status='pending'
  order by j.manual_review_due_at asc,j.created_at asc,j.health_document_id asc
  limit least(greatest(coalesce(p_limit,100),1),500)
$$;
revoke all on function public.service_health_ai_manual_review_queue(integer) from public,anon,authenticated;
grant execute on function public.service_health_ai_manual_review_queue(integer) to service_role;

create or replace function public.service_health_ai_ops_snapshot()
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'generatedAt',now(),
    'pending',(select count(*) from public.health_ai_jobs where status in ('pending','failed')),
    'processing',(select count(*) from public.health_ai_jobs where status='processing'),
    'manualReview',(select count(*) from public.health_ai_jobs where status='manual_review'),
    'manualReviewOverdue',(select count(*) from public.health_ai_jobs where status='manual_review' and manual_review_due_at<=now()),
    'oldestManualReviewDueAt',(select min(manual_review_due_at) from public.health_ai_jobs where status='manual_review'),
    'workerLastStartedAt',(select last_started_at from public.worker_heartbeats where worker='health-ai-worker'),
    'workerLastCompletedAt',(select last_completed_at from public.worker_heartbeats where worker='health-ai-worker')
  )
$$;
revoke all on function public.service_health_ai_ops_snapshot() from public,anon,authenticated;
grant execute on function public.service_health_ai_ops_snapshot() to service_role;
