-- PawLink social/product polish: richer pet identity, hidden owner trust signal,
-- post-meet feedback, feed modes and scale indexes.

alter table public.users add column if not exists identity_verified boolean not null default false;
alter table public.users add column if not exists identity_verified_at timestamptz;

create table if not exists public.pet_prompts (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  prompt_key text not null check (char_length(prompt_key) between 2 and 80),
  answer text not null check (char_length(trim(answer)) between 1 and 240),
  sort_order smallint not null check (sort_order between 1 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(pet_id,sort_order)
);

create table if not exists public.meetup_feedback (
  id uuid primary key default gen_random_uuid(),
  meetup_request_id uuid not null references public.meetup_requests(id) on delete cascade,
  reviewer_pet_id uuid not null references public.pets(id) on delete cascade,
  met boolean not null,
  felt_safe boolean,
  would_meet_again boolean,
  issue_category text,
  private_note text check (private_note is null or char_length(private_note) <= 1000),
  created_at timestamptz not null default now(),
  unique(meetup_request_id,reviewer_pet_id)
);

alter table public.pet_prompts enable row level security;
alter table public.meetup_feedback enable row level security;

create index if not exists idx_pets_discovery_core on public.pets(discovery_enabled,moderation_status,species,city,district);
create index if not exists idx_pets_owner on public.pets(owner_id);
create index if not exists idx_pet_likes_to_created on public.pet_likes(to_pet_id,created_at desc);
create index if not exists idx_pet_matches_active on public.pet_matches(pet_low_id,pet_high_id) where unmatched_at is null;
create index if not exists idx_messages_conversation_created on public.messages(conversation_id,created_at desc);
create index if not exists idx_posts_feed on public.posts(moderation_status,created_at desc) where deleted_at is null;
create index if not exists idx_follows_from on public.follows(from_pet_id,to_pet_id);
create index if not exists idx_notifications_user_created on public.notifications(user_id,created_at desc);
create index if not exists idx_events_location_time on public.pet_events(city,district,starts_at);

create or replace function public.pet_json(p_pet_id uuid,p_viewer_pet_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'id',p.id,'name',p.name,'species',p.species,'breed',p.breed,'sex',p.sex,'birthDate',p.birth_date,
    'ageYears',case when p.birth_date is null then null else extract(year from age(current_date,p.birth_date))::int end,
    'size',p.size,'weightKg',p.weight_kg,'energyLevel',p.energy_level,'temperamentTags',p.temperament_tags,
    'city',p.city,'district',p.district,'neighborhood',p.neighborhood,
    'purposes',coalesce((select jsonb_agg(pp.purpose order by pp.purpose) from public.pet_purposes pp where pp.pet_id=p.id),'[]'::jsonb),
    'prompts',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'promptKey',q.prompt_key,'answer',q.answer,'sortOrder',q.sort_order) order by q.sort_order) from public.pet_prompts q where q.pet_id=p.id),'[]'::jsonb),
    'bio',p.bio,'profileVerified',p.profile_verified,'ownerVerified',u.identity_verified,
    'photos',coalesce((select jsonb_agg(jsonb_build_object('id',ph.id,'url',ph.storage_path,'sortOrder',ph.sort_order,'moderationStatus',ph.moderation_status) order by ph.sort_order) from public.pet_photos ph where ph.pet_id=p.id and (ph.moderation_status='approved' or p.owner_id=auth.uid())),'[]'::jsonb),
    'health',jsonb_build_object('vaccinationStatus',coalesce(h.vaccination_status,'unknown'::public.vaccination_status),'veterinarianVerified',coalesce(h.veterinarian_verified,false),'neutered',h.neutered,'microchipVerified',coalesce(h.microchip_verified,false),'geneticScreeningAvailable',coalesce(h.genetic_screening_available,false),'pedigreeAvailable',coalesce(h.pedigree_available,false)),
    'followersCount',(select count(*) from public.follows f where f.to_pet_id=p.id),
    'followingCount',(select count(*) from public.follows f where f.from_pet_id=p.id),
    'isFollowing',case when p_viewer_pet_id is null then false else exists(select 1 from public.follows f where f.from_pet_id=p_viewer_pet_id and f.to_pet_id=p.id) end
  )
  from public.pets p join public.users u on u.id=p.owner_id left join public.pet_health_summary h on h.pet_id=p.id where p.id=p_pet_id;
$$;

