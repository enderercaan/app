-- v14 disabled-feature payload + internal-helper privilege hardening.
-- Mating remains stored for legacy-data reversibility, but it is not exposed or used while the
-- launch policy is disabled. Helper SECURITY DEFINER functions are internal-only so callers
-- cannot bypass the guarded public RPC surface with arbitrary UUIDs or custom rate-limit keys.
create or replace function public.pet_json(p_pet_id uuid,p_viewer_pet_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'id',p.id,'name',p.name,'species',p.species,'breed',p.breed,'sex',p.sex,'birthDate',p.birth_date,
    'ageYears',case when p.birth_date is null then null else extract(year from age(current_date,p.birth_date))::int end,
    'size',p.size,'weightKg',p.weight_kg,'energyLevel',p.energy_level,'temperamentTags',p.temperament_tags,
    'city',p.city,'district',p.district,'neighborhood',p.neighborhood,
    'purposes',coalesce((select jsonb_agg(pp.purpose order by pp.purpose) from public.pet_purposes pp where pp.pet_id=p.id and pp.purpose<>'mating'),'[]'::jsonb),
    'prompts',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'promptKey',q.prompt_key,'answer',q.answer,'sortOrder',q.sort_order) order by q.sort_order) from public.pet_prompts q where q.pet_id=p.id),'[]'::jsonb),
    'bio',p.bio,'profileVerified',p.profile_verified,'ownerVerified',u.identity_verified,
    'photos',coalesce((select jsonb_agg(jsonb_build_object('id',ph.id,'url',ph.storage_path,'sortOrder',ph.sort_order,'moderationStatus',ph.moderation_status) order by ph.sort_order) from public.pet_photos ph where ph.pet_id=p.id and (ph.moderation_status='approved' or p.owner_id=auth.uid())),'[]'::jsonb),
    'health',jsonb_build_object('vaccinationStatus',coalesce(h.vaccination_status,'unknown'::public.vaccination_status),'veterinarianVerified',coalesce(h.veterinarian_verified,false),'neutered',h.neutered,'microchipVerified',coalesce(h.microchip_verified,false),'geneticScreeningAvailable',coalesce(h.genetic_screening_available,false),'pedigreeAvailable',coalesce(h.pedigree_available,false)),
    'followersCount',(select count(*) from public.follows f where f.to_pet_id=p.id),
    'followingCount',(select count(*) from public.follows f where f.from_pet_id=p.id),
    'isFollowing',case when p_viewer_pet_id is null then false else exists(select 1 from public.follows f where f.from_pet_id=p_viewer_pet_id and f.to_pet_id=p.id) end
  )
  from public.pets p
  join public.users u on u.id=p.owner_id
  left join public.pet_health_summary h on h.pet_id=p.id
  where p.id=p_pet_id;
$$;
revoke all on function public.pet_json(uuid,uuid) from public,anon,authenticated;
revoke all on function public.rate_limit(text,integer,integer) from public,anon,authenticated;
revoke all on function public.haversine_km(double precision,double precision,double precision,double precision) from public,anon,authenticated;
revoke all on function public.normalize_search_text(text) from public,anon,authenticated;

-- v14 push-dispatch concurrency hardening. Claim due notifications atomically so overlapping
-- scheduler invocations cannot both deliver the same pending row. A stale lease is recovered
-- after five minutes and consumes an attempt, preserving bounded retry semantics after crashes.
alter table public.notifications add column if not exists push_claimed_at timestamptz;
alter table public.notifications drop constraint if exists notifications_push_status_check;
alter table public.notifications add constraint notifications_push_status_check
  check (push_status in ('pending','processing','sent','failed','skipped')) not valid;
alter table public.notifications validate constraint notifications_push_status_check;
create index if not exists idx_notifications_push_processing_stale
  on public.notifications(push_claimed_at) where push_status='processing';

