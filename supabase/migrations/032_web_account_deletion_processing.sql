-- Tailmance TUR 2: complete the public web account-deletion path without treating
-- knowledge of an email address as deletion authority. Processing is service-role only,
-- requires an explicit identity-verification attestation, is claim-token serialized,
-- and minimizes request PII once resolved.

alter table public.account_deletion_requests add column if not exists claim_token uuid;
alter table public.account_deletion_requests add column if not exists claimed_at timestamptz;
alter table public.account_deletion_requests add column if not exists target_user_id uuid;
alter table public.account_deletion_requests add column if not exists identity_verified_at timestamptz;
alter table public.account_deletion_requests add column if not exists verification_reference text;
alter table public.account_deletion_requests alter column email drop not null;
alter table public.account_deletion_requests alter column email_hash drop not null;
alter table public.account_deletion_requests alter column request_fingerprint drop not null;
alter table public.account_deletion_requests drop constraint if exists account_deletion_requests_email_check;
alter table public.account_deletion_requests add constraint account_deletion_requests_email_check
  check (email is null or char_length(email) between 3 and 254) not valid;
alter table public.account_deletion_requests validate constraint account_deletion_requests_email_check;
alter table public.account_deletion_requests add constraint account_deletion_requests_verification_reference_check
  check (verification_reference is null or char_length(verification_reference)<=255) not valid;
alter table public.account_deletion_requests validate constraint account_deletion_requests_verification_reference_check;

-- Collapse duplicate open requests before enforcing one open request per normalized email.
with ranked as (
  select id,row_number() over(partition by email_hash order by requested_at desc,id desc) as rn
  from public.account_deletion_requests
  where email_hash is not null and status in ('pending','verifying')
)
update public.account_deletion_requests r
set status='rejected',resolved_at=now(),resolution_note='duplicate_request_superseded',
    email=null,email_hash=null,ip_hash=null,request_fingerprint=null
from ranked d where r.id=d.id and d.rn>1;

create unique index if not exists account_deletion_one_open_email_idx
  on public.account_deletion_requests(email_hash)
  where email_hash is not null and status in ('pending','verifying');
create index if not exists account_deletion_claim_idx
  on public.account_deletion_requests(claimed_at) where status='verifying';

create or replace function public.claim_web_account_deletion_request(
  p_request_id uuid,
  p_identity_verified boolean,
  p_verification_reference text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_row public.account_deletion_requests%rowtype;
  v_token uuid:=gen_random_uuid();
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_identity_verified is distinct from true then raise exception 'identity_verification_required'; end if;
  if p_verification_reference is null or char_length(trim(p_verification_reference)) not between 1 and 255 then raise exception 'verification_reference_required'; end if;

  select * into v_row from public.account_deletion_requests where id=p_request_id for update;
  if v_row.id is null then return jsonb_build_object('claimed',false,'status','not_found'); end if;
  if v_row.status in ('completed','rejected') then return jsonb_build_object('claimed',false,'status',v_row.status); end if;
  if v_row.email_hash is null or v_row.email is null then raise exception 'request_identity_missing'; end if;
  if v_row.status='verifying' and v_row.claimed_at is not null and v_row.claimed_at>now()-interval '15 minutes' then
    return jsonb_build_object('claimed',false,'status','verifying');
  end if;

  update public.account_deletion_requests
  set status='verifying',claim_token=v_token,claimed_at=now(),identity_verified_at=coalesce(identity_verified_at,now()),
      verification_reference=left(trim(p_verification_reference),255)
  where id=p_request_id;

  return jsonb_build_object(
    'claimed',true,'claimToken',v_token,'status','verifying','emailHash',v_row.email_hash,
    'email',v_row.email,'targetUserId',v_row.target_user_id
  );
end;
$$;
revoke all on function public.claim_web_account_deletion_request(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_web_account_deletion_request(uuid,boolean,text) to service_role;

create or replace function public.lookup_auth_user_by_email(p_email text)
returns uuid
language plpgsql stable security definer set search_path=''
as $$
declare
  v_email text:=lower(trim(coalesce(p_email,'')));
  v_ids uuid[];
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if char_length(v_email) not between 3 and 254 or position('@' in v_email)=0 then raise exception 'invalid_email'; end if;

  -- Supabase Auth stores normalized email in normal operation, so use the indexed exact path first.
  select array_agg(x.id) into v_ids
  from (
    select u.id from auth.users u
    where u.email=v_email
    order by u.id limit 2
  ) x;

  -- Bounded legacy fallback for historical/case-variant rows. This is intentionally reached only
  -- when the exact normalized lookup found no account.
  if coalesce(cardinality(v_ids),0)=0 then
    select array_agg(x.id) into v_ids
    from (
      select u.id from auth.users u
      where u.email is not null and lower(trim(u.email))=v_email
      order by u.id limit 2
    ) x;
  end if;

  if coalesce(cardinality(v_ids),0)=0 then return null; end if;
  if cardinality(v_ids)<>1 then raise exception 'ambiguous_email'; end if;
  return v_ids[1];
end;
$$;
revoke all on function public.lookup_auth_user_by_email(text) from public,anon,authenticated;
grant execute on function public.lookup_auth_user_by_email(text) to service_role;

create or replace function public.bind_web_account_deletion_target(
  p_request_id uuid,
  p_claim_token uuid,
  p_user_id uuid
) returns boolean
language plpgsql security definer set search_path=''
as $$
declare v_updated integer;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_user_id is null then raise exception 'invalid_user_id'; end if;
  update public.account_deletion_requests
  set target_user_id=p_user_id
  where id=p_request_id and status='verifying' and claim_token=p_claim_token
    and (target_user_id is null or target_user_id=p_user_id);
  get diagnostics v_updated=row_count;
  return v_updated=1;
end;
$$;
revoke all on function public.bind_web_account_deletion_target(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.bind_web_account_deletion_target(uuid,uuid,uuid) to service_role;

create or replace function public.finish_web_account_deletion_request(
  p_request_id uuid,
  p_claim_token uuid,
  p_status text,
  p_resolution_note text default null
) returns boolean
language plpgsql security definer set search_path=''
as $$
declare v_updated integer;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_status not in ('completed','rejected') then raise exception 'invalid_status'; end if;
  update public.account_deletion_requests
  set status=p_status,resolved_at=now(),resolution_note=left(nullif(trim(coalesce(p_resolution_note,'')),''),255),
      claim_token=null,claimed_at=null,target_user_id=null,verification_reference=null,
      email=null,email_hash=null,ip_hash=null,request_fingerprint=null
  where id=p_request_id and status='verifying' and claim_token=p_claim_token;
  get diagnostics v_updated=row_count;
  return v_updated=1;
end;
$$;
revoke all on function public.finish_web_account_deletion_request(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.finish_web_account_deletion_request(uuid,uuid,text,text) to service_role;

create or replace function public.release_web_account_deletion_request(
  p_request_id uuid,
  p_claim_token uuid,
  p_error_code text default null
) returns boolean
language plpgsql security definer set search_path=''
as $$
declare v_updated integer;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  update public.account_deletion_requests
  set claim_token=null,claimed_at=null,
      resolution_note=case when p_error_code is null then resolution_note else left(p_error_code,120) end
  where id=p_request_id and status='verifying' and claim_token=p_claim_token;
  get diagnostics v_updated=row_count;
  return v_updated=1;
end;
$$;
revoke all on function public.release_web_account_deletion_request(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.release_web_account_deletion_request(uuid,uuid,text) to service_role;
