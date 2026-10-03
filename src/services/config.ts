const value=(input:string|undefined):string=>input?.trim()??'';
const isPlaceholder=(input:string)=>!input||/YOUR_|REPLACE_|xxxxx|example\.com/i.test(input);

export const env = {
  supabaseUrl: value(process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: value(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
  revenueCatIosApiKey: value(process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY),
  revenueCatAndroidApiKey: value(process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY),
  revenueCatEntitlementId: value(process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID),
  revenueCatPremiumPackageId: value(process.env.EXPO_PUBLIC_REVENUECAT_PREMIUM_PACKAGE_ID),
  revenueCatBoostProductIds: value(process.env.EXPO_PUBLIC_REVENUECAT_BOOST_PRODUCT_IDS).split(',').map(x=>x.trim()).filter(Boolean),
  revenueCatSuperLikeProductIds: value(process.env.EXPO_PUBLIC_REVENUECAT_SUPER_LIKE_PRODUCT_IDS).split(',').map(x=>x.trim()).filter(Boolean),
  iosAppUrl: value(process.env.EXPO_PUBLIC_IOS_APP_URL),
  androidAppUrl: value(process.env.EXPO_PUBLIC_ANDROID_APP_URL),
  sentryDsn: value(process.env.EXPO_PUBLIC_SENTRY_DSN),
  authChallengeUrl: value(process.env.EXPO_PUBLIC_AUTH_CHALLENGE_URL),
  appLinkHost: value(process.env.EXPO_PUBLIC_APP_LINK_HOST).toLowerCase(),
  edgeAiManifestUrl: value(process.env.EXPO_PUBLIC_EDGE_AI_MODEL_MANIFEST_URL),
  edgeAiManifestSha256: value('EXPO_PUBLIC_EDGE_AI_MODEL_MANIFEST_SHA256').toLowerCase(),
  playIntegrityCloudProjectNumber: value(process.env.EXPO_PUBLIC_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER),
  googleWebClientId: value(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID),
  appEnv: value(process.env.EXPO_PUBLIC_APP_ENV) || 'development',
  legalVersion: value(process.env.EXPO_PUBLIC_LEGAL_VERSION) || '2026-09-28-v19',
  termsVersion: value(process.env.EXPO_PUBLIC_TERMS_VERSION) || value(process.env.EXPO_PUBLIC_LEGAL_VERSION) || '2026-09-28-v19',
  communityGuidelinesVersion: value(process.env.EXPO_PUBLIC_COMMUNITY_GUIDELINES_VERSION) || value(process.env.EXPO_PUBLIC_LEGAL_VERSION) || '2026-09-28-v19',
  privacyNoticeVersion: value(process.env.EXPO_PUBLIC_PRIVACY_NOTICE_VERSION) || value(process.env.EXPO_PUBLIC_LEGAL_VERSION) || '2026-09-28-v19',
  marketingPushConsentVersion: value(process.env.EXPO_PUBLIC_MARKETING_PUSH_CONSENT_VERSION) || '2026-09-28-v19',
  enableDemo: value(process.env.EXPO_PUBLIC_ENABLE_DEMO) === 'true'
};

const backendUrlIsAllowed = env.appEnv==='production' ? /^https:\/\//i.test(env.supabaseUrl) : /^https?:\/\//i.test(env.supabaseUrl);

export const isBackendConfigured = Boolean(
  !isPlaceholder(env.supabaseUrl) && backendUrlIsAllowed &&
  !isPlaceholder(env.supabaseAnonKey) && env.supabaseAnonKey.length > 20
);
export const isDemoEnabled = !isBackendConfigured && env.enableDemo && env.appEnv !== 'production';
export const isPurchasesConfigured = (platform:'ios'|'android') => {
  const key=platform==='ios'?env.revenueCatIosApiKey:env.revenueCatAndroidApiKey;
  return !isPlaceholder(key) && !isPlaceholder(env.revenueCatEntitlementId) && !isPlaceholder(env.revenueCatPremiumPackageId);
};
