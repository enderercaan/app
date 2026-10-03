-- Tailmance TUR 2: serialize destructive account deletion across devices/workers.
create table if not exists public.account_deletion_claims(
  user_id uuid primary key references auth.users(id) on delete cascade,
  claim_token uuid not null,
  claimed_at timestamptz not null default now()
);
alter table public.account_deletion_claims enable row level security;
revoke all on public.account_deletion_claims from public,anon,authenticated;

create or replace function public.claim_account_deletion(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_existing public.account_deletion_claims%rowtype;
  v_token uuid:=gen_random_uuid();
  v_inserted integer:=0;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_user_id is null then raise exception 'invalid_user'; end if;
  if not exists(select 1 from auth.users where id=p_user_id) then
    return jsonb_build_object('claimed',false,'status','missing_user');
  end if;

  -- The INSERT itself arbitrates the first-claim race. A select-then-insert sequence can let
  -- two transactions both observe "missing" before one loses with a unique violation.
  insert into public.account_deletion_claims(user_id,claim_token,claimed_at)
  values(p_user_id,v_token,now())
  on conflict(user_id) do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted=1 then
    return jsonb_build_object('claimed',true,'claimToken',v_token);
  end if;

  select * into v_existing
  from public.account_deletion_claims
  where user_id=p_user_id
  for update;
  if v_existing.user_id is null then raise exception 'claim_state_missing'; end if;
  if v_existing.claimed_at>now()-interval '15 minutes' then
    return jsonb_build_object('claimed',false,'status','processing');
  end if;

  update public.account_deletion_claims
  set claim_token=v_token,claimed_at=now()
  where user_id=p_user_id;
  return jsonb_build_object('claimed',true,'claimToken',v_token,'recoveredStale',true);
end $$;
revoke all on function public.claim_account_deletion(uuid) from public,anon,authenticated;
grant execute on function public.claim_account_deletion(uuid) to service_role;

create or replace function public.release_account_deletion_claim(p_user_id uuid,p_claim_token uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_deleted integer;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  delete from public.account_deletion_claims where user_id=p_user_id and claim_token=p_claim_token;
  get diagnostics v_deleted=row_count;
  return v_deleted=1;
end $$;
revoke all on function public.release_account_deletion_claim(uuid,uuid) from public,anon,authenticated;
grant execute on function public.release_account_deletion_claim(uuid,uuid) to service_role;
