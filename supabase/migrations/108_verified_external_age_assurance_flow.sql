-- Privacy-minimized verified-external age assurance flow.
-- Raw identity documents, DOB and biometric material are never stored by Tailmance.
-- The app stores only a provider reference hash, threshold result, expiry and attributable evidence metadata.

create table if not exists public.legal_age_assurance_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  legal_country_code text not null check (legal_country_code ~ '^[A-Z]{2}$'),
  legal_subnational_code text,
  age_threshold smallint not null check (age_threshold between 18 and 100),
  provider_code text not null check (char_length(trim(provider_code)) between 2 and 80),
  provider_reference_sha256 text check (provider_reference_sha256 is null or provider_reference_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending','passed','failed','expired','cancelled','revoked')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (legal_subnational_code is null or (char_length(legal_subnational_code) between 1 and 32 and legal_subnational_code ~ '^[A-Z0-9-]+$')),
  check (expires_at>created_at)
);
create unique index if not exists legal_age_assurance_one_pending_per_user_idx
  on public.legal_age_assurance_sessions(user_id) where status='pending';
create index if not exists legal_age_assurance_sessions_user_idx
  on public.legal_age_assurance_sessions(user_id,created_at desc);
alter table public.legal_age_assurance_sessions enable row level security;
revoke all on table public.legal_age_assurance_sessions from public,anon,authenticated;
grant select,insert,update on table public.legal_age_assurance_sessions to service_role;

create or replace function public.service_apply_legal_age_assurance_result(
  p_session_id uuid,
  p_status text,
  p_provider_reference_sha256 text,
  p_evidence_reference jsonb,
  p_verified_at timestamptz,
  p_result_expires_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session public.legal_age_assurance_sessions;v_event_id bigint;v_now timestamptz:=now();
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_session_id is null then raise exception 'session_required'; end if;
  if p_status not in ('passed','failed','expired','cancelled','revoked') then raise exception 'invalid_status'; end if;
  if nullif(trim(coalesce(p_provider_reference_sha256,'')),'') is not null and lower(trim(p_provider_reference_sha256)) !~ '^[0-9a-f]{64}$' then raise exception 'invalid_provider_reference_hash'; end if;
  select * into v_session from public.legal_age_assurance_sessions where id=p_session_id for update;
  if v_session.id is null then raise exception 'age_assurance_session_not_found'; end if;

  if p_status='revoked' then
    if v_session.status='revoked' then return jsonb_build_object('ok',true,'idempotent',true,'status','revoked'); end if;
    if v_session.status<>'passed' then return jsonb_build_object('ok',true,'idempotent',false,'stale',true,'status',v_session.status); end if;
    v_event_id:=public.service_record_legal_age_assurance(v_session.user_id,v_session.legal_country_code,v_session.legal_subnational_code,v_session.age_threshold,'privacy_minimized_external_age_assurance',v_session.provider_code,coalesce(nullif(lower(trim(coalesce(p_provider_reference_sha256,''))),''),v_session.provider_reference_sha256),'revoked',coalesce(p_evidence_reference,'[]'::jsonb),coalesce(p_verified_at,v_now),null,'identity_verification_webhook');
    update public.legal_age_assurance_sessions set status='revoked',updated_at=v_now where id=v_session.id;
    return jsonb_build_object('ok',true,'idempotent',false,'status','revoked','ageAssuranceEventId',v_event_id);
  end if;

  if v_session.status<>'pending' then return jsonb_build_object('ok',true,'idempotent',v_session.status=p_status,'stale',v_session.status<>p_status,'status',v_session.status); end if;
  if v_session.expires_at<=v_now and p_status='passed' then p_status:='expired'; end if;
  if p_status='passed' then
    if p_verified_at is null then raise exception 'verified_at_required'; end if;
    if p_evidence_reference is null or jsonb_typeof(p_evidence_reference)<>'array' or jsonb_array_length(p_evidence_reference)=0 then raise exception 'age_assurance_evidence_required'; end if;
    v_event_id:=public.service_record_legal_age_assurance(v_session.user_id,v_session.legal_country_code,v_session.legal_subnational_code,v_session.age_threshold,'privacy_minimized_external_age_assurance',v_session.provider_code,coalesce(nullif(lower(trim(coalesce(p_provider_reference_sha256,''))),''),v_session.provider_reference_sha256),'passed',p_evidence_reference,p_verified_at,p_result_expires_at,'identity_verification_webhook');
  end if;
  update public.legal_age_assurance_sessions set status=p_status,provider_reference_sha256=coalesce(nullif(lower(trim(coalesce(p_provider_reference_sha256,''))),''),provider_reference_sha256),updated_at=v_now where id=v_session.id;
  return jsonb_build_object('ok',true,'idempotent',false,'status',p_status,'ageAssuranceEventId',v_event_id);
end $$;
revoke all on function public.service_apply_legal_age_assurance_result(uuid,text,text,jsonb,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.service_apply_legal_age_assurance_result(uuid,text,text,jsonb,timestamptz,timestamptz) to service_role;
