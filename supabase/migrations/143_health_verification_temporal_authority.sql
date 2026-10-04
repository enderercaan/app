-- Tailmance v19 R8 — health-verification temporal authority hardening.
-- Provider attestations are not current before their verified_at instant. New/updated
-- attestations may tolerate only small provider clock skew and otherwise fail closed.

create or replace function public.guard_health_verification_attestation_time()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.verified_at is null or new.verified_at>now()+interval '5 minutes' then
    raise exception 'health_verification_verified_at_invalid';
  end if;
  if new.expires_at is not null and new.expires_at<=new.verified_at then
    raise exception 'health_verification_expiry_invalid';
  end if;
  return new;
end $$;
revoke all on function public.guard_health_verification_attestation_time() from public,anon,authenticated;

drop trigger if exists health_verification_attestation_time_guard on public.health_verification_attestations;
create trigger health_verification_attestation_time_guard
before insert or update of verified_at,expires_at on public.health_verification_attestations
for each row execute function public.guard_health_verification_attestation_time();

create or replace function public.has_current_veterinarian_verification(p_pet_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.health_verification_attestations a
    where a.pet_id=p_pet_id
      and a.signal='veterinarian_verified'
      and a.method='provider_ocr_signature'
      and a.integrity_status='valid'
      and a.revoked_at is null
      and a.verified_at<=now()
      and (a.expires_at is null or a.expires_at>now())
  )
$$;
revoke all on function public.has_current_veterinarian_verification(uuid) from public,anon,authenticated;

create or replace function public.health_trust_json(p_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce((
    select jsonb_build_object(
      'method',a.method,
      'clinicPublicId',a.clinic_public_id,
      'providerCode',a.provider_code,
      'integrityStatus',a.integrity_status,
      'verifiedAt',a.verified_at,
      'expiresAt',a.expires_at
    )
    from public.health_verification_attestations a
    where a.pet_id=p_pet_id
      and a.signal='veterinarian_verified'
      and a.method='provider_ocr_signature'
      and a.integrity_status='valid'
      and a.revoked_at is null
      and a.verified_at<=now()
      and (a.expires_at is null or a.expires_at>now())
    order by a.verified_at desc,a.id desc limit 1
  ),'null'::jsonb)
$$;
revoke all on function public.health_trust_json(uuid) from public,anon,authenticated;
