-- Tailmance v19 R8: make Standard daily product quotas operator-configurable without mid-window surprises.
-- Defaults remain 50 discovery swipes + 3 newly initiated conversations per local day.
-- Config changes apply to the next quota window; an active user's limits are frozen until reset_at.

alter table public.app_runtime_config
  add column if not exists standard_daily_swipe_limit integer not null default 50,
  add column if not exists standard_daily_new_conversation_limit integer not null default 3;

alter table public.app_runtime_config drop constraint if exists app_runtime_config_standard_daily_swipe_limit_check;
alter table public.app_runtime_config add constraint app_runtime_config_standard_daily_swipe_limit_check
  check (standard_daily_swipe_limit between 1 and 500) not valid;
alter table public.app_runtime_config validate constraint app_runtime_config_standard_daily_swipe_limit_check;

alter table public.app_runtime_config drop constraint if exists app_runtime_config_standard_daily_new_conversation_limit_check;
alter table public.app_runtime_config add constraint app_runtime_config_standard_daily_new_conversation_limit_check
  check (standard_daily_new_conversation_limit between 1 and 50) not valid;
alter table public.app_runtime_config validate constraint app_runtime_config_standard_daily_new_conversation_limit_check;

-- Migration 196 used fixed upper-bound checks. Remove those bounds before allowing a future
-- operator-configured value above the launch defaults, while preserving non-negative counters.
alter table public.daily_product_quotas drop constraint if exists daily_product_quotas_swipes_used_check;
alter table public.daily_product_quotas drop constraint if exists daily_product_quotas_conversations_started_check;
alter table public.daily_product_quotas
  add column if not exists swipe_limit integer not null default 50,
  add column if not exists conversation_limit integer not null default 3;

alter table public.daily_product_quotas drop constraint if exists daily_product_quotas_swipes_used_nonnegative_check;
alter table public.daily_product_quotas add constraint daily_product_quotas_swipes_used_nonnegative_check
  check (swipes_used>=0) not valid;
alter table public.daily_product_quotas validate constraint daily_product_quotas_swipes_used_nonnegative_check;
alter table public.daily_product_quotas drop constraint if exists daily_product_quotas_conversations_started_nonnegative_check;
alter table public.daily_product_quotas add constraint daily_product_quotas_conversations_started_nonnegative_check
  check (conversations_started>=0) not valid;
alter table public.daily_product_quotas validate constraint daily_product_quotas_conversations_started_nonnegative_check;
alter table public.daily_product_quotas drop constraint if exists daily_product_quotas_swipe_limit_check;
alter table public.daily_product_quotas add constraint daily_product_quotas_swipe_limit_check
  check (swipe_limit between 1 and 500) not valid;
alter table public.daily_product_quotas validate constraint daily_product_quotas_swipe_limit_check;
alter table public.daily_product_quotas drop constraint if exists daily_product_quotas_conversation_limit_check;
alter table public.daily_product_quotas add constraint daily_product_quotas_conversation_limit_check
  check (conversation_limit between 1 and 50) not valid;
alter table public.daily_product_quotas validate constraint daily_product_quotas_conversation_limit_check;

comment on column public.daily_product_quotas.swipe_limit is
  'Standard swipe limit frozen for this quota window. Operator changes apply on the next local-day window.';
comment on column public.daily_product_quotas.conversation_limit is
  'Standard new-conversation limit frozen for this quota window. Operator changes apply on the next local-day window.';

create or replace function public.current_user_daily_product_quota_status()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_tier public.account_tier;
  v_preferred_timezone text;
  v_timezone text;
  v_local_date date;
  v_reset_at timestamptz;
  v_swipes integer:=0;
  v_conversations integer:=0;
  v_swipe_limit integer:=50;
  v_conversation_limit integer:=3;
  v_existing public.daily_product_quotas%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform public.require_active_authenticated_session();
  select u.tier,coalesce(nullif(trim(u.notification_preferences->>'timeZone'),''),'UTC')
    into v_tier,v_preferred_timezone from public.users u where u.id=v_uid;
  if v_tier is null then raise exception 'account_not_found'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names z where z.name=v_preferred_timezone) then v_preferred_timezone:='UTC'; end if;

  select * into v_existing from public.daily_product_quotas q where q.user_id=v_uid;
  if v_existing.user_id is not null and v_existing.reset_at>now() then
    v_timezone:=v_existing.time_zone;
    v_local_date:=v_existing.local_date;
    v_reset_at:=v_existing.reset_at;
    v_swipes:=v_existing.swipes_used;
    v_conversations:=v_existing.conversations_started;
    v_swipe_limit:=v_existing.swipe_limit;
    v_conversation_limit:=v_existing.conversation_limit;
  else
    v_timezone:=v_preferred_timezone;
    v_local_date:=(now() at time zone v_timezone)::date;
    v_reset_at:=((v_local_date+1)::timestamp at time zone v_timezone);
    select c.standard_daily_swipe_limit,c.standard_daily_new_conversation_limit
      into v_swipe_limit,v_conversation_limit
      from public.app_runtime_config c where c.singleton=true;
    v_swipe_limit:=coalesce(v_swipe_limit,50);
    v_conversation_limit:=coalesce(v_conversation_limit,3);
  end if;

  return jsonb_build_object(
    'tier',v_tier,
    'swipeLimit',case when v_tier='premium' then null else v_swipe_limit end,
    'newConversationLimit',case when v_tier='premium' then null else v_conversation_limit end,
    'swipesRemaining',case when v_tier='premium' then null else greatest(v_swipe_limit-v_swipes,0) end,
    'newConversationsRemaining',case when v_tier='premium' then null else greatest(v_conversation_limit-v_conversations,0) end,
    'resetAt',v_reset_at,
    'timeZone',v_timezone
  );
