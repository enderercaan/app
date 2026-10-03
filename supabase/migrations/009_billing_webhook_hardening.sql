-- RevenueCat webhook processing ledger. Keeps idempotency separate from subscription history.
create table if not exists public.billing_webhook_events (
  event_id text primary key,
  event_type text not null,
  user_ids uuid[] not null default '{}',
  status text not null default 'processing' check (status in ('processing','processed','failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text
);
alter table public.billing_webhook_events enable row level security;
revoke all on public.billing_webhook_events from anon, authenticated;
create index if not exists billing_webhook_events_status_idx on public.billing_webhook_events(status,received_at);
comment on table public.billing_webhook_events is 'Private idempotency and operational ledger for verified RevenueCat webhook events.';
