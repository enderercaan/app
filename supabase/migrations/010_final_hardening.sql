-- Tailmance final product/security hardening
-- Single-use upload intents, pet verification, normalized discovery and cursor pagination.

create or replace function public.normalize_search_text(p_value text)
returns text language sql immutable set search_path='' as $$
  select regexp_replace(
    translate(lower(trim(coalesce(p_value,''))), 'çğıöşüâîû', 'cgiosuaiu'),
    '\s+', ' ', 'g'
  );
$$;

create table if not exists public.upload_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  bucket text not null check (bucket in ('pet-photos','social-media','health-documents','pet-verification')),
  purpose text not null check (purpose in ('pet_photo_1','pet_photo_2','pet_photo_3','post_media','story_media','health_document','pet_verification')),
  storage_path text not null unique,
  mime_type text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '15 minutes'),
  consumed_at timestamptz,
  cancelled_at timestamptz
);
alter table public.upload_intents enable row level security;
revoke all on public.upload_intents from anon,authenticated;
create index if not exists upload_intents_active_idx on public.upload_intents(user_id,pet_id,expires_at) where consumed_at is null and cancelled_at is null;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('pet-verification','pet-verification',false,10485760,array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

alter table public.storage_gc_queue drop constraint if exists storage_gc_queue_bucket_check;
alter table public.storage_gc_queue add constraint storage_gc_queue_bucket_check check (bucket in ('pet-photos','social-media','health-documents','pet-verification'));

create table if not exists public.pet_verification_requests (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
  reason text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
alter table public.pet_verification_requests enable row level security;
revoke all on public.pet_verification_requests from anon,authenticated;
create index if not exists pet_verification_requests_pet_created_idx on public.pet_verification_requests(pet_id,created_at desc);

create or replace function public.create_upload_intent(
  p_pet_id uuid,p_bucket text,p_purpose text,p_mime_type text,p_extension text default 'jpg'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_path text; v_ext text; v_allowed boolean:=false;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('upload_intent',80,3600);
  v_allowed :=
    (p_bucket='pet-photos' and p_purpose in ('pet_photo_1','pet_photo_2','pet_photo_3') and p_mime_type in ('image/jpeg','image/png','image/webp','image/heic','image/heif')) or
    (p_bucket='social-media' and p_purpose in ('post_media','story_media') and p_mime_type in ('image/jpeg','image/png','image/webp','image/heic','image/heif')) or
    (p_bucket='health-documents' and p_purpose='health_document' and p_mime_type in ('application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif')) or
    (p_bucket='pet-verification' and p_purpose='pet_verification' and p_mime_type in ('image/jpeg','image/png','image/webp','image/heic','image/heif'));
  if not v_allowed then raise exception 'invalid_upload_intent'; end if;
  v_ext:=regexp_replace(lower(coalesce(p_extension,'jpg')),'[^a-z0-9]','','g');
  if v_ext='' or char_length(v_ext)>5 then v_ext:='jpg'; end if;
  v_id:=gen_random_uuid();
  v_path:=p_pet_id::text||'/intents/'||v_id::text||'.'||v_ext;
  insert into public.upload_intents(id,user_id,pet_id,bucket,purpose,storage_path,mime_type)
  values(v_id,auth.uid(),p_pet_id,p_bucket,p_purpose,v_path,p_mime_type);
  return jsonb_build_object('id',v_id,'bucket',p_bucket,'path',v_path,'expiresAt',now()+interval '15 minutes');
end $$;

create or replace function public.cancel_upload_intent(p_intent_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v public.upload_intents;
begin
  select * into v from public.upload_intents where id=p_intent_id and user_id=auth.uid() for update;
  if v.id is null then return; end if;
  if v.consumed_at is null and v.cancelled_at is null then
    update public.upload_intents set cancelled_at=now() where id=v.id;
    insert into public.storage_gc_queue(bucket,storage_path,queued_at,not_before,attempts,last_error)
    values(v.bucket,v.storage_path,now(),now()+interval '15 minutes',0,null)
    on conflict(bucket,storage_path) do update set queued_at=excluded.queued_at,not_before=excluded.not_before,attempts=0,last_error=null;
  end if;
end $$;

create or replace function public.consume_upload_intent(p_pet_id uuid,p_bucket text,p_purpose text,p_path text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  update public.upload_intents
  set consumed_at=now()
  where id=(select id from public.upload_intents where user_id=auth.uid() and pet_id=p_pet_id and bucket=p_bucket and purpose=p_purpose and storage_path=p_path and consumed_at is null and cancelled_at is null and expires_at>now() order by created_at desc limit 1)
  returning id into v_id;
  if v_id is null then raise exception 'valid_upload_intent_required'; end if;
  return v_id;
end $$;
revoke all on function public.consume_upload_intent(uuid,text,text,text) from public,anon,authenticated;

create or replace function public.can_upload_storage_object(p_bucket text,p_name text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.upload_intents i
    where i.user_id=auth.uid() and i.bucket=p_bucket and i.storage_path=p_name
      and i.consumed_at is null and i.cancelled_at is null and i.expires_at>now()
  );
$$;

create or replace function public.can_read_storage_object(p_bucket text,p_name text)
returns boolean language sql stable security definer set search_path='' as $$
  select case
    when p_bucket='pet-photos' then exists(select 1 from public.pet_photos ph join public.pets p on p.id=ph.pet_id where ph.storage_path=p_name and (ph.moderation_status='approved' or p.owner_id=auth.uid()))
    when p_bucket='health-documents' then exists(select 1 from public.health_documents h join public.pets p on p.id=h.pet_id where h.storage_path=p_name and p.owner_id=auth.uid())
    when p_bucket='pet-verification' then exists(select 1 from public.pet_verification_requests r where r.storage_path=p_name and r.owner_id=auth.uid())
    when p_bucket='social-media' then exists(select 1 from public.post_media pm join public.posts po on po.id=pm.post_id join public.pets p on p.id=po.pet_id where pm.storage_path=p_name and (pm.moderation_status='approved' or p.owner_id=auth.uid()))
      or exists(select 1 from public.stories s join public.pets p on p.id=s.pet_id where s.storage_path=p_name and (s.moderation_status='approved' or p.owner_id=auth.uid()))
    else false end;
$$;

create or replace function public.attach_pet_photo(p_pet_id uuid,p_storage_path text,p_sort_order smallint)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_purpose text;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_sort_order not between 1 and 3 then raise exception 'invalid_photo_slot'; end if;
  perform public.rate_limit('photo_attach',20,3600);
  v_purpose:='pet_photo_'||p_sort_order::text;
  perform public.consume_upload_intent(p_pet_id,'pet-photos',v_purpose,p_storage_path);
  insert into public.pet_photos(pet_id,storage_path,sort_order,moderation_status) values(p_pet_id,p_storage_path,p_sort_order,'pending')
  on conflict(pet_id,sort_order) do update set storage_path=excluded.storage_path,moderation_status='pending',moderation_reason=null,updated_at=now()
  returning id into v_id;
  update public.pets set profile_verified=false where id=p_pet_id;
  insert into public.moderation_items(target_type,target_id,status) values('pet_photo',v_id,'pending') on conflict(target_type,target_id) do update set status='pending',reason=null,reviewed_at=null;
  return v_id;
end $$;

create or replace function public.attach_health_document(p_pet_id uuid,p_document_type text,p_storage_path text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('health_document_attach',10,3600);
  perform public.consume_upload_intent(p_pet_id,'health-documents','health_document',p_storage_path);
  insert into public.health_documents(pet_id,document_type,storage_path,verification_status) values(p_pet_id,left(trim(p_document_type),80),p_storage_path,'pending') returning id into v_id;
  insert into public.moderation_items(target_type,target_id,status) values('health_document',v_id,'pending') on conflict do nothing;
  return v_id;
end $$;

create or replace function public.create_post(p_pet_id uuid,p_caption text,p_media_paths text[] default '{}')
returns uuid language plpgsql security definer set search_path='' as $$
declare v_post uuid; v_path text; v_i int:=0; v_media_id uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('create_post',20,86400);
  if coalesce(array_length(p_media_paths,1),0)>5 then raise exception 'too_many_media'; end if;
  if char_length(trim(coalesce(p_caption,'')))=0 and coalesce(array_length(p_media_paths,1),0)=0 then raise exception 'empty_post'; end if;
  foreach v_path in array coalesce(p_media_paths,'{}') loop perform public.consume_upload_intent(p_pet_id,'social-media','post_media',v_path); end loop;
  insert into public.posts(pet_id,caption,moderation_status) values(p_pet_id,left(trim(coalesce(p_caption,'')),2200),'pending') returning id into v_post;
  foreach v_path in array coalesce(p_media_paths,'{}') loop v_i:=v_i+1; insert into public.post_media(post_id,storage_path,sort_order,moderation_status) values(v_post,v_path,v_i,'pending') returning id into v_media_id; insert into public.moderation_items(target_type,target_id,status) values('post_media',v_media_id,'pending') on conflict do nothing; end loop;
  insert into public.moderation_items(target_type,target_id,status) values('post_text',v_post,'pending') on conflict do nothing;
  return v_post;
end $$;

create or replace function public.create_story(p_pet_id uuid,p_storage_path text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('create_story',20,86400);
  perform public.consume_upload_intent(p_pet_id,'social-media','story_media',p_storage_path);
  insert into public.stories(pet_id,storage_path,moderation_status) values(p_pet_id,p_storage_path,'pending') returning id into v_id;
  insert into public.moderation_items(target_type,target_id,status) values('story',v_id,'pending') on conflict do nothing;
  return v_id;
end $$;

create or replace function public.submit_pet_verification(p_pet_id uuid,p_storage_path text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('pet_verification',5,86400);
  perform public.consume_upload_intent(p_pet_id,'pet-verification','pet_verification',p_storage_path);
  update public.pet_verification_requests set status='cancelled',reviewed_at=now() where pet_id=p_pet_id and status='pending';
  insert into public.pet_verification_requests(pet_id,owner_id,storage_path,status) values(p_pet_id,auth.uid(),p_storage_path,'pending') returning id into v_id;
  update public.pets set profile_verified=false where id=p_pet_id;
  return v_id;
end $$;

create or replace function public.get_pet_verification_status(p_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.owns_pet(p_pet_id) then jsonb_build_object(
    'profileVerified',(select profile_verified from public.pets where id=p_pet_id),
    'latestStatus',coalesce((select status from public.pet_verification_requests where pet_id=p_pet_id order by created_at desc limit 1),'not_started'),
    'latestRequestedAt',(select created_at from public.pet_verification_requests where pet_id=p_pet_id order by created_at desc limit 1)
  ) else null end;
$$;

-- Server-only review function. Service role/admin Edge Function may invoke it.
create or replace function public.review_pet_verification(p_request_id uuid,p_approved boolean,p_reason text default null)
returns void language plpgsql security definer set search_path='' as $$
declare v public.pet_verification_requests;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required'; end if;
  select * into v from public.pet_verification_requests where id=p_request_id for update;
  if v.id is null or v.status<>'pending' then raise exception 'invalid_request'; end if;
  update public.pet_verification_requests set status=case when p_approved then 'approved' else 'rejected' end,reason=left(p_reason,500),reviewed_at=now() where id=v.id;
  update public.pets set profile_verified=p_approved where id=v.pet_id;
  insert into public.storage_gc_queue(bucket,storage_path,queued_at,not_before,attempts,last_error)
  values('pet-verification',v.storage_path,now(),now()+interval '1 hour',0,null)
  on conflict(bucket,storage_path) do update set queued_at=excluded.queued_at,not_before=excluded.not_before,attempts=0,last_error=null;
end $$;
revoke all on function public.review_pet_verification(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.review_pet_verification(uuid,boolean,text) to service_role;

-- Any material identity change revokes the pet-verification badge.
create or replace function public.revoke_pet_verification_on_identity_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.name is distinct from new.name or old.species is distinct from new.species or old.breed is distinct from new.breed or old.sex is distinct from new.sex or old.birth_date is distinct from new.birth_date then new.profile_verified:=false; end if;
  return new;
end $$;
drop trigger if exists revoke_pet_verification_identity on public.pets;
create trigger revoke_pet_verification_identity before update on public.pets for each row execute function public.revoke_pet_verification_on_identity_change();
revoke all on function public.revoke_pet_verification_on_identity_change() from public,anon,authenticated;

-- Strong profile validation at the server boundary.
create or replace function public.validate_pet_payload(p_payload jsonb)
returns void language plpgsql stable set search_path='' as $$
declare v_birth date; v_weight numeric; v_energy int;
begin
  if trim(coalesce(p_payload->>'name',''))='' or trim(coalesce(p_payload->>'breed',''))='' or trim(coalesce(p_payload->>'city',''))='' or trim(coalesce(p_payload->>'district',''))='' or trim(coalesce(p_payload->>'neighborhood',''))='' then raise exception 'required_profile_fields_missing'; end if;
  if nullif(p_payload->>'birthDate','') is null then raise exception 'birth_date_required'; end if;
  v_birth:=(p_payload->>'birthDate')::date;
  if v_birth>current_date or v_birth<current_date-interval '35 years' then raise exception 'invalid_birth_date'; end if;
  if coalesce(jsonb_array_length(coalesce(p_payload->'purposes','[]'::jsonb)),0)=0 then raise exception 'purpose_required'; end if;
  if nullif(p_payload->>'weightKg','') is not null then v_weight:=(p_payload->>'weightKg')::numeric; if v_weight<=0 or v_weight>150 then raise exception 'invalid_weight'; end if; end if;
  if nullif(p_payload->>'energyLevel','') is not null then v_energy:=(p_payload->>'energyLevel')::int; if v_energy not between 1 and 5 then raise exception 'invalid_energy'; end if; end if;
end $$;
revoke all on function public.validate_pet_payload(jsonb) from public,anon,authenticated;

-- Replace profile upsert with the existing implementation guarded by validation.
create or replace function public.upsert_pet_profile(p_pet_id uuid,p_payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid:=p_pet_id;
begin
  perform public.validate_pet_payload(p_payload);
  if p_pet_id is null then
    perform public.rate_limit('pet_create',10,86400);
    insert into public.pets(owner_id,name,species,breed,sex,birth_date,size,weight_kg,energy_level,temperament_tags,bio,city,district,neighborhood,moderation_status)
    values(auth.uid(),trim(p_payload->>'name'),(p_payload->>'species')::public.pet_species,trim(p_payload->>'breed'),(p_payload->>'sex')::public.pet_sex,(p_payload->>'birthDate')::date,(p_payload->>'size')::public.pet_size,nullif(p_payload->>'weightKg','')::numeric,nullif(p_payload->>'energyLevel','')::smallint,array(select jsonb_array_elements_text(coalesce(p_payload->'temperamentTags','[]'::jsonb))),left(coalesce(p_payload->>'bio',''),500),trim(p_payload->>'city'),trim(p_payload->>'district'),trim(p_payload->>'neighborhood'),'pending') returning id into v_id;
  else
    if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
    update public.pets set name=trim(p_payload->>'name'),species=(p_payload->>'species')::public.pet_species,breed=trim(p_payload->>'breed'),sex=(p_payload->>'sex')::public.pet_sex,birth_date=(p_payload->>'birthDate')::date,size=(p_payload->>'size')::public.pet_size,weight_kg=nullif(p_payload->>'weightKg','')::numeric,energy_level=nullif(p_payload->>'energyLevel','')::smallint,temperament_tags=array(select jsonb_array_elements_text(coalesce(p_payload->'temperamentTags','[]'::jsonb))),bio=left(coalesce(p_payload->>'bio',''),500),city=trim(p_payload->>'city'),district=trim(p_payload->>'district'),neighborhood=trim(p_payload->>'neighborhood'),updated_at=now(),moderation_status='pending' where id=p_pet_id;
  end if;
  delete from public.pet_purposes where pet_id=v_id;
  insert into public.pet_purposes(pet_id,purpose) select v_id,(x)::public.pet_purpose from jsonb_array_elements_text(p_payload->'purposes') x;
  insert into public.moderation_items(target_type,target_id,status) values('pet_text',v_id,'pending') on conflict(target_type,target_id) do update set status='pending',reason=null,reviewed_at=null;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id) values(auth.uid(),v_id,'pet_profile_upsert','pet',v_id);
  return v_id;
end $$;

-- Normalized, expanded discovery.
create or replace function public.discover_pets(p_active_pet_id uuid,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_me public.pets; v_private public.pet_private; v_result jsonb;
begin
  if not public.owns_pet(p_active_pet_id) then raise exception 'forbidden'; end if;
  select * into v_me from public.pets where id=p_active_pet_id;
  select * into v_private from public.pet_private where pet_id=p_active_pet_id;
  select coalesce(jsonb_agg(item order by (item->>'compatibilityScore')::int desc nulls last),'[]'::jsonb) into v_result from (
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
      and (coalesce(jsonb_array_length(coalesce(p_filters->'breeds','[]'::jsonb)),0)=0 or public.normalize_search_text(p.breed) in (select public.normalize_search_text(x) from jsonb_array_elements_text(p_filters->'breeds') x))
      and (nullif(p_filters->>'minAge','') is null or extract(year from age(current_date,p.birth_date)) >= (p_filters->>'minAge')::int)
      and (nullif(p_filters->>'maxAge','') is null or extract(year from age(current_date,p.birth_date)) <= (p_filters->>'maxAge')::int)
      and (nullif(p_filters->>'minWeightKg','') is null or p.weight_kg >= (p_filters->>'minWeightKg')::numeric)
      and (nullif(p_filters->>'maxWeightKg','') is null or p.weight_kg <= (p_filters->>'maxWeightKg')::numeric)
      and (coalesce(jsonb_array_length(coalesce(p_filters->'energyLevels','[]'::jsonb)),0)=0 or p.energy_level::text in (select jsonb_array_elements_text(p_filters->'energyLevels')))
      and (coalesce(jsonb_array_length(coalesce(p_filters->'temperamentTags','[]'::jsonb)),0)=0 or exists(select 1 from unnest(p.temperament_tags) t where public.normalize_search_text(t) in (select public.normalize_search_text(x) from jsonb_array_elements_text(p_filters->'temperamentTags') x)))
      and (nullif(p_filters->>'city','') is null or public.normalize_search_text(p.city)=public.normalize_search_text(p_filters->>'city'))
      and (nullif(p_filters->>'district','') is null or public.normalize_search_text(p.district)=public.normalize_search_text(p_filters->>'district'))
      and (nullif(p_filters->>'neighborhood','') is null or public.normalize_search_text(coalesce(p.neighborhood,''))=public.normalize_search_text(p_filters->>'neighborhood'))
      and (coalesce((p_filters->>'vaccinatedOnly')::boolean,false)=false or h.vaccination_status='complete')
      and (coalesce((p_filters->>'veterinarianVerifiedOnly')::boolean,false)=false or h.veterinarian_verified)
      and (coalesce((p_filters->>'profileVerifiedOnly')::boolean,false)=false or p.profile_verified)
      and (coalesce((p_filters->>'ownerVerifiedOnly')::boolean,false)=false or u.identity_verified)
      and (coalesce((p_filters->>'microchipVerifiedOnly')::boolean,false)=false or h.microchip_verified)
      and (coalesce((p_filters->>'geneticScreeningOnly')::boolean,false)=false or h.genetic_screening_available)
      and (coalesce((p_filters->>'pedigreeOnly')::boolean,false)=false or h.pedigree_available)
      and (coalesce(p_filters->>'neutered','all')='all' or (p_filters->>'neutered'='yes' and h.neutered=true) or (p_filters->>'neutered'='no' and h.neutered=false))
      and (coalesce(jsonb_array_length(coalesce(p_filters->'purposes','[]'::jsonb)),0)=0 or exists(select 1 from public.pet_purposes x where x.pet_id=p.id and x.purpose::text in (select jsonb_array_elements_text(p_filters->'purposes'))))
      and (nullif(p_filters->>'maxDistanceKm','') is null or v_private.latitude is null or pp.latitude is null or public.haversine_km(v_private.latitude,v_private.longitude,pp.latitude,pp.longitude) <= (p_filters->>'maxDistanceKm')::double precision)
      and (coalesce((p_filters->>'matingOnlyNonNeutered')::boolean,true)=false or not exists(select 1 from public.pet_purposes px where px.pet_id=p.id and px.purpose='mating') or h.neutered=false)
      and (not (coalesce(p_filters->'purposes','[]'::jsonb) ? 'mating') or (p.species=v_me.species and p.sex<>v_me.sex and h.neutered=false and h.vaccination_status='complete' and h.veterinarian_verified))
    limit 100
  ) q;
  return v_result;
end $$;

create or replace function public.get_discovery_suggestions(p_active_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.owns_pet(p_active_pet_id) then jsonb_build_object(
    'breeds',coalesce((select jsonb_agg(x) from (select distinct p.breed x from public.pets p where p.moderation_status='approved' and p.discovery_enabled order by x limit 80) q),'[]'::jsonb),
    'cities',coalesce((select jsonb_agg(x) from (select distinct p.city x from public.pets p where p.moderation_status='approved' and p.discovery_enabled order by x limit 80) q),'[]'::jsonb),
    'districts',coalesce((select jsonb_agg(x) from (select distinct p.district x from public.pets p where p.moderation_status='approved' and p.discovery_enabled order by x limit 120) q),'[]'::jsonb),
    'neighborhoods',coalesce((select jsonb_agg(x) from (select distinct p.neighborhood x from public.pets p where p.moderation_status='approved' and p.discovery_enabled and p.neighborhood is not null order by x limit 160) q),'[]'::jsonb)
  ) else null end;
$$;

-- Keyset pagination for messages and notifications.
create or replace function public.get_conversation_messages_page(p_conversation_id uuid,p_limit integer default 40,p_before_created_at timestamptz default null,p_before_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'conversationId',x.conversation_id,'senderPetId',x.sender_pet_id,'body',x.body,'createdAt',x.created_at,'readAt',x.read_at) order by x.created_at,x.id),'[]'::jsonb)
  from (select msg.* from public.messages msg join public.conversations c on c.id=msg.conversation_id join public.pet_matches m on m.id=c.match_id where msg.conversation_id=p_conversation_id and exists(select 1 from public.pets p where p.owner_id=auth.uid() and p.id in(m.pet_low_id,m.pet_high_id)) and (p_before_created_at is null or (msg.created_at,msg.id)<(p_before_created_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))) order by msg.created_at desc,msg.id desc limit least(greatest(p_limit,1),100)) x;
$$;

create or replace function public.get_notifications_page(p_limit integer default 40,p_before_created_at timestamptz default null,p_before_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'type',n.type,'title',n.title,'body',n.body,'createdAt',n.created_at,'readAt',n.read_at,'entityId',n.entity_id) order by n.created_at desc,n.id desc),'[]'::jsonb)
  from (select * from public.notifications where user_id=auth.uid() and (p_before_created_at is null or (created_at,id)<(p_before_created_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))) order by created_at desc,id desc limit least(greatest(p_limit,1),100)) n;
$$;

-- Stable feed page: freeze the ranking snapshot on page one and use rank/date/id cursor.
create or replace function public.get_feed_page(p_pet_id uuid,p_mode text default 'for_you',p_limit integer default 20,p_snapshot_at timestamptz default null,p_before_rank numeric default null,p_before_created_at timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_snapshot timestamptz:=coalesce(p_snapshot_at,now()); v_items jsonb;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  with ranked as (
    select p.*, (case when p.pet_id=p_pet_id then 6 else 0 end + case when exists(select 1 from public.follows f where f.from_pet_id=p_pet_id and f.to_pet_id=p.pet_id) then 12 else 0 end + greatest(0,5-extract(epoch from (v_snapshot-p.created_at))/86400.0))::numeric rank_score
    from public.posts p join public.pets author on author.id=p.pet_id join public.users au on au.id=author.owner_id and au.suspended_at is null
    where p.deleted_at is null and p.moderation_status='approved' and p.created_at<=v_snapshot and not public.is_blocked(p_pet_id,p.pet_id) and (p_mode<>'following' or p.pet_id=p_pet_id or exists(select 1 from public.follows f where f.from_pet_id=p_pet_id and f.to_pet_id=p.pet_id))
  ), page as (
    select * from ranked where p_before_rank is null or (rank_score,created_at,id)<(p_before_rank,p_before_created_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)) order by rank_score desc,created_at desc,id desc limit least(greatest(p_limit,1),50)
  ) select coalesce(jsonb_agg(jsonb_build_object(
    'id',po.id,'pet',public.pet_json(po.pet_id,p_pet_id),'caption',po.caption,
    'mediaUrls',coalesce((select jsonb_agg(pm.storage_path order by pm.sort_order) from public.post_media pm where pm.post_id=po.id and pm.moderation_status='approved'),'[]'::jsonb),
    'createdAt',po.created_at,'rankScore',po.rank_score,'likeCount',(select count(*) from public.post_likes l where l.post_id=po.id),'commentCount',(select count(*) from public.comments c where c.post_id=po.id and c.deleted_at is null and c.moderation_status='approved'),
    'likedByMe',exists(select 1 from public.post_likes l where l.post_id=po.id and l.pet_id=p_pet_id),'savedByMe',exists(select 1 from public.saved_posts s where s.post_id=po.id and s.pet_id=p_pet_id)
  ) order by po.rank_score desc,po.created_at desc,po.id desc),'[]'::jsonb) into v_items from page po;
  return jsonb_build_object('snapshotAt',v_snapshot,'items',v_items);
end $$;

revoke all on function public.create_upload_intent(uuid,text,text,text,text) from public,anon;
grant execute on function public.create_upload_intent(uuid,text,text,text,text) to authenticated;
revoke all on function public.cancel_upload_intent(uuid) from public,anon;
grant execute on function public.cancel_upload_intent(uuid) to authenticated;
revoke all on function public.submit_pet_verification(uuid,text) from public,anon;
grant execute on function public.submit_pet_verification(uuid,text) to authenticated;
revoke all on function public.get_pet_verification_status(uuid) from public,anon;
grant execute on function public.get_pet_verification_status(uuid) to authenticated;
revoke all on function public.get_discovery_suggestions(uuid) from public,anon;
grant execute on function public.get_discovery_suggestions(uuid) to authenticated;
revoke all on function public.get_conversation_messages_page(uuid,integer,timestamptz,uuid) from public,anon;
grant execute on function public.get_conversation_messages_page(uuid,integer,timestamptz,uuid) to authenticated;
revoke all on function public.get_notifications_page(integer,timestamptz,uuid) from public,anon;
grant execute on function public.get_notifications_page(integer,timestamptz,uuid) to authenticated;
revoke all on function public.get_feed_page(uuid,text,integer,timestamptz,numeric,timestamptz,uuid) from public,anon;
grant execute on function public.get_feed_page(uuid,text,integer,timestamptz,numeric,timestamptz,uuid) to authenticated;
