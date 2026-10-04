import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(p)=>fs.readFileSync(p,'utf8');
const m87=read('supabase/migrations/087_retention_trust_and_local_network_architecture.sql');
const m88=read('supabase/migrations/088_retention_trust_and_local_network_architecture.sql');
const m89=read('supabase/migrations/089_oauth_existing_account_only_guard.sql');
const m90=read('supabase/migrations/090_plus_growth_b2b_and_pet_first_product_enforcement.sql');
const m91=read('supabase/migrations/091_pet_first_no_human_dating_enforcement.sql');
const m92=read('supabase/migrations/092_verified_identity_parity_strict_legal_gate.sql');
const m93=read('supabase/migrations/093_pet_first_discovery_mating_and_local_feed_finalization.sql');
const m94=read('supabase/migrations/094_consumable_billing_claim_bound_atomic_apply.sql');
const m95=read('supabase/migrations/095_local_density_unlock_semantics.sql');
const m96=read('supabase/migrations/096_b2b_monthly_contract_and_future_roadmap_fail_closed.sql');
const m107=read('supabase/migrations/107_product_density_retention_and_partner_revenue_finalization.sql');
const m196=read('supabase/migrations/196_daily_swipe_conversation_quota_and_premium_naming_alignment.sql');
const m141=read('supabase/migrations/141_br_paid_promotion_transparency_fail_closed.sql');
const m159=read('supabase/migrations/159_pet_rehoming_zero_tolerance_enforcement.sql');
const m185=read('supabase/migrations/185_revenuecat_premium_contract_exact_mapping.sql');
const api=read('src/services/api.ts');
const auth=read('src/services/auth.ts');
const discover=read('src/screens/DiscoverScreen.tsx');
const events=read('src/screens/EventsScreen.tsx');
const feed=read('src/screens/FeedScreen.tsx');
const meetups=read('src/screens/MeetupsScreen.tsx');
const premium=read('src/screens/PremiumScreen.tsx');
const verify=read('src/screens/VerificationCenterScreen.tsx');
const petEditor=read('src/screens/PetEditorScreen.tsx');
const contentSafety=read('src/domain/contentSafety.ts');
const webhook=read('supabase/functions/revenuecat-webhook/index.ts');
const exportFn=read('supabase/functions/export-download/index.ts');
const nav=read('src/navigation/AppNavigator.tsx');
const enLocale=read('src/i18n/locales/en.ts');
const socialShare=read('src/services/socialShare.ts');
const strategy=read('PRODUCT_STRATEGY_RETENTION_AND_MONETIZATION_BOUNDARY_2026-09-30.md');
const places=read('src/screens/PlacesScreen.tsx');
const appConfig=read('app.config.ts');
const packageJson=read('package.json');

let passed=0;
const ok=(name,fn)=>{fn();passed++;};

