-- Tailmance v19 R8: regional billing programs are explicit, evidence-bound and fail-closed.
-- Native Apple/Google billing through RevenueCat remains the only default production purchase path.
-- No alternative billing or external purchase-link program may become visible from country inference alone.

create table if not exists public.jurisdiction_billing_programs (
  country_code text primary key check (country_code ~ '^[A-Z]{2}$'),
  ios_alternative_billing_enabled boolean not null default false,
  android_alternative_billing_enabled boolean not null default false,
  external_purchase_links_enabled boolean not null default false,
  review_status text not null default 'not_verified' check (review_status in ('not_verified','blocked','approved')),
  evidence_reference text,
  reviewed_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  check (
    not (ios_alternative_billing_enabled or android_alternative_billing_enabled or external_purchase_links_enabled)
    or (
      review_status='approved'
      and reviewed_at is not null
      and expires_at is not null
      and char_length(trim(coalesce(evidence_reference,''))) between 8 and 500
    )
  ),
  check (expires_at is null or reviewed_at is null or expires_at>reviewed_at)
);

comment on table public.jurisdiction_billing_programs is
  'Service-only evidence-bound regional billing configuration. Absence, stale review, or non-approved status always disables alternative billing and external purchase links.';

alter table public.jurisdiction_billing_programs enable row level security;
revoke all on table public.jurisdiction_billing_programs from public,anon,authenticated;
grant select,insert,update,delete on table public.jurisdiction_billing_programs to service_role;

create or replace function public.current_regional_billing_policy()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_runtime public.legal_country_runtime;
  v_policy public.jurisdiction_billing_programs;
  v_approved boolean:=false;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform public.require_active_authenticated_session();

  select * into v_runtime from public.legal_country_runtime where user_id=v_uid;
  if not found or v_runtime.legal_country_code is null or v_runtime.resolution_status<>'verified' then
    return jsonb_build_object(
      'status','blocked_legal_country_unresolved',
      'iosAlternativeBillingEnabled',false,
      'androidAlternativeBillingEnabled',false,
      'externalPurchaseLinksEnabled',false
    );
  end if;

  if not public.legal_source_approval_current(v_runtime.legal_country_code) then
    return jsonb_build_object(
      'status','blocked_legal_source_not_current',
      'legalCountryCode',v_runtime.legal_country_code,
      'iosAlternativeBillingEnabled',false,
      'androidAlternativeBillingEnabled',false,
      'externalPurchaseLinksEnabled',false
    );
  end if;

  select * into v_policy from public.jurisdiction_billing_programs where country_code=v_runtime.legal_country_code;
  if not found then
    return jsonb_build_object(
      'status','blocked_not_configured',
      'legalCountryCode',v_runtime.legal_country_code,
      'iosAlternativeBillingEnabled',false,
      'androidAlternativeBillingEnabled',false,
      'externalPurchaseLinksEnabled',false
    );
  end if;

  v_approved:=v_policy.review_status='approved'
    and v_policy.reviewed_at is not null
    and v_policy.reviewed_at<=now()
    and v_policy.expires_at is not null
    and v_policy.expires_at>now()
    and char_length(trim(coalesce(v_policy.evidence_reference,''))) between 8 and 500;

  if not v_approved then
    return jsonb_build_object(
      'status','blocked_review_not_current',
      'legalCountryCode',v_runtime.legal_country_code,
      'iosAlternativeBillingEnabled',false,
      'androidAlternativeBillingEnabled',false,
      'externalPurchaseLinksEnabled',false
    );
  end if;

  return jsonb_build_object(
    'status','approved',
    'legalCountryCode',v_runtime.legal_country_code,
    'iosAlternativeBillingEnabled',v_policy.ios_alternative_billing_enabled,
    'androidAlternativeBillingEnabled',v_policy.android_alternative_billing_enabled,
    'externalPurchaseLinksEnabled',v_policy.external_purchase_links_enabled,
    'reviewedAt',v_policy.reviewed_at,
    'expiresAt',v_policy.expires_at
  );
end $$;
revoke all on function public.current_regional_billing_policy() from public,anon;
grant execute on function public.current_regional_billing_policy() to authenticated;

-- Re-state the product feature policy with the regional billing object included. The object is
-- informational product policy only: purchase code continues to use RevenueCat/native store APIs.
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
    'regionalBilling',public.current_regional_billing_policy(),
    'nativeStoreBillingDefault',true,'revenueCatEntitlement','tailmance_premium','revenueCatPackage','premium_access',
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
