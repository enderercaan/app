-- Tailmance v19 R8 security hardening: production-safe integrity policy defaults.
-- Migration 097 initially used observe mode while App Attest / Play Integrity source wiring was being built.
-- That is no longer an acceptable steady-state default. High-risk actions now fail closed unless a
-- service-role operator deliberately creates a short, audited relaxation window.

alter table public.security_integrity_policy
  add column if not exists temporary_relaxation_until timestamptz,
  add column if not exists change_reason text,
  add column if not exists changed_at timestamptz not null default now();

-- Move every existing environment to the secure baseline. Development/staging may temporarily
-- relax through service_set_device_integrity_policy(), never by direct table UPDATE.
update public.security_integrity_policy
set enforcement_mode='enforce',
    temporary_relaxation_until=null,
    change_reason='migration_104_fail_closed_baseline',
    changed_at=now(),
    updated_at=now()
where singleton=true;

revoke update on table public.security_integrity_policy from service_role;
grant select on table public.security_integrity_policy to service_role;

create or replace function public.service_set_device_integrity_policy(
  p_mode text,
  p_max_assessment_age_seconds integer default 900,
  p_temporary_relaxation_until timestamptz default null,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_reason text:=trim(coalesce(p_reason,''));
  v_until timestamptz:=p_temporary_relaxation_until;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_mode not in ('observe','step_up','enforce') then raise exception 'invalid_integrity_mode'; end if;
  if p_max_assessment_age_seconds not between 60 and 3600 then raise exception 'invalid_integrity_assessment_age'; end if;
  if char_length(v_reason) not between 8 and 240 then raise exception 'integrity_change_reason_required'; end if;

  if p_mode='observe' then
    if v_until is null or v_until<=now() or v_until>now()+interval '24 hours' then
      raise exception 'observe_requires_short_relaxation_window';
    end if;
  elsif p_mode='step_up' then
    if v_until is not null and (v_until<=now() or v_until>now()+interval '7 days') then
      raise exception 'invalid_step_up_relaxation_window';
    end if;
  else
    v_until:=null;
  end if;

  update public.security_integrity_policy
  set enforcement_mode=p_mode,
      max_assessment_age_seconds=p_max_assessment_age_seconds,
      temporary_relaxation_until=v_until,
      change_reason=left(v_reason,240),
      changed_at=now(),
      updated_at=now()
  where singleton=true;

  if not found then raise exception 'integrity_policy_unavailable'; end if;

  return jsonb_build_object(
    'mode',p_mode,
    'maxAssessmentAgeSeconds',p_max_assessment_age_seconds,
    'temporaryRelaxationUntil',v_until,
    'changedAt',now()
  );
end;
$$;
revoke all on function public.service_set_device_integrity_policy(text,integer,timestamptz,text) from public,anon,authenticated;
grant execute on function public.service_set_device_integrity_policy(text,integer,timestamptz,text) to service_role;

create or replace function public.service_device_integrity_gate(p_user_id uuid,p_action text)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  stored_mode text;
  effective_mode text;
  max_age integer;
  relax_until timestamptz;
  ok boolean;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  select enforcement_mode,max_assessment_age_seconds,temporary_relaxation_until
    into stored_mode,max_age,relax_until
    from public.security_integrity_policy where singleton=true;
  if stored_mode is null then
    return jsonb_build_object('mode','enforce','allowed',false,'recentVerified',false,'reason','policy_unavailable','action',left(coalesce(p_action,''),80));
  end if;

  effective_mode:=case
    when stored_mode='observe' and relax_until is not null and relax_until>now() then 'observe'
    when stored_mode='step_up' and (relax_until is null or relax_until>now()) then 'step_up'
    else 'enforce'
  end;

  select exists(
    select 1 from public.security_device_assessments a
    where a.user_id=p_user_id
      and a.action=p_action
      and a.verdict='verified'
      and a.expires_at>now()
      and a.verified_at>now()-make_interval(secs=>max_age)
  ) into ok;

  return jsonb_build_object(
    'mode',effective_mode,
    'allowed',case when effective_mode='observe' then true else ok end,
    'recentVerified',ok,
    'reason',case when ok then null when effective_mode='observe' then 'observe_only' when effective_mode='step_up' then 'device_integrity_step_up_required' else 'device_integrity_required' end,
    'action',left(coalesce(p_action,''),80),
    'temporaryRelaxationUntil',relax_until
  );
end;
$$;
revoke all on function public.service_device_integrity_gate(uuid,text) from public,anon,authenticated;
grant execute on function public.service_device_integrity_gate(uuid,text) to service_role;

create or replace function public.require_current_device_integrity(p_action text)
returns void
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_stored_mode text;
  v_mode text;
  v_max_age integer;
  v_relax_until timestamptz;
  v_ok boolean:=false;
begin
  if auth.role()<>'authenticated' then return; end if;
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_action is null or p_action !~ '^[a-z][a-z0-9_.:-]{1,79}$' then raise exception 'invalid_integrity_action'; end if;

  select enforcement_mode,max_assessment_age_seconds,temporary_relaxation_until
    into v_stored_mode,v_max_age,v_relax_until
    from public.security_integrity_policy where singleton=true;
  if v_stored_mode is null then raise exception 'device_integrity_policy_unavailable'; end if;

  v_mode:=case
    when v_stored_mode='observe' and v_relax_until is not null and v_relax_until>now() then 'observe'
    when v_stored_mode='step_up' and (v_relax_until is null or v_relax_until>now()) then 'step_up'
    else 'enforce'
  end;
  if v_mode='observe' then return; end if;

  select exists(
    select 1 from public.security_device_assessments a
    where a.user_id=auth.uid()
      and a.action=p_action
      and a.verdict='verified'
      and a.expires_at>now()
      and a.verified_at>now()-make_interval(secs=>v_max_age)
  ) into v_ok;
  if not v_ok then
    raise exception using errcode='42501',message=case when v_mode='step_up' then 'device_integrity_step_up_required' else 'device_integrity_required' end;
  end if;
end;
$$;
revoke all on function public.require_current_device_integrity(text) from public,anon,authenticated;