create or replace function public.upsert_pet_prompts(p_pet_id uuid,p_prompts jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v_item jsonb; v_order int:=0; v_answer text;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('pet_prompts',30,3600);
  if jsonb_typeof(coalesce(p_prompts,'[]'::jsonb)) <> 'array' then raise exception 'invalid_prompts'; end if;
  if jsonb_array_length(coalesce(p_prompts,'[]'::jsonb)) > 3 then raise exception 'too_many_prompts'; end if;
  delete from public.pet_prompts where pet_id=p_pet_id;
  for v_item in select * from jsonb_array_elements(coalesce(p_prompts,'[]'::jsonb)) loop
    v_order:=v_order+1; v_answer:=trim(coalesce(v_item->>'answer',''));
    if v_answer<>'' then
      insert into public.pet_prompts(pet_id,prompt_key,answer,sort_order)
      values(p_pet_id,left(trim(coalesce(v_item->>'promptKey','other')),80),left(v_answer,240),v_order);
    end if;
  end loop;
  update public.pets set moderation_status='pending',updated_at=now() where id=p_pet_id;
  insert into public.moderation_items(target_type,target_id,status) values('pet_text',p_pet_id,'pending')
  on conflict(target_type,target_id) do update set status='pending',reason=null,reviewed_at=null;
end $$;

create or replace function public.get_feed(p_pet_id uuid,p_limit integer default 50,p_mode text default 'for_you')
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.owns_pet(p_pet_id) then coalesce(jsonb_agg(jsonb_build_object(
    'id',po.id,'pet',public.pet_json(po.pet_id,p_pet_id),'caption',po.caption,
    'mediaUrls',coalesce((select jsonb_agg(pm.storage_path order by pm.sort_order) from public.post_media pm where pm.post_id=po.id and pm.moderation_status='approved'),'[]'::jsonb),
    'createdAt',po.created_at,'likeCount',(select count(*) from public.post_likes l where l.post_id=po.id),'commentCount',(select count(*) from public.comments c where c.post_id=po.id and c.deleted_at is null and c.moderation_status='approved'),
    'likedByMe',exists(select 1 from public.post_likes l where l.post_id=po.id and l.pet_id=p_pet_id),'savedByMe',exists(select 1 from public.saved_posts s where s.post_id=po.id and s.pet_id=p_pet_id)
  ) order by po.rank_score desc,po.created_at desc),'[]'::jsonb) else null end
  from (
    select p.*, (
      case when p.pet_id=p_pet_id then 6 else 0 end +
      case when exists(select 1 from public.follows f where f.from_pet_id=p_pet_id and f.to_pet_id=p.pet_id) then 12 else 0 end +
      greatest(0,5 - extract(epoch from (now()-p.created_at))/86400.0)
    ) rank_score
    from public.posts p
    join public.pets author on author.id=p.pet_id
    join public.users au on au.id=author.owner_id and au.suspended_at is null
    where p.deleted_at is null and p.moderation_status='approved' and not public.is_blocked(p_pet_id,p.pet_id)
      and (p_mode<>'following' or p.pet_id=p_pet_id or exists(select 1 from public.follows f where f.from_pet_id=p_pet_id and f.to_pet_id=p.pet_id))
    order by rank_score desc,p.created_at desc
    limit least(greatest(p_limit,1),100)
  ) po;
$$;

create or replace function public.submit_meetup_feedback(
  p_request_id uuid,p_reviewer_pet_id uuid,p_met boolean,p_felt_safe boolean default null,
  p_would_meet_again boolean default null,p_issue_category text default null,p_private_note text default null
) returns void language plpgsql security definer set search_path='' as $$
declare v_match uuid;
begin
  if not public.owns_pet(p_reviewer_pet_id) then raise exception 'forbidden'; end if;
  select match_id into v_match from public.meetup_requests where id=p_request_id and status='accepted' and starts_at < now();
  if v_match is null then raise exception 'feedback_not_available'; end if;
  if not exists(select 1 from public.pet_matches m where m.id=v_match and p_reviewer_pet_id in (m.pet_low_id,m.pet_high_id)) then raise exception 'forbidden'; end if;
  insert into public.meetup_feedback(meetup_request_id,reviewer_pet_id,met,felt_safe,would_meet_again,issue_category,private_note)
  values(p_request_id,p_reviewer_pet_id,p_met,p_felt_safe,p_would_meet_again,nullif(left(trim(coalesce(p_issue_category,'')),80),''),nullif(left(trim(coalesce(p_private_note,'')),1000),''))
  on conflict(meetup_request_id,reviewer_pet_id) do update set met=excluded.met,felt_safe=excluded.felt_safe,would_meet_again=excluded.would_meet_again,issue_category=excluded.issue_category,private_note=excluded.private_note,created_at=now();
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id) values(auth.uid(),p_reviewer_pet_id,'meetup_feedback','meetup_request',p_request_id);
end $$;

revoke all on function public.upsert_pet_prompts(uuid,jsonb) from public,anon;
grant execute on function public.upsert_pet_prompts(uuid,jsonb) to authenticated;
revoke all on function public.get_feed(uuid,integer,text) from public,anon;
grant execute on function public.get_feed(uuid,integer,text) to authenticated;
revoke all on function public.submit_meetup_feedback(uuid,uuid,boolean,boolean,boolean,text,text) from public,anon;
grant execute on function public.submit_meetup_feedback(uuid,uuid,boolean,boolean,boolean,text,text) to authenticated;
