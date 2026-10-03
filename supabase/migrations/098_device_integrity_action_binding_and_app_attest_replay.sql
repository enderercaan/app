-- Tailmance v19 R8 security hardening: action-bound integrity assessments and
-- server-side App Attest assertion counter replay protection.

create table if not exists public.security_app_attest_keys(
  key_id_sha256 text primary key check(key_id_sha256 ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  app_id text not null check(char_length(app_id) between 3 and 240),
  last_assertion_counter bigint not null default 0 check(last_assertion_counter>=0),
  status text not null default 'active' check(status in ('active','revoked')),
  attested_at timestamptz not null default now(),
  last_asserted_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists security_app_attest_keys_user_idx on public.security_app_attest_keys(user_id,status,updated_at desc);
alter table public.security_app_attest_keys enable row level security;
revoke all on table public.security_app_attest_keys from public,anon,authenticated;
grant select,insert,update,delete on table public.security_app_attest_keys to service_role;

create or replace function public.service_finish_device_integrity_challenge(
  p_user_id uuid,p_challenge_id uuid,p_claim_token uuid,p_verdict text,p_app_integrity text,p_device_integrity text,
  p_app_id text,p_app_version text,p_key_id_sha256 text,p_assertion_counter bigint,p_details jsonb,p_ttl_seconds integer default 900
) returns boolean language plpgsql security definer set search_path='' as $$
declare
  changed integer;
  v_platform text;
  v_mode text;
  v_key public.security_app_attest_keys%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_verdict not in ('verified','limited','rejected') then raise exception 'invalid_verdict'; end if;
  if p_ttl_seconds<60 or p_ttl_seconds>86400 then raise exception 'invalid_ttl'; end if;

  select platform into v_platform from public.security_attestation_challenges
  where id=p_challenge_id and user_id=p_user_id and claim_token=p_claim_token and consumed_at is null and expires_at>now();
  if v_platform is null then return false; end if;

  if v_platform='ios' and p_verdict='verified' then
    if p_key_id_sha256 is null or p_key_id_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'app_attest_key_missing'; end if;
    if p_app_id is null or char_length(p_app_id) not between 3 and 240 then raise exception 'app_attest_app_id_missing'; end if;
    v_mode:=coalesce(p_details->>'mode','');
    if v_mode='attestation' then
      if p_assertion_counter is distinct from 0 then raise exception 'app_attest_initial_counter_invalid'; end if;
      insert into public.security_app_attest_keys(key_id_sha256,user_id,app_id,last_assertion_counter,status,attested_at,updated_at)
      values(p_key_id_sha256,p_user_id,p_app_id,0,'active',now(),now())
      on conflict(key_id_sha256) do update set
        user_id=excluded.user_id,app_id=excluded.app_id,last_assertion_counter=0,status='active',attested_at=now(),last_asserted_at=null,updated_at=now()
      where public.security_app_attest_keys.user_id=excluded.user_id;
      if not found then raise exception 'app_attest_key_owner_mismatch'; end if;
    elsif v_mode='assertion' then
      if p_assertion_counter is null or p_assertion_counter<=0 then raise exception 'app_attest_counter_invalid'; end if;
      select * into v_key from public.security_app_attest_keys
      where key_id_sha256=p_key_id_sha256 and user_id=p_user_id and app_id=p_app_id and status='active' for update;
      if v_key.key_id_sha256 is null then raise exception 'app_attest_key_not_attested'; end if;
      if p_assertion_counter<=v_key.last_assertion_counter then raise exception 'app_attest_counter_replay'; end if;
      update public.security_app_attest_keys set last_assertion_counter=p_assertion_counter,last_asserted_at=now(),updated_at=now()
      where key_id_sha256=p_key_id_sha256 and user_id=p_user_id;
    else
      raise exception 'app_attest_mode_invalid';
    end if;
  end if;

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
  if p_action is null or p_action !~ '^[a-z][a-z0-9_.:-]{1,79}$' then raise exception 'invalid_integrity_action'; end if;
  select enforcement_mode,max_assessment_age_seconds into mode,max_age from public.security_integrity_policy where singleton=true;
  if mode is null then return jsonb_build_object('mode','enforce','allowed',false,'reason','policy_unavailable'); end if;
  select exists(
    select 1 from public.security_device_assessments a
    where a.user_id=p_user_id and a.action=p_action and a.verdict='verified'
      and a.expires_at>now() and a.verified_at>now()-make_interval(secs=>max_age)
  ) into ok;
  return jsonb_build_object(
    'mode',mode,
    'allowed',case when mode='observe' then true else ok end,
    'recentVerified',ok,
    'reason',case when ok then null when mode='observe' then 'observe_only' else 'device_integrity_required' end,
    'action',p_action
  );
end $$;
revoke all on function public.service_device_integrity_gate(uuid,text) from public,anon,authenticated;
grant execute on function public.service_device_integrity_gate(uuid,text) to service_role;
