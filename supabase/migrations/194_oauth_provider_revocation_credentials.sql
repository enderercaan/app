-- Tailmance v19 R8: durable, privacy-minimized OAuth provider revocation support.
-- Sign in with Apple / Google provider credentials are captured server-side encrypted so
-- account deletion can revoke external authorization without keeping provider secrets on-device.
-- The table intentionally has no FK to auth.users: queued revocation must survive local hard delete.

alter table public.external_deletion_queue
  drop constraint if exists external_deletion_queue_provider_check;
alter table public.external_deletion_queue
  add constraint external_deletion_queue_provider_check
  check(provider in ('revenuecat','apple','google'));

create table if not exists public.oauth_revocation_credentials(
  account_user_id uuid not null,
  provider text not null check(provider in ('apple','google')),
  token_kind text not null check(token_kind in ('access_token','refresh_token')),
  token_ciphertext text not null check(length(token_ciphertext) between 16 and 16384),
  token_iv text not null check(length(token_iv) between 16 and 128),
  key_version text not null check(key_version ~ '^[A-Za-z0-9._-]{1,40}$'),
  captured_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  retention_deadline timestamptz,
  primary key(account_user_id,provider),
  check(retention_deadline is null or retention_deadline>=captured_at)
);
alter table public.oauth_revocation_credentials enable row level security;
revoke all on table public.oauth_revocation_credentials from public,anon,authenticated;
grant select,insert,update,delete on table public.oauth_revocation_credentials to service_role;
create index if not exists oauth_revocation_credentials_retention_idx
  on public.oauth_revocation_credentials(retention_deadline)
  where retention_deadline is not null;

-- Operational helper used by the account-deletion path before auth.users is removed.
create or replace function public.service_prepare_oauth_revocation(
  p_user_id uuid,
  p_provider text,
  p_retention_deadline timestamptz default now()+interval '30 days'
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare v_updated integer;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_user_id is null or p_provider not in ('apple','google') then raise exception 'invalid_oauth_revocation_target'; end if;
  if p_retention_deadline is null or p_retention_deadline<now()+interval '1 day' or p_retention_deadline>now()+interval '45 days' then
    raise exception 'invalid_oauth_revocation_retention';
  end if;

  update public.oauth_revocation_credentials
  set retention_deadline=p_retention_deadline,updated_at=now()
  where account_user_id=p_user_id and provider=p_provider;
  get diagnostics v_updated = row_count;
  if v_updated=0 then return false; end if;

  insert into public.external_deletion_queue(provider,external_user_id,queued_at,not_before,attempts,last_error)
  values(p_provider,p_user_id::text,now(),now(),0,null)
  on conflict(provider,external_user_id) do update
    set not_before=least(public.external_deletion_queue.not_before,excluded.not_before),
        last_error=null;
  return true;
end $$;
revoke all on function public.service_prepare_oauth_revocation(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.service_prepare_oauth_revocation(uuid,text,timestamptz) to service_role;

create or replace function public.service_expire_oauth_revocation_credentials()
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare v_deleted bigint;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  with expired as (
    delete from public.oauth_revocation_credentials c
    where c.retention_deadline is not null and c.retention_deadline<=now()
    returning c.account_user_id,c.provider
  ), marked as (
    update public.external_deletion_queue q
    set attempts=greatest(q.attempts,12),
        last_error='oauth_credential_retention_expired_manual_required',
        not_before=now()+interval '100 years'
    from expired e
    where q.provider=e.provider and q.external_user_id=e.account_user_id::text
    returning 1
  )
  select count(*) into v_deleted from expired;
  return coalesce(v_deleted,0);
end $$;
revoke all on function public.service_expire_oauth_revocation_credentials() from public,anon,authenticated;
grant execute on function public.service_expire_oauth_revocation_credentials() to service_role;
