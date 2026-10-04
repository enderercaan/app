const required=[
  'SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ANON_KEY','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','OAUTH_REVOCATION_CREDENTIAL_KEY_B64','OAUTH_REVOCATION_CREDENTIAL_KEY_VERSION','APPLE_SIGN_IN_TEAM_ID','APPLE_SIGN_IN_KEY_ID','APPLE_SIGN_IN_CLIENT_ID','APPLE_SIGN_IN_PRIVATE_KEY_P8','APPLE_SIGN_IN_NATIVE_CLIENT_ID','GOOGLE_OAUTH_SERVER_CLIENT_ID','GOOGLE_OAUTH_SERVER_CLIENT_SECRET','LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET','APNS_TEAM_ID','APNS_KEY_ID','APNS_VOIP_PRIVATE_KEY_P8','APNS_BUNDLE_ID','APNS_ENVIRONMENT','REVENUECAT_REST_API_KEY','REVENUECAT_WEBHOOK_AUTH','REVENUECAT_WEBHOOK_SIGNING_SECRET','REVENUECAT_WEBHOOK_ENVIRONMENT','REVENUECAT_ALLOWED_APP_IDS_JSON','REVENUECAT_ENTITLEMENT_ID','REVENUECAT_CONSUMABLE_PRODUCTS_JSON',
  'PUSH_WORKER_SECRET','LIVEKIT_ROOM_REAPER_SECRET','STORAGE_GC_SECRET','EXTERNAL_DELETION_WORKER_SECRET','ACCOUNT_DELETION_ADMIN_SECRET','REMINDER_WORKER_SECRET','MODERATION_WORKER_SECRET','MODERATION_ADMIN_SECRET','MODERATION_APPEALS_ADMIN_SECRET','REPORTS_ADMIN_SECRET',
  'MODERATION_API_URL','MODERATION_API_KEY','MODERATION_ALLOWED_HOSTS_JSON','HEALTH_AI_WORKER_SECRET','HEALTH_AI_API_URL','HEALTH_AI_API_KEY','HEALTH_AI_ALLOWED_HOSTS_JSON','HEALTH_AI_PROVIDER_CODE','OPS_HEALTH_SECRET','SECURITY_ADMIN_SECRET','HEALTH_VERIFICATION_WEBHOOK_SECRET','CORS_ALLOWED_ORIGIN','TURNSTILE_SECRET_KEY','TURNSTILE_EXPECTED_HOSTNAME','TURNSTILE_EXPECTED_ACTION','GOOGLE_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON','PLAY_INTEGRITY_PACKAGE_NAME','PLAY_INTEGRITY_ALLOWED_CERT_SHA256','PLAY_INTEGRITY_ALLOWED_VERSION_CODES','PLAY_INTEGRITY_REQUIRE_LICENSED','APPLE_APP_ATTEST_VERIFIER_URL','APPLE_APP_ATTEST_VERIFIER_SECRET','APPLE_APP_ATTEST_APP_ID','APPLE_APP_ATTEST_VERIFIER_ALLOWED_HOSTS_JSON','IDENTITY_PROVIDER_SESSION_URL','IDENTITY_PROVIDER_SECRET','IDENTITY_PROVIDER_RETURN_URL','IDENTITY_PROVIDER_ALLOWED_HOSTS_JSON','IDENTITY_WEBHOOK_SECRET','TAILMANCE_LEGAL_VERSION','TAILMANCE_TERMS_VERSION','TAILMANCE_COMMUNITY_GUIDELINES_VERSION','TAILMANCE_PRIVACY_NOTICE_VERSION'
];
const placeholder=/YOUR_|REPLACE_|xxxxx|example\.com|changeme|placeholder/i;
const failures=[];
const value=(name)=>(process.env[name]??'').trim();

