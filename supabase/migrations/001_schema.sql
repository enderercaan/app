-- Tailmance production schema
-- Public social identity is always a pet. Human accounts are private authorization/billing records.

create extension if not exists pgcrypto;

create type public.pet_species as enum ('dog','cat');
create type public.pet_sex as enum ('female','male');
create type public.pet_size as enum ('mini','small','medium','large','giant');
create type public.pet_purpose as enum ('socialize','playmate','mating','walk');
create type public.account_tier as enum ('standard','premium');
create type public.vaccination_status as enum ('complete','incomplete','unknown');
create type public.verification_state as enum ('pending','verified','rejected');
create type public.moderation_state as enum ('pending','approved','rejected');
create type public.like_kind as enum ('like','super_like');
create type public.event_attendance_status as enum ('going','interested');
create type public.notification_type as enum ('match','message','like','follow','comment','event','health','system');

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  tier public.account_tier not null default 'standard',
  free_messages_sent integer not null default 0 check (free_messages_sent between 0 and 2),
  age_18_confirmed boolean not null default false,
  legal_version text,
  discoverable boolean not null default true,
  incognito boolean not null default false,
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 50),
  species public.pet_species not null,
  breed text not null check (char_length(trim(breed)) between 1 and 80),
  sex public.pet_sex not null,
  birth_date date,
  size public.pet_size not null,
  weight_kg numeric(5,2) check (weight_kg is null or weight_kg > 0),
  energy_level smallint check (energy_level between 1 and 5),
  temperament_tags text[] not null default '{}',
  bio text not null default '' check (char_length(bio) <= 500),
  city text not null check (char_length(trim(city)) between 1 and 80),
  district text not null check (char_length(trim(district)) between 1 and 80),
  neighborhood text,
  profile_verified boolean not null default false,
  discovery_enabled boolean not null default true,
  moderation_status public.moderation_state not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (birth_date is null or birth_date <= current_date)
);

-- Highly sensitive data lives outside the public pet row.
create table public.pet_private (
  pet_id uuid primary key references public.pets(id) on delete cascade,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  microchip_number text,
  exact_address text,
  updated_at timestamptz not null default now()
);

create table public.pet_health_summary (
  pet_id uuid primary key references public.pets(id) on delete cascade,
  vaccination_status public.vaccination_status not null default 'unknown',
  veterinarian_verified boolean not null default false,
  neutered boolean,
  microchip_verified boolean not null default false,
  genetic_screening_available boolean not null default false,
  pedigree_available boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.pet_photos (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  storage_path text not null,
  sort_order smallint not null check (sort_order between 1 and 3),
  moderation_status public.moderation_state not null default 'pending',
  moderation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pet_id, sort_order),
  unique (storage_path)
);

create table public.pet_purposes (
  pet_id uuid not null references public.pets(id) on delete cascade,
  purpose public.pet_purpose not null,
  primary key (pet_id, purpose)
);

create table public.pet_vaccinations (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  vaccine_name text not null check (char_length(trim(vaccine_name)) between 1 and 120),
  dose_date date,
  next_due_date date,
  verification_status public.verification_state not null default 'pending',
  verification_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (next_due_date is null or dose_date is null or next_due_date >= dose_date)
);

