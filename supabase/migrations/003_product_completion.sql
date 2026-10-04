-- Tailmance production completion and security hardening.
-- Keeps pet identity public while human account, precise location and billing stay private.

create table if not exists public.push_receipts (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  push_token_id uuid references public.push_tokens(id) on delete set null,
  expo_ticket_id text,
  receipt_status text not null default 'pending' check (receipt_status in ('pending','ok','error')),
  error_code text,
  error_message text,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique(notification_id,push_token_id)
);
alter table public.push_receipts enable row level security;
revoke all on public.push_receipts from anon, authenticated;

create or replace function public.get_account_settings()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'tier',u.tier,'freeMessagesSent',u.free_messages_sent,'discoverable',u.discoverable,
    'incognito',u.incognito,'age18Confirmed',u.age_18_confirmed,'legalVersion',u.legal_version
  ) from public.users u where u.id=auth.uid();
$$;

create or replace function public.update_privacy_settings(p_discoverable boolean,p_incognito boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_incognito and not exists(select 1 from public.users where id=auth.uid() and tier='premium') then
    raise exception 'premium_required';
  end if;
  update public.users set discoverable=p_discoverable,incognito=p_incognito where id=auth.uid();
  insert into public.audit_events(user_id,action,entity_type,metadata)
  values(auth.uid(),'privacy_settings_update','user',jsonb_build_object('discoverable',p_discoverable,'incognito',p_incognito));
end $$;

create or replace function public.get_pet_health_details(p_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.owns_pet(p_pet_id) then jsonb_build_object(
    'summary',jsonb_build_object(
      'vaccinationStatus',coalesce(h.vaccination_status,'unknown'::public.vaccination_status),
      'veterinarianVerified',coalesce(h.veterinarian_verified,false),
      'neutered',h.neutered,'microchipVerified',coalesce(h.microchip_verified,false),
      'geneticScreeningAvailable',coalesce(h.genetic_screening_available,false),
      'pedigreeAvailable',coalesce(h.pedigree_available,false)
    ),
    'vaccinations',coalesce((select jsonb_agg(jsonb_build_object(
      'id',v.id,'vaccineName',v.vaccine_name,'doseDate',v.dose_date,'nextDueDate',v.next_due_date,
      'verificationStatus',v.verification_status
    ) order by coalesce(v.next_due_date,v.dose_date) desc nulls last) from public.pet_vaccinations v where v.pet_id=p_pet_id),'[]'::jsonb),
    'documents',coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.id,'documentType',d.document_type,'verificationStatus',d.verification_status,'createdAt',d.created_at
    ) order by d.created_at desc) from public.health_documents d where d.pet_id=p_pet_id),'[]'::jsonb)
  ) else null end
  from public.pet_health_summary h where h.pet_id=p_pet_id;
$$;

create or replace function public.upsert_vaccination(p_pet_id uuid,p_vaccination_id uuid,p_vaccine_name text,p_dose_date date,p_next_due_date date)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid:=p_vaccination_id;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('vaccination_write',30,3600);
  if char_length(trim(p_vaccine_name))<2 then raise exception 'invalid_vaccine_name'; end if;
  if p_dose_date is not null and p_dose_date>current_date then raise exception 'dose_date_in_future'; end if;
  if p_next_due_date is not null and p_dose_date is not null and p_next_due_date<p_dose_date then raise exception 'invalid_due_date'; end if;
  if v_id is null then
    insert into public.pet_vaccinations(pet_id,vaccine_name,dose_date,next_due_date,verification_status)
    values(p_pet_id,left(trim(p_vaccine_name),120),p_dose_date,p_next_due_date,'pending') returning id into v_id;
  else
    update public.pet_vaccinations set vaccine_name=left(trim(p_vaccine_name),120),dose_date=p_dose_date,next_due_date=p_next_due_date,
      verification_status='pending',verified_by=null,verified_at=null
    where id=v_id and pet_id=p_pet_id;
    if not found then raise exception 'vaccination_not_found'; end if;
  end if;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id)
  values(auth.uid(),p_pet_id,'vaccination_upsert','vaccination',v_id);
  return v_id;
end $$;

