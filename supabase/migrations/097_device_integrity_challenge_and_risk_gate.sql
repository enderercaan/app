-- Tailmance v19 R8 security hardening: replay-safe device/app integrity evidence.
-- App Attest / Play Integrity are risk signals, never client-authoritative decisions.

create table if not exists public.security_integrity_policy(
  singleton boolean primary key default true check(singleton),
  enforcement_mode text not null default 'observe' check(enforcement_mode in ('observe','step_up','enforce')),
  max_assessment_age_seconds integer not null default 900 check(max_assessment_age_seconds between 60 and 86400),
  updated_at timestamptz not null default now()
);
insert into public.security_integrity_policy(singleton,enforcement_mode,max_assessment_age_seconds)
values(true,'observe',900) on conflict(singleton) do nothing;

create table if not exists public.security_attestation_challenges(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check(length(action) between 2 and 80),
  platform text not null check(platform in ('ios','android')),
  nonce text not null unique check(length(nonce) between 32 and 200),
  client_data text not null check(length(client_data) between 32 and 4096),
  expires_at timestamptz not null,
  attempts integer not null default 0 check(attempts between 0 and 3),
  claimed_at timestamptz,
  claim_token uuid,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check(expires_at>created_at)
);
create index if not exists security_attestation_challenges_user_idx on public.security_attestation_challenges(user_id,created_at desc);

create table if not exists public.security_device_assessments(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check(platform in ('ios','android')),
  action text not null check(length(action) between 2 and 80),
  verdict text not null check(verdict in ('verified','limited','rejected')),
  app_integrity text,
  device_integrity text,
  app_id text,
  app_version text,
  key_id_sha256 text,
  assertion_counter bigint,
  details jsonb not null default '{}'::jsonb,
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check(expires_at>verified_at),
  check(jsonb_typeof(details)='object')
);
create index if not exists security_device_assessments_user_idx on public.security_device_assessments(user_id,verified_at desc);

alter table public.security_integrity_policy enable row level security;
alter table public.security_attestation_challenges enable row level security;
alter table public.security_device_assessments enable row level security;
revoke all on table public.security_integrity_policy from public,anon,authenticated;
revoke all on table public.security_attestation_challenges from public,anon,authenticated;
revoke all on table public.security_device_assessments from public,anon,authenticated;
grant select,update on table public.security_integrity_policy to service_role;
grant select,insert,update,delete on table public.security_attestation_challenges to service_role;
grant select,insert,delete on table public.security_device_assessments to service_role;

create or replace function public.service_claim_device_integrity_challenge(p_user_id uuid,p_challenge_id uuid,p_client_data text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.security_attestation_challenges; token uuid:=gen_random_uuid();
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  update public.security_attestation_challenges
    set claimed_at=now(),claim_token=token,attempts=attempts+1
    where id=p_challenge_id and user_id=p_user_id and client_data=p_client_data
      and consumed_at is null and expires_at>now() and attempts<3
      and (claimed_at is null or claimed_at<now()-interval '45 seconds')
    returning * into r;
  if r.id is null then return null; end if;
  return jsonb_build_object('claimToken',token,'action',r.action,'platform',r.platform,'clientData',r.client_data,'attempts',r.attempts);
end $$;
revoke all on function public.service_claim_device_integrity_challenge(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.service_claim_device_integrity_challenge(uuid,uuid,text) to service_role;

create or replace function public.service_release_device_integrity_challenge(p_user_id uuid,p_challenge_id uuid,p_claim_token uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  update public.security_attestation_challenges set claimed_at=null,claim_token=null
    where id=p_challenge_id and user_id=p_user_id and claim_token=p_claim_token and consumed_at is null;
end $$;
revoke all on function public.service_release_device_integrity_challenge(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_release_device_integrity_challenge(uuid,uuid,uuid) to service_role;

create or replace function public.service_finish_device_integrity_challenge(
  p_user_id uuid,p_challenge_id uuid,p_claim_token uuid,p_verdict text,p_app_integrity text,p_device_integrity text,
  p_app_id text,p_app_version text,p_key_id_sha256 text,p_assertion_counter bigint,p_details jsonb,p_ttl_seconds integer default 900
) returns boolean language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_verdict not in ('verified','limited','rejected') then raise exception 'invalid_verdict'; end if;
  if p_ttl_seconds<60 or p_ttl_seconds>86400 then raise exception 'invalid_ttl'; end if;
  update public.security_attestation_challenges set consumed_at=now(),claimed_at=null,claim_token=null
    where id=p_challenge_id and user_id=p_user_id and claim_token=p_claim_token and consumed_at is null and expires_at>now();
  get diagnostics changed=row_count;
  if changed<>1 then return false; end if;
  insert into public.security_device_assessments(user_id,platform,action,verdict,app_integrity,device_integrity,app_id,app_version,key_id_sha256,assertion_counter,details,expires_at)
    select p_user_id,c.platform,c.action,p_verdict,left(p_app_integrity,120),left(p_device_integrity,240),left(p_app_id,240),left(p_app_version,80),left(p_key_id_sha256,128),p_assertion_counter,
      case when jsonb_typeof(coalesce(p_details,'{}'::jsonb))='object' then coalesce(p_details,'{}'::jsonb) else '{}'::jsonb end,
      now()+make_interval(secs=>p_ttl_seconds)
    from public.security_attestation_challenges c where c.id=p_challenge_id;
  return true;
end $$;
revoke all on function public.service_finish_device_integrity_challenge(uuid,uuid,uuid,text,text,text,text,text,text,bigint,jsonb,integer) from public,anon,authenticated;
grant execute on function public.service_finish_device_integrity_challenge(uuid,uuid,uuid,text,text,text,text,text,text,bigint,jsonb,integer) to service_role;

create or replace function public.service_device_integrity_gate(p_user_id uuid,p_action text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare mode text; max_age integer; ok boolean;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  select enforcement_mode,max_assessment_age_seconds into mode,max_age from public.security_integrity_policy where singleton=true;
  if mode is null then return jsonb_build_object('mode','enforce','allowed',false,'reason','policy_unavailable'); end if;
  select exists(select 1 from public.security_device_assessments a where a.user_id=p_user_id and a.verdict='verified' and a.expires_at>now() and a.verified_at>now()-make_interval(secs=>max_age)) into ok;
  return jsonb_build_object('mode',mode,'allowed',case when mode='observe' then true else ok end,'recentVerified',ok,'reason',case when ok then null when mode='observe' then 'observe_only' else 'device_integrity_required' end,'action',left(coalesce(p_action,''),80));
end $$;
revoke all on function public.service_device_integrity_gate(uuid,text) from public,anon,authenticated;
grant execute on function public.service_device_integrity_gate(uuid,text) to service_role;

-- Keep evidence bounded. Operational jobs may purge consumed challenges and expired assessments.