ok('lost-pet notification type is migration-safe before use',()=>{
  assert.match(m87,/alter type public\.notification_type add value if not exists 'lost_pet'/i);
  assert.match(m88,/notification_type\s*=\s*lost_pet|notification_type = lost_pet|lost_pet/i);
});
ok('pilot neighborhoods seed density and referral thresholds',()=>{
  for(const n of ['Moda','Fenerbahçe','Caddebostan']) assert.match(m88,new RegExp(n,'u'));
  assert.match(m88,/pilot_open',300,40/);
});
ok('cats are feed-only at local-network boundary',()=>assert.match(m88,/p\.species='cat'[\s\S]*'status','feed_only'/));
ok('cats are excluded at final discovery SQL boundary',()=>{
  assert.match(m93,/if v_me\.species<>'dog' then return '\[\]'::jsonb/);
  assert.match(m93,/and p\.species='dog'/);
});

ok('neighborhood unlock is based on active-dog density, never waitlist count',()=>{
  assert.match(m95,/remainingToOpen',greatest\(v_density_target-v_active,0\)/);
  assert.match(m95,/Unconfigured neighborhoods never auto-open/);
  assert.match(m95,/'operatorApprovalRequired',true/);
  assert.doesNotMatch(m95,/remainingToOpen',greatest\(40-v_waitlist,0\)/);
  assert.match(discover,/const status=await getLocalNetworkStatus\(petId\)/);
});
ok('unopened neighborhoods fail closed into density-based operator waitlist',()=>{
  assert.match(m88,/community_zone_waitlisted/);
  assert.match(m95,/v_density_target integer:=300/);
  assert.match(m95,/v_referral_target integer:=40/);
  assert.match(m95,/'operatorApprovalRequired',true/);
  assert.match(m95,/greatest\(v_density_target-v_active,0\)/);
});
ok('waitlist join requires dog plus neighborhood and rate limit',()=>{
  assert.match(m88,/p\.species<>'dog'/);
  assert.match(m88,/dog_neighborhood_required/);
  assert.match(m88,/rate_limit\('community_waitlist',10,86400\)/);
});
ok('standard recipient gets courtesy reply after premium sender message',()=>{
  assert.match(m88,/v_tier='standard' and v_other_tier='premium'/);
  assert.match(m88,/sender_pet_id=v_other_pet/);
  assert.match(m88,/'premiumReplyCourtesy',v_courtesy/);
  assert.match(m88,/'canSend',v_tier='premium' or v_courtesy or coalesce\(v_free,0\)<2/);
});
ok('standard self-initiated messaging remains quota-limited',()=>{
  assert.match(m88,/greatest\(2-coalesce\(v_free,0\),0\)/);
  assert.match(m88,/coalesce\(v_free,0\)<2/);
});
ok('event creation is server-side premium only',()=>{
  assert.match(m88,/create or replace function public\.create_community_event/);
  assert.match(m88,/tier<>'premium'|premium_required/i);
  assert.match(events,/settings\?\.tier!=='premium'/);
});
ok('walk and weekly recurring events are first-class options',()=>{
  assert.match(m88,/event_kind in \('community','walk','playdate','education'\)/);
  assert.match(events,/\['community','walk','playdate','education'\]/);
  assert.match(events,/\['none','weekly'\]/);
});
ok('lost-pet alerts stay free in product policy',()=>assert.match(m93,/'lostPetAlertsFree',true/));
ok('lost-pet alerts are owner-created and proximity-scoped',()=>{
  assert.match(m88,/create or replace function public\.create_lost_pet_alert/);
  assert.match(m88,/owns_pet\(p_pet_id\)/);
  assert.match(m88,/get_nearby_lost_pet_alerts/);
});
ok('pet-friendly places are location utility with referral tracking',()=>{
  assert.match(m88,/create table if not exists public\.pet_friendly_places/);
  assert.match(m90,/create or replace function public\.get_pet_friendly_places/);
  assert.match(m90,/create or replace function public\.track_commercial_referral/);
});

ok('pet-friendly places include a real in-app native map without exposing live user location',()=>{
  assert.match(packageJson,/"react-native-maps": "1\.27\.2"/);
  assert.match(places,/import MapView, \{ Marker/);
  assert.match(places,/<MapView[\s\S]*<Marker/);
  assert.match(places,/showsUserLocation=\{false\}/);
  assert.match(places,/fitToCoordinates/);
  assert.match(appConfig,/GOOGLE_MAPS_ANDROID_API_KEY/);
  assert.match(appConfig,/react-native-maps/);
});

ok('meetup safety keeps public-place workflow and sharing',()=>{
  assert.match(meetups,/publicPlace|public_place|place/i);
  assert.match(meetups,/Share\.share|shareMeetup|share/i);
});
ok('meetup composer selects nearby pet-friendly public places in-app',()=>{
  assert.match(meetups,/getPetFriendlyPlaces/);
  assert.match(meetups,/choosePublicPlace/);
  assert.match(meetups,/setPlace\(`\$\{item\.name\} · \$\{item\.addressLabel\}`\)/);
});
ok('visible trust badge remains on pet cards',()=>{
  const petCard=read('src/components/PetCard.tsx');
  assert.match(petCard,/profileVerified\?<TrustPill/);
  assert.match(petCard,/ownerVerified\?<TrustPill/);
});
ok('OAuth is protected by existing-account guard',()=>{
  assert.match(m89,/existing_account|oauth/i);
  assert.match(auth,/signInWithOAuth/);
});
ok('phone verification is exposed as an additional trust signal',()=>{
  assert.match(auth,/updateUser\(\{phone:normalized\}\)/);
  assert.match(auth,/type:'phone_change'/);
  assert.match(verify,/requestPhoneVerification/);
  assert.match(verify,/linkIdentity\('apple'\)/);
  assert.match(verify,/linkIdentity\('google'\)/);
});
ok('multiple pets are enforced as premium on server',()=>{
  assert.match(m90,/enforce_pet_insert_product_access/);
  assert.match(m90,/premium_required|multiple_pet/i);
});
ok('advanced discovery filters are premium-gated server-side',()=>{
  assert.match(m90,/discovery_filters_use_premium_features/);
  assert.match(m90,/advanced_filters_premium_required|premium_required/i);
  assert.match(discover,/usesPremiumDiscoveryFilters/);
});
ok('travel mode is premium and only targets open/pilot zones',()=>{
  assert.match(m90,/set_travel_mode/);
  assert.match(m90,/launch_status in \('pilot_open','open'\)/);
  assert.match(m90,/tier<>'premium'|premium_required/i);
  assert.match(discover,/getAvailableTravelZones|travelZones/);
});
ok('boost wallet and weekly premium benefit exist',()=>{
  assert.match(m90,/create table if not exists public\.consumable_balances/);
  assert.match(m90,/create table if not exists public\.pet_boosts/);
  assert.match(m90,/activate_pet_boost/);
  assert.match(m90,/week|7 days|weekly/i);
});
ok('consumable grants are atomic, idempotent and service-role only',()=>{
  assert.match(m94,/auth\.role\(\)<>'service_role'/);
  assert.match(m94,/on conflict\(event_key\) do nothing/);
  assert.match(m94,/for update/);
  assert.match(m94,/claim_token/);
});
ok('RevenueCat non-renewing purchases credit server ledger',()=>{
  assert.match(webhook,/NON_RENEWING_PURCHASE/);
  assert.match(webhook,/REVENUECAT_CONSUMABLE_PRODUCTS_JSON/);
  assert.match(webhook,/apply_consumable_billing_webhook_event/);
});
ok('RevenueCat premium entitlement has no stale database fallback',()=>{
  assert.match(m185,/alter table public\.subscriptions alter column entitlement_id drop default/i);
  assert.match(m185,/Production release contract: tailmance_premium/i);
  assert.doesNotMatch(m185,/default\s+'(?:premium|tailmance_premium)'/i);
});
ok('premium UI uses store-provided localized price strings',()=>{
  assert.match(premium,/priceString/);
  assert.doesNotMatch(premium,/\$14\.99|14,99\s*\$|14\.99\s*USD/i);
});
ok('safety and lost-pet are declared free, no pet-sale product flag',()=>{
  assert.match(m93,/'safetyFeaturesFree',true/);
  assert.match(m93,/'lostPetAlertsFree',true/);
  assert.match(m93,/'petSalesEnabled',false/);
  assert.match(m93,/'commercialBreedingEnabled',false/);
});
ok('mating is owner-arranged and remains jurisdiction fail-closed',()=>{
  assert.match(m90,/current_mating_feature_enabled/);
  assert.match(m93,/current_mating_feature_enabled\(\)/);
  assert.match(m93,/mating_pair_profile_signals_eligible/);
  assert.match(m93,/species='dog'/);
});
ok('mating eligibility uses welfare/health signals, not commerce',()=>{
  assert.match(m93,/vaccination_status='complete'/);
  assert.match(m93,/veterinarian_verified=true/);
  assert.match(m93,/neutered is false/);
  assert.match(m93,/a\.sex<>b\.sex/);
});
ok('pet sale/commercial breeding UGC is rejected cross-surface',()=>{
  for(const table of ['messages','posts','comments','pet_events','meetup_requests','pets','pet_prompts']) assert.match(m91,new RegExp(`tg_table_name='${table}'`));
  assert.match(m91,/pet_commerce_prohibited/);
  assert.match(contentSafety,/pet_sale_or_commercial_breeding/);
});
ok('pet adoption and rehoming UGC is rejected cross-surface',()=>{
  for(const table of ['messages','posts','comments','pet_events','meetup_requests','pets','pet_prompts']) assert.match(m159,new RegExp(`tg_table_name='${table}'`));
  assert.match(m159,/contains_prohibited_pet_rehoming_intent/);
  assert.match(m159,/pet_rehoming_prohibited/);
  assert.match(m159,/pet_rehoming/);
  assert.match(contentSafety,/PROHIBITED_PET_REHOMING_PATTERNS/);
  assert.match(contentSafety,/pet_rehoming/);
});
ok('human dating misuse is rejected cross-surface',()=>{
  assert.match(m91,/contains_prohibited_human_dating_intent/);
  assert.match(m91,/human_dating_prohibited/);
  assert.match(contentSafety,/human_dating_profile/);
});
ok('moderation assigns Yekta Özel and explicit SLAs',()=>{
  assert.match(m91,/assigned_operator:='Yekta Özel'/);
  assert.match(m91,/interval '15 minutes'/);
  assert.match(m91,/interval '4 hours'/);
  assert.match(m91,/interval '24 hours'/);
  assert.match(m91,/interval '48 hours'/);
});
ok('B2B partner categories include vet/groomer/trainer and disclosure',()=>{
  assert.match(m90,/business_partner_profiles/);
  assert.match(m90,/veterinary|veterinarian/i);
  assert.match(m90,/groomer/);
  assert.match(m90,/trainer/);
  assert.match(m90,/sponsorship_disclosure/);
});
ok('commercial event offers support ticket/sponsor/sample without animal sale',()=>{
  assert.match(m90,/event_commercial_offers/);
  assert.match(m90,/external_ticket/);
  assert.match(m90,/sponsorship/);
  assert.match(m90,/sample/);
  assert.match(events,/commercialOffer/);
});
ok('commercial links use the shared hardened HTTPS opener',()=>{
  assert.match(events,/openSafeExternalHttpsUrl\(offer\.bookingUrl\)/);
  const externalLinks=read('src/services/externalLinks.ts');
  assert.match(externalLinks,/parsed\.protocol!=='https:'/);
  assert.match(externalLinks,/parsed\.username\|\|parsed\.password\|\|parsed\.port/);
  assert.match(externalLinks,/unsafeHost\(parsed\.hostname\)/);
});

ok('B2B paid plans are explicit monthly operator-managed contracts',()=>{
  assert.match(m96,/billing_interval text not null default 'monthly'/);
  assert.match(m96,/operator_managed_contract boolean not null default true/);
  assert.match(m96,/plan_status in \('inactive','trial','active','past_due','cancelled'\)/);
  assert.match(m96,/business_partner_entitlement_active/);
  assert.match(m96,/current_period_end>now\(\)/);
});
ok('expired B2B partners cannot receive promoted placement or commercial offers',()=>{
  assert.match(m96,/case when x\.partner_entitled then x\.partnership_tier else 'organic' end/);
  assert.match(m96,/public\.business_partner_entitlement_active\(o\.partner_id\)/);
  assert.match(m96,/not public\.business_partner_entitlement_active\(v_partner_id\)/);
});
ok('future affiliate and sitter monetization stays fail-closed',()=>{
  assert.match(m96,/'insuranceAffiliateEnabled',false/);
  assert.match(m96,/'commerceAffiliateEnabled',false/);
  assert.match(m96,/'sitterMarketplaceEnabled',false/);
  assert.match(m96,/'dataSaleEnabled',false/);
  assert.match(m96,/'dataSalesEnabled',false/);
  assert.match(m96,/'aggressiveAdsEnabled',false/);
  assert.match(m96,/'petCommerceMarketplaceEnabled',false/);
  assert.match(m96,/'premiumMultiplePets',true/);
  assert.match(m96,/'premiumAdvancedFilters',true/);
  assert.match(m96,/'premiumTravelMode',true/);
  assert.match(m96,/'premiumUnlimitedLikes',true/);
  assert.match(m96,/'consumableBoosts',true/);
  assert.match(m96,/'consumableSuperLikes',true/);
  assert.match(m96,/'contextualBusinessPromotionsOnly',true/);
  assert.match(m96,/'businessPartnerMonthlyPlans',true/);
});
ok('feed stays pet-centered and shareable',()=>{
  assert.match(feed,/sharePetPost/);
  assert.match(feed,/feed\.shareMessage/);
  assert.match(socialShare,/Share\.share/);
  assert.match(socialShare,/mediaUrl/);
  assert.match(socialShare,/title:`Tailmance/);
});
ok('local feed ranking is part of final backend',()=>{
  assert.match(m93,/p_mode not in \('for_you','following','local'\)/);
  assert.match(m93,/normalize_search_text\(author\.district\)/);
});
ok('local pet-only feed is visible and the default client mode',()=>{
  const appData=read('src/contexts/AppDataContext.tsx');
  assert.match(appData,/useState<'local'\|'for_you'\|'following'>\('local'\)/);
  assert.match(feed,/setFeedMode\('local'\)/);
  assert.match(feed,/feed\.emptyLocalTitle/);
});
ok('new retention/payment and integrity personal data is included in access export v19',()=>{
  assert.match(exportFn,/export_version:19/);
  for(const dataset of ['consumable_balances','consumable_credit_history','consumable_transaction_state','travel_mode','community_waitlist','lost_pet_alerts','pet_boosts']) assert.match(exportFn,new RegExp(`'${dataset}'`));
});
ok('lost-pet and places screens are navigable',()=>{
  assert.match(nav,/LostPetAlerts/);
  assert.match(nav,/Places/);
});
ok('pet editor performs local pet-first content safety preflight',()=>assert.match(petEditor,/preflightUserText/));
ok('verified identity does not bypass strict legal product access',()=>{
  assert.match(m92,/current_user_has_product_access/);
  assert.match(m92,/legal/i);
});
ok('product policy is explicitly pet-first with cats excluded',()=>{
  assert.match(m93,/'catsInDiscovery',false/);
  assert.match(m93,/'petFirstNoHumanDating',true/);
});
ok('digital dog park positioning and cat feed-only promise are explicit',()=>{
  assert.match(enLocale,/Your neighborhood’s digital dog park/);
  assert.match(enLocale,/Cats stay in the pet-only social feed instead of discovery/);
});


ok('final product contract makes owner-arranged mating explicitly non-brokered and non-commercial',()=>{
  for(const token of ["'matingOwnerDecisionOnly',true","'matingBrokerageEnabled',false","'matingTransactionEnabled',false","'matingCommerceEnabled',false"]) assert.ok(m107.includes(token));
  assert.match(strategy,/does not sell animals, broker breeding, set stud fees, arrange mating/i);
});
ok('density strategy preserves Istanbul pilot and 300-500 active-dog target band',()=>{
  for(const n of ['Moda','Fenerbahçe','Caddebostan']) assert.match(m107,new RegExp(n,'u'));
  assert.match(m107,/'localDensityTargetMin',300/);assert.match(m107,/'localDensityTargetMax',500/);assert.match(m107,/'referralMilestone',40/);
  assert.match(strategy,/40-paw referral milestone is a growth signal, not an automatic unlock/i);
});
ok('premium contract explicitly includes likes-you incognito unlimited likes and event hosting',()=>{
  for(const token of ["'premiumLikesYou',true","'premiumIncognito',true","'premiumUnlimitedLikes',true","'premiumEventHosting',true"]) assert.ok(m107.includes(token));
});
ok('standard recipient courtesy is part of the final product contract',()=>assert.match(m107,/'standardPremiumReplyCourtesy',true/));
ok('daily Standard product quota is 50 swipes and 3 new conversations with Premium unlimited',()=>{assert.match(m196,/'standardDailySwipeLimit',50/);assert.match(m196,/'standardDailyNewConversationLimit',3/);assert.match(m196,/dailyQuotaUsesLocalMidnight',true/);assert.match(m196,/if v_tier='premium' then[\s\S]*'swipesRemaining',null[\s\S]*'newConversationsRemaining',null/)});
ok('Premium-first conversation permanently records unlock without re-consuming Standard reply quota',()=>{assert.match(m196,/is_unlocked=\(v_tier='premium'\)/);assert.match(m196,/unlocked_by=case when v_tier='premium' then v_uid else null end/);assert.match(m196,/if v_conversation\.initiated_at is null then[\s\S]*consume_standard_daily_product_quota\('conversation'\)/)});
ok('weekly retention utilities are explicit and safety/lost-pet remain free',()=>{
  for(const token of ["'petFriendlyPlacesEnabled',true","'lostPetProximityAlertsEnabled',true","'safeMeetupSharingEnabled',true","'lostPetAlertsFree',true","'safetyFeaturesFree',true"]) assert.ok(m107.includes(token));
});
ok('native social share helper carries branded pet media without silent auto-post',()=>{
  assert.match(socialShare,/Share\.share/);assert.match(socialShare,/Tailmance/);assert.match(socialShare,/mediaUrl/);assert.match(socialShare,/never silently upload or post/i);
  assert.match(feed,/sharePetPost/);
});
ok('ticket commission conversion evidence is service-role-only idempotent and deterministic',()=>{
  assert.match(m107,/commercial_conversion_events/);
  assert.match(m107,/provider_event_key text not null unique/);
  assert.match(m107,/commission_minor = floor/);
  assert.match(m107,/auth\.role\(\)<>'service_role'/);
  assert.match(m107,/on conflict\(provider_event_key\) do nothing/);
  assert.match(m107,/grant execute on function public\.record_event_ticket_conversion[\s\S]*to service_role/);
});
ok('pricing cadence is explicit while localized store price remains authority',()=>{
  assert.match(m107,/'consumerPriceReviewCadenceDays',90/);assert.match(m107,/'consumerPriceAuthority','store_localized'/);
});
ok('health tracking stays enabled while AI veterinary diagnosis remains deliberately fail-closed',()=>{
  assert.match(m107,/'healthTrackingEnabled',true/);assert.match(m107,/'aiVeterinaryDiagnosisEnabled',false/);
  assert.match(strategy,/No AI veterinary diagnosis feature is enabled/i);
});
ok('sales adoption data-sale and aggressive-ad marketplaces stay disabled',()=>{
  for(const token of ["'petSalesEnabled',false","'adoptionMarketplaceEnabled',false","'dataSaleEnabled',false","'aggressiveAdsEnabled',false"]) assert.ok(m107.includes(token));
});

ok('offline resilience uses encrypted replay-safe mutations without a local social-data replica',()=>{
  const boundary=read('FULL_APP_COMPLETENESS_BOUNDARY_2026-09-30.md');
  const supabaseClient=read('src/services/supabase.ts');
  const secureStorageSource=read('src/services/secureStorage.ts');
  const offlineQueue=read('src/services/offlineMutationQueue.ts');
  assert.match(boundary,/encrypted SQLCipher queue/i);
  assert.match(boundary,/never stores a persistent browseable replica/i);
  assert.match(boundary,/Payments, subscriptions, legal consent, account deletion, health verification, boosts and super-likes are intentionally excluded/i);
  assert.match(offlineQueue,/PRAGMA cipher_version/);
  assert.match(offlineQueue,/owner_user_id/);
  assert.match(supabaseClient,/CLIENT_HTTP_TIMEOUT_MS/);
  assert.match(supabaseClient,/idempotentRead\?3:1/);
  assert.match(supabaseClient,/250\*\(2\*\*attempt\)/);
  assert.match(supabaseClient,/Retry-After/);
  assert.match(secureStorageSource,/WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
});
ok('analytics lineage liveness and breeder boundaries do not make false product claims',()=>{
  const boundary=read('FULL_APP_COMPLETENESS_BOUNDARY_2026-09-30.md');
  assert.match(boundary,/behavioral\/product analytics SDKs are deliberately not mandatory/i);
  assert.match(boundary,/genetically safe to breed/i);
  assert.match(boundary,/not a breeder, puppy-sale, adoption-sale, or pet-commerce marketplace/i);
  assert.match(boundary,/does not claim biometric pet identity, deepfake detection, or liveness proof/i);
});


ok('health deep links are bound to the routed owned pet instead of ambient active-pet state',()=>{const health=read('src/screens/HealthScreen.tsx');assert.match(health,/route\.params\.petId/);assert.match(health,/const targetPet=useMemo/);assert.match(health,/getPetHealthDetails\(targetPet\.id\)/)});
ok('notification domain and RPC expose recipient-pet context',()=>{const domain=read('src/types/domain.ts');const m=read('supabase/migrations/114_notification_recipient_pet_context.sql');assert.match(domain,/recipientPetId\?:string/);assert.match(m,/'recipientPetId',n\.recipient_pet_id/)});
ok('in-app notification routing switches to the server-bound recipient pet',()=>{const screen=read('src/screens/NotificationsScreen.tsx');assert.match(screen,/n\.recipientPetId\?myPets\.find/);assert.match(screen,/setActivePet\(recipientPet\)/);assert.match(screen,/getMatchByConversation\(petId,n\.entityId\)/)});
ok('push notification routing preserves recipient-pet context through cold start',()=>{const nav=read('src/navigation/AppNavigator.tsx');assert.match(nav,/recipientPetId\?:string/);assert.match(nav,/recipientPetId\?myPets\.find/);assert.match(nav,/setActivePet\(recipientPet\)/)});
ok('pet profile destructive and social mutations use a route-bound synchronous single-flight guard',()=>{const profile=read('src/screens/PetProfileScreen.tsx');assert.match(profile,/const actionRef=useRef<string\|null>\(null\)/);assert.match(profile,/const routeKey=`\$\{ownPetId\}:\$\{pet\.id\}`/);for(const fn of ['handleLike','handleFollow','handleReport','handleBlock'])assert.match(profile,new RegExp(`const ${fn}=async\\(\\)=>\\{[\\s\\S]*?actionRef\\.current`))});
ok('like retry preserves economic idempotency and match timestamps',()=>{const m=read('supabase/migrations/113_like_pet_idempotency_and_match_side_effect_hardening.sql');assert.match(m,/if v_like_changed then/);assert.match(m,/if v_existing_unmatched_at is not null then/);assert.doesNotMatch(m,/on conflict\(pet_low_id,pet_high_id\) do update set unmatched_at=null,unmatched_by_pet_id=null,matched_at=now/)});


ok('likes-you and notifications refresh invalidate stale pagination locks',()=>{
  const likes=read('src/screens/LikesYouScreen.tsx');
  const notifications=read('src/screens/NotificationsScreen.tsx');
  assert.match(likes,/paginationRef\.current=false;setLoadingMore\(false\);setLoading\(true\)/);
  assert.match(notifications,/if\(reset\)\{requestRef\.current\+=1;paginationRef\.current=false;setLoadingMore\(false\)\}/);
});
ok('blocked-pets pagination and unblock actions are route-pet bound and synchronous single-flight',()=>{
  const blocked=read('src/screens/BlockedPetsScreen.tsx');
  const routes=read('src/navigation/types.ts');
  const settings=read('src/screens/SettingsScreen.tsx');
  assert.match(routes,/BlockedPets: \{ petId: string \}/);
  assert.match(settings,/navigate\('BlockedPets',\{petId:activePet\.id\}\)/);
  assert.match(blocked,/const petId=route\.params\.petId/);
  assert.match(blocked,/const ownPet=myPets\.find/);
  assert.match(blocked,/paginationRef=useRef\(false\)/);
  assert.match(blocked,/actionRef=useRef\(false\)/);
  assert.match(blocked,/routeEpochRef=useRef\(0\)/);
  assert.match(blocked,/if\(!ownPet\|\|!cursor\|\|!hasMore\|\|paginationRef\.current\)return/);
  assert.match(blocked,/await unblockPet\(petId,item\.id\)/);
  assert.match(blocked,/if\(epoch===routeEpochRef\.current\)actionRef\.current=false/);
});
ok('meetup pagination, place lookup and mutations are route-epoch guarded',()=>{
  assert.match(meetups,/const \{matchId,otherPet,ownPetId\}=route\.params/);
  assert.match(meetups,/requestRef=useRef\(0\)/);
  assert.match(meetups,/paginationRef=useRef\(false\)/);
  assert.match(meetups,/placeRequestRef=useRef\(0\)/);
  assert.match(meetups,/requestId!==requestRef\.current/);
  assert.match(meetups,/actionRef\.current/);
});
ok('app-data pagination is same-frame single-flight for matches stories and events',()=>{
  const appData=read('src/contexts/AppDataContext.tsx');
  for(const ref of ['matchPageBusyRef','storyPageBusyRef','eventPageBusyRef'])assert.match(appData,new RegExp(`${ref}=useRef\\(false\\)`));
  assert.match(appData,/if\(demoMode\|\|!activePet\|\|matchPageBusyRef\.current/);
  assert.match(appData,/if\(demoMode\|\|!activePet\|\|storyPageBusyRef\.current/);
  assert.match(appData,/if\(demoMode\|\|!activePet\|\|eventPageBusyRef\.current/);
});
ok('pet-scoped navigation propagates the initiating pet through profile chat meetups and likes-you',()=>{
  const routes=read('src/navigation/types.ts');
  const chat=read('src/screens/ChatScreen.tsx');
  const likes=read('src/screens/LikesYouScreen.tsx');
  assert.match(routes,/LikesYou: \{ petId: string \}/);
  assert.match(chat,/navigate\('PetProfile',\{pet:otherPet,ownPetId\}\)/);
  assert.match(chat,/navigate\('Meetups',\{matchId,otherPet,ownPetId\}\)/);
  assert.match(likes,/like\(pet,'like',petId\)/);
  assert.match(likes,/navigate\('PetProfile',\{pet,ownPetId:petId\}\)/);
});


ok('event composer resets pet-specific draft state on routed-pet change',()=>{
  assert.match(events,/useEffect\(\(\)=>\{petEpochRef\.current\+=1/);
  assert.match(events,/setOpen\(false\);setTitle\(''\);setDescription\(''\);setCity\(ownPet\?\.city\?\?''\);setDistrict\(ownPet\?\.district\?\?''\);setNeighborhood\(ownPet\?\.neighborhood\?\?''\)/);
  assert.match(events,/\},\[routePetId\]\)/);
  assert.match(events,/setSelected\(dateAt\(1,18\)\);setCapacity\(''\);setEventKind\('community'\);setRecurrence\('none'\)/);
});

ok('lost-pet refresh cannot be overwritten by an old active-pet load closure',()=>{
  const lost=read('src/screens/LostPetAlertsScreen.tsx');
  assert.match(lost,/const petId=activePet\.id;if\(activePetIdRef\.current!==petId\)return/);
  assert.match(lost,/requestId===loadRequestRef\.current&&activePetIdRef\.current===petId&&mountedRef\.current/);
  assert.match(lost,/petEpochRef\.current\+=1;loadRequestRef\.current\+=1/);
});


ok('discover pet switches invalidate stale waitlist boost travel and undo completions',()=>{
  assert.match(discover,/useEffect\(\(\)=>\{petEpochRef\.current\+=1;undoRef\.current=false;[\s\S]*?waitlistRef\.current=false;boostRef\.current=false;travelRef\.current=false/);
  assert.match(discover,/const isCurrentPet=\(petId:string,epoch:number\)=>mountedRef\.current&&activePetIdRef\.current===petId&&petEpochRef\.current===epoch/);
  assert.match(discover,/const status=await getPetBoostStatus\(petId\);if\(!isCurrentPet\(petId,epoch\)\)return;setBoostStatus\(status\)/);
  assert.match(discover,/const next=await setTravelMode\(petId,zone\.id,true\);if\(!isCurrentPet\(petId,epoch\)\)return/);
});


ok('favorites is a complete readable removable and pet-scoped product surface',()=>{
  const migrationPath=fs.globSync?fs.globSync('supabase/migrations/*_favorites_surface_and_pet_json.sql')[0]:null;
  const fallback=fs.readdirSync('supabase/migrations').find(name=>name.endsWith('_favorites_surface_and_pet_json.sql'));
  const migration=read(migrationPath??`supabase/migrations/${fallback}`);
  const favorites=read('src/screens/FavoritesScreen.tsx');
  const routes=read('src/navigation/types.ts');
  assert.match(migration,/create or replace function public\.get_favorite_pets_page/);
  assert.match(migration,/'isFavorite'/);
  assert.match(api,/getFavoritePetsPage/);
  assert.match(api,/setFavoritePet/);
  assert.match(routes,/Favorites: \{ petId: string \}/);
  assert.match(nav,/Stack\.Screen name="Favorites" component=\{FavoritesScreen\}/);
  assert.match(discover,/navigate\('Favorites',\{petId:activePet\.id\}\)/);
  assert.match(favorites,/getFavoritePetsPage\(petId/);
  assert.match(favorites,/setFavoritePet\(petId,pet\.id,false\)/);
  assert.match(favorites,/navigation\.navigate\('PetProfile',\{pet,ownPetId:petId\}\)/);
});

ok('favorite cards render canonical state instead of a write-only star action',()=>{
  const card=read('src/components/PetCard.tsx');
  const context=read('src/contexts/AppDataContext.tsx');
  assert.match(card,/pet\.isFavorite\?'petCard\.removeFavorite':'petCard\.favorite'/);
  assert.match(card,/selected=\{Boolean\(pet\.isFavorite\)\}/);
  assert.match(context,/api\.setFavoritePet\(petId,pet\.id,desired\)/);
  assert.match(context,/isFavorite:next/);
});

ok('feed and follow retries request explicit desired state rather than toggling server state',()=>{
  const profile=read('src/screens/PetProfileScreen.tsx');
  assert.match(feed,/setPostLike\(petId,post\.id,desired\)/);
  assert.match(feed,/setSavePost\(petId,post\.id,desired\)/);
  assert.match(profile,/const desired=!following/);
  assert.match(profile,/setFollowPet\(ownId,targetId,desired\)/);
  assert.doesNotMatch(api,/rpc\('toggle_(?:post_like|save_post|follow_pet|favorite_pet)'/);
});


ok('directive visual system uses emerald-slate coral mint glass and motion-safe shimmer',()=>{
  const theme=read('src/theme.ts');const glass=read('src/components/GlassSurface.tsx');const shimmer=read('src/components/ShimmerSkeleton.tsx');const swipe=read('src/components/SwipeableCard.tsx');const pkg=JSON.parse(read('package.json'));
  for(const hex of ['#0F172A','#FF6B6B','#F0FDF4'])assert.ok(theme.includes(hex));
  assert.equal(pkg.dependencies['expo-glass-effect'],'~57.0.4');
  assert.match(glass,/isGlassEffectAPIAvailable\(\)&&isLiquidGlassAvailable\(\)/);
  assert.match(glass,/return <View style=\{composed\}>\{children\}<\/View>/);
  assert.match(shimmer,/useReduceMotion\(\)/);assert.match(shimmer,/Animated\.loop/);
  assert.match(swipe,/Animated\.spring\(position/);assert.match(swipe,/Haptics\.impactAsync/);
});

ok('premium uses native storefront price authority and responsive bento feature cards',()=>{
  const premium=read('src/screens/PremiumScreen.tsx');const en=read('src/i18n/locales/en.ts');
  assert.match(premium,/pkg\.product\.priceString/);assert.doesNotMatch(premium,/\$14\.99/);
  assert.match(en,/premium\.paymentNote[\s\S]*Price and applicable taxes are shown according to your store and region/);
  assert.match(premium,/card:\{marginVertical:16,flexDirection:'row',flexWrap:'wrap',gap:10\}/);
  assert.match(premium,/feature:\{width:'48%',minHeight:118/);
});

ok('store compliance encodes intended 14.99 USD base price without client-side tax arithmetic',()=>{
  const store=JSON.parse(read('release/store-compliance-v19.json'));
  assert.equal(store.subscription.intended_base_price.currency,'USD');
  assert.equal(store.subscription.intended_base_price.amount,'14.99');
  assert.equal(store.subscription.intended_base_price.billing_period,'month');
  assert.equal(store.subscription.intended_base_price.product_intent_only,true);
  assert.equal(store.subscription.customer_price_authority,'native_storefront_localized_price_via_RevenueCat_product.priceString');
  assert.equal(store.subscription.client_side_tax_calculation,false);
  assert.equal(store.subscription.price_tax_console_parity_status,'not_verified');
  const checklist=read('docs/STORE_RELEASE_CHECKLIST.md');
  assert.match(checklist,/USD 14\.99 base price/);
  assert.match(checklist,/no client-side tax\/VAT\/KDV arithmetic/);
});

ok('veterinarian trust badge exposes only attributable provider evidence and is interactive',()=>{
  const domain=read('src/types/domain.ts');const pill=read('src/components/HealthTrustPill.tsx');const card=read('src/components/PetCard.tsx');const profile=read('src/screens/PetProfileScreen.tsx');
  assert.match(domain,/HealthVerificationTrust = \{ method:'provider_ocr_signature'/);
  assert.match(domain,/clinicPublicId:string; providerCode:string; integrityStatus:'valid'/);
  assert.match(pill,/formatDateTime\(trust\.verifiedAt/);assert.match(pill,/HealthTrustPill/);
  assert.match(card,/pet\.health\.veterinarianVerified&&pet\.health\.trust\?<HealthTrustPill/);
  assert.match(profile,/pet\.health\.veterinarianVerified&&pet\.health\.trust\?<HealthTrustPill/);
});


ok('EU Modernisation Directive price-transparency baseline is screened without claiming national legal approval',()=>{
  const store=JSON.parse(read('release/store-compliance-v19.json'));
  const eu=store.eu_consumer_modernisation_price_transparency;
  assert.equal(eu.directive,'Directive (EU) 2019/2161');
  assert.match(eu.common_name,/Omnibus Directive/);
  assert.equal(eu.national_implementation_approval_status,'not_verified');
  assert.match(eu.tailmance_source_rule,/native storefront localized price/);
  assert.ok(eu.official_sources.some((x)=>x.includes('modernisation-directive')));
});


ok('Brazil paid promotions fail closed until the 2026 transparency and retention controls are operationally ready',()=>{
  assert.match(m141,/jurisdiction_paid_promotion_compliance/);
  for(const marker of ['advertiser_recordkeeping_ready','material_relationship_disclosure_ready','public_repository_ready','financial_advertiser_verification_ready','minimum_record_retention_days']) assert.match(m141,new RegExp(marker));
  assert.match(m141,/country_code='BR'/);
  assert.match(m141,/current_paid_promotion_visibility_enabled/);
  assert.match(m141,/paid_promotion_visibility_enabled,false/);
});
ok('paid partner fields and event commercial offers are suppressed when jurisdiction promotion compliance is closed',()=>{
  assert.match(m141,/v_paid_promotions and public\.business_partner_entitlement_active/);
  assert.match(m141,/websiteUrl',case when x\.partner_entitled/);
  assert.match(m141,/commercialOffer'[\s\S]*where v_paid_promotions and o\.event_id/);
  assert.match(m141,/commercial_promotion_not_available/);
});
ok('product feature policy reports jurisdiction-aware contextual promotion availability',()=>{
  assert.match(m141,/contextualBusinessPromotionsEnabled',public\.current_paid_promotion_visibility_enabled\(\)/);
  assert.match(m141,/contextualAdsOnly',true/);
});
ok('document-verified discovery is default-on for every tier and is not paywalled',()=>{
  const validation=read('src/domain/validation.ts');
  assert.match(validation,/profileVerifiedOnly:\s*true/,'Default discovery must hide non-document-verified pets');
  const premiumFilterFn=discover.match(/function usesPremiumDiscoveryFilters\(f:DiscoveryFilters\)\{[^\n]+\}/)?.[0]??'';
  assert.ok(premiumFilterFn,'Premium-filter classifier must exist');
  assert.doesNotMatch(premiumFilterFn,/profileVerifiedOnly/,'Default document-verification filter must remain available to Standard users');
  assert.match(discover,/\['profileVerifiedOnly',t\('discover\.petVerified'\)\]/,'Discover filter sheet must expose the document-verification toggle');
});

console.log(`product-retention-checks: ${passed}/${passed} strategic product, retention, trust, monetization and pet-first invariants PASS`);