function parseExactHostAllowlist(name){
  const raw=value(name); if(!raw)return [];
  try{
    const parsed=JSON.parse(raw);
    if(!Array.isArray(parsed)||!parsed.length||parsed.length>32||parsed.some(x=>typeof x!=='string'||!/^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])$/.test(x)||/[*/@]/.test(x))) { failures.push(`${name}: must be a non-empty JSON array of exact DNS hostnames`); return []; }
    return [...new Set(parsed.map(x=>x.toLowerCase().replace(/\.$/,'')))];
  }catch{failures.push(`${name}: invalid JSON`);return []}
}
function validateHttpsEndpointAgainstAllowlist(urlName,allowlistName){
  const raw=value(urlName); const allowed=parseExactHostAllowlist(allowlistName); if(!raw||!allowed.length)return;
  try{
    const u=new URL(raw);
    if(u.protocol!=='https:'||u.username||u.password||u.hash||u.search||(u.port&&u.port!=='443')) failures.push(`${urlName}: must be a credential-free HTTPS URL without query/fragment and default TLS port`);
    const host=u.hostname.toLowerCase().replace(/\.$/,'');
    if(!allowed.includes(host)) failures.push(`${urlName}: hostname must be present in ${allowlistName}`);
  }catch{failures.push(`${urlName}: invalid URL`)}
}
for(const name of required){const v=value(name);if(!v)failures.push(`${name}: missing`);else if(placeholder.test(v))failures.push(`${name}: placeholder value`)}
const match=(name,re,msg)=>{const v=value(name);if(v&&!re.test(v))failures.push(`${name}: ${msg}`)};
for(const name of ['TAILMANCE_LEGAL_VERSION','TAILMANCE_TERMS_VERSION','TAILMANCE_COMMUNITY_GUIDELINES_VERSION','TAILMANCE_PRIVACY_NOTICE_VERSION'])match(name,/^[0-9A-Za-z._-]{1,64}$/,'must be a stable version identifier');
for(const name of ['SUPABASE_URL','UPSTASH_REDIS_REST_URL','MODERATION_API_URL','HEALTH_AI_API_URL','IDENTITY_PROVIDER_SESSION_URL','CORS_ALLOWED_ORIGIN','APPLE_APP_ATTEST_VERIFIER_URL'])match(name,/^https:\/\//i,'must use HTTPS');

if(value('LIVEKIT_URL')){
  try{
    const u=new URL(value('LIVEKIT_URL'));
    if(!['wss:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||(u.port&&u.port!=='443')||u.pathname!=='/') failures.push('LIVEKIT_URL: must be a credential-free wss:// or https:// origin using the default TLS port');
  }catch{failures.push('LIVEKIT_URL: invalid URL')}
}
match('LIVEKIT_API_KEY',/^[A-Za-z0-9_-]{10,200}$/,'must be a plausible LiveKit API key');
if(value('LIVEKIT_ROOM_REAPER_SECRET')&&value('LIVEKIT_ROOM_REAPER_SECRET').length<32)failures.push('LIVEKIT_ROOM_REAPER_SECRET: must be at least 32 characters');

match('OAUTH_REVOCATION_CREDENTIAL_KEY_VERSION',/^[A-Za-z0-9._-]{1,40}$/,'must be a stable OAuth credential encryption-key version');
if(value('OAUTH_REVOCATION_CREDENTIAL_KEY_B64')){
  try{const bytes=Buffer.from(value('OAUTH_REVOCATION_CREDENTIAL_KEY_B64'),'base64');if(bytes.length!==32||bytes.toString('base64').replace(/=+$/,'')!==value('OAUTH_REVOCATION_CREDENTIAL_KEY_B64').replace(/=+$/,''))failures.push('OAUTH_REVOCATION_CREDENTIAL_KEY_B64: must be canonical base64 for exactly 32 random bytes')}catch{failures.push('OAUTH_REVOCATION_CREDENTIAL_KEY_B64: invalid base64')}
}
if(value('OAUTH_REVOCATION_CREDENTIAL_PREVIOUS_KEYS_JSON')){
  try{
    const previous=JSON.parse(value('OAUTH_REVOCATION_CREDENTIAL_PREVIOUS_KEYS_JSON'));
    const entries=previous&&typeof previous==='object'&&!Array.isArray(previous)?Object.entries(previous):[];
    if(entries.length>4||entries.some(([version,key])=>! /^[A-Za-z0-9._-]{1,40}$/.test(version)||version===value('OAUTH_REVOCATION_CREDENTIAL_KEY_VERSION')||typeof key!=='string')) failures.push('OAUTH_REVOCATION_CREDENTIAL_PREVIOUS_KEYS_JSON: must be a JSON object of at most four non-current key versions');
    for(const [version,key] of entries){
      const bytes=Buffer.from(String(key),'base64');
      if(bytes.length!==32||bytes.toString('base64').replace(/=+$/,'')!==String(key).replace(/=+$/,'')) failures.push(`OAUTH_REVOCATION_CREDENTIAL_PREVIOUS_KEYS_JSON: ${version} must be canonical base64 for exactly 32 random bytes`);
    }
  }catch{failures.push('OAUTH_REVOCATION_CREDENTIAL_PREVIOUS_KEYS_JSON: invalid JSON')}
}
match('APPLE_SIGN_IN_TEAM_ID',/^[A-Z0-9]{10}$/,'must be the 10-character Apple Developer Team ID');
match('APPLE_SIGN_IN_KEY_ID',/^[A-Z0-9]{10}$/,'must be the 10-character Sign in with Apple key ID');
match('APPLE_SIGN_IN_CLIENT_ID',/^[A-Za-z0-9.-]{3,200}$/,'must be the exact App ID or Services ID used for browser Sign in with Apple authorization');
match('APPLE_SIGN_IN_NATIVE_CLIENT_ID',/^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)+$/,'must be the exact native iOS App ID / bundle identifier used for Sign in with Apple');
if(value('APPLE_SIGN_IN_NATIVE_CLIENT_ID')&&value('APNS_BUNDLE_ID')&&value('APPLE_SIGN_IN_NATIVE_CLIENT_ID')!==value('APNS_BUNDLE_ID'))failures.push('APPLE_SIGN_IN_NATIVE_CLIENT_ID: must equal APNS_BUNDLE_ID for the Tailmance iOS app');
if(value('APPLE_SIGN_IN_PRIVATE_KEY_P8')&&(!value('APPLE_SIGN_IN_PRIVATE_KEY_P8').includes('BEGIN PRIVATE KEY')||value('APPLE_SIGN_IN_PRIVATE_KEY_P8').length<120))failures.push('APPLE_SIGN_IN_PRIVATE_KEY_P8: must contain a complete Sign in with Apple .p8 PKCS#8 private key');
match('GOOGLE_OAUTH_SERVER_CLIENT_ID',/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/,'must be a Google OAuth Web client ID used for native serverAuthCode exchange');
if(value('GOOGLE_OAUTH_SERVER_CLIENT_SECRET')&&(value('GOOGLE_OAUTH_SERVER_CLIENT_SECRET').length<16||/[\s\u0000-\u001f\u007f]/.test(value('GOOGLE_OAUTH_SERVER_CLIENT_SECRET'))))failures.push('GOOGLE_OAUTH_SERVER_CLIENT_SECRET: must be a plausible non-whitespace Google OAuth Web client secret');
if(value('GOOGLE_OAUTH_SERVER_REDIRECT_URI')){try{const u=new URL(value('GOOGLE_OAUTH_SERVER_REDIRECT_URI'));if(u.protocol!=='https:'||u.username||u.password||u.hash||u.search||(u.port&&u.port!=='443'))failures.push('GOOGLE_OAUTH_SERVER_REDIRECT_URI: when set, must be a credential-free HTTPS redirect URI without query/fragment and using the default TLS port')}catch{failures.push('GOOGLE_OAUTH_SERVER_REDIRECT_URI: invalid URL')}}
match('APNS_TEAM_ID',/^[A-Z0-9]{10}$/,'must be the 10-character Apple Developer Team ID');
match('APNS_KEY_ID',/^[A-Z0-9]{10}$/,'must be the 10-character APNs signing key ID');
match('APNS_BUNDLE_ID',/^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)+$/,'must be the exact iOS bundle identifier');
match('APNS_ENVIRONMENT',/^(production|sandbox)$/,'must be production or sandbox');
if(value('APNS_VOIP_PRIVATE_KEY_P8')&&(!value('APNS_VOIP_PRIVATE_KEY_P8').includes('BEGIN PRIVATE KEY')||value('APNS_VOIP_PRIVATE_KEY_P8').length<120))failures.push('APNS_VOIP_PRIVATE_KEY_P8: must contain a complete APNs .p8 PKCS#8 private key');

if(value('CORS_ALLOWED_ORIGIN')){try{const u=new URL(value('CORS_ALLOWED_ORIGIN'));if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||(u.pathname!=='/'&&u.pathname!=='')||(u.port&&u.port!=='443'))failures.push('CORS_ALLOWED_ORIGIN: must be an exact credential-free HTTPS origin')}catch{failures.push('CORS_ALLOWED_ORIGIN: invalid URL')}}
match('IDENTITY_PROVIDER_RETURN_URL',/^tailmance:\/\/verification-complete$/,'must be tailmance://verification-complete');
validateHttpsEndpointAgainstAllowlist('MODERATION_API_URL','MODERATION_ALLOWED_HOSTS_JSON');
validateHttpsEndpointAgainstAllowlist('HEALTH_AI_API_URL','HEALTH_AI_ALLOWED_HOSTS_JSON');
match('HEALTH_AI_PROVIDER_CODE',/^[A-Za-z0-9._-]{2,80}$/,'must be a stable provider identifier');
validateHttpsEndpointAgainstAllowlist('IDENTITY_PROVIDER_SESSION_URL','IDENTITY_PROVIDER_ALLOWED_HOSTS_JSON');
const ageProviderFields=['AGE_ASSURANCE_PROVIDER_SESSION_URL','AGE_ASSURANCE_PROVIDER_SECRET','AGE_ASSURANCE_PROVIDER_ALLOWED_HOSTS_JSON'];
const ageProviderConfigured=ageProviderFields.some(name=>Boolean(value(name)));
if(ageProviderConfigured){
  for(const name of ageProviderFields)if(!value(name))failures.push(`${name}: required when any dedicated age-assurance provider setting is configured`);
  validateHttpsEndpointAgainstAllowlist('AGE_ASSURANCE_PROVIDER_SESSION_URL','AGE_ASSURANCE_PROVIDER_ALLOWED_HOSTS_JSON');
  if(value('AGE_ASSURANCE_PROVIDER_SECRET')&&value('AGE_ASSURANCE_PROVIDER_SECRET').length<20)failures.push('AGE_ASSURANCE_PROVIDER_SECRET: implausibly short');
  match('AGE_ASSURANCE_PROVIDER_RETURN_URL',/^tailmance:\/\/age-verification-complete$/,'must be tailmance://age-verification-complete');
}
validateHttpsEndpointAgainstAllowlist('APPLE_APP_ATTEST_VERIFIER_URL','APPLE_APP_ATTEST_VERIFIER_ALLOWED_HOSTS_JSON');