create or replace function public.claim_pending_notifications(p_limit integer default 100)
returns table(
  id uuid,
  user_id uuid,
  title text,
  body text,
  type public.notification_type,
  entity_id uuid,
  push_attempts smallint,
  template_key text,
  template_params jsonb
) language plpgsql security definer set search_path='' as $$
begin
  update public.notifications n
  set push_status=case when n.push_attempts+1>=6 then 'failed' else 'pending' end,
      push_attempts=least(n.push_attempts+1,32767)::smallint,
      next_push_attempt_at=now(),
      push_claimed_at=null
  where n.push_status='processing'
    and n.push_claimed_at<now()-interval '5 minutes';

  return query
  with candidates as (
    select n.id
    from public.notifications n
    where n.push_status='pending'
      and n.push_attempts<6
      and n.next_push_attempt_at<=now()
    order by n.created_at asc,n.id asc
    for update skip locked
    limit least(greatest(coalesce(p_limit,100),1),100)
  )
  update public.notifications n
  set push_status='processing',push_claimed_at=now()
  from candidates c
  where n.id=c.id
  returning n.id,n.user_id,n.title,n.body,n.type,n.entity_id,n.push_attempts,n.template_key,n.template_params;
end $$;
revoke all on function public.claim_pending_notifications(integer) from public,anon,authenticated;
grant execute on function public.claim_pending_notifications(integer) to service_role;

-- v14 moderation-worker concurrency hardening. Due moderation work is leased atomically so
-- overlapping schedulers cannot submit the same item to the provider at the same time.
-- The lease reuses next_attempt_at and naturally expires after ten minutes if a worker crashes.
create or replace function public.claim_moderation_items(p_limit integer default 25)
returns setof public.moderation_items
language plpgsql security definer set search_path='' as $$
begin
  return query
  with candidates as (
    select mi.id
    from public.moderation_items mi
    where mi.status='pending'
      and not mi.manual_review_required
      and (mi.next_attempt_at is null or mi.next_attempt_at<=now())
    order by coalesce(mi.next_attempt_at,mi.created_at) asc,mi.created_at asc,mi.id asc
    for update skip locked
    limit least(greatest(coalesce(p_limit,25),1),25)
  )
  update public.moderation_items mi
  set last_attempt_at=now(),
      next_attempt_at=now()+interval '10 minutes'
  from candidates c
  where mi.id=c.id
  returning mi.*;
end $$;
revoke all on function public.claim_moderation_items(integer) from public,anon,authenticated;
grant execute on function public.claim_moderation_items(integer) to service_role;

-- v14 durable-worker queue concurrency hardening. Reuse each queue's not_before field as a
-- short claim lease so overlapping schedulers do not process the same destructive job twice.
create or replace function public.claim_storage_gc_items(p_limit integer default 100)
returns table(id bigint,bucket text,storage_path text,attempts integer)
language plpgsql security definer set search_path='' as $$
begin
  return query
  with candidates as (
    select q.id from public.storage_gc_queue q
    where q.not_before<=now() and q.attempts<8
    order by q.not_before asc,q.id asc
    for update skip locked
    limit least(greatest(coalesce(p_limit,100),1),100)
  )
  update public.storage_gc_queue q
  set not_before=now()+interval '10 minutes'
  from candidates c where q.id=c.id
  returning q.id,q.bucket,q.storage_path,q.attempts;
end $$;
revoke all on function public.claim_storage_gc_items(integer) from public,anon,authenticated;
grant execute on function public.claim_storage_gc_items(integer) to service_role;

create or replace function public.claim_external_deletion_items(p_limit integer default 100)
returns table(provider text,external_user_id text,attempts integer)
language plpgsql security definer set search_path='' as $$
begin
  return query
  with candidates as (
    select q.provider,q.external_user_id from public.external_deletion_queue q
    where q.not_before<=now() and q.attempts<12
    order by q.not_before asc,q.provider asc,q.external_user_id asc
    for update skip locked
    limit least(greatest(coalesce(p_limit,100),1),100)
  )
  update public.external_deletion_queue q
  set not_before=now()+interval '10 minutes'
  from candidates c
  where q.provider=c.provider and q.external_user_id=c.external_user_id
  returning q.provider,q.external_user_id,q.attempts;
end $$;
revoke all on function public.claim_external_deletion_items(integer) from public,anon,authenticated;
grant execute on function public.claim_external_deletion_items(integer) to service_role;

