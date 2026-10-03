-- Tailmance v19 R8: serialize boost entitlement/credit decisions per authenticated user.
-- Direct client table writes are revoked; this closes concurrent RPC retries that could
-- otherwise both pass the active/weekly checks before either boost row became visible.

create or replace function public.activate_pet_boost(p_pet_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_tier public.account_tier; v_source text; v_id uuid; v_ends timestamptz;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.pets where id=p_pet_id and species='dog') then raise exception 'boost_discovery_dogs_only'; end if;

  -- Serialize all boost decisions for this account before checking active/weekly state
  -- or decrementing a consumable balance. The row exists for every authenticated app user.
  select tier into v_tier from public.users where id=auth.uid() for update;
  if not found then raise exception 'forbidden'; end if;

  if exists(select 1 from public.pet_boosts where pet_id=p_pet_id and ends_at>now()) then raise exception 'boost_already_active'; end if;
  perform public.rate_limit('activate_boost',10,86400);
  if v_tier='premium' and not exists(
    select 1 from public.pet_boosts where user_id=auth.uid() and source='premium_weekly' and starts_at>=date_trunc('week',now())
  ) then
    v_source:='premium_weekly';
  else
    update public.consumable_balances set boost_credits=boost_credits-1,updated_at=now()
      where user_id=auth.uid() and boost_credits>0;
    if not found then raise exception 'boost_credit_required'; end if;
    v_source:='consumable_credit';
  end if;
  v_ends:=now()+interval '30 minutes';
  insert into public.pet_boosts(pet_id,user_id,source,ends_at) values(p_pet_id,auth.uid(),v_source,v_ends) returning id into v_id;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id) values(auth.uid(),p_pet_id,'pet_boost_activated','pet_boost',v_id);
  return jsonb_build_object('id',v_id,'source',v_source,'endsAt',v_ends);
end $$;
revoke all on function public.activate_pet_boost(uuid) from public,anon;
grant execute on function public.activate_pet_boost(uuid) to authenticated;
