-- Tailmance v19 R8 — pet-first short-video/Reels production source pipeline.
-- Reels reuse posts/comments/likes/saves/reporting so the established safety surface remains authoritative.
-- Raw uploads stay private and pending until the moderation worker validates duration/policy and replaces
-- the object with a provider-sanitized MP4 derivative that strips source container metadata.

alter table public.posts add column if not exists content_type text not null default 'grid';
alter table public.posts drop constraint if exists posts_content_type_check;
alter table public.posts add constraint posts_content_type_check check (content_type in ('grid','reel')) not valid;
alter table public.posts validate constraint posts_content_type_check;

alter table public.post_media add column if not exists media_kind text not null default 'image';
alter table public.post_media add column if not exists mime_type text;
alter table public.post_media add column if not exists duration_ms integer;
alter table public.post_media drop constraint if exists post_media_media_kind_check;
alter table public.post_media add constraint post_media_media_kind_check check (media_kind in ('image','video')) not valid;
alter table public.post_media validate constraint post_media_media_kind_check;
alter table public.post_media drop constraint if exists post_media_video_duration_check;
alter table public.post_media add constraint post_media_video_duration_check check (
  (media_kind='image' and duration_ms is null)
  or (media_kind='video' and duration_ms between 1000 and 60000)
) not valid;
alter table public.post_media validate constraint post_media_video_duration_check;

create index if not exists posts_reels_page_idx
  on public.posts(created_at desc,id desc)
  where content_type='reel' and deleted_at is null and moderation_status='approved';

update storage.buckets
set file_size_limit=41943040,
    allowed_mime_types=array['image/jpeg','image/png','image/webp','image/heic','image/heif','video/mp4','video/quicktime']
where id='social-media';

create or replace function public.create_upload_intent(
  p_pet_id uuid,p_bucket text,p_purpose text,p_mime_type text,p_extension text default 'jpg'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_path text; v_ext text; v_allowed boolean:=false; v_mime text:=lower(trim(coalesce(p_mime_type,'')));
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  perform public.rate_limit('upload_intent',80,3600);
  v_allowed :=
    (p_bucket='pet-photos' and p_purpose in ('pet_photo_1','pet_photo_2','pet_photo_3') and v_mime in ('image/jpeg','image/png','image/webp','image/heic','image/heif')) or
    (p_bucket='social-media' and p_purpose in ('post_media','story_media') and v_mime in ('image/jpeg','image/png','image/webp','image/heic','image/heif')) or
    (p_bucket='social-media' and p_purpose='reel_media' and v_mime in ('video/mp4','video/quicktime')) or
    (p_bucket='health-documents' and p_purpose='health_document' and v_mime in ('application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif')) or
    (p_bucket='pet-verification' and p_purpose='pet_verification' and v_mime in ('image/jpeg','image/png','image/webp','image/heic','image/heif'));
  if not v_allowed then raise exception 'invalid_upload_intent'; end if;
  v_ext:=regexp_replace(lower(coalesce(p_extension,'jpg')),'[^a-z0-9]','','g');
  if p_purpose='reel_media' then
    if (v_mime='video/mp4' and v_ext<>'mp4') or (v_mime='video/quicktime' and v_ext<>'mov') then raise exception 'invalid_video_extension'; end if;
  elsif v_ext='' or char_length(v_ext)>5 then v_ext:='jpg'; end if;
  v_id:=gen_random_uuid();
  v_path:=p_pet_id::text||'/intents/'||v_id::text||'.'||v_ext;
  insert into public.upload_intents(id,user_id,pet_id,bucket,purpose,storage_path,mime_type)
  values(v_id,auth.uid(),p_pet_id,p_bucket,p_purpose,v_path,v_mime);
  return jsonb_build_object('id',v_id,'bucket',p_bucket,'path',v_path,'expiresAt',now()+interval '15 minutes');
end $$;
revoke all on function public.create_upload_intent(uuid,text,text,text,text) from public,anon,authenticated;

create or replace function public.create_reel_idempotent(
  p_pet_id uuid,
  p_caption text,
  p_storage_path text,
  p_duration_ms integer,
  p_client_operation_id text
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_op text:=trim(coalesce(p_client_operation_id,''));
  v_caption text:=trim(coalesce(p_caption,''));
  v_path text:=trim(coalesce(p_storage_path,''));
  v_hash text;
  v_receipt public.client_mutation_receipts%rowtype;
  v_post uuid;
  v_media uuid;
  v_mime text;
begin
  perform public.require_active_authenticated_session();
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if v_op !~ '^[A-Za-z0-9_-]{16,96}$' then raise exception 'invalid_client_operation_id'; end if;
  if char_length(v_caption)>2200 then raise exception 'caption_too_long'; end if;
  if v_path='' then raise exception 'invalid_media_path'; end if;
  if p_duration_ms not between 1000 and 60000 then raise exception 'invalid_reel_duration'; end if;
  perform public.rate_limit('create_reel',12,86400);

  v_hash:=public.client_mutation_hash(jsonb_build_object(
    'petId',p_pet_id,'caption',v_caption,'storagePath',v_path,'durationMs',p_duration_ms
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':create_reel:'||v_op,0));
  select * into v_receipt from public.client_mutation_receipts
    where user_id=auth.uid() and action='create_reel' and operation_id=v_op;
  if v_receipt.user_id is not null then
    if v_receipt.request_hash<>v_hash then raise exception 'client_operation_id_reused'; end if;
    return (v_receipt.result->>'id')::uuid;
  end if;

  select mime_type into v_mime
  from public.upload_intents
  where user_id=auth.uid() and pet_id=p_pet_id and bucket='social-media' and purpose='reel_media'
    and storage_path=v_path and consumed_at is null and cancelled_at is null and expires_at>now()
  order by created_at desc limit 1;
  if v_mime not in ('video/mp4','video/quicktime') then raise exception 'valid_reel_upload_required'; end if;

  perform public.consume_upload_intent(p_pet_id,'social-media','reel_media',v_path);
  insert into public.posts(pet_id,caption,content_type,moderation_status)
    values(p_pet_id,v_caption,'reel','pending') returning id into v_post;
  insert into public.post_media(post_id,storage_path,sort_order,moderation_status,media_kind,mime_type,duration_ms)
    values(v_post,v_path,1,'pending','video',v_mime,p_duration_ms) returning id into v_media;
  insert into public.moderation_items(target_type,target_id,status)
    values('post_media',v_media,'pending') on conflict do nothing;
  insert into public.moderation_items(target_type,target_id,status)
    values('post_text',v_post,'pending') on conflict do nothing;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),p_pet_id,'reel_created','post',v_post,jsonb_build_object('durationMs',p_duration_ms));
  insert into public.client_mutation_receipts(user_id,action,operation_id,request_hash,result)
    values(auth.uid(),'create_reel',v_op,v_hash,jsonb_build_object('id',v_post));
  return v_post;
