-- TUR 2: serialize owner-verification starts and prevent provider/session abuse.
-- Historical duplicate pending rows are cancelled deterministically before the unique guard is installed.

with ranked as (
  select id,
         row_number() over (partition by user_id order by created_at desc, id desc) as rn
  from public.owner_verification_sessions
  where status='pending'
)
update public.owner_verification_sessions s
set status='cancelled',updated_at=now()
from ranked r
where s.id=r.id and r.rn>1;

update public.owner_verification_sessions
set status='expired',updated_at=now()
where status='pending' and expires_at is not null and expires_at<=now();

create unique index if not exists owner_verification_one_pending_per_user_idx
  on public.owner_verification_sessions(user_id)
  where status='pending';
