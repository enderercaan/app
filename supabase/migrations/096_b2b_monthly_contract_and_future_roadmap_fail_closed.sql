-- Tailmance v19 R8: B2B monthly partner lifecycle + future monetization fail-closed flags.
-- Paid visibility is contractual/operator-managed and never enables animal sales, data sales or personalized ads.

alter table public.business_partner_profiles add column if not exists billing_interval text not null default 'monthly';
alter table public.business_partner_profiles add column if not exists plan_status text not null default 'inactive';
alter table public.business_partner_profiles add column if not exists plan_started_at timestamptz;
alter table public.business_partner_profiles add column if not exists current_period_end timestamptz;
alter table public.business_partner_profiles add column if not exists monthly_price_minor integer;
alter table public.business_partner_profiles add column if not exists billing_currency char(3);
alter table public.business_partner_profiles add column if not exists operator_managed_contract boolean not null default true;

alter table public.business_partner_profiles drop constraint if exists business_partner_profiles_billing_interval_check;
alter table public.business_partner_profiles add constraint business_partner_profiles_billing_interval_check check (billing_interval='monthly') not valid;
alter table public.business_partner_profiles validate constraint business_partner_profiles_billing_interval_check;
alter table public.business_partner_profiles drop constraint if exists business_partner_profiles_plan_status_check;
alter table public.business_partner_profiles add constraint business_partner_profiles_plan_status_check check (plan_status in ('inactive','trial','active','past_due','cancelled')) not valid;
alter table public.business_partner_profiles validate constraint business_partner_profiles_plan_status_check;
alter table public.business_partner_profiles drop constraint if exists business_partner_profiles_monthly_price_check;
alter table public.business_partner_profiles add constraint business_partner_profiles_monthly_price_check check (monthly_price_minor is null or monthly_price_minor>=0) not valid;
alter table public.business_partner_profiles validate constraint business_partner_profiles_monthly_price_check;
alter table public.business_partner_profiles drop constraint if exists business_partner_profiles_billing_currency_check;
alter table public.business_partner_profiles add constraint business_partner_profiles_billing_currency_check check (billing_currency is null or billing_currency ~ '^[A-Z]{3}$') not valid;
alter table public.business_partner_profiles validate constraint business_partner_profiles_billing_currency_check;
alter table public.business_partner_profiles drop constraint if exists business_partner_profiles_operator_managed_check;
alter table public.business_partner_profiles add constraint business_partner_profiles_operator_managed_check check (operator_managed_contract=true) not valid;
alter table public.business_partner_profiles validate constraint business_partner_profiles_operator_managed_check;
alter table public.business_partner_profiles drop constraint if exists business_partner_profiles_active_paid_contract_check;
alter table public.business_partner_profiles add constraint business_partner_profiles_active_paid_contract_check check (
  plan='free' or plan_status<>'active' or (
    monthly_price_minor is not null and monthly_price_minor>0 and billing_currency is not null
    and plan_started_at is not null and current_period_end is not null and current_period_end>plan_started_at
  )
) not valid;
alter table public.business_partner_profiles validate constraint business_partner_profiles_active_paid_contract_check;

create or replace function public.business_partner_entitlement_active(p_partner_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((
    select bp.active and (
      bp.plan='free' or (
        bp.plan in ('featured','professional','verification_partner')
        and bp.plan_status='active'
        and bp.current_period_end>now()
        and coalesce(bp.monthly_price_minor,0)>0
        and bp.billing_currency is not null
      )
    )
    from public.business_partner_profiles bp where bp.id=p_partner_id
  ),false);
$$;
revoke all on function public.business_partner_entitlement_active(uuid) from public,anon,authenticated;

-- Expired or unpaid paid partners never receive promoted placement or commercial offers.
create or replace function public.get_pet_friendly_places(p_pet_id uuid,p_category text default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare mine public.pet_private; p public.pets; v_result jsonb;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select * into p from public.pets where id=p_pet_id; select * into mine from public.pet_private where pet_id=p_pet_id;
  if p_category is not null and p_category not in ('park','cafe','restaurant','veterinary','groomer','trainer','hotel','shop','other') then raise exception 'invalid_place_category'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'name',x.name,'category',x.category,'city',x.city,'district',x.district,'neighborhood',x.neighborhood,'addressLabel',x.address_label,
    'latitude',x.latitude,'longitude',x.longitude,'websiteUrl',coalesce(x.partner_website_url,x.website_url),'bookingUrl',coalesce(x.appointment_url,x.booking_url),'petPolicySummary',x.pet_policy_summary,
    'verificationPartner',x.verification_partner or coalesce(x.partner_verification_partner,false),'verified',x.verified or coalesce(x.partner_verified,false),
    'partnershipTier',case when x.partner_entitled then x.partnership_tier else 'organic' end,
    'sponsorshipDisclosure',case when x.partner_entitled then coalesce(x.partner_disclosure,x.sponsorship_disclosure) else null end,
    'businessPlan',case when x.partner_entitled then x.business_plan else 'free' end,'appointmentUrl',case when x.partner_entitled then x.appointment_url else null end,
    'approximateDistanceKm',case when x.distance_km is null then null else round(x.distance_km::numeric,1) end
  ) order by x.distance_km nulls last,case when x.partner_entitled then x.partnership_rank else 0 end desc,x.name),'[]'::jsonb) into v_result
  from (
    select place.*,case place.partnership_tier when 'event_host' then 2 when 'featured' then 1 else 0 end partnership_rank,
      case when mine.latitude is null or mine.longitude is null then null else public.haversine_km(mine.latitude,mine.longitude,place.latitude,place.longitude) end distance_km,
      bp.plan business_plan,bp.website_url partner_website_url,bp.appointment_url,bp.verification_partner partner_verification_partner,bp.verified partner_verified,bp.sponsorship_disclosure partner_disclosure,
      case when bp.id is null then false else public.business_partner_entitlement_active(bp.id) end partner_entitled
    from public.pet_friendly_places place left join public.business_partner_profiles bp on bp.place_id=place.id and bp.active
    where place.active and (p_category is null or place.category=p_category)
      and (public.normalize_search_text(place.city)=public.normalize_search_text(p.city) or (mine.latitude is not null and mine.longitude is not null and public.haversine_km(mine.latitude,mine.longitude,place.latitude,place.longitude)<=50))
  ) x limit least(greatest(p_limit,1),100);
  return v_result;