create or replace function public.delete_vaccination(p_pet_id uuid,p_vaccination_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  delete from public.pet_vaccinations where id=p_vaccination_id and pet_id=p_pet_id;
end $$;

create or replace function public.update_pet_health_claims(p_pet_id uuid,p_neutered boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  insert into public.pet_health_summary(pet_id,neutered) values(p_pet_id,p_neutered)
  on conflict(pet_id) do update set neutered=excluded.neutered,updated_at=now();
end $$;

-- Incognito semantics: an incognito target is discoverable only to pets it has already liked.
-- Mating discovery adds conservative verified-signal requirements, without making a veterinary suitability decision.
create or replace function public.discover_pets(p_active_pet_id uuid,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_me public.pets; v_private public.pet_private; v_me_health public.pet_health_summary; v_result jsonb; v_mating boolean;
begin
  if not public.owns_pet(p_active_pet_id) then raise exception 'forbidden'; end if;
  select * into v_me from public.pets where id=p_active_pet_id;
  select * into v_private from public.pet_private where pet_id=p_active_pet_id;
  select * into v_me_health from public.pet_health_summary where pet_id=p_active_pet_id;
  v_mating := coalesce(p_filters->'purposes','[]'::jsonb) ? 'mating';
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
      and (not u.incognito or exists(select 1 from public.pet_likes il where il.from_pet_id=p.id and il.to_pet_id=p_active_pet_id))
      and not public.is_blocked(p_active_pet_id,p.id)
      and not exists(select 1 from public.pet_passes ps where ps.from_pet_id=p_active_pet_id and ps.to_pet_id=p.id and ps.created_at>now()-interval '30 days')
      and not exists(select 1 from public.pet_matches m where m.unmatched_at is null and m.pet_low_id=least(p_active_pet_id,p.id) and m.pet_high_id=greatest(p_active_pet_id,p.id))
      and (coalesce(p_filters->>'species','all')='all' or p.species::text=p_filters->>'species')
      and (coalesce(jsonb_array_length(coalesce(p_filters->'breeds','[]'::jsonb)),0)=0 or lower(p.breed) in (select lower(x) from jsonb_array_elements_text(p_filters->'breeds') x))
      and (coalesce(p_filters->>'sex','all')='all' or p.sex::text=p_filters->>'sex')
      and (coalesce(jsonb_array_length(coalesce(p_filters->'sizes','[]'::jsonb)),0)=0 or p.size::text in (select jsonb_array_elements_text(p_filters->'sizes')))
      and (nullif(p_filters->>'minAge','') is null or (p.birth_date is not null and extract(year from age(current_date,p.birth_date)) >= (p_filters->>'minAge')::int))
      and (nullif(p_filters->>'maxAge','') is null or (p.birth_date is not null and extract(year from age(current_date,p.birth_date)) <= (p_filters->>'maxAge')::int))
      and (nullif(p_filters->>'city','') is null or lower(p.city)=lower(p_filters->>'city'))
      and (nullif(p_filters->>'district','') is null or lower(p.district)=lower(p_filters->>'district'))
      and (nullif(p_filters->>'neighborhood','') is null or lower(coalesce(p.neighborhood,''))=lower(p_filters->>'neighborhood'))
      and (coalesce((p_filters->>'vaccinatedOnly')::boolean,false)=false or h.vaccination_status='complete')
      and (coalesce((p_filters->>'veterinarianVerifiedOnly')::boolean,false)=false or h.veterinarian_verified)
      and (coalesce((p_filters->>'profileVerifiedOnly')::boolean,false)=false or p.profile_verified)
      and (coalesce(jsonb_array_length(coalesce(p_filters->'purposes','[]'::jsonb)),0)=0 or exists(select 1 from public.pet_purposes x where x.pet_id=p.id and x.purpose::text in (select jsonb_array_elements_text(p_filters->'purposes'))))
      and (nullif(p_filters->>'maxDistanceKm','') is null or (v_private.latitude is not null and pp.latitude is not null and public.haversine_km(v_private.latitude,v_private.longitude,pp.latitude,pp.longitude) <= (p_filters->>'maxDistanceKm')::double precision))
      and (coalesce((p_filters->>'matingOnlyNonNeutered')::boolean,true)=false or not exists(select 1 from public.pet_purposes px where px.pet_id=p.id and px.purpose='mating') or h.neutered=false)
      and (not v_mating or (
        p.species=v_me.species and p.sex<>v_me.sex and h.neutered=false and v_me_health.neutered=false
        and h.vaccination_status='complete' and v_me_health.vaccination_status='complete'
        and h.veterinarian_verified and v_me_health.veterinarian_verified
      ))
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
  if not exists(select 1 from public.pets p where p.id=p_from_pet_id and p.moderation_status='approved' and p.discovery_enabled and (select count(*) from public.pet_photos ph where ph.pet_id=p.id and ph.moderation_status='approved')=3) then raise exception 'own_profile_not_discovery_ready'; end if;
  if not exists(select 1 from public.pets p join public.users u on u.id=p.owner_id where p.id=p_to_pet_id and p.owner_id<>auth.uid() and p.moderation_status='approved' and p.discovery_enabled and u.suspended_at is null and (select count(*) from public.pet_photos ph where ph.pet_id=p.id and ph.moderation_status='approved')=3) then raise exception 'target_unavailable'; end if;
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

create or replace function public.get_incoming_likes(p_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case
    when not public.owns_pet(p_pet_id) then null
    when not exists(select 1 from public.users where id=auth.uid() and tier='premium') then jsonb_build_object('error','premium_required')
    else coalesce(jsonb_agg(public.pet_json(l.from_pet_id,p_pet_id) || jsonb_build_object('likedAt',l.created_at,'likeKind',l.kind) order by l.created_at desc),'[]'::jsonb)
  end
  from public.pet_likes l
  where l.to_pet_id=p_pet_id
    and not exists(select 1 from public.pet_matches m where m.unmatched_at is null and m.pet_low_id=least(l.from_pet_id,p_pet_id) and m.pet_high_id=greatest(l.from_pet_id,p_pet_id))
    and not public.is_blocked(l.from_pet_id,p_pet_id);
$$;

create or replace function public.undo_last_pass(p_pet_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_target uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.users where id=auth.uid() and tier='premium') then raise exception 'premium_required'; end if;
  select to_pet_id into v_target from public.pet_passes where from_pet_id=p_pet_id order by created_at desc limit 1;
  if v_target is null then return jsonb_build_object('restored',false); end if;
  delete from public.pet_passes where from_pet_id=p_pet_id and to_pet_id=v_target;
  return jsonb_build_object('restored',true,'petId',v_target);
end $$;

create or replace function public.get_meetup_requests(p_pet_id uuid,p_match_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.owns_pet(p_pet_id) then coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'matchId',r.match_id,'proposedByPetId',r.proposed_by_pet_id,'startsAt',r.starts_at,
    'publicPlaceLabel',r.public_place_label,'note',r.note,'status',r.status,'createdAt',r.created_at
  ) order by r.created_at desc),'[]'::jsonb) else null end
  from public.meetup_requests r join public.pet_matches m on m.id=r.match_id
  where (m.pet_low_id=p_pet_id or m.pet_high_id=p_pet_id) and (p_match_id is null or r.match_id=p_match_id);
$$;

create or replace function public.respond_meetup_request(p_request_id uuid,p_pet_id uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $$
declare r public.meetup_requests; m public.pet_matches;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_status not in ('accepted','declined','cancelled') then raise exception 'invalid_status'; end if;
  select * into r from public.meetup_requests where id=p_request_id for update;
  select * into m from public.pet_matches where id=r.match_id and unmatched_at is null;
  if r.id is null or m.id is null or p_pet_id not in(m.pet_low_id,m.pet_high_id) then raise exception 'not_found'; end if;
  if p_status='cancelled' and r.proposed_by_pet_id<>p_pet_id then raise exception 'forbidden'; end if;
  if p_status in ('accepted','declined') and r.proposed_by_pet_id=p_pet_id then raise exception 'other_pet_must_respond'; end if;
  update public.meetup_requests set status=p_status where id=p_request_id and status='pending';
end $$;

create or replace function public.report_content(p_reporter_pet_id uuid,p_target_type text,p_target_id uuid,p_reason text,p_details text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_exists boolean:=false;
begin
  if not public.owns_pet(p_reporter_pet_id) then raise exception 'forbidden'; end if;
  if p_target_type not in ('pet','post','comment','message','story','event') then raise exception 'invalid_target_type'; end if;
  perform public.rate_limit('report',20,86400);
  if p_target_type='pet' then select exists(select 1 from public.pets where id=p_target_id and owner_id<>auth.uid()) into v_exists;
  elsif p_target_type='post' then select exists(select 1 from public.posts po join public.pets p on p.id=po.pet_id where po.id=p_target_id and p.owner_id<>auth.uid()) into v_exists;
  elsif p_target_type='comment' then select exists(select 1 from public.comments c join public.pets p on p.id=c.pet_id where c.id=p_target_id and p.owner_id<>auth.uid()) into v_exists;
  elsif p_target_type='message' then select exists(select 1 from public.messages msg where msg.id=p_target_id and msg.sender_pet_id<>p_reporter_pet_id) into v_exists;
  elsif p_target_type='story' then select exists(select 1 from public.stories s join public.pets p on p.id=s.pet_id where s.id=p_target_id and p.owner_id<>auth.uid()) into v_exists;
  elsif p_target_type='event' then select exists(select 1 from public.pet_events e join public.pets p on p.id=e.creator_pet_id where e.id=p_target_id and p.owner_id<>auth.uid()) into v_exists; end if;
  if not v_exists then raise exception 'invalid_target'; end if;
  insert into public.reports(reporter_user_id,reporter_pet_id,target_type,target_id,reason,details)
  values(auth.uid(),p_reporter_pet_id,p_target_type,p_target_id,left(trim(p_reason),100),left(p_details,2000)) returning id into v_id;
  return v_id;
end $$;

create or replace function public.delete_owned_content(p_pet_id uuid,p_target_type text,p_target_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_target_type='post' then update public.posts set deleted_at=now() where id=p_target_id and pet_id=p_pet_id;
  elsif p_target_type='comment' then update public.comments set deleted_at=now() where id=p_target_id and pet_id=p_pet_id;
  elsif p_target_type='story' then delete from public.stories where id=p_target_id and pet_id=p_pet_id;
  elsif p_target_type='event' then delete from public.pet_events where id=p_target_id and creator_pet_id=p_pet_id;
  else raise exception 'invalid_target_type'; end if;
end $$;

create or replace function public.mark_all_notifications_read()
returns void language sql security definer set search_path='' as $$
  update public.notifications set read_at=coalesce(read_at,now()) where user_id=auth.uid() and read_at is null;
$$;

-- Revoke public defaults and expose only explicit authenticated RPCs.
revoke all on all functions in schema public from public,anon;
grant execute on function public.get_account_settings() to authenticated;
grant execute on function public.update_privacy_settings(boolean,boolean) to authenticated;
grant execute on function public.get_pet_health_details(uuid) to authenticated;
grant execute on function public.upsert_vaccination(uuid,uuid,text,date,date) to authenticated;
grant execute on function public.delete_vaccination(uuid,uuid) to authenticated;
grant execute on function public.update_pet_health_claims(uuid,boolean) to authenticated;
grant execute on function public.discover_pets(uuid,jsonb) to authenticated;
grant execute on function public.like_pet(uuid,uuid,public.like_kind) to authenticated;
grant execute on function public.get_incoming_likes(uuid) to authenticated;
grant execute on function public.undo_last_pass(uuid) to authenticated;
grant execute on function public.get_meetup_requests(uuid,uuid) to authenticated;
grant execute on function public.respond_meetup_request(uuid,uuid,text) to authenticated;
grant execute on function public.report_content(uuid,text,uuid,text,text) to authenticated;
grant execute on function public.delete_owned_content(uuid,text,uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- Re-grant the v2 application surface after the blanket revoke above.
grant execute on function public.get_my_pets() to authenticated;
grant execute on function public.upsert_pet_profile(uuid,jsonb) to authenticated;
grant execute on function public.attach_pet_photo(uuid,text,smallint) to authenticated;
grant execute on function public.attach_health_document(uuid,text,text) to authenticated;
grant execute on function public.update_pet_private_location(uuid,double precision,double precision) to authenticated;
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

create or replace function public.get_post_comments(p_pet_id uuid,p_post_id uuid,p_limit integer default 100)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.owns_pet(p_pet_id) then coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'postId',c.post_id,'pet',public.pet_json(c.pet_id,p_pet_id),'body',c.body,'createdAt',c.created_at
  ) order by c.created_at asc),'[]'::jsonb) else null end
  from (select c.* from public.comments c join public.posts po on po.id=c.post_id where c.post_id=p_post_id and c.deleted_at is null and c.moderation_status='approved' and po.deleted_at is null order by c.created_at asc limit least(greatest(p_limit,1),200)) c;
$$;
revoke all on function public.get_post_comments(uuid,uuid,integer) from public,anon;
grant execute on function public.get_post_comments(uuid,uuid,integer) to authenticated;

-- Storage abuse controls. Keep buckets private and enforce practical size/MIME limits at the storage layer.
update storage.buckets set file_size_limit=10485760,allowed_mime_types=array['image/jpeg','image/png','image/webp','image/heic','image/heif'] where id in ('pet-photos','social-media');
update storage.buckets set file_size_limit=15728640,allowed_mime_types=array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif'] where id='health-documents';
