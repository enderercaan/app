-- Tailmance v19 R8 — harden the effective service-only MFA verifier.
-- The function is SECURITY DEFINER and all referenced objects are schema-qualified,
-- so an empty search_path removes unnecessary name-resolution attack surface.
create or replace function public.service_user_has_verified_mfa(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from auth.mfa_factors
    where user_id=p_user_id and status::text='verified'
  )
$$;
revoke all on function public.service_user_has_verified_mfa(uuid) from public,anon,authenticated;
grant execute on function public.service_user_has_verified_mfa(uuid) to service_role;
