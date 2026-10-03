-- Security helpers, RLS, and all client-facing RPCs.

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path='' as $$
begin new.updated_at=now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['users','pets','pet_private','pet_health_summary','pet_photos','pet_vaccinations','posts','subscriptions'] loop
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()',t,t);
  end loop;
end $$;

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.users(id,age_18_confirmed,legal_version)
  values(new.id,coalesce((new.raw_user_meta_data->>'age_18_confirmed')::boolean,false),new.raw_user_meta_data->>'legal_version')
  on conflict(id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();

create or replace function public.owns_pet(p_pet_id uuid,p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.pets p where p.id=p_pet_id and p.owner_id=p_user_id);
$$;

create or replace function public.is_blocked(p_pet_a uuid,p_pet_b uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.blocks b where (b.blocker_pet_id=p_pet_a and b.blocked_pet_id=p_pet_b) or (b.blocker_pet_id=p_pet_b and b.blocked_pet_id=p_pet_a));
$$;

create or replace function public.rate_limit(p_action text,p_limit integer,p_window_seconds integer)
returns void language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_window timestamptz; v_count integer;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode='42501'; end if;
  v_window := to_timestamp(floor(extract(epoch from now())/p_window_seconds)*p_window_seconds);
  insert into public.rate_limits(user_id,action,window_start,count) values(v_uid,p_action,v_window,1)
  on conflict(user_id,action,window_start) do update set count=public.rate_limits.count+1 returning count into v_count;
  if coalesce(v_count,1)>p_limit then raise exception 'rate_limit_exceeded' using errcode='P0001'; end if;
end $$;

create or replace function public.haversine_km(lat1 double precision,lon1 double precision,lat2 double precision,lon2 double precision)
returns double precision language sql immutable set search_path='' as $$
  select 6371.0*2*asin(sqrt(power(sin(radians(lat2-lat1)/2),2)+cos(radians(lat1))*cos(radians(lat2))*power(sin(radians(lon2-lon1)/2),2)));
$$;

create or replace function public.pet_json(p_pet_id uuid,p_viewer_pet_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'id',p.id,'name',p.name,'species',p.species,'breed',p.breed,'sex',p.sex,'birthDate',p.birth_date,
    'ageYears',case when p.birth_date is null then null else extract(year from age(current_date,p.birth_date))::int end,
    'size',p.size,'weightKg',p.weight_kg,'energyLevel',p.energy_level,'temperamentTags',p.temperament_tags,
    'city',p.city,'district',p.district,'neighborhood',p.neighborhood,
    'purposes',coalesce((select jsonb_agg(pp.purpose order by pp.purpose) from public.pet_purposes pp where pp.pet_id=p.id),'[]'::jsonb),
    'bio',p.bio,'profileVerified',p.profile_verified,
    'photos',coalesce((select jsonb_agg(jsonb_build_object('id',ph.id,'url',ph.storage_path,'sortOrder',ph.sort_order,'moderationStatus',ph.moderation_status) order by ph.sort_order) from public.pet_photos ph where ph.pet_id=p.id and (ph.moderation_status='approved' or p.owner_id=auth.uid())),'[]'::jsonb),
    'health',jsonb_build_object('vaccinationStatus',coalesce(h.vaccination_status,'unknown'::public.vaccination_status),'veterinarianVerified',coalesce(h.veterinarian_verified,false),'neutered',h.neutered,'microchipVerified',coalesce(h.microchip_verified,false),'geneticScreeningAvailable',coalesce(h.genetic_screening_available,false),'pedigreeAvailable',coalesce(h.pedigree_available,false)),
    'followersCount',(select count(*) from public.follows f where f.to_pet_id=p.id),
    'followingCount',(select count(*) from public.follows f where f.from_pet_id=p.id),
    'isFollowing',case when p_viewer_pet_id is null then false else exists(select 1 from public.follows f where f.from_pet_id=p_viewer_pet_id and f.to_pet_id=p.id) end
  )
  from public.pets p left join public.pet_health_summary h on h.pet_id=p.id where p.id=p_pet_id;
$$;

create or replace function public.get_my_pets()
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(public.pet_json(p.id,p.id) order by p.created_at),'[]'::jsonb) from public.pets p where p.owner_id=auth.uid();
$$;

