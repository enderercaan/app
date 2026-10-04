-- Pet-verification state must be bound to the current pet identity and current profile imagery.
create or replace function public.cancel_pending_pet_verification(p_pet_id uuid,p_reason text default 'profile_changed')
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.storage_gc_queue(bucket,storage_path,queued_at,not_before,attempts,last_error)
  select 'pet-verification',r.storage_path,now(),now()+interval '15 minutes',0,null
  from public.pet_verification_requests r
  where r.pet_id=p_pet_id and r.status='pending'
  on conflict(bucket,storage_path) do update
    set queued_at=excluded.queued_at,not_before=least(public.storage_gc_queue.not_before,excluded.not_before),attempts=0,last_error=null;

  update public.pet_verification_requests
  set status='cancelled',reason=left(coalesce(nullif(trim(p_reason),''),'profile_changed'),500),reviewed_at=now()
  where pet_id=p_pet_id and status='pending';
end $$;
revoke all on function public.cancel_pending_pet_verification(uuid,text) from public,anon,authenticated;

-- Existing pending requests predate identity/photo serialization, so their snapshot integrity cannot be proven.
-- Fail closed during hardening rollout: cancel every historical pending request, queue its private media for GC,
-- and require the owner to submit a fresh verification request under the new locking rules.
insert into public.storage_gc_queue(bucket,storage_path,queued_at,not_before,attempts,last_error)
select 'pet-verification',storage_path,now(),now()+interval '15 minutes',0,null
from public.pet_verification_requests
where status='pending'
on conflict(bucket,storage_path) do update
  set queued_at=excluded.queued_at,not_before=least(public.storage_gc_queue.not_before,excluded.not_before),attempts=0,last_error=null;

update public.pet_verification_requests
set status='cancelled',reason='pre_hardening_reverification_required',reviewed_at=now()
where status='pending';

create unique index if not exists pet_verification_one_pending_per_pet
on public.pet_verification_requests(pet_id) where status='pending';

