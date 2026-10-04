-- Tailmance v19 R8: final product-density, retention, owner-arranged mating boundary and partner-revenue hardening.

-- External event-ticket conversions are operator/provider evidence, never client-authoritative.
create table if not exists public.commercial_conversion_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_key text not null unique check (char_length(trim(provider_event_key)) between 8 and 200),
  offer_id uuid not null references public.event_commercial_offers(id) on delete restrict,
  partner_id uuid not null references public.business_partner_profiles(id) on delete restrict,
  source text not null check (source='event_ticket'),
  gross_minor bigint not null check (gross_minor>=0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  commission_bps integer not null check (commission_bps between 0 and 3000),
  commission_minor bigint not null check (commission_minor>=0),
  status text not null default 'confirmed' check (status in ('pending','confirmed','reversed')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (commission_minor = floor((gross_minor::numeric * commission_bps::numeric) / 10000)::bigint)
);
create index if not exists idx_commercial_conversion_partner_time on public.commercial_conversion_events(partner_id,occurred_at desc);
create index if not exists idx_commercial_conversion_offer_time on public.commercial_conversion_events(offer_id,occurred_at desc);
alter table public.commercial_conversion_events enable row level security;
revoke all on public.commercial_conversion_events from public,anon,authenticated;
grant all on public.commercial_conversion_events to service_role;

create or replace function public.record_event_ticket_conversion(
  p_provider_event_key text,
  p_offer_id uuid,
  p_gross_minor bigint,
  p_currency text,
  p_occurred_at timestamptz,
  p_status text default 'confirmed'
) returns boolean language plpgsql security definer set search_path='' as $$
declare
  v_partner_id uuid;
  v_commission_bps integer;
  v_inserted integer:=0;
  v_currency text:=upper(trim(coalesce(p_currency,'')));
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if char_length(trim(coalesce(p_provider_event_key,''))) not between 8 and 200 then raise exception 'invalid_provider_event_key'; end if;
  if p_gross_minor<0 or v_currency !~ '^[A-Z]{3}$' or p_occurred_at is null then raise exception 'invalid_conversion'; end if;
  if p_status not in ('pending','confirmed','reversed') then raise exception 'invalid_conversion_status'; end if;

  select partner_id,commission_bps into v_partner_id,v_commission_bps
  from public.event_commercial_offers
  where id=p_offer_id and offer_type='external_ticket';
  if v_partner_id is null then raise exception 'ticket_offer_not_found'; end if;

  insert into public.commercial_conversion_events(
    provider_event_key,offer_id,partner_id,source,gross_minor,currency,commission_bps,commission_minor,status,occurred_at
  ) values(
    trim(p_provider_event_key),p_offer_id,v_partner_id,'event_ticket',p_gross_minor,v_currency,v_commission_bps,
    floor((p_gross_minor::numeric*v_commission_bps::numeric)/10000)::bigint,p_status,p_occurred_at
  ) on conflict(provider_event_key) do nothing;
  get diagnostics v_inserted=row_count;
  return v_inserted=1;
end $$;
revoke all on function public.record_event_ticket_conversion(text,uuid,bigint,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.record_event_ticket_conversion(text,uuid,bigint,text,timestamptz,text) to service_role;

-- Explicit product contract used by clients and regression tests. The app is a digital dog park,
-- not a pet-sales, breeding brokerage, human-dating or data-sale marketplace.
create or replace function public.get_product_feature_policy()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.require_active_authenticated_session();
  return jsonb_build_object(
    'matingOwnerArrangedEnabled',public.current_mating_feature_enabled(),
    'matingOwnerDecisionOnly',true,
    'matingBrokerageEnabled',false,
    'matingTransactionEnabled',false,
    'matingCommerceEnabled',false,
    'petSalesEnabled',false,'commercialBreedingEnabled',false,'petCommerceMarketplaceEnabled',false,
    'adoptionMarketplaceEnabled',false,
    'dataSaleEnabled',false,'dataSalesEnabled',false,'aggressiveAdsEnabled',false,
    'catsInDiscovery',false,'catsFeedOnly',true,'dogDiscoveryOnly',true,
    'localFeedDefault',true,
    'premiumEventCreation',true,'lostPetAlertsFree',true,'safetyFeaturesFree',true,
    'multiplePetsPremium',true,'advancedFiltersPremium',true,'travelModePremium',true,
    'boostsEnabled',true,'consumablePacksEnabled',true,'contextualAdsOnly',true,
    'premiumMultiplePets',true,'premiumAdvancedFilters',true,'premiumTravelMode',true,
    'premiumUnlimitedLikes',true,'premiumLikesYou',true,'premiumIncognito',true,
    'premiumEventHosting',true,
    'standardPremiumReplyCourtesy',true,
    'consumableBoosts',true,'consumableSuperLikes',true,
    'contextualBusinessPromotionsOnly',true,'petFirstNoHumanDating',true,
    'petFriendlyPlacesEnabled',true,'lostPetProximityAlertsEnabled',true,'safeMeetupSharingEnabled',true,
    'healthTrackingEnabled',true,'aiVeterinaryDiagnosisEnabled',false,
    'socialShareEnabled',true,'socialShareBranding','Tailmance',
    'pilotCity','Istanbul','pilotNeighborhoods',jsonb_build_array('Moda','Fenerbahçe','Caddebostan'),
    'localDensityTargetMin',300,'localDensityTargetMax',500,'referralMilestone',40,
    'consumerPriceReviewCadenceDays',90,'consumerPriceAuthority','store_localized',
    'businessPartnerMonthlyPlans',true,'eventTicketCommissionAttribution',true,
    'insuranceAffiliateEnabled',false,'commerceAffiliateEnabled',false,'sitterMarketplaceEnabled',false
  );
end $$;
revoke all on function public.get_product_feature_policy() from public,anon;
grant execute on function public.get_product_feature_policy() to authenticated;