create or replace function public.upsert_pet_profile(p_pet_id uuid,p_payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid:=p_pet_id; v_count int;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  perform public.rate_limit('upsert_pet',20,3600);
  if v_id is null then
    select count(*) into v_count from public.pets where owner_id=auth.uid();
    if v_count>=5 then raise exception 'pet_limit_reached'; end if;
    insert into public.pets(owner_id,name,species,breed,sex,birth_date,size,weight_kg,energy_level,temperament_tags,bio,city,district,neighborhood)
    values(auth.uid(),trim(p_payload->>'name'),coalesce((p_payload->>'species')::public.pet_species,'dog'),trim(p_payload->>'breed'),coalesce((p_payload->>'sex')::public.pet_sex,'male'),nullif(p_payload->>'birthDate','')::date,coalesce((p_payload->>'size')::public.pet_size,'medium'),nullif(p_payload->>'weightKg','')::numeric,nullif(p_payload->>'energyLevel','')::smallint,coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'temperamentTags','[]'::jsonb))),'{}'),left(coalesce(p_payload->>'bio',''),500),trim(p_payload->>'city'),trim(p_payload->>'district'),nullif(trim(coalesce(p_payload->>'neighborhood','')),'')) returning id into v_id;
    insert into public.pet_private(pet_id) values(v_id);
    insert into public.pet_health_summary(pet_id) values(v_id);
  else
    if not public.owns_pet(v_id) then raise exception 'forbidden'; end if;
    update public.pets set
      name=coalesce(nullif(trim(p_payload->>'name'),''),name), breed=coalesce(nullif(trim(p_payload->>'breed'),''),breed),
      species=case when p_payload ? 'species' then (p_payload->>'species')::public.pet_species else species end,
      sex=case when p_payload ? 'sex' then (p_payload->>'sex')::public.pet_sex else sex end,
      bio=left(coalesce(p_payload->>'bio',bio),500), city=coalesce(nullif(trim(p_payload->>'city'),''),city), district=coalesce(nullif(trim(p_payload->>'district'),''),district),
      neighborhood=coalesce(nullif(trim(p_payload->>'neighborhood'),''),neighborhood),
      birth_date=case when p_payload ? 'birthDate' then nullif(p_payload->>'birthDate','')::date else birth_date end,
      size=case when p_payload ? 'size' then (p_payload->>'size')::public.pet_size else size end,
      weight_kg=case when p_payload ? 'weightKg' then nullif(p_payload->>'weightKg','')::numeric else weight_kg end,
      energy_level=case when p_payload ? 'energyLevel' then nullif(p_payload->>'energyLevel','')::smallint else energy_level end,
      temperament_tags=case when p_payload ? 'temperamentTags' then array(select jsonb_array_elements_text(p_payload->'temperamentTags')) else temperament_tags end
    where id=v_id;
  end if;
  if p_payload ? 'purposes' then
    delete from public.pet_purposes where pet_id=v_id;
    insert into public.pet_purposes(pet_id,purpose) select v_id,(x)::public.pet_purpose from jsonb_array_elements_text(p_payload->'purposes') x;
  end if;
  insert into public.moderation_items(target_type,target_id,status) values('pet_text',v_id,'pending') on conflict(target_type,target_id) do update set status='pending',reason=null,reviewed_at=null;
  update public.pets set moderation_status='pending' where id=v_id;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id) values(auth.uid(),v_id,'pet_profile_upsert','pet',v_id);
  return v_id;
end $$;

create or replace function public.attach_pet_photo(p_pet_id uuid,p_storage_path text,p_sort_order smallint)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_sort_order not between 1 and 3 or split_part(p_storage_path,'/',1)<>p_pet_id::text then raise exception 'invalid_photo_path'; end if;
  perform public.rate_limit('photo_attach',20,3600);
  insert into public.pet_photos(pet_id,storage_path,sort_order,moderation_status) values(p_pet_id,p_storage_path,p_sort_order,'pending')
  on conflict(pet_id,sort_order) do update set storage_path=excluded.storage_path,moderation_status='pending',moderation_reason=null,updated_at=now()
  returning id into v_id;
  insert into public.moderation_items(target_type,target_id,status) values('pet_photo',v_id,'pending') on conflict(target_type,target_id) do update set status='pending',reason=null,reviewed_at=null;
  return v_id;
end $$;

