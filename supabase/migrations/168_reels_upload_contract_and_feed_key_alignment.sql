-- Tailmance v19 R8 — Reels upload-size contract + feed hydration alignment.
-- The social-media bucket must accept 40 MB raw video intents, while image purposes retain
-- their stricter 15 MB object limit. Reels feed JSON deliberately exposes the storage path
-- under videoUrl because the client hydrator replaces that value with a short-lived signed URL.

create or replace function public.consume_upload_intent(p_pet_id uuid,p_bucket text,p_purpose text,p_path text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_intent public.upload_intents%rowtype;
  v_size_text text;
  v_mime text;
  v_size bigint;
  v_max_bytes bigint;
begin
  select * into v_intent
  from public.upload_intents
  where user_id=auth.uid()
    and pet_id=p_pet_id
    and bucket=p_bucket
    and purpose=p_purpose
    and storage_path=p_path
    and consumed_at is null
    and cancelled_at is null
    and expires_at>now()
  order by created_at desc
  limit 1
  for update;

  if v_intent.id is null then raise exception 'valid_upload_intent_required'; end if;

  v_max_bytes:=case
    when v_intent.bucket='pet-photos' then 10485760::bigint
    when v_intent.bucket='social-media' and v_intent.purpose='reel_media' then 41943040::bigint
    when v_intent.bucket='social-media' and v_intent.purpose in ('post_media','story_media') then 15728640::bigint
    when v_intent.bucket='health-documents' then 15728640::bigint
    when v_intent.bucket='pet-verification' then 10485760::bigint
    else null end;
  if v_max_bytes is null then raise exception 'invalid_upload_bucket_or_purpose'; end if;

  select o.metadata->>'size',o.metadata->>'mimetype'
  into v_size_text,v_mime
  from storage.objects o
  where o.bucket_id=v_intent.bucket and o.name=v_intent.storage_path
  limit 1;

  if v_size_text is null or v_mime is null then raise exception 'uploaded_object_required'; end if;
  if v_size_text !~ '^[0-9]+$' then raise exception 'invalid_uploaded_object_metadata'; end if;
  v_size:=v_size_text::bigint;
  if v_size<=0 or v_size>v_max_bytes then raise exception 'invalid_uploaded_object_size'; end if;
  if lower(v_mime)<>lower(v_intent.mime_type) then raise exception 'uploaded_object_mime_mismatch'; end if;

  update public.upload_intents set consumed_at=now() where id=v_intent.id;
  return v_intent.id;
end $$;
revoke all on function public.consume_upload_intent(uuid,text,text,text) from public,anon,authenticated;

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
    select p.*,(case when p.pet_id=p_pet_id then 3 else 0 end
      +case when author.species=v_me.species then 8 else 0 end
      +case when public.normalize_search_text(author.breed)=public.normalize_search_text(v_me.breed) then 6 else 0 end
      +case when public.normalize_search_text(author.city)=public.normalize_search_text(v_me.city) then 4 else 0 end
      +greatest(0,12-extract(epoch from (v_snapshot-p.created_at))/43200.0)
      +((((pg_catalog.hashtextextended(p.id::text||':'||p_pet_id::text,0)%1000)+1000)%1000)::numeric/1000.0))::numeric rank_score
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
    'videoUrl',(select pm.storage_path from public.post_media pm where pm.post_id=po.id and pm.media_kind='video' and pm.moderation_status='approved' order by pm.sort_order limit 1),
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
