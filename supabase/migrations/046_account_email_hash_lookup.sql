-- Tailmance TUR 2: O(1)-style account-deletion identity lookup without scanning auth.users by email.
-- Only a deterministic SHA-256 of normalized email is stored; clients have no direct access.
-- The deletion worker MUST still re-read the Auth user and compare the real normalized email.

create table if not exists public.account_email_lookup (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);
alter table public.account_email_lookup enable row level security;
revoke all on table public.account_email_lookup from public,anon,authenticated;
create index if not exists account_email_lookup_hash_idx on public.account_email_lookup(email_hash);

create or replace function public.sync_account_email_lookup()
returns trigger
language plpgsql security definer set search_path=''
as $$
declare v_hash text;
begin
  if tg_op='DELETE' then
    delete from public.account_email_lookup where user_id=old.id;
    return old;
  end if;
  if new.email is null or trim(new.email)='' then
    delete from public.account_email_lookup where user_id=new.id;
    return new;
  end if;
  v_hash:=encode(extensions.digest(lower(trim(new.email)),'sha256'),'hex');
  insert into public.account_email_lookup(user_id,email_hash,updated_at)
  values(new.id,v_hash,now())
  on conflict(user_id) do update set email_hash=excluded.email_hash,updated_at=excluded.updated_at;
  return new;
end;
$$;
revoke all on function public.sync_account_email_lookup() from public,anon,authenticated;

insert into public.account_email_lookup(user_id,email_hash,updated_at)
select id,encode(extensions.digest(lower(trim(email)),'sha256'),'hex'),now()
from auth.users
where email is not null and trim(email)<>''
on conflict(user_id) do update set email_hash=excluded.email_hash,updated_at=excluded.updated_at;

drop trigger if exists tailmance_auth_email_lookup_sync on auth.users;
create trigger tailmance_auth_email_lookup_sync
after insert or update of email or delete on auth.users
for each row execute function public.sync_account_email_lookup();

create or replace function public.lookup_auth_user_by_email_hash(p_email_hash text)
returns uuid
language plpgsql stable security definer set search_path=''
as $$
declare v_ids uuid[];
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_email_hash is null or p_email_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_email_hash'; end if;
  select array_agg(x.user_id) into v_ids
  from (
    select user_id from public.account_email_lookup
    where email_hash=p_email_hash
    order by user_id
    limit 2
  ) x;
  if coalesce(cardinality(v_ids),0)=0 then return null; end if;
  if cardinality(v_ids)<>1 then raise exception 'ambiguous_email_hash'; end if;
  return v_ids[1];
end;
$$;
revoke all on function public.lookup_auth_user_by_email_hash(text) from public,anon,authenticated;
grant execute on function public.lookup_auth_user_by_email_hash(text) to service_role;

-- Retire the older direct Auth email scan now that all callers use the bounded hash index.
drop function if exists public.lookup_auth_user_by_email(text);