end $$;
revoke all on function public.current_user_daily_product_quota_status() from public,anon;
grant execute on function public.current_user_daily_product_quota_status() to authenticated;

create or replace function public.consume_standard_daily_product_quota(p_kind text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_tier public.account_tier;
  v_preferred_timezone text;
  v_timezone text;
  v_local_date date;
  v_window_started_at timestamptz;
  v_reset_at timestamptz;
  v_swipes integer:=0;
  v_conversations integer:=0;
  v_swipe_limit integer:=50;
  v_conversation_limit integer:=3;
  v_existing public.daily_product_quotas%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform public.require_active_authenticated_session();
  if p_kind not in ('swipe','conversation') then raise exception 'invalid_quota_kind'; end if;

  select u.tier,coalesce(nullif(trim(u.notification_preferences->>'timeZone'),''),'UTC')
    into v_tier,v_preferred_timezone from public.users u where u.id=v_uid for update;
  if v_tier is null then raise exception 'account_not_found'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names z where z.name=v_preferred_timezone) then v_preferred_timezone:='UTC'; end if;

  select * into v_existing from public.daily_product_quotas q where q.user_id=v_uid for update;
  if v_existing.user_id is not null and v_existing.reset_at>now() then
    v_timezone:=v_existing.time_zone;
    v_local_date:=v_existing.local_date;
    v_window_started_at:=v_existing.window_started_at;
    v_reset_at:=v_existing.reset_at;
    v_swipes:=v_existing.swipes_used;
    v_conversations:=v_existing.conversations_started;
    v_swipe_limit:=v_existing.swipe_limit;
    v_conversation_limit:=v_existing.conversation_limit;
  else
    v_timezone:=v_preferred_timezone;
    v_local_date:=(now() at time zone v_timezone)::date;
    v_window_started_at:=now();
    v_reset_at:=((v_local_date+1)::timestamp at time zone v_timezone);
    select c.standard_daily_swipe_limit,c.standard_daily_new_conversation_limit
      into v_swipe_limit,v_conversation_limit
      from public.app_runtime_config c where c.singleton=true;
    v_swipe_limit:=coalesce(v_swipe_limit,50);
    v_conversation_limit:=coalesce(v_conversation_limit,3);
    v_swipes:=0;
    v_conversations:=0;
  end if;

  if v_tier='premium' then
    return jsonb_build_object('tier',v_tier,'swipeLimit',null,'newConversationLimit',null,'swipesRemaining',null,'newConversationsRemaining',null,'resetAt',v_reset_at,'timeZone',v_timezone);
  end if;

  if p_kind='swipe' then
    if v_swipes>=v_swipe_limit then raise exception 'daily_swipe_quota_reached'; end if;
    v_swipes:=v_swipes+1;
  else
    if v_conversations>=v_conversation_limit then raise exception 'daily_new_conversation_quota_reached'; end if;
    v_conversations:=v_conversations+1;
  end if;

  insert into public.daily_product_quotas(user_id,local_date,time_zone,window_started_at,reset_at,swipes_used,conversations_started,swipe_limit,conversation_limit,updated_at)
  values(v_uid,v_local_date,v_timezone,v_window_started_at,v_reset_at,v_swipes,v_conversations,v_swipe_limit,v_conversation_limit,now())
  on conflict(user_id) do update set
    local_date=excluded.local_date,
    time_zone=excluded.time_zone,
    window_started_at=excluded.window_started_at,
    reset_at=excluded.reset_at,
    swipes_used=excluded.swipes_used,
    conversations_started=excluded.conversations_started,
    swipe_limit=excluded.swipe_limit,
    conversation_limit=excluded.conversation_limit,
    updated_at=now();

  return jsonb_build_object(
    'tier',v_tier,
    'swipeLimit',v_swipe_limit,
    'newConversationLimit',v_conversation_limit,
    'swipesRemaining',greatest(v_swipe_limit-v_swipes,0),
    'newConversationsRemaining',greatest(v_conversation_limit-v_conversations,0),
    'resetAt',v_reset_at,
    'timeZone',v_timezone
  );
