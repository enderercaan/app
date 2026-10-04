-- Used by scripts/postgres-migration-chain-check.mjs (npm run verify:database).
-- Minimal local emulation of the Supabase platform schemas the Tailmance migrations depend on.
-- This is a TEST HARNESS ONLY. It approximates Supabase-owned objects (auth, storage, realtime,
-- extensions, roles, supabase_realtime publication) closely enough to execute the migration chain.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists realtime;
grant usage on schema extensions, auth, storage, realtime to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
alter database postgres set search_path to "$user", public, extensions;
set search_path to public, extensions;

create table auth.users(
  instance_id uuid, id uuid primary key default extensions.gen_random_uuid(), aud text, role text,
  email text, encrypted_password text, email_confirmed_at timestamptz, invited_at timestamptz,
  confirmation_token text, confirmation_sent_at timestamptz, recovery_token text, recovery_sent_at timestamptz,
  last_sign_in_at timestamptz, raw_app_meta_data jsonb default '{}'::jsonb, raw_user_meta_data jsonb default '{}'::jsonb,
  is_super_admin boolean, created_at timestamptz default now(), updated_at timestamptz default now(),
  phone text unique, phone_confirmed_at timestamptz, confirmed_at timestamptz,
  banned_until timestamptz, deleted_at timestamptz, is_sso_user boolean not null default false, is_anonymous boolean not null default false
);
create table auth.sessions(
  id uuid primary key default extensions.gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(), updated_at timestamptz default now(), factor_id uuid, aal text,
  not_after timestamptz, refreshed_at timestamp, user_agent text, ip inet, tag text
);
create table auth.mfa_factors(
  id uuid primary key default extensions.gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  friendly_name text, factor_type text not null default 'totp', status text not null default 'unverified',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), secret text, phone text
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                  nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
create or replace function auth.email() returns text language sql stable as $$ select auth.jwt() ->> 'email' $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create table storage.buckets(
  id text primary key, name text not null unique, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(),
  public boolean default false, avif_autodetection boolean default false, file_size_limit bigint, allowed_mime_types text[], owner_id text
);
create table storage.objects(
  id uuid primary key default extensions.gen_random_uuid(), bucket_id text references storage.buckets(id), name text,
  owner uuid, owner_id text, created_at timestamptz default now(), updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(), metadata jsonb, user_metadata jsonb, version text,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored
);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
create or replace function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[]; begin select string_to_array(name, '/') into _parts; return _parts[1:array_length(_parts,1)-1]; end $$;
create or replace function storage.filename(name text) returns text language plpgsql immutable as $$
declare _parts text[]; begin select string_to_array(name, '/') into _parts; return _parts[array_length(_parts,1)]; end $$;
create or replace function storage.extension(name text) returns text language plpgsql immutable as $$
declare _parts text[]; _filename text; begin select string_to_array(name, '/') into _parts; select _parts[array_length(_parts,1)] into _filename; return reverse(split_part(reverse(_filename), '.', 1)); end $$;
grant all on storage.objects, storage.buckets to authenticated, service_role;
grant select on storage.objects, storage.buckets to anon;

create table realtime.messages(
  id bigserial, topic text not null, extension text not null default 'broadcast', payload jsonb, event text, private boolean default false,
  updated_at timestamp not null default now(), inserted_at timestamp not null default now(), primary key(id, inserted_at)
);
alter table realtime.messages enable row level security;
create or replace function realtime.topic() returns text language sql stable as $$ select nullif(current_setting('realtime.topic', true), '')::text $$;
grant select, insert on realtime.messages to authenticated;
create publication supabase_realtime;
-- Supabase default privileges: functions/tables in public are executable/accessible by API roles unless revoked.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
