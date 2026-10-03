-- v18: service-only visibility into whether a user has a verified MFA factor.
-- Used by Edge Functions after validating the caller JWT; never exposed to anon/authenticated roles.
create or replace function public.service_user_has_verified_mfa(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists(
    select 1 from auth.mfa_factors
    where user_id = p_user_id and status::text = 'verified'
  );
$$;

revoke all on function public.service_user_has_verified_mfa(uuid) from public, anon, authenticated;
grant execute on function public.service_user_has_verified_mfa(uuid) to service_role;