match('REVENUECAT_ENTITLEMENT_ID',/^tailmance_premium$/,'must equal the production Tailmance entitlement tailmance_premium');
match('REVENUECAT_WEBHOOK_ENVIRONMENT',/^(PRODUCTION|SANDBOX)$/,'must be PRODUCTION or SANDBOX');
if(value('REVENUECAT_CONSUMABLE_PRODUCTS_JSON')){
  try{
    const products=JSON.parse(value('REVENUECAT_CONSUMABLE_PRODUCTS_JSON'));
    const entries=products&&typeof products==='object'&&!Array.isArray(products)?Object.entries(products):[];
    if(!entries.length||entries.length>100||entries.some(([id,def])=>!id||id.length>200||!/^[A-Za-z0-9._-]+$/.test(id)||!def||typeof def!=='object'||!['boost','super_like'].includes(def.kind)||!Number.isInteger(def.quantity)||def.quantity<1||def.quantity>1000)) failures.push('REVENUECAT_CONSUMABLE_PRODUCTS_JSON: must be a non-empty product-id map to {kind: boost|super_like, quantity: 1..1000}');
  }catch{failures.push('REVENUECAT_CONSUMABLE_PRODUCTS_JSON: invalid JSON')}
}
if(value('REVENUECAT_ALLOWED_APP_IDS_JSON')){
  try{
    const ids=JSON.parse(value('REVENUECAT_ALLOWED_APP_IDS_JSON'));
    if(!Array.isArray(ids)||!ids.length||ids.some(x=>typeof x!=='string'||!/^app_[A-Za-z0-9_-]{6,200}$/.test(x))) failures.push('REVENUECAT_ALLOWED_APP_IDS_JSON: must be a non-empty JSON array of RevenueCat app_ identifiers');
  }catch{failures.push('REVENUECAT_ALLOWED_APP_IDS_JSON: invalid JSON')}
}