create table public.health_documents (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  document_type text not null check (char_length(trim(document_type)) between 1 and 80),
  storage_path text not null unique,
  verification_status public.verification_state not null default 'pending',
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.pet_likes (
  from_pet_id uuid not null references public.pets(id) on delete cascade,
  to_pet_id uuid not null references public.pets(id) on delete cascade,
  kind public.like_kind not null default 'like',
  created_at timestamptz not null default now(),
  primary key (from_pet_id,to_pet_id),
  check (from_pet_id <> to_pet_id)
);

create table public.pet_passes (
  from_pet_id uuid not null references public.pets(id) on delete cascade,
  to_pet_id uuid not null references public.pets(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (from_pet_id,to_pet_id),
  check (from_pet_id <> to_pet_id)
);

create table public.pet_favorites (
  from_pet_id uuid not null references public.pets(id) on delete cascade,
  to_pet_id uuid not null references public.pets(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (from_pet_id,to_pet_id),
  check (from_pet_id <> to_pet_id)
);

create table public.pet_matches (
  id uuid primary key default gen_random_uuid(),
  pet_low_id uuid not null references public.pets(id) on delete cascade,
  pet_high_id uuid not null references public.pets(id) on delete cascade,
  matched_at timestamptz not null default now(),
  unmatched_at timestamptz,
  unmatched_by_pet_id uuid references public.pets(id) on delete set null,
  unique (pet_low_id,pet_high_id),
  check (pet_low_id < pet_high_id)
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null unique references public.pet_matches(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_pet_id uuid not null references public.pets(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table public.blocks (
  blocker_pet_id uuid not null references public.pets(id) on delete cascade,
  blocked_pet_id uuid not null references public.pets(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_pet_id,blocked_pet_id),
  check (blocker_pet_id <> blocked_pet_id)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references public.users(id) on delete cascade,
  reporter_pet_id uuid references public.pets(id) on delete set null,
  target_type text not null check (target_type in ('pet','post','comment','message','story','event')),
  target_id uuid not null,
  reason text not null check (char_length(trim(reason)) between 1 and 100),
  details text check (details is null or char_length(details) <= 2000),
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  created_at timestamptz not null default now()
);

create table public.follows (
  from_pet_id uuid not null references public.pets(id) on delete cascade,
  to_pet_id uuid not null references public.pets(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (from_pet_id,to_pet_id),
  check (from_pet_id <> to_pet_id)
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  caption text not null default '' check (char_length(caption) <= 2200),
  moderation_status public.moderation_state not null default 'pending',
  moderation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  storage_path text not null unique,
  sort_order smallint not null default 1 check (sort_order between 1 and 10),
  moderation_status public.moderation_state not null default 'pending',
  created_at timestamptz not null default now(),
  unique (post_id,sort_order)
);

create table public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id,pet_id)
);

create table public.saved_posts (
  post_id uuid not null references public.posts(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id,pet_id)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  moderation_status public.moderation_state not null default 'pending',
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.stories (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  storage_path text not null unique,
  moderation_status public.moderation_state not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  check (expires_at > created_at)
);

create table public.story_views (
  story_id uuid not null references public.stories(id) on delete cascade,
  viewer_pet_id uuid not null references public.pets(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id,viewer_pet_id)
);

create table public.pet_events (
  id uuid primary key default gen_random_uuid(),
  creator_pet_id uuid not null references public.pets(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 3 and 120),
  description text not null default '' check (char_length(description) <= 1500),
  city text not null,
  district text not null,
  neighborhood text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  capacity integer check (capacity is null or capacity between 2 and 500),
  moderation_status public.moderation_state not null default 'pending',
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create table public.event_attendees (
  event_id uuid not null references public.pet_events(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  status public.event_attendance_status not null,
  created_at timestamptz not null default now(),
  primary key (event_id,pet_id)
);

create table public.meetup_requests (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.pet_matches(id) on delete cascade,
  proposed_by_pet_id uuid not null references public.pets(id) on delete cascade,
  starts_at timestamptz not null,
  public_place_label text not null check (char_length(trim(public_place_label)) between 2 and 160),
  note text check (note is null or char_length(note) <= 500),
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type public.notification_type not null,
  title text not null,
  body text not null,
  entity_id uuid,
  read_at timestamptz,
  push_status text not null default 'pending' check (push_status in ('pending','sent','failed','skipped')),
  push_attempts smallint not null default 0,
  next_push_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('ios','android')),
  active_pet_id uuid references public.pets(id) on delete set null,
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  platform text not null check (platform in ('apple','google')),
  product_id text not null,
  entitlement_id text not null default 'premium',
  store_transaction_id text,
  status text not null,
  current_period_end timestamptz,
  will_renew boolean,
  raw_event_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.moderation_items (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('pet_photo','post_media','story','pet_text','post_text','comment_text','event_text','health_document')),
  target_id uuid not null,
  status public.moderation_state not null default 'pending',
  provider text,
  provider_reference text,
  reason text,
  score jsonb,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(target_type,target_id)
);

create table public.rate_limits (
  user_id uuid not null references public.users(id) on delete cascade,
  action text not null,
  window_start timestamptz not null,
  count integer not null default 1,
  primary key (user_id,action,window_start)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  user_id uuid,
  pet_id uuid,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index pets_discovery_idx on public.pets(species,sex,size,city,district,moderation_status,discovery_enabled);
create index pets_owner_idx on public.pets(owner_id,created_at desc);
create index pet_photos_pet_idx on public.pet_photos(pet_id,sort_order);
create index vaccinations_pet_due_idx on public.pet_vaccinations(pet_id,next_due_date);
create index likes_to_idx on public.pet_likes(to_pet_id,created_at desc);
create index matches_low_idx on public.pet_matches(pet_low_id,matched_at desc) where unmatched_at is null;
create index matches_high_idx on public.pet_matches(pet_high_id,matched_at desc) where unmatched_at is null;
create index messages_conversation_idx on public.messages(conversation_id,created_at desc);
create index posts_pet_idx on public.posts(pet_id,created_at desc) where deleted_at is null;
create index posts_feed_idx on public.posts(moderation_status,created_at desc) where deleted_at is null;
create index comments_post_idx on public.comments(post_id,created_at) where deleted_at is null;
create index stories_active_idx on public.stories(expires_at desc) where moderation_status='approved';
create index events_time_idx on public.pet_events(starts_at,city,district) where moderation_status='approved';
create index notifications_user_idx on public.notifications(user_id,created_at desc);
create index notifications_push_idx on public.notifications(push_status,next_push_attempt_at) where push_status in ('pending','failed');
create index reports_open_idx on public.reports(status,created_at) where status in ('open','reviewing');
create index moderation_queue_idx on public.moderation_items(status,created_at) where status='pending';

-- Buckets are private by default. Signed URLs or authenticated functions should be used for sensitive content.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values
  ('pet-photos','pet-photos',false,10485760,array['image/jpeg','image/png','image/webp']),
  ('social-media','social-media',false,15728640,array['image/jpeg','image/png','image/webp']),
  ('health-documents','health-documents',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
