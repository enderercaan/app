-- Tailmance v19 R8: close remaining desired-state retry gaps.
-- 1) Privacy-setting no-op retries must not consume rate budget or duplicate audit events,
--    while real state changes remain bounded.
-- 2) Replaying an identical pet-prompt payload after response loss must not requeue moderation,
--    consume rate budget, or churn rows. The pet row serializes concurrent prompt saves.

create or replace function public.update_privacy_settings(p_discoverable boolean,p_incognito boolean)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_discoverable boolean;
  v_incognito boolean;
  v_tier public.account_tier;
begin
  perform public.require_active_authenticated_session();
  select u.discoverable,u.incognito,u.tier into v_discoverable,v_incognito,v_tier
    from public.users u where u.id=auth.uid() for update;
  if not found then raise exception 'authentication_required'; end if;
  if p_incognito and v_tier<>'premium' then raise exception 'premium_required'; end if;
  if v_discoverable is not distinct from p_discoverable and v_incognito is not distinct from p_incognito then return; end if;
  perform public.rate_limit('privacy_settings',30,3600);
  update public.users set discoverable=p_discoverable,incognito=p_incognito,updated_at=now() where id=auth.uid();
  insert into public.audit_events(user_id,action,entity_type,metadata)
  values(auth.uid(),'privacy_settings_update','user',jsonb_build_object('discoverable',p_discoverable,'incognito',p_incognito));
end $$;
revoke all on function public.update_privacy_settings(boolean,boolean) from public,anon;
grant execute on function public.update_privacy_settings(boolean,boolean) to authenticated;

create or replace function public.upsert_pet_prompts(p_pet_id uuid,p_prompts jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_item jsonb;
  v_order integer:=0;
  v_answer text;
  v_key text;
  v_requested jsonb:='[]'::jsonb;
  v_existing jsonb:='[]'::jsonb;
  v_allowed constant text[]:=array[
    'favoriteGame','firstMeet','happyThing','atPark','likeInPets','threeWords',
    'En sevdiğim oyun','İlk tanışmada ben','Beni mutlu eden şey',
    'Parkta beni bulursan','Diğer petlerde sevdiğim şey','Beni en iyi anlatan üç kelime'
  ];
  v_seen text[]:='{}';
begin
  perform public.require_active_authenticated_session();
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if jsonb_typeof(coalesce(p_prompts,'[]'::jsonb)) <> 'array' then raise exception 'invalid_prompts'; end if;
  if jsonb_array_length(coalesce(p_prompts,'[]'::jsonb)) > 3 then raise exception 'too_many_prompts'; end if;

  -- Validate and normalize the complete payload before taking the mutation lock. Empty answers
  -- remain equivalent to omission, matching the existing product behavior.
  for v_item in select * from jsonb_array_elements(coalesce(p_prompts,'[]'::jsonb)) loop
    if jsonb_typeof(v_item)<>'object' then raise exception 'invalid_prompt'; end if;
    v_key:=trim(coalesce(v_item->>'promptKey',''));
    v_answer:=trim(coalesce(v_item->>'answer',''));
    if v_answer='' then continue; end if;
    if not (v_key=any(v_allowed)) then raise exception 'invalid_prompt_key'; end if;
    if v_key=any(v_seen) then raise exception 'duplicate_prompt_key'; end if;
    if char_length(v_answer)>240 then raise exception 'prompt_answer_too_long'; end if;
    v_seen:=array_append(v_seen,v_key);
    v_requested:=v_requested||jsonb_build_array(jsonb_build_object('promptKey',v_key,'answer',v_answer));
  end loop;

  -- Serialize saves for this pet. A complete committed first attempt makes an ambiguous retry
  -- a pure no-op, so moderation state and rate budget are not touched twice.
  perform 1 from public.pets p where p.id=p_pet_id and p.owner_id=auth.uid() for update;
  if not found then raise exception 'forbidden'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('promptKey',pp.prompt_key,'answer',pp.answer) order by pp.sort_order),'[]'::jsonb)
    into v_existing from public.pet_prompts pp where pp.pet_id=p_pet_id;
  if v_existing=v_requested then return; end if;

  perform public.rate_limit('pet_prompts',30,3600);
  delete from public.pet_prompts where pet_id=p_pet_id;
  v_order:=0;
  for v_item in select * from jsonb_array_elements(v_requested) loop
    v_order:=v_order+1;
    insert into public.pet_prompts(pet_id,prompt_key,answer,sort_order)
    values(p_pet_id,v_item->>'promptKey',v_item->>'answer',v_order);
  end loop;
  update public.pets set moderation_status='pending',updated_at=now() where id=p_pet_id;
  insert into public.moderation_items(target_type,target_id,status) values('pet_text',p_pet_id,'pending')
  on conflict(target_type,target_id) do update set status='pending',reason=null,reviewed_at=null;
end $$;
revoke all on function public.upsert_pet_prompts(uuid,jsonb) from public,anon;
grant execute on function public.upsert_pet_prompts(uuid,jsonb) to authenticated;