end $$;
revoke all on function public.create_reel_idempotent(uuid,text,text,integer,text) from public,anon;
grant execute on function public.create_reel_idempotent(uuid,text,text,integer,text) to authenticated;

create or replace function public.get_reels_page(
  p_pet_id uuid,
  p_limit integer default 12,
  p_snapshot_at timestamptz default null,
  p_before_rank numeric default null,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_snapshot timestamptz:=coalesce(p_snapshot_at,now()); v_items jsonb; v_me public.pets;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select * into v_me from public.pets where id=p_pet_id;
  with ranked as (
    select p.*,(case when p.pet_id=p_pet_id then 4 else 0 end
      +case when exists(select 1 from public.follows f where f.from_pet_id=p_pet_id and f.to_pet_id=p.pet_id) then 10 else 0 end
      +case when public.normalize_search_text(author.city)=public.normalize_search_text(v_me.city) then 6 else 0 end
      +least(18,(select count(*) from public.post_likes l where l.post_id=p.id)::numeric/4)
      +least(12,(select count(*) from public.comments c where c.post_id=p.id and c.deleted_at is null and c.moderation_status='approved')::numeric/3)
      +greatest(0,10-extract(epoch from (v_snapshot-p.created_at))/43200.0))::numeric rank_score
    from public.posts p
    join public.pets author on author.id=p.pet_id
    join public.users au on au.id=author.owner_id and au.suspended_at is null and au.paused_at is null
    where p.content_type='reel' and p.deleted_at is null and p.moderation_status='approved' and p.created_at<=v_snapshot
      and author.moderation_status='approved' and not public.is_blocked(p_pet_id,p.pet_id)
      and exists(select 1 from public.post_media pm where pm.post_id=p.id and pm.media_kind='video' and pm.moderation_status='approved')
  ), page as (
    select * from ranked
    where p_before_rank is null or (rank_score,created_at,id)<(p_before_rank,p_before_created_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
    order by rank_score desc,created_at desc,id desc
    limit least(greatest(p_limit,1),30)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',po.id,'pet',public.pet_json(po.pet_id,p_pet_id),'caption',po.caption,
    'videoPath',(select pm.storage_path from public.post_media pm where pm.post_id=po.id and pm.media_kind='video' and pm.moderation_status='approved' order by pm.sort_order limit 1),
    'durationMs',(select pm.duration_ms from public.post_media pm where pm.post_id=po.id and pm.media_kind='video' and pm.moderation_status='approved' order by pm.sort_order limit 1),
    'createdAt',po.created_at,'rankScore',po.rank_score,
    'likeCount',(select count(*) from public.post_likes l where l.post_id=po.id),
    'commentCount',(select count(*) from public.comments c join public.pets cp on cp.id=c.pet_id join public.users cu on cu.id=cp.owner_id where c.post_id=po.id and c.deleted_at is null and c.moderation_status='approved' and cu.suspended_at is null and cu.paused_at is null),
    'likedByMe',exists(select 1 from public.post_likes l where l.post_id=po.id and l.pet_id=p_pet_id),
    'savedByMe',exists(select 1 from public.saved_posts sp where sp.post_id=po.id and sp.pet_id=p_pet_id)
  ) order by po.rank_score desc,po.created_at desc,po.id desc),'[]'::jsonb) into v_items from page po;
  return jsonb_build_object('snapshotAt',v_snapshot,'items',v_items);
