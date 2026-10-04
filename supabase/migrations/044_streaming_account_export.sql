-- Tailmance TUR 2: bounded-memory, one-time account export downloads.
-- Raw bearer download tokens never persist in Postgres; only SHA-256 hashes are stored.

create table if not exists public.account_export_download_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.account_export_download_tokens enable row level security;
revoke all on table public.account_export_download_tokens from public,anon,authenticated;
grant all on table public.account_export_download_tokens to service_role;

create unique index if not exists account_export_download_tokens_one_per_user
  on public.account_export_download_tokens(user_id);
create index if not exists idx_account_export_download_tokens_user
  on public.account_export_download_tokens(user_id,created_at desc);
create index if not exists idx_account_export_download_tokens_expiry
  on public.account_export_download_tokens(expires_at) where claimed_at is null;

create or replace function public.claim_account_export_download_token(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare v_user_id uuid;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;

  update public.account_export_download_tokens
  set claimed_at=now()
  where token_hash=p_token_hash
    and claimed_at is null
    and expires_at>now()
  returning user_id into v_user_id;

  return v_user_id;
end $$;
revoke all on function public.claim_account_export_download_token(text) from public,anon,authenticated;
grant execute on function public.claim_account_export_download_token(text) to service_role;
