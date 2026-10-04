-- Tailmance v19 R8: privacy-minimal client frame telemetry.
-- Stores only bounded aggregate frame-window metrics. No user_id, pet_id, route params,
-- URLs, device identifiers, message content, coordinates, or raw stack/error content.

create table if not exists public.client_performance_events (
  id uuid primary key default gen_random_uuid(),
  metric text not null check (metric='js_frame_window'),
  surface text not null check (surface in ('app_foreground')),
  app_version text not null check (char_length(app_version) between 1 and 32),
  platform text not null check (platform in ('ios','android')),
  average_fps numeric(6,2) not null check (average_fps between 0 and 240),
  slow_frame_rate numeric(7,6) not null check (slow_frame_rate between 0 and 1),
  frozen_frame_rate numeric(7,6) not null check (frozen_frame_rate between 0 and 1),
  frame_count integer not null check (frame_count between 2 and 5000),
  sample_duration_ms integer not null check (sample_duration_ms between 1000 and 30000),
  occurred_at timestamptz not null default now()
);

alter table public.client_performance_events enable row level security;
revoke all on table public.client_performance_events from public,anon,authenticated;
create index if not exists client_performance_events_occurred_idx
  on public.client_performance_events(occurred_at desc);
create index if not exists client_performance_events_platform_version_idx
  on public.client_performance_events(platform,app_version,occurred_at desc);

create or replace function public.record_client_performance(
  p_metric text,
  p_surface text,
  p_app_version text,
  p_platform text,
  p_average_fps numeric,
  p_slow_frame_rate numeric,
  p_frozen_frame_rate numeric,
  p_frame_count integer,
  p_sample_duration_ms integer
)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  perform public.require_active_authenticated_session();
  if auth.uid() is null then return; end if;
  if p_metric <> 'js_frame_window' then raise exception 'invalid_performance_metric'; end if;
  if p_surface <> 'app_foreground' then raise exception 'invalid_performance_surface'; end if;
  if p_app_version is null or char_length(trim(p_app_version)) not between 1 and 32 then raise exception 'invalid_app_version'; end if;
  if p_platform not in ('ios','android') then raise exception 'invalid_platform'; end if;
  if p_average_fps is null or p_average_fps < 0 or p_average_fps > 240 then raise exception 'invalid_average_fps'; end if;
  if p_slow_frame_rate is null or p_slow_frame_rate < 0 or p_slow_frame_rate > 1 then raise exception 'invalid_slow_frame_rate'; end if;
  if p_frozen_frame_rate is null or p_frozen_frame_rate < 0 or p_frozen_frame_rate > 1 then raise exception 'invalid_frozen_frame_rate'; end if;
  if p_frame_count is null or p_frame_count not between 2 and 5000 then raise exception 'invalid_frame_count'; end if;
  if p_sample_duration_ms is null or p_sample_duration_ms not between 1000 and 30000 then raise exception 'invalid_sample_duration'; end if;

  perform public.rate_limit('client_performance_telemetry',12,3600);
  insert into public.client_performance_events(
    metric,surface,app_version,platform,average_fps,slow_frame_rate,
    frozen_frame_rate,frame_count,sample_duration_ms
  ) values (
    p_metric,p_surface,trim(p_app_version),p_platform,
    round(p_average_fps,2),round(p_slow_frame_rate,6),round(p_frozen_frame_rate,6),
    p_frame_count,p_sample_duration_ms
  );

  delete from public.client_performance_events
   where occurred_at < now()-interval '14 days';
end $$;

revoke all on function public.record_client_performance(text,text,text,text,numeric,numeric,numeric,integer,integer) from public,anon;
grant execute on function public.record_client_performance(text,text,text,text,numeric,numeric,numeric,integer,integer) to authenticated;