end $$;
revoke all on function public.consume_standard_daily_product_quota(text) from public,anon,authenticated;

-- Public runtime config may expose quota limits because they are product policy, never secrets.
create or replace function public.get_runtime_config()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'maintenanceMode',maintenance_mode,
    'minimumSupportedVersion',minimum_supported_version,
    'latestVersion',latest_version,
    'minimumSupportedVersions',jsonb_build_object(
      'ios',coalesce(minimum_supported_version_ios,minimum_supported_version),
      'android',coalesce(minimum_supported_version_android,minimum_supported_version)
    ),
    'latestVersions',jsonb_build_object(
      'ios',coalesce(latest_version_ios,latest_version),
      'android',coalesce(latest_version_android,latest_version)
    ),
    'features',features,
    'productLimits',jsonb_build_object(
      'standardDailySwipeLimit',standard_daily_swipe_limit,
      'standardDailyNewConversationLimit',standard_daily_new_conversation_limit
    ),
    'message',message,
    'messages',messages
  )
  from public.app_runtime_config where singleton=true;
$$;
revoke all on function public.get_runtime_config() from public;
grant execute on function public.get_runtime_config() to anon,authenticated;

create or replace function public.get_product_feature_policy()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_swipe_limit integer:=50;
  v_conversation_limit integer:=3;
begin
  perform public.require_active_authenticated_session();
  select c.standard_daily_swipe_limit,c.standard_daily_new_conversation_limit
    into v_swipe_limit,v_conversation_limit
    from public.app_runtime_config c where c.singleton=true;
  v_swipe_limit:=coalesce(v_swipe_limit,50);
  v_conversation_limit:=coalesce(v_conversation_limit,3);
  return jsonb_build_object(
    'matingOwnerArrangedEnabled',public.current_mating_feature_enabled(),
    'matingOwnerDecisionOnly',true,'matingBrokerageEnabled',false,'matingTransactionEnabled',false,'matingCommerceEnabled',false,
    'petSalesEnabled',false,'commercialBreedingEnabled',false,'petCommerceMarketplaceEnabled',false,'adoptionMarketplaceEnabled',false,
    'dataSaleEnabled',false,'dataSalesEnabled',false,'aggressiveAdsEnabled',false,
    'catsInDiscovery',false,'catsFeedOnly',true,'dogDiscoveryOnly',true,'localFeedDefault',true,
    'premiumEventCreation',true,'lostPetAlertsFree',true,'safetyFeaturesFree',true,
    'multiplePetsPremium',true,'advancedFiltersPremium',true,'travelModePremium',true,
    'boostsEnabled',true,'consumablePacksEnabled',true,'contextualAdsOnly',true,
    'premiumMultiplePets',true,'premiumAdvancedFilters',true,'premiumTravelMode',true,
    'premiumUnlimitedLikes',true,'premiumLikesYou',true,'premiumIncognito',true,'premiumEventHosting',true,
    'standardPremiumReplyCourtesy',true,'consumableBoosts',true,'consumableSuperLikes',true,
    'standardDailySwipeLimit',v_swipe_limit,'standardDailyNewConversationLimit',v_conversation_limit,'dailyQuotaUsesLocalMidnight',true,
    'contextualBusinessPromotionsOnly',true,'contextualBusinessPromotionsEnabled',public.current_paid_promotion_visibility_enabled(),
    'petFirstNoHumanDating',true,'petFriendlyPlacesEnabled',true,'lostPetProximityAlertsEnabled',true,'safeMeetupSharingEnabled',true,
    'healthTrackingEnabled',true,'aiVeterinaryDiagnosisEnabled',false,'socialShareEnabled',true,'socialShareBranding','Tailmance',
    'pilotCity','Istanbul','pilotNeighborhoods',jsonb_build_array('Moda','Fenerbahçe','Caddebostan'),
    'localDensityTargetMin',300,'localDensityTargetMax',500,'referralMilestone',40,
    'consumerPriceReviewCadenceDays',90,'consumerPriceAuthority','store_localized',
    'businessPartnerMonthlyPlans',true,'eventTicketCommissionAttribution',true,
    'insuranceAffiliateEnabled',false,'commerceAffiliateEnabled',false,'sitterMarketplaceEnabled',false
  );
end $$;
revoke all on function public.get_product_feature_policy() from public,anon;
grant execute on function public.get_product_feature_policy() to authenticated;
