-- Tailmance v19 R8 security hardening: private incident-response ledger and bounded
-- integrity-evidence retention with a global legal/incident hold fail-safe.

create table if not exists public.security_incidents(
  id uuid primary key default gen_random_uuid(),
  severity text not null check(severity in ('sev1_critical','sev2_high','sev3_medium','sev4_low')),
  status text not null default 'investigating' check(status in ('investigating','contained','monitoring','resolved')),
  incident_type text not null check(char_length(incident_type) between 2 and 120),
  summary text not null check(char_length(summary) between 1 and 4000),
  incident_owner text not null default 'Yekta Özel' check(char_length(incident_owner) between 2 and 160),
  detected_at timestamptz not null default now(),
  contained_at timestamptz,
  resolved_at timestamptz,
  affected_users_estimate integer check(affected_users_estimate is null or affected_users_estimate>=0),
  affected_data_categories text[] not null default '{}'::text[],
  evidence_hold boolean not null default true,
  decision_notes text check(decision_notes is null or char_length(decision_notes)<=8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(contained_at is null or contained_at>=detected_at),
  check(resolved_at is null or resolved_at>=detected_at)
);
create index if not exists security_incidents_status_idx on public.security_incidents(status,severity,detected_at desc);

create table if not exists public.security_incident_jurisdictions(
  incident_id uuid not null references public.security_incidents(id) on delete cascade,
  country_code text not null check(country_code ~ '^[A-Z]{2}$'),
  subnational_code text not null default '',
  applicability_status text not null default 'pending_review' check(applicability_status in ('pending_review','counsel_confirmed','not_applicable_with_evidence')),
  regulator_notification_required boolean,
  data_subject_notification_required boolean,
  notification_deadline_at timestamptz,
  authority_route text check(authority_route is null or char_length(authority_route)<=1000),
  decision_evidence_reference text check(decision_evidence_reference is null or char_length(decision_evidence_reference)<=2000),
  notification_status text not null default 'pending' check(notification_status in ('pending','not_required_with_evidence','prepared','submitted','completed')),
  updated_at timestamptz not null default now(),
  primary key(incident_id,country_code,subnational_code),
  check(notification_status<>'not_required_with_evidence' or applicability_status<>'pending_review')
);
create index if not exists security_incident_jurisdictions_country_idx on public.security_incident_jurisdictions(country_code,notification_status,updated_at desc);

alter table public.security_incidents enable row level security;
alter table public.security_incident_jurisdictions enable row level security;
revoke all on table public.security_incidents,public.security_incident_jurisdictions from public,anon,authenticated;
grant select,insert,update,delete on table public.security_incidents,public.security_incident_jurisdictions to service_role;

create or replace function public.service_cleanup_security_integrity_evidence(
  p_consumed_challenge_retention_days integer default 7,
  p_expired_assessment_retention_days integer default 90
) returns jsonb language plpgsql security definer set search_path='' as $$
declare deleted_challenges integer:=0; deleted_assessments integer:=0; held boolean:=false;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_consumed_challenge_retention_days not between 1 and 90 then raise exception 'invalid_challenge_retention'; end if;
  if p_expired_assessment_retention_days not between 7 and 365 then raise exception 'invalid_assessment_retention'; end if;

  select exists(select 1 from public.security_incidents where evidence_hold=true and status<>'resolved') into held;
  if held then return jsonb_build_object('held',true,'deletedChallenges',0,'deletedAssessments',0); end if;

  delete from public.security_attestation_challenges
  where (consumed_at is not null or expires_at<now())
    and created_at<now()-make_interval(days=>p_consumed_challenge_retention_days);
  get diagnostics deleted_challenges=row_count;

  delete from public.security_device_assessments
  where expires_at<now()-make_interval(days=>p_expired_assessment_retention_days);
  get diagnostics deleted_assessments=row_count;

  return jsonb_build_object('held',false,'deletedChallenges',deleted_challenges,'deletedAssessments',deleted_assessments);
end $$;
revoke all on function public.service_cleanup_security_integrity_evidence(integer,integer) from public,anon,authenticated;
grant execute on function public.service_cleanup_security_integrity_evidence(integer,integer) to service_role;
