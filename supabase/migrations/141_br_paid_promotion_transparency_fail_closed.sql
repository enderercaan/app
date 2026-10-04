-- Tailmance v19 R8: Brazil paid-promotion transparency / retention fail-closed hardening.
-- Portaria Conjunta SENACON/SEDIGI/SPDIGI nº 3/2026 was published 2026-09-23.
-- Most provisions become effective 2026-10-23; Article 3 material-relationship tooling
-- becomes effective 2026-12-22. Tailmance prepares the source/runtime gate now and does
-- not surface Brazil paid promotion until the operational controls are actually ready.

create table if not exists public.jurisdiction_paid_promotion_compliance (
  country_code text primary key check (country_code ~ '^[A-Z]{2}$'),
  paid_promotion_visibility_enabled boolean not null default false,
  advertiser_recordkeeping_ready boolean not null default false,
  material_relationship_disclosure_ready boolean not null default false,
  public_repository_ready boolean not null default false,
  financial_advertiser_verification_ready boolean not null default false,
  minimum_record_retention_days integer not null default 365 check (minimum_record_retention_days>=365),
  reviewed_at timestamptz,
  effective_at timestamptz,
  expires_at timestamptz,
  evidence_reference text,
  updated_at timestamptz not null default now(),
  check (
    not paid_promotion_visibility_enabled or (
      advertiser_recordkeeping_ready
      and material_relationship_disclosure_ready
      and public_repository_ready
      and financial_advertiser_verification_ready
      and minimum_record_retention_days>=365
      and reviewed_at is not null
      and effective_at is not null
      and expires_at is not null
      and expires_at>effective_at
      and nullif(trim(evidence_reference),'') is not null
    )
  )
);

alter table public.jurisdiction_paid_promotion_compliance enable row level security;
revoke all on public.jurisdiction_paid_promotion_compliance from public,anon,authenticated;
grant all on public.jurisdiction_paid_promotion_compliance to service_role;

insert into public.jurisdiction_paid_promotion_compliance(
  country_code,paid_promotion_visibility_enabled,advertiser_recordkeeping_ready,
  material_relationship_disclosure_ready,public_repository_ready,
  financial_advertiser_verification_ready,minimum_record_retention_days,
  reviewed_at,effective_at,expires_at,evidence_reference
) values (
  'BR',false,false,false,false,false,365,now(),
  '2026-10-23T00:00:00Z'::timestamptz,'2027-12-31T23:59:59Z'::timestamptz,
  'https://bibliotecadigital.mj.gov.br/handle/1/17694'
)
on conflict(country_code) do update set
  minimum_record_retention_days=greatest(public.jurisdiction_paid_promotion_compliance.minimum_record_retention_days,365),
  evidence_reference=excluded.evidence_reference,
  updated_at=now();

create or replace function public.current_paid_promotion_visibility_enabled()
returns boolean language plpgsql stable security definer set search_path='' as $$
declare
  r public.legal_country_runtime;
  c public.jurisdiction_paid_promotion_compliance;
begin
  perform public.require_active_authenticated_session();
  select * into r from public.legal_country_runtime where user_id=auth.uid();
  if r.legal_country_code is null or r.resolution_status<>'verified' then return false; end if;
  if not public.legal_source_approval_current(r.legal_country_code) then return false; end if;
  if r.legal_country_code<>'BR' then return true; end if;
  select * into c from public.jurisdiction_paid_promotion_compliance where country_code='BR';
  return coalesce(c.paid_promotion_visibility_enabled,false)
    and coalesce(c.advertiser_recordkeeping_ready,false)
    and coalesce(c.material_relationship_disclosure_ready,false)
    and coalesce(c.public_repository_ready,false)
    and coalesce(c.financial_advertiser_verification_ready,false)
    and coalesce(c.minimum_record_retention_days,0)>=365
    and c.reviewed_at is not null
    and c.effective_at<=now()
    and c.expires_at>now()
    and nullif(trim(c.evidence_reference),'') is not null;
end $$;
revoke all on function public.current_paid_promotion_visibility_enabled() from public,anon,authenticated;
grant execute on function public.current_paid_promotion_visibility_enabled() to service_role;

