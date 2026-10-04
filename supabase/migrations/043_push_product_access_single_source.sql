-- Tailmance TUR 2: background delivery must use the same effective product-access
-- definition as interactive RPCs. Keep auth-email confirmation, current legal acceptance,
-- 18+ attestation and account state in one database-side rule instead of duplicating a
-- weaker subset in the push worker.

create or replace function public.service_product_access_user_ids(p_user_ids uuid[])
returns table(user_id uuid)
language plpgsql stable security definer set search_path=''
as $$
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_user_ids is null or cardinality(p_user_ids)=0 then return; end if;
  if cardinality(p_user_ids)>200 then raise exception 'too_many_user_ids'; end if;

  return query
  select u.id
  from public.users u
  join public.app_security_config c on c.singleton=true
  join auth.users au on au.id=u.id and au.email_confirmed_at is not null
  where u.id=any(p_user_ids)
    and u.suspended_at is null
    and u.paused_at is null
    and u.age_18_confirmed=true
    and u.legal_version=c.current_legal_version
    and exists(
      select 1 from public.legal_acceptances a
      where a.user_id=u.id and a.legal_version=c.current_legal_version
    );
end;
$$;
revoke all on function public.service_product_access_user_ids(uuid[]) from public,anon,authenticated;
grant execute on function public.service_product_access_user_ids(uuid[]) to service_role;
