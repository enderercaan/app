-- PawLink private media lifecycle. Queue detached objects for delayed, server-side deletion.

create table if not exists public.storage_gc_queue (
  id bigint generated always as identity primary key,
  bucket text not null check (bucket in ('pet-photos','social-media','health-documents')),
  storage_path text not null,
  queued_at timestamptz not null default now(),
  not_before timestamptz not null default (now() + interval '1 hour'),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  unique(bucket,storage_path)
);
alter table public.storage_gc_queue enable row level security;
revoke all on public.storage_gc_queue from anon, authenticated;
create index if not exists storage_gc_queue_due_idx on public.storage_gc_queue(not_before,attempts);

create or replace function public.queue_detached_storage_object()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare v_bucket text := TG_ARGV[0];
begin
  if old.storage_path is null then return coalesce(new,old); end if;
  if TG_OP='UPDATE' and new.storage_path is not distinct from old.storage_path then return new; end if;
  insert into public.storage_gc_queue(bucket,storage_path,queued_at,not_before,attempts,last_error)
  values(v_bucket,old.storage_path,now(),now()+interval '1 hour',0,null)
  on conflict(bucket,storage_path) do update
    set queued_at=excluded.queued_at,not_before=excluded.not_before,attempts=0,last_error=null;
  return coalesce(new,old);
end $$;

revoke all on function public.queue_detached_storage_object() from public,anon,authenticated;

drop trigger if exists pet_photos_storage_gc on public.pet_photos;
create trigger pet_photos_storage_gc after update of storage_path or delete on public.pet_photos
for each row execute function public.queue_detached_storage_object('pet-photos');

drop trigger if exists post_media_storage_gc on public.post_media;
create trigger post_media_storage_gc after update of storage_path or delete on public.post_media
for each row execute function public.queue_detached_storage_object('social-media');

drop trigger if exists stories_storage_gc on public.stories;
create trigger stories_storage_gc after update of storage_path or delete on public.stories
for each row execute function public.queue_detached_storage_object('social-media');

drop trigger if exists health_documents_storage_gc on public.health_documents;
create trigger health_documents_storage_gc after update of storage_path or delete on public.health_documents
for each row execute function public.queue_detached_storage_object('health-documents');

comment on table public.storage_gc_queue is 'Private delayed deletion queue for storage objects detached from application records.';
