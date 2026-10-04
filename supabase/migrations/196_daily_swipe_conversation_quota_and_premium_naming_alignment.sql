-- Tailmance v19 R8: align the product contract with server-authoritative daily quotas.
-- Standard: 50 discovery swipes per local day and 3 newly initiated conversations per local day.
-- Premium: no product quota, while high anti-abuse rate limits remain in force.
-- A conversation becomes permanently unlocked only when Premium sends the first message.

create table if not exists public.daily_product_quotas (
  user_id uuid primary key references public.users(id) on delete cascade,
  local_date date not null,
  time_zone text not null,
  window_started_at timestamptz not null,
  reset_at timestamptz not null,
  swipes_used integer not null default 0 check (swipes_used between 0 and 50),
  conversations_started integer not null default 0 check (conversations_started between 0 and 3),
  updated_at timestamptz not null default now(),
  check (reset_at>window_started_at)
);

alter table public.daily_product_quotas enable row level security;
revoke all on public.daily_product_quotas from public,anon,authenticated;
grant all on public.daily_product_quotas to service_role;
comment on table public.daily_product_quotas is
  'One active product-quota window per owner. The window timezone is frozen until reset_at so changing preferences cannot create an early quota reset.';

alter table public.conversations add column if not exists is_unlocked boolean not null default false;
alter table public.conversations add column if not exists unlocked_by uuid references public.users(id) on delete set null;
alter table public.conversations add column if not exists initiated_by uuid references public.users(id) on delete set null;
alter table public.conversations add column if not exists initiated_at timestamptz;

-- Preserve all established conversations. Premium-first historical conversations are marked unlocked;
-- Standard-first historical conversations remain usable because initiation has already occurred.
with first_message as (
  select distinct on (m.conversation_id)
    m.conversation_id,
    p.owner_id as user_id,
    u.tier,
    m.created_at
  from public.messages m
  join public.pets p on p.id=m.sender_pet_id
  join public.users u on u.id=p.owner_id
  order by m.conversation_id,m.created_at,m.id
)
update public.conversations c
set initiated_by=f.user_id,
    initiated_at=f.created_at,
    is_unlocked=(f.tier='premium'),
    unlocked_by=case when f.tier='premium' then f.user_id else null end
