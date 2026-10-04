-- Privacy-minimize external owner-verification provider identifiers.
-- Raw provider references are not application data and must not remain persisted.

alter table public.owner_verification_sessions
  add column if not exists provider_reference_sha256 text
  check (provider_reference_sha256 is null or provider_reference_sha256 ~ '^[0-9a-f]{64}$');

update public.owner_verification_sessions
set provider_reference_sha256=coalesce(
      provider_reference_sha256,
      encode(extensions.digest(convert_to(provider_reference,'UTF8'),'sha256'),'hex')
    ),
    provider_reference=null,
    updated_at=now()
where provider_reference is not null;

alter table public.owner_verification_sessions
  drop constraint if exists owner_verification_sessions_provider_provider_reference_key;

drop index if exists public.owner_verification_sessions_provider_reference_hash_unique_idx;
create unique index owner_verification_sessions_provider_reference_hash_unique_idx
  on public.owner_verification_sessions(provider,provider_reference_sha256)
  where provider_reference_sha256 is not null;

alter table public.owner_verification_sessions
  drop constraint if exists owner_verification_sessions_raw_provider_reference_forbidden;
alter table public.owner_verification_sessions
  add constraint owner_verification_sessions_raw_provider_reference_forbidden
  check (provider_reference is null);
