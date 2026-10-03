-- Trust center and runtime controls. PawLink never stores raw government-ID images here.

create table if not exists public.owner_verification_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'external',
  provider_reference text,
  status text not null default 'pending' check (status in ('pending','verified','failed','expired','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  unique(provider,provider_reference)
);
alter table public.owner_verification_sessions enable row level security;
revoke all on public.owner_verification_sessions from anon,authenticated;

create table if not exists public.app_runtime_config (
  singleton boolean primary key default true check(singleton),
  maintenance_mode boolean not null default false,
  minimum_supported_version text not null default '1.0.0',
  latest_version text not null default '1.0.0',
  features jsonb not null default '{"stories":true,"events":true,"ownerVerification":true,"meetupFeedback":true}'::jsonb,
  message text,
  updated_at timestamptz not null default now()
);
insert into public.app_runtime_config(singleton) values(true) on conflict(singleton) do nothing;
alter table public.app_runtime_config enable row level security;
revoke all on public.app_runtime_config from anon,authenticated;

create or replace function public.get_runtime_config()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('maintenanceMode',maintenance_mode,'minimumSupportedVersion',minimum_supported_version,'latestVersion',latest_version,'features',features,'message',message)
  from public.app_runtime_config where singleton=true;
$$;

create or replace function public.get_verification_status()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'identityVerified',coalesce(u.identity_verified,false),
    'identityVerifiedAt',u.identity_verified_at,
    'latestStatus',coalesce((select s.status from public.owner_verification_sessions s where s.user_id=u.id order by s.created_at desc limit 1),'not_started'),
    'latestRequestedAt',(select s.created_at from public.owner_verification_sessions s where s.user_id=u.id order by s.created_at desc limit 1)
  ) from public.users u where u.id=auth.uid();
$$;

create or replace function public.get_account_settings()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'tier',u.tier,'freeMessagesSent',u.free_messages_sent,'discoverable',u.discoverable,
    'incognito',u.incognito,'age18Confirmed',u.age_18_confirmed,'legalVersion',u.legal_version,
    'identityVerified',coalesce(u.identity_verified,false)
  ) from public.users u where u.id=auth.uid();
$$;

revoke all on function public.get_runtime_config() from public;
grant execute on function public.get_runtime_config() to anon,authenticated;
revoke all on function public.get_verification_status() from public,anon;
grant execute on function public.get_verification_status() to authenticated;
revoke all on function public.get_account_settings() from public,anon;
grant execute on function public.get_account_settings() to authenticated;