from first_message f
where c.id=f.conversation_id and c.initiated_at is null;

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
  else
    v_timezone:=v_preferred_timezone;
    v_local_date:=(now() at time zone v_timezone)::date;
    v_reset_at:=((v_local_date+1)::timestamp at time zone v_timezone);
  end if;

  return jsonb_build_object(
    'tier',v_tier,
    'swipesRemaining',case when v_tier='premium' then null else greatest(50-v_swipes,0) end,
    'newConversationsRemaining',case when v_tier='premium' then null else greatest(3-v_conversations,0) end,
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
  else
    v_timezone:=v_preferred_timezone;
    v_local_date:=(now() at time zone v_timezone)::date;
    v_window_started_at:=now();
    v_reset_at:=((v_local_date+1)::timestamp at time zone v_timezone);
    v_swipes:=0;
    v_conversations:=0;
  end if;

  if v_tier='premium' then
    return jsonb_build_object('tier',v_tier,'swipesRemaining',null,'newConversationsRemaining',null,'resetAt',v_reset_at,'timeZone',v_timezone);
  end if;

  if p_kind='swipe' then
    if v_swipes>=50 then raise exception 'daily_swipe_quota_reached'; end if;
    v_swipes:=v_swipes+1;
  else
    if v_conversations>=3 then raise exception 'daily_new_conversation_quota_reached'; end if;
    v_conversations:=v_conversations+1;
  end if;

  insert into public.daily_product_quotas(user_id,local_date,time_zone,window_started_at,reset_at,swipes_used,conversations_started,updated_at)
  values(v_uid,v_local_date,v_timezone,v_window_started_at,v_reset_at,v_swipes,v_conversations,now())
  on conflict(user_id) do update set
    local_date=excluded.local_date,
    time_zone=excluded.time_zone,
    window_started_at=excluded.window_started_at,
    reset_at=excluded.reset_at,
    swipes_used=excluded.swipes_used,
    conversations_started=excluded.conversations_started,
    updated_at=now();

  return jsonb_build_object(
    'tier',v_tier,
    'swipesRemaining',greatest(50-v_swipes,0),
    'newConversationsRemaining',greatest(3-v_conversations,0),
    'resetAt',v_reset_at,
    'timeZone',v_timezone
  );
end $$;
revoke all on function public.consume_standard_daily_product_quota(text) from public,anon,authenticated;

create or replace function public.get_conversation_message_entitlement(p_conversation_id uuid,p_sender_pet_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_match public.pet_matches;
  v_conversation public.conversations;
  v_other_pet uuid;
  v_tier public.account_tier;
  v_other_tier public.account_tier;
  v_quota jsonb;
  v_courtesy boolean:=false;
  v_can_send boolean:=false;
begin
  if not public.owns_pet(p_sender_pet_id) then raise exception 'forbidden'; end if;
  select * into v_conversation from public.conversations c where c.id=p_conversation_id;
  if v_conversation.id is not null then select * into v_match from public.pet_matches m where m.id=v_conversation.match_id; end if;
  if v_match.id is null or v_match.unmatched_at is not null or p_sender_pet_id not in(v_match.pet_low_id,v_match.pet_high_id) then raise exception 'active_match_required'; end if;
  v_other_pet:=case when p_sender_pet_id=v_match.pet_low_id then v_match.pet_high_id else v_match.pet_low_id end;
  select u.tier into v_tier from public.users u where u.id=auth.uid();
  select u.tier into v_other_tier from public.pets p join public.users u on u.id=p.owner_id where p.id=v_other_pet;
  v_quota:=public.current_user_daily_product_quota_status();
  v_courtesy:=v_tier='standard' and v_conversation.is_unlocked and v_conversation.unlocked_by is not null and v_conversation.unlocked_by<>auth.uid();
  v_can_send:=v_tier='premium' or v_conversation.initiated_at is not null or coalesce((v_quota->>'newConversationsRemaining')::integer,0)>0;
  return jsonb_build_object(
    'tier',v_tier,
    'otherTier',v_other_tier,
    'newConversationsRemaining',v_quota->'newConversationsRemaining',
    'resetAt',v_quota->>'resetAt',
    'timeZone',v_quota->>'timeZone',
    'conversationInitiated',v_conversation.initiated_at is not null,
    'conversationUnlocked',v_conversation.is_unlocked,
    'premiumReplyCourtesy',v_courtesy,
    'canSend',v_can_send
  );
end $$;
revoke all on function public.get_conversation_message_entitlement(uuid,uuid) from public,anon;
grant execute on function public.get_conversation_message_entitlement(uuid,uuid) to authenticated;

create or replace function public.send_message(p_conversation_id uuid,p_sender_pet_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_match public.pet_matches;
  v_conversation public.conversations;
  v_uid uuid:=auth.uid();
  v_msg public.messages;
  v_other_pet uuid;
  v_tier public.account_tier;
  v_other_tier public.account_tier;
  v_body text:=trim(coalesce(p_body,''));
  v_courtesy boolean:=false;
begin
  if not public.owns_pet(p_sender_pet_id) then raise exception 'forbidden'; end if;
  if char_length(v_body) not between 1 and 2000 then raise exception 'invalid_message'; end if;
  perform public.rate_limit('message',60,60);
  select * into v_conversation from public.conversations c where c.id=p_conversation_id for update;
  if v_conversation.id is not null then select * into v_match from public.pet_matches m where m.id=v_conversation.match_id; end if;
  if v_match.id is null or v_match.unmatched_at is not null or p_sender_pet_id not in(v_match.pet_low_id,v_match.pet_high_id) then raise exception 'active_match_required'; end if;
  v_other_pet:=case when p_sender_pet_id=v_match.pet_low_id then v_match.pet_high_id else v_match.pet_low_id end;
  if public.is_blocked(p_sender_pet_id,v_other_pet) then raise exception 'blocked'; end if;
  if not exists(select 1 from public.pets p join public.users u on u.id=p.owner_id where p.id=v_other_pet and u.suspended_at is null and u.paused_at is null) then raise exception 'recipient_unavailable'; end if;
  select tier into v_tier from public.users where id=v_uid for update;
  select u.tier into v_other_tier from public.pets p join public.users u on u.id=p.owner_id where p.id=v_other_pet;

  if v_conversation.initiated_at is null then
    if v_tier='standard' then perform public.consume_standard_daily_product_quota('conversation'); end if;
    update public.conversations
      set initiated_by=v_uid,initiated_at=now(),is_unlocked=(v_tier='premium'),unlocked_by=case when v_tier='premium' then v_uid else null end
      where id=p_conversation_id;
    v_conversation.initiated_by:=v_uid;
    v_conversation.initiated_at:=now();
    v_conversation.is_unlocked:=v_tier='premium';
    v_conversation.unlocked_by:=case when v_tier='premium' then v_uid else null end;
  end if;
  v_courtesy:=v_tier='standard' and v_conversation.is_unlocked and v_conversation.unlocked_by is not null and v_conversation.unlocked_by<>v_uid;

  insert into public.messages(conversation_id,sender_pet_id,body,moderation_status)
  values(p_conversation_id,p_sender_pet_id,v_body,'pending') returning * into v_msg;
  insert into public.moderation_items(target_type,target_id,status)
  values('message_text',v_msg.id,'pending')
  on conflict(target_type,target_id) do update set status='pending',reason=null,reviewed_at=null,provider=null,score=null,next_attempt_at=now(),manual_review_required=false;
  return jsonb_build_object(
    'id',v_msg.id,'conversationId',v_msg.conversation_id,'senderPetId',v_msg.sender_pet_id,'body',v_msg.body,
    'createdAt',v_msg.created_at,'readAt',v_msg.read_at,'moderationStatus',v_msg.moderation_status,'premiumReplyCourtesy',v_courtesy
  );
end $$;
revoke all on function public.send_message(uuid,uuid,text) from public,anon,authenticated;
-- Only the retry-safe wrapper remains callable by authenticated clients.

create or replace function public.pass_pet(p_from_pet_id uuid,p_to_pet_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_tier public.account_tier;
begin
  if not public.owns_pet(p_from_pet_id) or p_from_pet_id=p_to_pet_id or public.is_blocked(p_from_pet_id,p_to_pet_id) then raise exception 'forbidden'; end if;
  if not exists(
    select 1 from public.pets target join public.users target_user on target_user.id=target.owner_id
    where target.id=p_to_pet_id and target.owner_id<>auth.uid() and target_user.suspended_at is null and target_user.paused_at is null
  ) then raise exception 'target_unavailable'; end if;
  select tier into v_tier from public.users where id=auth.uid();
  if v_tier='standard' then perform public.consume_standard_daily_product_quota('swipe'); end if;
  perform public.rate_limit('pass_abuse_guard',5000,86400);
  insert into public.pet_passes(from_pet_id,to_pet_id) values(p_from_pet_id,p_to_pet_id)
  on conflict(from_pet_id,to_pet_id) do update set created_at=now();
  delete from public.pet_likes where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id;
end $$;
revoke all on function public.pass_pet(uuid,uuid) from public,anon,authenticated;

create or replace function public.like_pet(p_from_pet_id uuid,p_to_pet_id uuid,p_kind public.like_kind default 'like')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_match_id uuid;
  v_low uuid:=least(p_from_pet_id,p_to_pet_id);
  v_high uuid:=greatest(p_from_pet_id,p_to_pet_id);
  v_other_owner uuid;
  v_matched boolean:=false;
  v_tier public.account_tier;
  v_mating_enabled boolean:=public.current_mating_feature_enabled();
  v_from_non_mating boolean;
  v_to_non_mating boolean;
  v_mutual_mating boolean;
  v_existing_kind public.like_kind;
  v_had_like boolean:=false;
  v_like_changed boolean:=false;
  v_existing_match_id uuid;
  v_existing_unmatched_at timestamptz;
  v_emit_match boolean:=false;
begin
  if not public.owns_pet(p_from_pet_id) then raise exception 'forbidden'; end if;
  if p_from_pet_id=p_to_pet_id or public.is_blocked(p_from_pet_id,p_to_pet_id) then raise exception 'invalid_target'; end if;
  if not exists(select 1 from public.pets where id=p_from_pet_id and species='dog') or not exists(select 1 from public.pets where id=p_to_pet_id and species='dog') then raise exception 'dog_discovery_only'; end if;
  select exists(select 1 from public.pet_purposes pp where pp.pet_id=p_from_pet_id and pp.purpose<>'mating') into v_from_non_mating;
  select exists(select 1 from public.pet_purposes pp where pp.pet_id=p_to_pet_id and pp.purpose<>'mating') into v_to_non_mating;
  select v_mating_enabled and public.mating_pair_profile_signals_eligible(p_from_pet_id,p_to_pet_id) into v_mutual_mating;
  if not v_from_non_mating and not v_mutual_mating then raise exception 'own_profile_purpose_unavailable'; end if;
  if not v_to_non_mating and not v_mutual_mating then raise exception 'target_unavailable'; end if;
  if not exists(select 1 from public.pets p where p.id=p_from_pet_id and p.moderation_status='approved' and p.discovery_enabled and (select count(*) from public.pet_photos ph where ph.pet_id=p.id and ph.moderation_status='approved')=3) then raise exception 'own_profile_not_discovery_ready'; end if;
  if not exists(select 1 from public.pets p join public.users u on u.id=p.owner_id where p.id=p_to_pet_id and p.owner_id<>auth.uid() and p.moderation_status='approved' and p.discovery_enabled and u.suspended_at is null and u.paused_at is null and u.discoverable and (not u.incognito or exists(select 1 from public.pet_likes prior where prior.from_pet_id=p_to_pet_id and prior.to_pet_id=p_from_pet_id)) and (select count(*) from public.pet_photos ph where ph.pet_id=p.id and ph.moderation_status='approved')=3) then raise exception 'target_unavailable'; end if;

  select tier into v_tier from public.users where id=auth.uid() for update;
  select kind into v_existing_kind from public.pet_likes where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id;
  v_had_like:=found;
  v_like_changed:=not v_had_like or (v_existing_kind='like' and p_kind='super_like');

  if v_like_changed then
    if not v_had_like and v_tier='standard' then perform public.consume_standard_daily_product_quota('swipe'); end if;
    if p_kind='super_like' then
      perform public.rate_limit('super_like_abuse_guard',200,86400);
      if v_tier<>'premium' then
        insert into public.consumable_balances(user_id) values(auth.uid()) on conflict(user_id) do nothing;
        update public.consumable_balances set super_like_credits=super_like_credits-1,updated_at=now()
          where user_id=auth.uid() and super_like_credits>0;
        if not found then raise exception 'premium_or_super_like_credit_required'; end if;
      end if;
    else
      perform public.rate_limit('like_abuse_guard',5000,86400);
    end if;
  end if;

  insert into public.pet_likes(from_pet_id,to_pet_id,kind) values(p_from_pet_id,p_to_pet_id,p_kind)
  on conflict(from_pet_id,to_pet_id) do update set kind=case when public.pet_likes.kind='super_like' then public.pet_likes.kind else excluded.kind end;
  delete from public.pet_passes where from_pet_id=p_from_pet_id and to_pet_id=p_to_pet_id;

  if exists(select 1 from public.pet_likes where from_pet_id=p_to_pet_id and to_pet_id=p_from_pet_id) then
    select id,unmatched_at into v_existing_match_id,v_existing_unmatched_at from public.pet_matches where pet_low_id=v_low and pet_high_id=v_high for update;
    if found then
      v_match_id:=v_existing_match_id;
      if v_existing_unmatched_at is not null then
        update public.pet_matches set unmatched_at=null,unmatched_by_pet_id=null,matched_at=now() where id=v_match_id;
        v_emit_match:=true;
      end if;
    else
      insert into public.pet_matches(pet_low_id,pet_high_id) values(v_low,v_high) returning id into v_match_id;
      v_emit_match:=true;
    end if;
    insert into public.conversations(match_id) values(v_match_id) on conflict(match_id) do nothing;
    v_matched:=true;
    if v_emit_match then
      select owner_id into v_other_owner from public.pets where id=p_to_pet_id;
      insert into public.notifications(user_id,type,title,body,entity_id,template_key,template_params,actor_pet_id) values(auth.uid(),'match','New match','Your pets liked each other and matched.',v_match_id,'match',jsonb_build_object(),p_to_pet_id);
      if v_other_owner<>auth.uid() then
        insert into public.notifications(user_id,type,title,body,entity_id,template_key,template_params,actor_pet_id) values(v_other_owner,'match','New match','Your pets liked each other and matched.',v_match_id,'match',jsonb_build_object(),p_from_pet_id);
      end if;
    end if;
  elsif not v_had_like then
    select owner_id into v_other_owner from public.pets where id=p_to_pet_id;
    if v_other_owner is not null then insert into public.notifications(user_id,type,title,body,entity_id,template_key,template_params,actor_pet_id) values(v_other_owner,'like','New pet interest','One of your pets received a like.',p_from_pet_id,'like',jsonb_build_object(),p_from_pet_id); end if;
  end if;
  return jsonb_build_object('matched',v_matched,'match_id',v_match_id);
end $$;
revoke all on function public.like_pet(uuid,uuid,public.like_kind) from public,anon,authenticated;

-- Retry-safe wrappers remain the only authenticated mutation entry points.
grant execute on function public.like_pet_idempotent(uuid,uuid,public.like_kind,text) to authenticated;
grant execute on function public.pass_pet_idempotent(uuid,uuid,text) to authenticated;
grant execute on function public.send_message_idempotent(uuid,uuid,text,text) to authenticated;

create or replace function public.get_product_feature_policy()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.require_active_authenticated_session();
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
    'standardDailySwipeLimit',50,'standardDailyNewConversationLimit',3,'dailyQuotaUsesLocalMidnight',true,
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

-- Keep account settings backward-compatible while projecting the new quota contract.
create or replace function public.get_account_settings()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'tier',u.tier,'discoverable',u.discoverable,'incognito',u.incognito,
    'paused',u.paused_at is not null,'suspended',u.suspended_at is not null,'age18Confirmed',u.age_18_confirmed,'legalVersion',u.legal_version,
    'identityVerified',coalesce(u.identity_verified,false),'preferredLocale',u.preferred_locale,'measurementSystem',u.measurement_system,
    'dailySwipeRemaining',(q.status->'swipesRemaining'),
    'dailyNewConversationRemaining',(q.status->'newConversationsRemaining'),
    'quotaResetAt',(q.status->>'resetAt'),
    'quotaTimeZone',(q.status->>'timeZone'),
    'legalContextCurrent',public.current_user_has_product_access(),'legalBundleAccepted',public.current_user_has_product_access(),
    'legalBundleId',public.resolve_current_legal_bundle_id(u.id,coalesce(u.preferred_locale,'en')),
    'legalCountry',r.legal_country_code,'legalCountryCode',r.legal_country_code,'legalSubnationalCode',r.legal_subnational_code,
    'legalCountryVerificationStatus',coalesce(r.resolution_status,'pending'),'legalCountryExpiresAt',r.expires_at,
    'legalApplicabilityMatrixId',r.current_applicability_matrix_id,
    'legalJurisdictionReleaseStatus',coalesce(j.release_status,'blocked'),'legalLanguageReviewStatus',coalesce(j.language_review_status,'pending_external_counsel'),'legalAgeAssuranceMode',coalesce(j.age_assurance_mode,'unresolved'),
    'legalUiLocale',b.ui_locale,'legalDocumentLocale',b.document_locale,
    'privacyNoticeVersion',(select p.notice_version from public.privacy_notice_acknowledgements p where p.user_id=u.id and p.applicability_matrix_id=r.current_applicability_matrix_id order by p.acknowledged_at desc,p.id desc limit 1),
    'marketingConsentVersion',case when public.current_marketing_push_consent_granted(u.id) then b.marketing_push_consent_version else null end,
    'notificationPreferences',jsonb_set(
      ('{"matches":true,"messages":true,"social":true,"events":true,"health":true,"marketing":false,"quietEnabled":false,"quietStartMinutes":1320,"quietEndMinutes":480,"timeZone":"UTC"}'::jsonb||coalesce(u.notification_preferences,'{}'::jsonb)),
      '{marketing}',to_jsonb(public.current_marketing_push_consent_granted(u.id)),true)
  ) from public.users u
  left join public.legal_country_runtime r on r.user_id=u.id
  left join public.legal_jurisdiction_policies j on j.legal_country_code=r.legal_country_code
  left join public.legal_document_bundles b on b.bundle_id=public.resolve_current_legal_bundle_id(u.id,coalesce(u.preferred_locale,'en'))
  cross join lateral (select public.current_user_daily_product_quota_status() as status) q
  where u.id=auth.uid() and public.current_session_satisfies_mfa_if_enrolled();
$$;
revoke all on function public.get_account_settings() from public,anon;
grant execute on function public.get_account_settings() to authenticated;

comment on column public.users.free_messages_sent is 'Legacy pre-v196 counter retained only for migration compatibility; it is not an authorization or product-quota source after migration 196.';