create or replace function public.attach_health_document(p_pet_id uuid,p_document_type text,p_storage_path text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if split_part(p_storage_path,'/',1)<>p_pet_id::text then raise exception 'invalid_document_path'; end if;
  perform public.rate_limit('health_document_attach',10,3600);
  insert into public.health_documents(pet_id,document_type,storage_path,verification_status) values(p_pet_id,left(trim(p_document_type),80),p_storage_path,'pending') returning id into v_id;
  insert into public.moderation_items(target_type,target_id,status) values('health_document',v_id,'pending') on conflict do nothing;
  return v_id;
end $$;

create or replace function public.update_pet_private_location(p_pet_id uuid,p_latitude double precision,p_longitude double precision)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then raise exception 'invalid_coordinates'; end if;
  insert into public.pet_private(pet_id,latitude,longitude) values(p_pet_id,p_latitude,p_longitude)
  on conflict(pet_id) do update set latitude=excluded.latitude,longitude=excluded.longitude,updated_at=now();
end $$;

create or replace function public.discover_pets(p_active_pet_id uuid,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_me public.pets; v_private public.pet_private; v_result jsonb;
begin
  if not public.owns_pet(p_active_pet_id) then raise exception 'forbidden'; end if;
  select * into v_me from public.pets where id=p_active_pet_id;
  select * into v_private from public.pet_private where pet_id=p_active_pet_id;
  select coalesce(jsonb_agg(item order by (item->>'compatibilityScore')::int desc nulls last),'[]'::jsonb) into v_result
  from (
    select public.pet_json(p.id,p_active_pet_id) || jsonb_build_object(
      'approximateDistanceKm',case when v_private.latitude is null or pp.latitude is null then null else round(public.haversine_km(v_private.latitude,v_private.longitude,pp.latitude,pp.longitude)::numeric,1) end,
      'compatibilityScore',least(100,35 + case when p.species=v_me.species then 15 else 0 end + case when p.size=v_me.size then 8 else 0 end + least(20,(select count(*)*7 from public.pet_purposes a join public.pet_purposes b on a.purpose=b.purpose where a.pet_id=p_active_pet_id and b.pet_id=p.id)))
    ) item
    from public.pets p
    join public.users u on u.id=p.owner_id and u.suspended_at is null and u.discoverable
    left join public.pet_private pp on pp.pet_id=p.id
    left join public.pet_health_summary h on h.pet_id=p.id
    where p.id<>p_active_pet_id and p.owner_id<>auth.uid() and p.discovery_enabled and p.moderation_status='approved'
      and (select count(*) from public.pet_photos ph where ph.pet_id=p.id and ph.moderation_status='approved')=3
      and not public.is_blocked(p_active_pet_id,p.id)
      and not exists(select 1 from public.pet_passes ps where ps.from_pet_id=p_active_pet_id and ps.to_pet_id=p.id and ps.created_at>now()-interval '30 days')
      and not exists(select 1 from public.pet_matches m where m.unmatched_at is null and m.pet_low_id=least(p_active_pet_id,p.id) and m.pet_high_id=greatest(p_active_pet_id,p.id))
      and (coalesce(p_filters->>'species','all')='all' or p.species::text=p_filters->>'species')
      and (coalesce(p_filters->>'sex','all')='all' or p.sex::text=p_filters->>'sex')
      and (coalesce(jsonb_array_length(coalesce(p_filters->'sizes','[]'::jsonb)),0)=0 or p.size::text in (select jsonb_array_elements_text(p_filters->'sizes')))
      and (nullif(p_filters->>'minAge','') is null or p.birth_date is null or extract(year from age(current_date,p.birth_date)) >= (p_filters->>'minAge')::int)
      and (nullif(p_filters->>'maxAge','') is null or p.birth_date is null or extract(year from age(current_date,p.birth_date)) <= (p_filters->>'maxAge')::int)
      and (nullif(p_filters->>'city','') is null or lower(p.city)=lower(p_filters->>'city'))
      and (nullif(p_filters->>'district','') is null or lower(p.district)=lower(p_filters->>'district'))
      and (nullif(p_filters->>'neighborhood','') is null or lower(coalesce(p.neighborhood,''))=lower(p_filters->>'neighborhood'))
      and (coalesce((p_filters->>'vaccinatedOnly')::boolean,false)=false or h.vaccination_status='complete')
      and (coalesce((p_filters->>'veterinarianVerifiedOnly')::boolean,false)=false or h.veterinarian_verified)
      and (coalesce((p_filters->>'profileVerifiedOnly')::boolean,false)=false or p.profile_verified)
      and (coalesce(jsonb_array_length(coalesce(p_filters->'purposes','[]'::jsonb)),0)=0 or exists(select 1 from public.pet_purposes x where x.pet_id=p.id and x.purpose::text in (select jsonb_array_elements_text(p_filters->'purposes'))))
      and (nullif(p_filters->>'maxDistanceKm','') is null or v_private.latitude is null or pp.latitude is null or public.haversine_km(v_private.latitude,v_private.longitude,pp.latitude,pp.longitude) <= (p_filters->>'maxDistanceKm')::double precision)
      and (coalesce((p_filters->>'matingOnlyNonNeutered')::boolean,true)=false or not exists(select 1 from public.pet_purposes px where px.pet_id=p.id and px.purpose='mating') or h.neutered=false)
    limit 100
  ) q;
  return v_result;
end $$;

create or replace function public.like_pet(p_from_pet_id uuid,p_to_pet_id uuid,p_kind public.like_kind default 'like')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_match_id uuid; v_low uuid:=least(p_from_pet_id,p_to_pet_id); v_high uuid:=greatest(p_from_pet_id,p_to_pet_id); v_other_owner uuid; v_matched boolean:=false;
begin
  if not public.owns_pet(p_from_pet_id) then raise exception 'forbidden'; end if;
  if p_from_pet_id=p_to_pet_id or public.is_blocked(p_from_pet_id,p_to_pet_id) then raise exception 'invalid_target'; end if;
  perform public.rate_limit(case when p_kind='super_like' then 'super_like' else 'like' end,case when p_kind='super_like' then 20 else 200 end,86400);
  if p_kind='super_like' and not exists(select 1 from public.users where id=auth.uid() and tier='premium') then raise exception 'premium_required'; end if;
  insert into public.pet_likes(from_pet_id,to_pet_id,kind) values(p_from_pet_id,p_to_pet_id,p_kind) on conflict(from_pet_id,to_pet_id) do update set kind=excluded.kind,created_at=now();
  delete from public.pet_passes where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id;
  if exists(select 1 from public.pet_likes where from_pet_id=p_to_pet_id and to_pet_id=p_from_pet_id) then
    insert into public.pet_matches(pet_low_id,pet_high_id) values(v_low,v_high)
    on conflict(pet_low_id,pet_high_id) do update set unmatched_at=null,unmatched_by_pet_id=null,matched_at=now()
    returning id into v_match_id;
    insert into public.conversations(match_id) values(v_match_id) on conflict(match_id) do nothing;
    v_matched:=true;
    select owner_id into v_other_owner from public.pets where id=p_to_pet_id;
    insert into public.notifications(user_id,type,title,body,entity_id) values(auth.uid(),'match','Yeni eşleşme 🐾','Petlerin karşılıklı beğenisi eşleşmeye dönüştü.',v_match_id);
    if v_other_owner<>auth.uid() then insert into public.notifications(user_id,type,title,body,entity_id) values(v_other_owner,'match','Yeni eşleşme 🐾','Petlerin karşılıklı beğenisi eşleşmeye dönüştü.',v_match_id); end if;
  else
    select owner_id into v_other_owner from public.pets where id=p_to_pet_id;
    if v_other_owner is not null then insert into public.notifications(user_id,type,title,body,entity_id) values(v_other_owner,'like','Yeni pati ilgisi','Petlerinden biri beğeni aldı.',p_from_pet_id); end if;
  end if;
  return jsonb_build_object('matched',v_matched,'match_id',v_match_id);
end $$;

create or replace function public.pass_pet(p_from_pet_id uuid,p_to_pet_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_from_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('pass',400,86400);
  insert into public.pet_passes(from_pet_id,to_pet_id) values(p_from_pet_id,p_to_pet_id) on conflict(from_pet_id,to_pet_id) do update set created_at=now();
  delete from public.pet_likes where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id;
end $$;

create or replace function public.toggle_favorite_pet(p_from_pet_id uuid,p_to_pet_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_from_pet_id) then raise exception 'forbidden'; end if;
  if exists(select 1 from public.pet_favorites where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id) then delete from public.pet_favorites where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id; return false;
  else insert into public.pet_favorites(from_pet_id,to_pet_id) values(p_from_pet_id,p_to_pet_id); return true; end if;
end $$;

create or replace function public.get_matches(p_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'conversationId',(select c.id from public.conversations c where c.match_id=m.id),'otherPet',public.pet_json(case when m.pet_low_id=p_pet_id then m.pet_high_id else m.pet_low_id end,p_pet_id),
    'matchedAt',m.matched_at,'commonPurposes',coalesce((select jsonb_agg(a.purpose) from public.pet_purposes a join public.pet_purposes b on a.purpose=b.purpose where a.pet_id=p_pet_id and b.pet_id=case when m.pet_low_id=p_pet_id then m.pet_high_id else m.pet_low_id end),'[]'::jsonb),
    'lastMessage',(select msg.body from public.conversations c join public.messages msg on msg.conversation_id=c.id where c.match_id=m.id order by msg.created_at desc limit 1),
    'lastMessageAt',(select msg.created_at from public.conversations c join public.messages msg on msg.conversation_id=c.id where c.match_id=m.id order by msg.created_at desc limit 1),
    'unreadCount',(select count(*) from public.conversations c join public.messages msg on msg.conversation_id=c.id where c.match_id=m.id and msg.sender_pet_id<>p_pet_id and msg.read_at is null)
  ) order by m.matched_at desc),'[]'::jsonb)
  from public.pet_matches m where public.owns_pet(p_pet_id) and m.unmatched_at is null and (m.pet_low_id=p_pet_id or m.pet_high_id=p_pet_id);
$$;

create or replace function public.unmatch_pet(p_match_id uuid,p_pet_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  update public.pet_matches set unmatched_at=now(),unmatched_by_pet_id=p_pet_id where id=p_match_id and unmatched_at is null and (pet_low_id=p_pet_id or pet_high_id=p_pet_id);
  if not found then raise exception 'match_not_found'; end if;
end $$;

create or replace function public.send_message(p_conversation_id uuid,p_sender_pet_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_match public.pet_matches; v_uid uuid:=auth.uid(); v_msg public.messages; v_other_pet uuid; v_other_owner uuid; v_tier public.account_tier;
begin
  if not public.owns_pet(p_sender_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('message',60,60);
  select m.* into v_match from public.conversations c join public.pet_matches m on m.id=c.match_id where c.id=p_conversation_id;
  if v_match.id is null or v_match.unmatched_at is not null or p_sender_pet_id not in (v_match.pet_low_id,v_match.pet_high_id) then raise exception 'active_match_required'; end if;
  v_other_pet:=case when p_sender_pet_id=v_match.pet_low_id then v_match.pet_high_id else v_match.pet_low_id end;
  if public.is_blocked(p_sender_pet_id,v_other_pet) then raise exception 'blocked'; end if;
  select tier into v_tier from public.users where id=v_uid for update;
  if v_tier='standard' then
    update public.users set free_messages_sent=free_messages_sent+1 where id=v_uid and free_messages_sent<2;
    if not found then raise exception 'free_message_limit_reached'; end if;
  end if;
  insert into public.messages(conversation_id,sender_pet_id,body) values(p_conversation_id,p_sender_pet_id,left(trim(p_body),2000)) returning * into v_msg;
  select owner_id into v_other_owner from public.pets where id=v_other_pet;
  insert into public.notifications(user_id,type,title,body,entity_id) values(v_other_owner,'message','Yeni mesaj','Eşleştiğin bir petten yeni mesaj var.',p_conversation_id);
  return jsonb_build_object('id',v_msg.id,'conversationId',v_msg.conversation_id,'senderPetId',v_msg.sender_pet_id,'body',v_msg.body,'createdAt',v_msg.created_at,'readAt',v_msg.read_at);
end $$;

create or replace function public.get_conversation_messages(p_conversation_id uuid,p_limit integer default 100)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'conversationId',x.conversation_id,'senderPetId',x.sender_pet_id,'body',x.body,'createdAt',x.created_at,'readAt',x.read_at) order by x.created_at),'[]'::jsonb)
  from (select msg.* from public.messages msg join public.conversations c on c.id=msg.conversation_id join public.pet_matches m on m.id=c.match_id where msg.conversation_id=p_conversation_id and exists(select 1 from public.pets p where p.owner_id=auth.uid() and p.id in(m.pet_low_id,m.pet_high_id)) order by msg.created_at desc limit least(greatest(p_limit,1),200)) x;
$$;

create or replace function public.mark_conversation_read(p_conversation_id uuid,p_viewer_pet_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_viewer_pet_id) then raise exception 'forbidden'; end if;
  update public.messages msg set read_at=coalesce(read_at,now()) from public.conversations c,public.pet_matches m where msg.conversation_id=p_conversation_id and c.id=p_conversation_id and m.id=c.match_id and p_viewer_pet_id in(m.pet_low_id,m.pet_high_id) and msg.sender_pet_id<>p_viewer_pet_id and msg.read_at is null;
end $$;

create or replace function public.toggle_follow_pet(p_from_pet_id uuid,p_to_pet_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_owner uuid;
begin
  if not public.owns_pet(p_from_pet_id) or p_from_pet_id=p_to_pet_id or public.is_blocked(p_from_pet_id,p_to_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('follow',150,86400);
  if exists(select 1 from public.follows where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id) then delete from public.follows where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id; return false; end if;
  insert into public.follows(from_pet_id,to_pet_id) values(p_from_pet_id,p_to_pet_id);
  select owner_id into v_owner from public.pets where id=p_to_pet_id;
  insert into public.notifications(user_id,type,title,body,entity_id) values(v_owner,'follow','Yeni takip','Bir pet seni takip etmeye başladı.',p_from_pet_id);
  return true;
end $$;

create or replace function public.create_post(p_pet_id uuid,p_caption text,p_media_paths text[] default '{}')
returns uuid language plpgsql security definer set search_path='' as $$
declare v_post uuid; v_path text; v_i int:=0; v_media_id uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('create_post',20,86400);
  insert into public.posts(pet_id,caption,moderation_status) values(p_pet_id,left(coalesce(p_caption,''),2200),'pending') returning id into v_post;
  foreach v_path in array p_media_paths loop v_i:=v_i+1; if v_i>10 then exit; end if; insert into public.post_media(post_id,storage_path,sort_order,moderation_status) values(v_post,v_path,v_i,'pending') returning id into v_media_id; insert into public.moderation_items(target_type,target_id,status) values('post_media',v_media_id,'pending') on conflict do nothing; end loop;
  insert into public.moderation_items(target_type,target_id,status) values('post_text',v_post,'pending') on conflict do nothing;
  return v_post;
end $$;

create or replace function public.get_feed(p_pet_id uuid,p_limit integer default 50)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',po.id,'pet',public.pet_json(po.pet_id,p_pet_id),'caption',po.caption,
    'mediaUrls',coalesce((select jsonb_agg(pm.storage_path order by pm.sort_order) from public.post_media pm where pm.post_id=po.id and pm.moderation_status='approved'),'[]'::jsonb),
    'createdAt',po.created_at,'likeCount',(select count(*) from public.post_likes l where l.post_id=po.id),'commentCount',(select count(*) from public.comments c where c.post_id=po.id and c.deleted_at is null and c.moderation_status='approved'),
    'likedByMe',exists(select 1 from public.post_likes l where l.post_id=po.id and l.pet_id=p_pet_id),'savedByMe',exists(select 1 from public.saved_posts s where s.post_id=po.id and s.pet_id=p_pet_id)
  ) order by po.created_at desc),'[]'::jsonb)
  from (select p.* from public.posts p where p.deleted_at is null and p.moderation_status='approved' and not public.is_blocked(p_pet_id,p.pet_id) and (p.pet_id=p_pet_id or exists(select 1 from public.follows f where f.from_pet_id=p_pet_id and f.to_pet_id=p.pet_id)) order by p.created_at desc limit least(greatest(p_limit,1),100)) po
  where public.owns_pet(p_pet_id);