match('PLAY_INTEGRITY_REQUIRE_LICENSED',/^true$/,'must be true for production release');
match('PLAY_INTEGRITY_PACKAGE_NAME',/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/,'must be an Android package name');
if(value('PLAY_INTEGRITY_ALLOWED_CERT_SHA256')){
  const certs=value('PLAY_INTEGRITY_ALLOWED_CERT_SHA256').split(',').map(x=>x.trim()).filter(Boolean);
  if(!certs.length||certs.some(x=>!/^(?:[A-Fa-f0-9]{64}|[A-Za-z0-9_\-+/]{43,88}={0,2})$/.test(x))) failures.push('PLAY_INTEGRITY_ALLOWED_CERT_SHA256: must contain comma-separated SHA-256 certificate digests');
}
if(value('PLAY_INTEGRITY_ALLOWED_VERSION_CODES')){
  const versions=value('PLAY_INTEGRITY_ALLOWED_VERSION_CODES').split(',').map(x=>x.trim()).filter(Boolean);
  if(!versions.length||versions.some(x=>!/^[1-9][0-9]{0,9}$/.test(x))) failures.push('PLAY_INTEGRITY_ALLOWED_VERSION_CODES: must contain comma-separated positive numeric version codes');
}
match('APPLE_APP_ATTEST_APP_ID',/^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/,'must be TEAMID.bundleIdentifier');
try{const service=JSON.parse(value('GOOGLE_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON')||'{}');if(!service.client_email||!service.private_key)failures.push('GOOGLE_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON: must contain client_email and private_key')}catch{failures.push('GOOGLE_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON: invalid JSON')}