end $$;
revoke all on function public.get_pet_friendly_places(uuid,text,integer) from public,anon;
grant execute on function public.get_pet_friendly_places(uuid,text,integer) to authenticated;

create or replace function public.get_pet_events_page(p_pet_id uuid,p_limit integer default 30,p_after_starts_at timestamptz default null,p_after_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'creatorPetId',e.creator_pet_id,'title',e.title,'description',e.description,'city',e.city,'district',e.district,'neighborhood',e.neighborhood,
    'startsAt',e.starts_at,'endsAt',e.ends_at,'capacity',e.capacity,'eventKind',e.event_kind,'recurrence',e.recurrence,
    'hostPlaceId',e.host_place_id,'hostPlaceName',place.name,'attendeeCount',(select count(*) from public.event_attendees a where a.event_id=e.id),
    'myStatus',(select a.status from public.event_attendees a where a.event_id=e.id and a.pet_id=p_pet_id),
    'commercialOffer',case when offer.id is null then null else jsonb_build_object('id',offer.id,'type',offer.offer_type,'bookingUrl',offer.external_booking_url,'priceMinor',offer.display_price_minor,'currency',offer.currency,'disclosure',offer.disclosure) end
  ) order by e.starts_at,e.id),'[]'::jsonb)
  from (
    select e.* from public.pet_events e join public.pets creator on creator.id=e.creator_pet_id join public.users u on u.id=creator.owner_id
    where public.owns_pet(p_pet_id) and e.moderation_status='approved' and e.starts_at>now() and creator.moderation_status='approved' and u.suspended_at is null and u.paused_at is null
      and not public.is_blocked(p_pet_id,e.creator_pet_id) and (p_after_starts_at is null or (e.starts_at,e.id)>(p_after_starts_at,coalesce(p_after_id,'00000000-0000-0000-0000-000000000000'::uuid)))
    order by e.starts_at,e.id limit least(greatest(p_limit,1),50)
  ) e
  left join public.pet_friendly_places place on place.id=e.host_place_id and place.active
  left join lateral (
    select o.* from public.event_commercial_offers o
    where o.event_id=e.id and o.active and public.business_partner_entitlement_active(o.partner_id)
    order by case o.offer_type when 'external_ticket' then 1 when 'sponsorship' then 2 else 3 end limit 1
  ) offer on true;
$$;
revoke all on function public.get_pet_events_page(uuid,integer,timestamptz,uuid) from public,anon;
grant execute on function public.get_pet_events_page(uuid,integer,timestamptz,uuid) to authenticated;

create or replace function public.track_commercial_referral(p_offer_id uuid,p_source text)
returns void language plpgsql security definer set search_path='' as $$
declare v_partner_id uuid;
begin
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
  return jsonb_build_object(
    'matingOwnerArrangedEnabled',public.current_mating_feature_enabled(),
    'petSalesEnabled',false,'commercialBreedingEnabled',false,'petCommerceMarketplaceEnabled',false,
    'dataSaleEnabled',false,'dataSalesEnabled',false,'aggressiveAdsEnabled',false,
    'catsInDiscovery',false,'premiumEventCreation',true,'lostPetAlertsFree',true,'safetyFeaturesFree',true,
    'multiplePetsPremium',true,'advancedFiltersPremium',true,'travelModePremium',true,
    'boostsEnabled',true,'consumablePacksEnabled',true,'contextualAdsOnly',true,
    'premiumMultiplePets',true,'premiumAdvancedFilters',true,'premiumTravelMode',true,
    'premiumUnlimitedLikes',true,'consumableBoosts',true,'consumableSuperLikes',true,
    'contextualBusinessPromotionsOnly',true,'petFirstNoHumanDating',true,
    'insuranceAffiliateEnabled',false,'commerceAffiliateEnabled',false,'sitterMarketplaceEnabled',false,
    'businessPartnerMonthlyPlans',true
  );
end $$;
revoke all on function public.get_product_feature_policy() from public,anon;
grant execute on function public.get_product_feature_policy() to authenticated;
