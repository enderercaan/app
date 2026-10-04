-- Tailmance v19 R8: expose a non-secret, context-bound SHA-256 fingerprint for current
-- veterinarian attestations. This is a display/audit fingerprint, not a bearer credential.
-- It deliberately salts the provider-reference hash with attestation + pet context so the
-- underlying provider reference cannot be correlated by simply reusing its digest.

create or replace function public.health_attestation_public_signature_sha256(p_attestation_id uuid)
returns text
language sql
stable
security definer
set search_path=''
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'schema','tailmance_health_passport_v1',
          'attestationId',a.id::text,
          'petId',a.pet_id::text,
          'signal',a.signal,
          'method',a.method,
          'clinicPublicId',a.clinic_public_id,
          'providerCode',a.provider_code,
          'providerReferenceSha256',a.provider_reference_sha256,
          'verifiedAt',a.verified_at,
          'expiresAt',a.expires_at
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  from public.health_verification_attestations a
  where a.id=p_attestation_id
$$;
revoke all on function public.health_attestation_public_signature_sha256(uuid) from public,anon,authenticated;

create or replace function public.health_trust_json(p_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce((
    select jsonb_build_object(
      'method',a.method,
      'clinicPublicId',a.clinic_public_id,
      'providerCode',a.provider_code,
      'integrityStatus',a.integrity_status,
      'verifiedAt',a.verified_at,
      'expiresAt',a.expires_at,
      'passportSignatureSha256',public.health_attestation_public_signature_sha256(a.id)
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
