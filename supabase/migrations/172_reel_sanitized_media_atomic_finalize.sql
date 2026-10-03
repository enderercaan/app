-- Tailmance v19 R8 — atomic sanitized-Reel storage finalization.
-- The moderated MP4 becomes authoritative and the detached raw object is durably queued for immediate GC
-- in the same database transaction. Retries are idempotent and never create nested .sanitized paths.

create or replace function public.service_finalize_sanitized_reel_media(
  p_media_id uuid,
  p_expected_current_path text,
  p_sanitized_path text,
  p_duration_ms integer
) returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_media public.post_media%rowtype;
  v_expected text:=trim(coalesce(p_expected_current_path,''));
  v_sanitized text:=trim(coalesce(p_sanitized_path,''));
begin
  if auth.role()<>'service_role' then raise exception 'forbidden'; end if;
  if v_expected='' or v_sanitized='' then raise exception 'invalid_storage_path'; end if;
  if p_duration_ms not between 1000 and 60000 then raise exception 'invalid_reel_duration'; end if;
  if v_sanitized !~ '\.sanitized\.mp4$' then raise exception 'invalid_sanitized_video_path'; end if;

  select * into v_media from public.post_media where id=p_media_id for update;
  if v_media.id is null or v_media.media_kind<>'video' then raise exception 'reel_media_not_found'; end if;

  -- Crash/retry path: the authoritative row already points at this exact sanitized derivative.
  if v_media.storage_path=v_sanitized then
    update public.post_media
      set mime_type='video/mp4',duration_ms=p_duration_ms
      where id=p_media_id;
    return true;
  end if;

  if v_media.storage_path<>v_expected then raise exception 'reel_media_path_changed'; end if;

  update public.post_media
    set storage_path=v_sanitized,mime_type='video/mp4',duration_ms=p_duration_ms
    where id=p_media_id;

  insert into public.storage_gc_queue(bucket,storage_path,queued_at,not_before,attempts,last_error)
  values('social-media',v_expected,now(),now(),0,null)
  on conflict(bucket,storage_path) do update
    set queued_at=excluded.queued_at,
        not_before=least(public.storage_gc_queue.not_before,excluded.not_before),
        attempts=0,
        last_error=null;
  return true;
end $$;

revoke all on function public.service_finalize_sanitized_reel_media(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.service_finalize_sanitized_reel_media(uuid,text,text,integer) to service_role;
