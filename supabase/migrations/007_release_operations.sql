-- Tailmance release operations: web deletion requests and notification extensibility.

alter type public.notification_type add value if not exists 'marketing';

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null check (char_length(email) between 3 and 254),
  email_hash text not null,
  ip_hash text,
  request_fingerprint text not null unique,
  source text not null default 'web' check (source in ('web','support')),
  status text not null default 'pending' check (status in ('pending','verifying','completed','rejected')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_note text
);
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from anon, authenticated;
create index if not exists account_deletion_requests_status_idx on public.account_deletion_requests(status,requested_at);
create index if not exists account_deletion_requests_email_hash_idx on public.account_deletion_requests(email_hash,requested_at desc);

comment on table public.account_deletion_requests is 'Public web deletion requests. Accessible only through trusted service-role operations; never exposed directly to clients.';
