-- TUR 2: product access must not depend on hosted Auth dashboard defaults alone.
-- Email confirmation, current legal acceptance, 18+ attestation and active account state
-- are enforced in the database for product actions. Pet creation is protected at the table
-- boundary so future SECURITY DEFINER write paths cannot accidentally bypass the gate.

create or replace function public.current_user_has_product_access()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select auth.uid() is not null and exists(
    select 1
    from public.users u
    join public.app_security_config c on c.singleton=true
    where u.id=auth.uid()
      and u.suspended_at is null
      and u.paused_at is null
      and u.age_18_confirmed=true
      and u.legal_version=c.current_legal_version
      and exists(
        select 1 from public.legal_acceptances a
        where a.user_id=u.id and a.legal_version=c.current_legal_version
      )
      and exists(
        select 1 from auth.users au
        where au.id=u.id and au.email_confirmed_at is not null
      )
  );
$$;
revoke all on function public.current_user_has_product_access() from public,anon,authenticated;
grant execute on function public.current_user_has_product_access() to service_role;

create or replace function public.owns_pet(p_pet_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.current_user_has_product_access() and exists(
    select 1 from public.pets p where p.id=p_pet_id and p.owner_id=auth.uid()
  );
$$;
revoke all on function public.owns_pet(uuid) from public,anon,authenticated;

create or replace function public.enforce_pet_insert_product_access()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.role()='authenticated' then
    if auth.uid() is null or new.owner_id is distinct from auth.uid() or not public.current_user_has_product_access() then
      raise exception 'product_access_required';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.enforce_pet_insert_product_access() from public,anon,authenticated;

drop trigger if exists trg_pets_require_product_access on public.pets;
create trigger trg_pets_require_product_access
before insert on public.pets
for each row execute function public.enforce_pet_insert_product_access();
