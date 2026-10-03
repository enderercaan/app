-- Tailmance v19 R8: health-AI worker crash/lease recovery.
-- A worker may die after claiming a job. Processing leases older than ten minutes are recovered,
-- consume a bounded attempt, and eventually fail safe into the manual-review SLA queue.

create or replace function public.claim_health_ai_jobs(p_limit integer default 10)
returns table(health_document_id uuid,attempts integer)
language plpgsql security definer set search_path='' as $$
begin
  update public.health_ai_jobs j
  set
    attempts=least(j.attempts+1,20),
    status=case when j.attempts+1>=8 then 'manual_review' else 'failed' end,
    claimed_at=null,
    completed_at=case when j.attempts+1>=8 then now() else null end,
    not_before=case when j.attempts+1>=8 then now() else now()+interval '60 seconds' end,
    last_error_code=case when j.attempts+1>=8 then 'health_ai_stale_claim_manual_review' else 'health_ai_stale_claim_recovered' end,
    updated_at=now()
  where j.status='processing'
    and j.claimed_at is not null
    and j.claimed_at<now()-interval '10 minutes';

  update public.moderation_items mi
  set status='pending',manual_review_required=true,next_attempt_at=null,reviewed_at=null,
      last_error_code='health_ai_stale_claim_manual_review',reason=null
  from public.health_ai_jobs j
  where j.status='manual_review'
    and j.last_error_code='health_ai_stale_claim_manual_review'
    and mi.target_type='health_document'
    and mi.target_id=j.health_document_id;

  return query
  with candidates as (
    select j.health_document_id
    from public.health_ai_jobs j
    join public.health_documents d on d.id=j.health_document_id
    where d.verification_status='pending'
      and j.status in ('pending','failed')
      and j.not_before<=now()
      and j.attempts<8
    order by j.not_before asc,j.created_at asc,j.health_document_id asc
    for update of j skip locked
    limit least(greatest(coalesce(p_limit,10),1),25)
  )
  update public.health_ai_jobs j
  set status='processing',claimed_at=now(),updated_at=now()
  from candidates c
  where j.health_document_id=c.health_document_id
  returning j.health_document_id,j.attempts;
end $$;
revoke all on function public.claim_health_ai_jobs(integer) from public,anon,authenticated;
grant execute on function public.claim_health_ai_jobs(integer) to service_role;