-- Paid partner fields are exposed only when the user's verified legal-country context
-- permits paid promotion. Organic place information remains available.
create or replace function public.get_pet_friendly_places(p_pet_id uuid,p_category text default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare mine public.pet_private; p public.pets; v_result jsonb; v_paid_promotions boolean:=false;
begin
  perform public.require_active_authenticated_session();
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  v_paid_promotions:=public.current_paid_promotion_visibility_enabled();
  select * into p from public.pets where id=p_pet_id;
  select * into mine from public.pet_private where pet_id=p_pet_id;
  if p_category is not null and p_category not in ('park','cafe','restaurant','veterinary','groomer','trainer','hotel','shop','other') then raise exception 'invalid_place_category'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'name',x.name,'category',x.category,'city',x.city,'district',x.district,'neighborhood',x.neighborhood,'addressLabel',x.address_label,
    'latitude',x.latitude,'longitude',x.longitude,
    'websiteUrl',case when x.partner_entitled then coalesce(x.partner_website_url,x.website_url) else x.website_url end,
    'bookingUrl',case when x.partner_entitled then coalesce(x.appointment_url,x.booking_url) else x.booking_url end,
    'petPolicySummary',x.pet_policy_summary,
    'verificationPartner',x.verification_partner or (x.partner_entitled and coalesce(x.partner_verification_partner,false)),
    'verified',x.verified or (x.partner_entitled and coalesce(x.partner_verified,false)),
    'partnershipTier',case when x.partner_entitled then x.partnership_tier else 'organic' end,
    'sponsorshipDisclosure',case when x.partner_entitled then coalesce(x.partner_disclosure,x.sponsorship_disclosure) else null end,
    'businessPlan',case when x.partner_entitled then x.business_plan else 'free' end,
    'appointmentUrl',case when x.partner_entitled then x.appointment_url else null end,
    'approximateDistanceKm',case when x.distance_km is null then null else round(x.distance_km::numeric,1) end
  ) order by x.distance_km nulls last,case when x.partner_entitled then x.partnership_rank else 0 end desc,x.name),'[]'::jsonb) into v_result
  from (
    select place.*,case place.partnership_tier when 'event_host' then 2 when 'featured' then 1 else 0 end partnership_rank,
      case when mine.latitude is null or mine.longitude is null then null else public.haversine_km(mine.latitude,mine.longitude,place.latitude,place.longitude) end distance_km,
      bp.plan business_plan,bp.website_url partner_website_url,bp.appointment_url,bp.verification_partner partner_verification_partner,bp.verified partner_verified,bp.sponsorship_disclosure partner_disclosure,
      case when bp.id is null then false else v_paid_promotions and public.business_partner_entitlement_active(bp.id) end partner_entitled
    from public.pet_friendly_places place left join public.business_partner_profiles bp on bp.place_id=place.id and bp.active
    where place.active and (p_category is null or place.category=p_category)
      and (public.normalize_search_text(place.city)=public.normalize_search_text(p.city) or (mine.latitude is not null and mine.longitude is not null and public.haversine_km(mine.latitude,mine.longitude,place.latitude,place.longitude)<=50))
  ) x limit least(greatest(p_limit,1),100);
  return v_result;
end $$;
revoke all on function public.get_pet_friendly_places(uuid,text,integer) from public,anon;
grant execute on function public.get_pet_friendly_places(uuid,text,integer) to authenticated;

create or replace function public.get_pet_events_page(p_pet_id uuid,p_limit integer default 30,p_after_starts_at timestamptz default null,p_after_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_paid_promotions boolean:=false; v_result jsonb;
begin
  perform public.require_active_authenticated_session();
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  v_paid_promotions:=public.current_paid_promotion_visibility_enabled();
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'creatorPetId',e.creator_pet_id,'title',e.title,'description',e.description,'city',e.city,'district',e.district,'neighborhood',e.neighborhood,
    'startsAt',e.starts_at,'endsAt',e.ends_at,'capacity',e.capacity,'eventKind',e.event_kind,'recurrence',e.recurrence,
    'hostPlaceId',e.host_place_id,'hostPlaceName',place.name,'attendeeCount',(select count(*) from public.event_attendees a where a.event_id=e.id),
    'myStatus',(select a.status from public.event_attendees a where a.event_id=e.id and a.pet_id=p_pet_id),
    'commercialOffer',case when offer.id is null then null else jsonb_build_object('id',offer.id,'type',offer.offer_type,'bookingUrl',offer.external_booking_url,'priceMinor',offer.display_price_minor,'currency',offer.currency,'disclosure',offer.disclosure) end
  ) order by e.starts_at,e.id),'[]'::jsonb) into v_result
  from (
    select ev.* from public.pet_events ev join public.pets creator on creator.id=ev.creator_pet_id join public.users u on u.id=creator.owner_id
    where ev.moderation_status='approved' and ev.starts_at>now() and creator.moderation_status='approved' and u.suspended_at is null and u.paused_at is null
      and not public.is_blocked(p_pet_id,ev.creator_pet_id) and (p_after_starts_at is null or (ev.starts_at,ev.id)>(p_after_starts_at,coalesce(p_after_id,'00000000-0000-0000-0000-000000000000'::uuid)))
    order by ev.starts_at,ev.id limit least(greatest(p_limit,1),50)
  ) e
  left join public.pet_friendly_places place on place.id=e.host_place_id and place.active
  left join lateral (
    select o.* from public.event_commercial_offers o
    where v_paid_promotions and o.event_id=e.id and o.active and public.business_partner_entitlement_active(o.partner_id)
    order by case o.offer_type when 'external_ticket' then 1 when 'sponsorship' then 2 else 3 end limit 1
  ) offer on true;
  return v_result;
end $$;
revoke all on function public.get_pet_events_page(uuid,integer,timestamptz,uuid) from public,anon;
grant execute on function public.get_pet_events_page(uuid,integer,timestamptz,uuid) to authenticated;

create or replace function public.track_commercial_referral(p_offer_id uuid,p_source text)
returns void language plpgsql security definer set search_path='' as $$
declare v_partner_id uuid;
begin
  perform public.require_active_authenticated_session();
  if not public.current_paid_promotion_visibility_enabled() then raise exception 'commercial_promotion_not_available'; end if;
  if p_source not in ('event_ticket','event_sponsor','event_sample') then raise exception 'invalid_referral_source'; end if;
  select partner_id into v_partner_id from public.event_commercial_offers where id=p_offer_id and active;
  if v_partner_id is null or not public.business_partner_entitlement_active(v_partner_id) then raise exception 'offer_not_found'; end if;
  perform public.rate_limit('commercial_referral',100,3600);
  insert into public.commercial_referral_events(offer_id,source) values(p_offer_id,p_source);
end $$;
revoke all on function public.track_commercial_referral(uuid,text) from public,anon;
grant execute on function public.track_commercial_referral(uuid,text) to authenticated;

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

comment on table public.jurisdiction_paid_promotion_compliance is
  'Operational gate for country-specific paid-promotion transparency/retention controls. Brazil is source-prepared for Portaria Conjunta SENACON/SEDIGI/SPDIGI nº 3/2026 but paid promotion remains fail-closed until required operational controls are ready.';