$$;

create or replace function public.toggle_post_like(p_pet_id uuid,p_post_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if; perform public.rate_limit('post_like',300,86400);
  if exists(select 1 from public.post_likes where post_id=p_post_id and pet_id=p_pet_id) then delete from public.post_likes where post_id=p_post_id and pet_id=p_pet_id; return false; else insert into public.post_likes(post_id,pet_id) values(p_post_id,p_pet_id); return true; end if;
end $$;

create or replace function public.toggle_save_post(p_pet_id uuid,p_post_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if exists(select 1 from public.saved_posts where post_id=p_post_id and pet_id=p_pet_id) then delete from public.saved_posts where post_id=p_post_id and pet_id=p_pet_id; return false; else insert into public.saved_posts(post_id,pet_id) values(p_post_id,p_pet_id); return true; end if;
end $$;

create or replace function public.create_comment(p_pet_id uuid,p_post_id uuid,p_body text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_owner uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if; perform public.rate_limit('comment',80,3600);
  insert into public.comments(post_id,pet_id,body,moderation_status) values(p_post_id,p_pet_id,left(trim(p_body),1000),'pending') returning id into v_id;
  select p.owner_id into v_owner from public.posts po join public.pets p on p.id=po.pet_id where po.id=p_post_id;
  if v_owner is not null and v_owner<>auth.uid() then insert into public.notifications(user_id,type,title,body,entity_id) values(v_owner,'comment','Yeni yorum','Bir pet gönderine yorum yaptı.',p_post_id); end if;
  insert into public.moderation_items(target_type,target_id,status) values('comment_text',v_id,'pending') on conflict do nothing;
  return v_id;
end $$;


create or replace function public.create_story(p_pet_id uuid,p_storage_path text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if; perform public.rate_limit('create_story',20,86400);
  if split_part(p_storage_path,'/',1)<>p_pet_id::text then raise exception 'invalid_media_path'; end if;
  insert into public.stories(pet_id,storage_path,moderation_status) values(p_pet_id,p_storage_path,'pending') returning id into v_id;
  insert into public.moderation_items(target_type,target_id,status) values('story',v_id,'pending') on conflict do nothing;
  return v_id;
end $$;

create or replace function public.create_pet_event(p_pet_id uuid,p_title text,p_description text,p_city text,p_district text,p_neighborhood text,p_starts_at timestamptz,p_ends_at timestamptz default null,p_capacity integer default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if; perform public.rate_limit('create_event',10,86400);
  if p_starts_at<=now() then raise exception 'future_time_required'; end if;
  insert into public.pet_events(creator_pet_id,title,description,city,district,neighborhood,starts_at,ends_at,capacity,moderation_status)
  values(p_pet_id,left(trim(p_title),120),left(coalesce(p_description,''),1500),left(trim(p_city),80),left(trim(p_district),80),nullif(left(trim(coalesce(p_neighborhood,'')),80),''),p_starts_at,p_ends_at,p_capacity,'pending') returning id into v_id;
  insert into public.moderation_items(target_type,target_id,status) values('event_text',v_id,'pending') on conflict do nothing;
  return v_id;
end $$;

create or replace function public.get_active_stories(p_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'petId',s.pet_id,'petName',p.name,'avatarUrl',(select ph.storage_path from public.pet_photos ph where ph.pet_id=p.id and ph.sort_order=1 and ph.moderation_status='approved'),'mediaUrl',s.storage_path,'createdAt',s.created_at,'expiresAt',s.expires_at,'seen',exists(select 1 from public.story_views v where v.story_id=s.id and v.viewer_pet_id=p_pet_id)) order by s.created_at desc),'[]'::jsonb)
  from public.stories s join public.pets p on p.id=s.pet_id where public.owns_pet(p_pet_id) and s.expires_at>now() and s.moderation_status='approved' and not public.is_blocked(p_pet_id,s.pet_id) and (s.pet_id=p_pet_id or exists(select 1 from public.follows f where f.from_pet_id=p_pet_id and f.to_pet_id=s.pet_id));
$$;

create or replace function public.mark_story_seen(p_story_id uuid,p_viewer_pet_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin if not public.owns_pet(p_viewer_pet_id) then raise exception 'forbidden'; end if; insert into public.story_views(story_id,viewer_pet_id) values(p_story_id,p_viewer_pet_id) on conflict do nothing; end $$;

create or replace function public.get_pet_events(p_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'creatorPetId',e.creator_pet_id,'title',e.title,'description',e.description,'city',e.city,'district',e.district,'startsAt',e.starts_at,'attendeeCount',(select count(*) from public.event_attendees a where a.event_id=e.id),'myStatus',(select a.status from public.event_attendees a where a.event_id=e.id and a.pet_id=p_pet_id)) order by e.starts_at),'[]'::jsonb)
  from public.pet_events e where public.owns_pet(p_pet_id) and e.moderation_status='approved' and e.starts_at>now() and not public.is_blocked(p_pet_id,e.creator_pet_id);
$$;

create or replace function public.set_event_attendance(p_event_id uuid,p_pet_id uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if; perform public.rate_limit('event_attendance',100,86400);
  if p_status='none' then delete from public.event_attendees where event_id=p_event_id and pet_id=p_pet_id;
  elsif p_status in ('going','interested') then insert into public.event_attendees(event_id,pet_id,status) values(p_event_id,p_pet_id,p_status::public.event_attendance_status) on conflict(event_id,pet_id) do update set status=excluded.status;
  else raise exception 'invalid_status'; end if;
end $$;

create or replace function public.create_meetup_request(p_match_id uuid,p_proposed_by_pet_id uuid,p_starts_at timestamptz,p_public_place_label text,p_note text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_match public.pet_matches;
begin
  if not public.owns_pet(p_proposed_by_pet_id) then raise exception 'forbidden'; end if; perform public.rate_limit('meetup_request',10,86400);
  select * into v_match from public.pet_matches where id=p_match_id and unmatched_at is null;
  if v_match.id is null or p_proposed_by_pet_id not in(v_match.pet_low_id,v_match.pet_high_id) then raise exception 'active_match_required'; end if;
  if p_starts_at<=now() then raise exception 'future_time_required'; end if;
  insert into public.meetup_requests(match_id,proposed_by_pet_id,starts_at,public_place_label,note) values(p_match_id,p_proposed_by_pet_id,p_starts_at,left(trim(p_public_place_label),160),left(p_note,500)) returning id into v_id; return v_id;
end $$;

create or replace function public.register_push_token(p_token text,p_platform text,p_active_pet_id uuid default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_active_pet_id is not null and not public.owns_pet(p_active_pet_id) then raise exception 'forbidden'; end if;
  insert into public.push_tokens(user_id,token,platform,active_pet_id,enabled) values(auth.uid(),p_token,p_platform,p_active_pet_id,true)
  on conflict(token) do update set user_id=auth.uid(),platform=excluded.platform,active_pet_id=excluded.active_pet_id,enabled=true,last_seen_at=now();
end $$;

create or replace function public.get_notifications(p_limit integer default 100)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'type',n.type,'title',n.title,'body',n.body,'createdAt',n.created_at,'readAt',n.read_at,'entityId',n.entity_id) order by n.created_at desc),'[]'::jsonb) from (select * from public.notifications where user_id=auth.uid() order by created_at desc limit least(greatest(p_limit,1),200)) n;
$$;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns void language sql security definer set search_path='' as $$ update public.notifications set read_at=coalesce(read_at,now()) where id=p_notification_id and user_id=auth.uid(); $$;

create or replace function public.report_pet(p_reporter_pet_id uuid,p_reported_pet_id uuid,p_reason text,p_details text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not public.owns_pet(p_reporter_pet_id) or p_reporter_pet_id=p_reported_pet_id then raise exception 'forbidden'; end if; perform public.rate_limit('report',20,86400);
  insert into public.reports(reporter_user_id,reporter_pet_id,target_type,target_id,reason,details) values(auth.uid(),p_reporter_pet_id,'pet',p_reported_pet_id,left(trim(p_reason),100),left(p_details,2000)) returning id into v_id; return v_id;
end $$;

create or replace function public.block_pet(p_blocker_pet_id uuid,p_blocked_pet_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_blocker_pet_id) or p_blocker_pet_id=p_blocked_pet_id then raise exception 'forbidden'; end if;
  insert into public.blocks(blocker_pet_id,blocked_pet_id) values(p_blocker_pet_id,p_blocked_pet_id) on conflict do nothing;
  update public.pet_matches set unmatched_at=now(),unmatched_by_pet_id=p_blocker_pet_id where unmatched_at is null and pet_low_id=least(p_blocker_pet_id,p_blocked_pet_id) and pet_high_id=greatest(p_blocker_pet_id,p_blocked_pet_id);
end $$;

-- RLS: default deny for exposed tables, narrow read policies only where Realtime/direct signed URL creation needs them.
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname='public' and tablename in ('users','pets','pet_private','pet_health_summary','pet_photos','pet_purposes','pet_vaccinations','health_documents','pet_likes','pet_passes','pet_favorites','pet_matches','conversations','messages','blocks','reports','follows','posts','post_media','post_likes','saved_posts','comments','stories','story_views','pet_events','event_attendees','meetup_requests','notifications','push_tokens','subscriptions','moderation_items','rate_limits','audit_events') loop
    execute format('alter table public.%I enable row level security',r.tablename);
    execute format('revoke all on public.%I from anon, authenticated',r.tablename);
  end loop;
end $$;

grant select on public.messages,public.notifications to authenticated;
create policy messages_participant_read on public.messages for select to authenticated using (
  exists(select 1 from public.conversations c join public.pet_matches m on m.id=c.match_id join public.pets p on p.owner_id=auth.uid() and p.id in(m.pet_low_id,m.pet_high_id) where c.id=messages.conversation_id)
);
create policy notifications_owner_read on public.notifications for select to authenticated using(user_id=auth.uid());

-- Storage authorization helpers keep metadata tables non-readable while allowing safe signed URLs/uploads.
create or replace function public.can_upload_storage_object(p_bucket text,p_name text)
returns boolean language sql stable security definer set search_path='' as $$
  select p_bucket in ('pet-photos','social-media','health-documents') and exists(select 1 from public.pets p where p.owner_id=auth.uid() and p.id::text=split_part(p_name,'/',1));
$$;

create or replace function public.can_read_storage_object(p_bucket text,p_name text)
returns boolean language sql stable security definer set search_path='' as $$
  select case
    when p_bucket='pet-photos' then exists(select 1 from public.pet_photos ph join public.pets p on p.id=ph.pet_id where ph.storage_path=p_name and (ph.moderation_status='approved' or p.owner_id=auth.uid()))
    when p_bucket='health-documents' then exists(select 1 from public.health_documents h join public.pets p on p.id=h.pet_id where h.storage_path=p_name and p.owner_id=auth.uid())
    when p_bucket='social-media' then exists(select 1 from public.post_media pm join public.posts po on po.id=pm.post_id join public.pets p on p.id=po.pet_id where pm.storage_path=p_name and (pm.moderation_status='approved' or p.owner_id=auth.uid()))
      or exists(select 1 from public.stories s join public.pets p on p.id=s.pet_id where s.storage_path=p_name and (s.moderation_status='approved' or p.owner_id=auth.uid()))
    else false end;
$$;

create policy pawlink_storage_insert on storage.objects for insert to authenticated with check(public.can_upload_storage_object(bucket_id,name));
create policy pawlink_storage_update on storage.objects for update to authenticated using(public.can_upload_storage_object(bucket_id,name));
create policy pawlink_storage_select on storage.objects for select to authenticated using(public.can_read_storage_object(bucket_id,name));

-- RPC exposure. Tables stay mostly inaccessible; app actions go through audited functions.
revoke all on all functions in schema public from public,anon;
grant execute on function public.get_my_pets() to authenticated;
grant execute on function public.upsert_pet_profile(uuid,jsonb) to authenticated;
grant execute on function public.attach_pet_photo(uuid,text,smallint) to authenticated;
grant execute on function public.attach_health_document(uuid,text,text) to authenticated;
grant execute on function public.update_pet_private_location(uuid,double precision,double precision) to authenticated;
grant execute on function public.discover_pets(uuid,jsonb) to authenticated;
grant execute on function public.like_pet(uuid,uuid,public.like_kind) to authenticated;
grant execute on function public.pass_pet(uuid,uuid) to authenticated;
grant execute on function public.toggle_favorite_pet(uuid,uuid) to authenticated;
grant execute on function public.get_matches(uuid) to authenticated;
grant execute on function public.unmatch_pet(uuid,uuid) to authenticated;
grant execute on function public.send_message(uuid,uuid,text) to authenticated;
grant execute on function public.get_conversation_messages(uuid,integer) to authenticated;
grant execute on function public.mark_conversation_read(uuid,uuid) to authenticated;
grant execute on function public.toggle_follow_pet(uuid,uuid) to authenticated;
grant execute on function public.create_post(uuid,text,text[]) to authenticated;
grant execute on function public.get_feed(uuid,integer) to authenticated;
grant execute on function public.toggle_post_like(uuid,uuid) to authenticated;
grant execute on function public.toggle_save_post(uuid,uuid) to authenticated;
grant execute on function public.create_comment(uuid,uuid,text) to authenticated;
grant execute on function public.create_story(uuid,text) to authenticated;
grant execute on function public.create_pet_event(uuid,text,text,text,text,text,timestamptz,timestamptz,integer) to authenticated;
grant execute on function public.get_active_stories(uuid) to authenticated;
grant execute on function public.mark_story_seen(uuid,uuid) to authenticated;
grant execute on function public.get_pet_events(uuid) to authenticated;
grant execute on function public.set_event_attendance(uuid,uuid,text) to authenticated;
grant execute on function public.create_meetup_request(uuid,uuid,timestamptz,text,text) to authenticated;
grant execute on function public.register_push_token(text,text,uuid) to authenticated;
grant execute on function public.get_notifications(integer) to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.report_pet(uuid,uuid,text,text) to authenticated;
grant execute on function public.block_pet(uuid,uuid) to authenticated;
grant execute on function public.can_upload_storage_object(text,text) to authenticated;
grant execute on function public.can_read_storage_object(text,text) to authenticated;
