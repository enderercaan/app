-- Tailmance v19 R8 — moderation review SLA hardening.
-- Every report is reviewed in under 24 hours. Higher-risk classes remain expedited.

create or replace function public.set_report_sla()
returns trigger language plpgsql set search_path='' as $$
begin
  new.priority:=case
    when lower(new.reason) in ('physical_safety','minor_safety','animal_welfare','credible_threat','lost_pet_abuse') then 'urgent'
    when lower(new.reason) in ('harassment','impersonation','pet_sale','pet_rehoming','commercial_breeding','scam','human_dating_misuse') then 'high'
    else coalesce(new.priority,'standard')
  end;
  new.assigned_operator:='Yekta Özel';
  new.triage_due_at:=coalesce(new.triage_due_at,new.created_at + case
    when new.priority='urgent' then interval '15 minutes'
    when new.priority='high' then interval '4 hours'
    else interval '12 hours'
  end);
  new.resolution_target_at:=coalesce(new.resolution_target_at,new.created_at + case
    when new.priority='urgent' then interval '4 hours'
    when new.priority='high' then interval '12 hours'
    else interval '23 hours'
  end);
  return new;
end $$;
revoke all on function public.set_report_sla() from public,anon,authenticated;