end $$;
revoke all on function public.get_reels_page(uuid,integer,timestamptz,numeric,timestamptz,uuid) from public,anon;
grant execute on function public.get_reels_page(uuid,integer,timestamptz,numeric,timestamptz,uuid) to authenticated;

-- Grid feed remains image-first; short videos use their dedicated vertical feed.
create or replace function public.get_feed_page(p_pet_id uuid,p_mode text default 'for_you',p_limit integer default 20,p_snapshot_at timestamptz default null,p_before_rank numeric default null,p_before_created_at timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_snapshot timestamptz:=coalesce(p_snapshot_at,now()); v_items jsonb; v_me public.pets;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_mode not in ('for_you','following','local') then raise exception 'invalid_feed_mode'; end if;
  select * into v_me from public.pets where id=p_pet_id;
  with ranked as (
    select p.*,(case when p.pet_id=p_pet_id then 6 else 0 end
      +case when exists(select 1 from public.follows f where f.from_pet_id=p_pet_id and f.to_pet_id=p.pet_id) then 12 else 0 end
      +case when public.normalize_search_text(author.city)=public.normalize_search_text(v_me.city) then 8 else 0 end
      +case when public.normalize_search_text(author.city)=public.normalize_search_text(v_me.city) and public.normalize_search_text(author.district)=public.normalize_search_text(v_me.district) then 12 else 0 end
      +case when public.normalize_search_text(author.city)=public.normalize_search_text(v_me.city) and public.normalize_search_text(author.district)=public.normalize_search_text(v_me.district) and public.normalize_search_text(coalesce(author.neighborhood,''))=public.normalize_search_text(coalesce(v_me.neighborhood,'')) then 20 else 0 end
      +greatest(0,5-extract(epoch from (v_snapshot-p.created_at))/86400.0))::numeric rank_score
    from public.posts p join public.pets author on author.id=p.pet_id join public.users au on au.id=author.owner_id and au.suspended_at is null and au.paused_at is null
    where p.content_type='grid' and p.deleted_at is null and p.moderation_status='approved' and p.created_at<=v_snapshot and not public.is_blocked(p_pet_id,p.pet_id)
      and (p_mode<>'following' or p.pet_id=p_pet_id or exists(select 1 from public.follows f where f.from_pet_id=p_pet_id and f.to_pet_id=p.pet_id))
      and (p_mode<>'local' or (public.normalize_search_text(author.city)=public.normalize_search_text(v_me.city) and public.normalize_search_text(author.district)=public.normalize_search_text(v_me.district)))
  ), page as (
    select * from ranked where p_before_rank is null or (rank_score,created_at,id)<(p_before_rank,p_before_created_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)) order by rank_score desc,created_at desc,id desc limit least(greatest(p_limit,1),50)
  ) select coalesce(jsonb_agg(jsonb_build_object(
    'id',po.id,'pet',public.pet_json(po.pet_id,p_pet_id),'caption',po.caption,
    'mediaUrls',coalesce((select jsonb_agg(pm.storage_path order by pm.sort_order) from public.post_media pm where pm.post_id=po.id and pm.media_kind='image' and pm.moderation_status='approved'),'[]'::jsonb),
    'createdAt',po.created_at,'rankScore',po.rank_score,'likeCount',(select count(*) from public.post_likes l where l.post_id=po.id),'commentCount',(select count(*) from public.comments c join public.pets cp on cp.id=c.pet_id join public.users cu on cu.id=cp.owner_id where c.post_id=po.id and c.deleted_at is null and c.moderation_status='approved' and cu.suspended_at is null and cu.paused_at is null),
    'likedByMe',exists(select 1 from public.post_likes l where l.post_id=po.id and l.pet_id=p_pet_id),'savedByMe',exists(select 1 from public.saved_posts sp where sp.post_id=po.id and sp.pet_id=p_pet_id)
  ) order by po.rank_score desc,po.created_at desc,po.id desc),'[]'::jsonb) into v_items from page po;
  return jsonb_build_object('snapshotAt',v_snapshot,'items',v_items);
end $$;
revoke all on function public.get_feed_page(uuid,text,integer,timestamptz,numeric,timestamptz,uuid) from public,anon;
grant execute on function public.get_feed_page(uuid,text,integer,timestamptz,numeric,timestamptz,uuid) to authenticated;
