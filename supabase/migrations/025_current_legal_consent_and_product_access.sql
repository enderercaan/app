-- Tailmance TUR 2: legal acceptance must be authenticated, current-version pinned, auditable,
-- and enforced at the server boundary rather than trusted from pre-auth signup metadata.

create table if not exists public.app_security_config (
  singleton boolean primary key default true check (singleton),
  current_legal_version text not null check (char_length(current_legal_version) between 1 and 64),
  updated_at timestamptz not null default now()
);
alter table public.app_security_config enable row level security;
revoke all on public.app_security_config from anon, authenticated;
insert into public.app_security_config(singleton,current_legal_version)
values(true,'2026-09-18')
on conflict(singleton) do nothing;

create table if not exists public.legal_acceptances (
  user_id uuid not null references auth.users(id) on delete cascade,
  legal_version text not null check (char_length(legal_version) between 1 and 64),
  accepted_at timestamptz not null default now(),
  primary key(user_id,legal_version)
);
alter table public.legal_acceptances enable row level security;
revoke all on public.legal_acceptances from anon, authenticated;

-- Earlier builds could copy legal_version from unauthenticated signup metadata. Force one
-- authenticated re-consent so no legacy row is mistaken for versioned acceptance evidence.
update public.users set legal_version=null where legal_version is not null;

create or replace function public.accept_current_legal_terms(
  p_user_id uuid,
  p_legal_version text,
  p_age_18_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_current text;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden'; end if;
  if p_user_id is null or p_age_18_confirmed is distinct from true then raise exception 'age_confirmation_required'; end if;
  select current_legal_version into v_current from public.app_security_config where singleton=true;
  if v_current is null then raise exception 'server_legal_version_not_configured'; end if;
  if p_legal_version is distinct from v_current then raise exception 'outdated_legal_version'; end if;

  update public.users
  set age_18_confirmed=true,legal_version=v_current,updated_at=now()
  where id=p_user_id;
  if not found then raise exception 'user_not_found'; end if;

  insert into public.legal_acceptances(user_id,legal_version,accepted_at)
  values(p_user_id,v_current,now())
  on conflict(user_id,legal_version) do update set accepted_at=excluded.accepted_at;

  return jsonb_build_object('ok',true,'age18Confirmed',true,'legalVersion',v_current);
end;
$$;
revoke all on function public.accept_current_legal_terms(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.accept_current_legal_terms(uuid,text,boolean) to service_role;

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
  );
$$;
revoke all on function public.current_user_has_product_access() from public,anon,authenticated;

create or replace function public.owns_pet(p_pet_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.current_user_has_product_access() and exists(
    select 1 from public.pets p where p.id=p_pet_id and p.owner_id=auth.uid()
  );
$$;
revoke all on function public.owns_pet(uuid) from public,anon,authenticated;

-- Remove the legacy default-argument overload so one-argument calls cannot become ambiguous.
-- 014 now removes this overload before any one-argument call is compiled; keep this step idempotent.
do $owns_pet_legacy$ begin
  if to_regprocedure('public.owns_pet(uuid,uuid)') is not null then
    revoke all on function public.owns_pet(uuid,uuid) from public,anon,authenticated;
  end if;
end $owns_pet_legacy$;
drop function if exists public.owns_pet(uuid,uuid);
