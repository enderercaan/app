-- Tailmance v19 R8 security hardening: bind abuse-prone authenticated writes to
-- recent action-specific platform integrity evidence when policy is step_up/enforce.
-- Default policy remains observe until production App Attest / Play Integrity evidence exists.

create or replace function public.require_current_device_integrity(p_action text)
returns void language plpgsql stable security definer set search_path='' as $$
declare
  v_mode text;
  v_max_age integer;
  v_ok boolean:=false;
begin
  if auth.role()<>'authenticated' then return; end if;
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_action is null or p_action !~ '^[a-z][a-z0-9_.:-]{1,79}$' then raise exception 'invalid_integrity_action'; end if;

  select enforcement_mode,max_assessment_age_seconds into v_mode,v_max_age
  from public.security_integrity_policy where singleton=true;
  if v_mode is null then raise exception 'device_integrity_policy_unavailable'; end if;
  if v_mode='observe' then return; end if;

  select exists(
    select 1 from public.security_device_assessments a
    where a.user_id=auth.uid() and a.action=p_action and a.verdict='verified'
      and a.expires_at>now()
      and a.verified_at>now()-make_interval(secs=>v_max_age)
  ) into v_ok;
  if not v_ok then
    raise exception using errcode='42501',message=case when v_mode='step_up' then 'device_integrity_step_up_required' else 'device_integrity_required' end;
  end if;
end $$;
revoke all on function public.require_current_device_integrity(text) from public,anon,authenticated;

create or replace function public.enforce_high_risk_device_integrity()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_action text;
begin
  if auth.role()<>'authenticated' then return new; end if;
  v_action:=case tg_table_name
    when 'lost_pet_alerts' then 'lost_pet_alert'
    when 'pet_events' then 'event_create'
    when 'meetup_requests' then 'meetup_create'
    when 'pet_boosts' then 'boost_activate'
    when 'user_travel_mode' then 'travel_mode'
    when 'pet_likes' then case when new.kind='super_like' then 'super_like' else null end
    else null
  end;
  if v_action is not null then perform public.require_current_device_integrity(v_action); end if;
  return new;
end $$;
revoke all on function public.enforce_high_risk_device_integrity() from public,anon,authenticated;

drop trigger if exists trg_integrity_lost_pet_alert on public.lost_pet_alerts;
create trigger trg_integrity_lost_pet_alert before insert on public.lost_pet_alerts
for each row execute function public.enforce_high_risk_device_integrity();

drop trigger if exists trg_integrity_pet_event on public.pet_events;
create trigger trg_integrity_pet_event before insert on public.pet_events
for each row execute function public.enforce_high_risk_device_integrity();

drop trigger if exists trg_integrity_meetup on public.meetup_requests;
create trigger trg_integrity_meetup before insert on public.meetup_requests
for each row execute function public.enforce_high_risk_device_integrity();

drop trigger if exists trg_integrity_pet_boost on public.pet_boosts;
create trigger trg_integrity_pet_boost before insert on public.pet_boosts
for each row execute function public.enforce_high_risk_device_integrity();

drop trigger if exists trg_integrity_travel_mode on public.user_travel_mode;
create trigger trg_integrity_travel_mode before insert or update on public.user_travel_mode
for each row execute function public.enforce_high_risk_device_integrity();

drop trigger if exists trg_integrity_super_like on public.pet_likes;
create trigger trg_integrity_super_like before insert or update of kind on public.pet_likes
for each row execute function public.enforce_high_risk_device_integrity();