match('TURNSTILE_EXPECTED_HOSTNAME',/^(?!https?:\/\/)[A-Za-z0-9.-]+$/,'must be a bare production hostname');
match('TURNSTILE_EXPECTED_ACTION',/^account_deletion$/,'must be account_deletion');
for(const name of ['SUPABASE_SERVICE_ROLE_KEY','UPSTASH_REDIS_REST_TOKEN','OAUTH_REVOCATION_CREDENTIAL_KEY_B64','APPLE_SIGN_IN_PRIVATE_KEY_P8','GOOGLE_OAUTH_SERVER_CLIENT_SECRET','LIVEKIT_API_SECRET','APNS_VOIP_PRIVATE_KEY_P8','REVENUECAT_REST_API_KEY','REVENUECAT_WEBHOOK_AUTH','REVENUECAT_WEBHOOK_SIGNING_SECRET','PUSH_WORKER_SECRET','LIVEKIT_ROOM_REAPER_SECRET','STORAGE_GC_SECRET','EXTERNAL_DELETION_WORKER_SECRET','ACCOUNT_DELETION_ADMIN_SECRET','REMINDER_WORKER_SECRET','MODERATION_WORKER_SECRET','MODERATION_ADMIN_SECRET','MODERATION_APPEALS_ADMIN_SECRET','REPORTS_ADMIN_SECRET','MODERATION_API_KEY','HEALTH_AI_WORKER_SECRET','HEALTH_AI_API_KEY','OPS_HEALTH_SECRET','SECURITY_ADMIN_SECRET','TURNSTILE_SECRET_KEY','APPLE_APP_ATTEST_VERIFIER_SECRET','IDENTITY_PROVIDER_SECRET','IDENTITY_WEBHOOK_SECRET','HEALTH_VERIFICATION_WEBHOOK_SECRET']){const v=value(name);if(v&&v.length<20)failures.push(`${name}: implausibly short`)}
if(value('HEALTH_AI_WORKER_SECRET')&&value('HEALTH_AI_WORKER_SECRET').length<32)failures.push('HEALTH_AI_WORKER_SECRET: must be at least 32 characters');
if(value('SECURITY_ADMIN_SECRET')&&value('SECURITY_ADMIN_SECRET').length<32)failures.push('SECURITY_ADMIN_SECRET: must be at least 32 characters because security-admin rejects shorter bearer secrets');
for(const name of ['IDENTITY_WEBHOOK_SECRET','HEALTH_VERIFICATION_WEBHOOK_SECRET'])if(value(name)&&value(name).length<32)failures.push(`${name}: must be at least 32 characters for HMAC-SHA256 webhook authentication`);
if(failures.length) throw new Error(`Server production release config failed (${failures.length} issues):\n- ${failures.join('\n- ')}`);
console.log(`server-release-config-check: ${required.length} server values validated`);
