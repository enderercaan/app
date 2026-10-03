-- Privacy hardening for verified-external age assurance evidence.
-- Tailmance stores only irreversible hashes of provider evidence references for the
-- privacy_minimized_external_age_assurance path. Raw provider references, document
-- identifiers, URLs, DOB, identity documents and biometric payloads are not persisted.

create or replace function public.enforce_privacy_minimized_age_assurance_evidence()
returns trigger language plpgsql set search_path='' as $$
declare v_ref text;
begin
  if new.verification_method='privacy_minimized_external_age_assurance' then
    if jsonb_typeof(new.evidence_reference)<>'array' then raise exception 'invalid_age_assurance_evidence'; end if;
    for v_ref in select value from jsonb_array_elements_text(new.evidence_reference) as x(value) loop
      if v_ref !~ '^sha256:[0-9a-f]{64}$' then raise exception 'age_assurance_evidence_must_be_hashed'; end if;
    end loop;
  end if;
  return new;
end $$;
revoke all on function public.enforce_privacy_minimized_age_assurance_evidence() from public,anon,authenticated;

drop trigger if exists trg_age_assurance_evidence_hash_only on public.legal_age_assurance_events;
create trigger trg_age_assurance_evidence_hash_only
before insert on public.legal_age_assurance_events
for each row execute function public.enforce_privacy_minimized_age_assurance_evidence();