create or replace function public.submit_pet_verification(p_pet_id uuid,p_storage_path text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('pet_verification',5,86400);

  -- Serialize verification submissions with identity/photo changes for this pet.
  perform 1 from public.pets where id=p_pet_id for update;
  perform public.consume_upload_intent(p_pet_id,'pet-verification','pet_verification',p_storage_path);
  perform public.cancel_pending_pet_verification(p_pet_id,'superseded_by_new_request');

  insert into public.pet_verification_requests(pet_id,owner_id,storage_path,status)
  values(p_pet_id,auth.uid(),p_storage_path,'pending') returning id into v_id;
  update public.pets set profile_verified=false where id=p_pet_id;
  return v_id;
end $$;
revoke all on function public.submit_pet_verification(uuid,text) from public,anon;
grant execute on function public.submit_pet_verification(uuid,text) to authenticated;

create or replace function public.attach_pet_photo(p_pet_id uuid,p_storage_path text,p_sort_order smallint)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_purpose text;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_sort_order not between 1 and 3 then raise exception 'invalid_photo_slot'; end if;
  perform public.rate_limit('photo_attach',20,3600);

  -- Lock the pet so a verification submit/review cannot race a profile-photo identity change.
  perform 1 from public.pets where id=p_pet_id for update;
  v_purpose:='pet_photo_'||p_sort_order::text;
  perform public.consume_upload_intent(p_pet_id,'pet-photos',v_purpose,p_storage_path);
  perform public.cancel_pending_pet_verification(p_pet_id,'profile_photo_changed');

  insert into public.pet_photos(pet_id,storage_path,sort_order,moderation_status)
  values(p_pet_id,p_storage_path,p_sort_order,'pending')
  on conflict(pet_id,sort_order) do update
    set storage_path=excluded.storage_path,moderation_status='pending',moderation_reason=null,updated_at=now()
  returning id into v_id;
  update public.pets set profile_verified=false where id=p_pet_id;
  insert into public.moderation_items(target_type,target_id,status)
  values('pet_photo',v_id,'pending')
  on conflict(target_type,target_id) do update set status='pending',reason=null,reviewed_at=null;
  return v_id;
end $$;
revoke all on function public.attach_pet_photo(uuid,text,smallint) from public,anon;
grant execute on function public.attach_pet_photo(uuid,text,smallint) to authenticated;

create or replace function public.revoke_pet_verification_on_identity_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.name is distinct from new.name
     or old.species is distinct from new.species
     or old.breed is distinct from new.breed
     or old.sex is distinct from new.sex
     or old.birth_date is distinct from new.birth_date then
    new.profile_verified:=false;
    perform public.cancel_pending_pet_verification(old.id,'pet_identity_changed');
  end if;
  return new;
end $$;
revoke all on function public.revoke_pet_verification_on_identity_change() from public,anon,authenticated;

-- Keep pet-verification lock ordering consistent: pet row first, request row second.
create or replace function public.review_pet_verification(p_request_id uuid,p_approved boolean,p_reason text default null)
returns void language plpgsql security definer set search_path='' as $$
declare v public.pet_verification_requests; v_pet_id uuid;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_reason is not null and char_length(p_reason)>500 then raise exception 'verification_reason_too_long'; end if;

  select pet_id into v_pet_id from public.pet_verification_requests where id=p_request_id;
  if v_pet_id is null then raise exception 'invalid_request'; end if;
  perform 1 from public.pets where id=v_pet_id for update;
  select * into v from public.pet_verification_requests
  where id=p_request_id and pet_id=v_pet_id for update;
  if v.id is null or v.status<>'pending' then raise exception 'invalid_request'; end if;

  update public.pet_verification_requests
  set status=case when p_approved then 'approved' else 'rejected' end,
      reason=p_reason,reviewed_at=now()
  where id=v.id;
  update public.pets set profile_verified=p_approved where id=v.pet_id;
  insert into public.storage_gc_queue(bucket,storage_path,queued_at,not_before,attempts,last_error)
  values('pet-verification',v.storage_path,now(),now()+interval '1 hour',0,null)
  on conflict(bucket,storage_path) do update
    set queued_at=excluded.queued_at,not_before=excluded.not_before,attempts=0,last_error=null;
end $$;
revoke all on function public.review_pet_verification(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.review_pet_verification(uuid,boolean,text) to service_role;

-- Storage read authorization must mirror application visibility and lifecycle state.
create or replace function public.can_read_storage_object(p_bucket text,p_name text)
returns boolean language sql stable security definer set search_path='' as $$
  select case
    when p_bucket='pet-photos' then exists(
      select 1
      from public.pet_photos ph
      join public.pets p on p.id=ph.pet_id
      join public.users u on u.id=p.owner_id
      where ph.storage_path=p_name
        and (
          p.owner_id=auth.uid()
          or (
            ph.moderation_status='approved'
            and p.moderation_status='approved'
            and u.suspended_at is null and u.paused_at is null
            and not exists(
              select 1 from public.pets mine
              where mine.owner_id=auth.uid() and public.is_blocked(mine.id,p.id)
            )
          )
        )
    )
    when p_bucket='health-documents' then exists(
      select 1 from public.health_documents h join public.pets p on p.id=h.pet_id
      where h.storage_path=p_name and p.owner_id=auth.uid()
    )
    when p_bucket='pet-verification' then exists(
      select 1 from public.pet_verification_requests r
      where r.storage_path=p_name and r.owner_id=auth.uid()
    )
    when p_bucket='social-media' then exists(
      select 1
      from public.post_media pm
      join public.posts po on po.id=pm.post_id
      join public.pets p on p.id=po.pet_id
      join public.users u on u.id=p.owner_id
      where pm.storage_path=p_name
        and (
          p.owner_id=auth.uid()
          or (
            pm.moderation_status='approved'
            and po.moderation_status='approved'
            and po.deleted_at is null
            and p.moderation_status='approved'
            and u.suspended_at is null and u.paused_at is null
            and not exists(
              select 1 from public.pets mine
              where mine.owner_id=auth.uid() and public.is_blocked(mine.id,p.id)
            )
          )
        )
    ) or exists(
      select 1
      from public.stories s
      join public.pets p on p.id=s.pet_id
      join public.users u on u.id=p.owner_id
      where s.storage_path=p_name
        and (
          p.owner_id=auth.uid()
          or (
            s.moderation_status='approved'
            and s.expires_at>now()
            and p.moderation_status='approved'
            and u.suspended_at is null and u.paused_at is null
            and exists(
              select 1 from public.pets mine
              where mine.owner_id=auth.uid()
                and not public.is_blocked(mine.id,p.id)
                and exists(select 1 from public.follows f where f.from_pet_id=mine.id and f.to_pet_id=p.id)
            )
          )
        )
    )
    else false
  end;
$$;
revoke all on function public.can_read_storage_object(text,text) from public,anon;
grant execute on function public.can_read_storage_object(text,text) to authenticated;

create or replace function public.get_active_stories(p_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'petId',s.pet_id,'petName',p.name,
    'avatarUrl',(select ph.storage_path from public.pet_photos ph where ph.pet_id=p.id and ph.sort_order=1 and ph.moderation_status='approved'),
    'mediaUrl',s.storage_path,'createdAt',s.created_at,'expiresAt',s.expires_at,
    'seen',exists(select 1 from public.story_views v where v.story_id=s.id and v.viewer_pet_id=p_pet_id)
  ) order by s.created_at desc),'[]'::jsonb)
  from public.stories s
  join public.pets p on p.id=s.pet_id
  join public.users u on u.id=p.owner_id
  where public.owns_pet(p_pet_id)
    and s.expires_at>now() and s.moderation_status='approved'
    and p.moderation_status='approved' and u.suspended_at is null and u.paused_at is null
    and not public.is_blocked(p_pet_id,s.pet_id)
    and (s.pet_id=p_pet_id or exists(select 1 from public.follows f where f.from_pet_id=p_pet_id and f.to_pet_id=s.pet_id));
$$;
revoke all on function public.get_active_stories(uuid) from public,anon;
grant execute on function public.get_active_stories(uuid) to authenticated;

create or replace function public.get_pet_events(p_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'creatorPetId',e.creator_pet_id,'title',e.title,'description',e.description,
    'city',e.city,'district',e.district,'neighborhood',e.neighborhood,'startsAt',e.starts_at,'endsAt',e.ends_at,'capacity',e.capacity,
    'attendeeCount',(select count(*) from public.event_attendees a where a.event_id=e.id),
    'myStatus',(select a.status from public.event_attendees a where a.event_id=e.id and a.pet_id=p_pet_id)
  ) order by e.starts_at),'[]'::jsonb)
  from public.pet_events e
  join public.pets creator on creator.id=e.creator_pet_id
  join public.users u on u.id=creator.owner_id
  where public.owns_pet(p_pet_id)
    and e.moderation_status='approved' and e.starts_at>now()
    and creator.moderation_status='approved' and u.suspended_at is null and u.paused_at is null
    and not public.is_blocked(p_pet_id,e.creator_pet_id);
$$;
revoke all on function public.get_pet_events(uuid) from public,anon;
grant execute on function public.get_pet_events(uuid) to authenticated;


