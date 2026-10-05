import { existsSync, readFileSync } from 'node:fs';
const edgeAiDisabledInV1 = JSON.parse(readFileSync('release/edge-ai-model-evidence-v21.json','utf8')).v1_scope_decision?.decision === 'disabled_in_v1_server_moderation_authoritative';
const required = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'EXPO_PUBLIC_REVENUECAT_IOS_API_KEY',
  'EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY',
  'EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID',
  'EXPO_PUBLIC_REVENUECAT_PREMIUM_PACKAGE_ID',
  'EXPO_PUBLIC_REVENUECAT_BOOST_PRODUCT_IDS',
  'EXPO_PUBLIC_REVENUECAT_SUPER_LIKE_PRODUCT_IDS',
  'EXPO_PUBLIC_EAS_PROJECT_ID',
  'EXPO_PUBLIC_IOS_APP_URL',
  'EXPO_PUBLIC_ANDROID_APP_URL',
  'EXPO_PUBLIC_LEGAL_VERSION',
  'EXPO_PUBLIC_TERMS_VERSION',
  'EXPO_PUBLIC_COMMUNITY_GUIDELINES_VERSION',
  'EXPO_PUBLIC_PRIVACY_NOTICE_VERSION',
  'EXPO_PUBLIC_MARKETING_PUSH_CONSENT_VERSION',
  'EXPO_PUBLIC_SENTRY_DSN',
  'EXPO_PUBLIC_AUTH_CHALLENGE_URL',
  'EXPO_PUBLIC_APP_LINK_HOST',
  'EXPO_PUBLIC_EDGE_AI_MODEL_MANIFEST_URL',
  'EXPO_PUBLIC_EDGE_AI_MODEL_MANIFEST_SHA256',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
  'SENTRY_AUTH_TOKEN',
  'EXPO_PUBLIC_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER',
  'GOOGLE_MAPS_ANDROID_API_KEY',
  'GOOGLE_SERVICES_JSON'
].filter(name => !(edgeAiDisabledInV1 && name.includes('_EDGE_AI_')));
const placeholder = /YOUR_|REPLACE_|xxxxx|example\.com|idREPLACE/i;
const failures=[];
const value=(name)=>(process.env[name]??'').trim();
for (const name of required) {
  const v=value(name);
  if(!v) failures.push(`${name}: missing`);
  else if(placeholder.test(v)) failures.push(`${name}: placeholder value`);
}
const match=(name,re,msg)=>{const v=value(name);if(v&&!re.test(v))failures.push(`${name}: ${msg}`)};
match('EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID',/^tailmance_premium$/,'must equal the production Tailmance entitlement tailmance_premium');
match('EXPO_PUBLIC_REVENUECAT_PREMIUM_PACKAGE_ID',/^premium_access$/,'must equal the production RevenueCat package identifier premium_access');
for(const name of ['EXPO_PUBLIC_REVENUECAT_BOOST_PRODUCT_IDS','EXPO_PUBLIC_REVENUECAT_SUPER_LIKE_PRODUCT_IDS']){
  const ids=value(name).split(',').map(x=>x.trim()).filter(Boolean);
  if(!ids.length||ids.length>50||new Set(ids).size!==ids.length||ids.some(id=>id.length>200||!/^[A-Za-z0-9._-]+$/.test(id))) failures.push(`${name}: must be a non-empty unique comma-separated list of store product identifiers`);
}
const boostProductIds=new Set(value('EXPO_PUBLIC_REVENUECAT_BOOST_PRODUCT_IDS').split(',').map(x=>x.trim()).filter(Boolean));
const superLikeProductIds=new Set(value('EXPO_PUBLIC_REVENUECAT_SUPER_LIKE_PRODUCT_IDS').split(',').map(x=>x.trim()).filter(Boolean));
const overlappingConsumables=[...boostProductIds].filter(id=>superLikeProductIds.has(id));
if(overlappingConsumables.length)failures.push('RevenueCat consumable product identifiers must map to exactly one client product kind');
for (const name of ['EXPO_PUBLIC_LEGAL_VERSION','EXPO_PUBLIC_TERMS_VERSION','EXPO_PUBLIC_COMMUNITY_GUIDELINES_VERSION','EXPO_PUBLIC_PRIVACY_NOTICE_VERSION','EXPO_PUBLIC_MARKETING_PUSH_CONSENT_VERSION']) match(name,/^[0-9A-Za-z._-]{1,64}$/,'must be an explicit version identifier');
if(value('EXPO_PUBLIC_APP_ENV')!=='production') failures.push('EXPO_PUBLIC_APP_ENV: must be production');
if(value('EXPO_PUBLIC_ENABLE_DEMO')==='true') failures.push('EXPO_PUBLIC_ENABLE_DEMO: demo mode must be disabled');
match('EXPO_PUBLIC_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER',/^\d{6,20}$/,'must be the numeric Google Cloud project number');
match('GOOGLE_MAPS_ANDROID_API_KEY',/^[A-Za-z0-9_-]{20,200}$/,'must be a plausible Android Google Maps API key restricted in Google Cloud to the Tailmance Android package and release signing certificate');

const googleServicesPath=value('GOOGLE_SERVICES_JSON');
if(googleServicesPath){
  if(!existsSync(googleServicesPath)) failures.push('GOOGLE_SERVICES_JSON: file does not exist at the supplied build-time path');
  else try{
    const googleServices=JSON.parse(readFileSync(googleServicesPath,'utf8'));
    const androidClients=Array.isArray(googleServices?.client)?googleServices.client:[];
    const matchingClient=androidClients.find(client=>client?.client_info?.android_client_info?.package_name==='com.tailmance.app');
    if(!matchingClient) failures.push('GOOGLE_SERVICES_JSON: missing Android client for com.tailmance.app');
    const apiKeys=Array.isArray(matchingClient?.api_key)?matchingClient.api_key:[];
    if(!apiKeys.some(entry=>typeof entry?.current_key==='string'&&entry.current_key.trim().length>=20)) failures.push('GOOGLE_SERVICES_JSON: matching Android client has no plausible API key');
    if(typeof googleServices?.project_info?.project_id!=='string'||!googleServices.project_info.project_id.trim()) failures.push('GOOGLE_SERVICES_JSON: project_info.project_id missing');
  }catch{failures.push('GOOGLE_SERVICES_JSON: invalid JSON');}
}
match('EXPO_PUBLIC_EAS_PROJECT_ID',/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,'must be a UUID');
match('EXPO_PUBLIC_SUPABASE_URL',/^https:\/\/[^/]+\.supabase\.co$/i,'must be an HTTPS Supabase project URL');
match('EXPO_PUBLIC_SENTRY_DSN',/^https:\/\/[^\s]+$/i,'must use HTTPS');
match('EXPO_PUBLIC_AUTH_CHALLENGE_URL',/^https:\/\/[^\s?#]+(?:[/?][^\s#]*)?$/i,'must be an HTTPS auth challenge page');
match('EXPO_PUBLIC_APP_LINK_HOST',/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,'must be a bare public DNS hostname without scheme, path, wildcard, port, localhost, or IP literal');
if(!edgeAiDisabledInV1)match('EXPO_PUBLIC_EDGE_AI_MODEL_MANIFEST_URL',/^https:\/\/[^\s?#]+(?:\?[^\s#]*)?$/i,'must be a credential-free HTTPS model-manifest URL');
if(!edgeAiDisabledInV1)match('EXPO_PUBLIC_EDGE_AI_MODEL_MANIFEST_SHA256',/^[a-f0-9]{64}$/i,'must be the exact SHA-256 of the approved model manifest');
if(value('EXPO_PUBLIC_EDGE_AI_MODEL_MANIFEST_URL')){try{const u=new URL(value('EXPO_PUBLIC_EDGE_AI_MODEL_MANIFEST_URL'));if(u.username||u.password||u.hash)failures.push('EXPO_PUBLIC_EDGE_AI_MODEL_MANIFEST_URL: credentials and fragments are forbidden')}catch{failures.push('EXPO_PUBLIC_EDGE_AI_MODEL_MANIFEST_URL: invalid URL')}}
if(value('SENTRY_AUTH_TOKEN') && value('SENTRY_AUTH_TOKEN').length<20) failures.push('SENTRY_AUTH_TOKEN: implausibly short');
for (const name of ['EXPO_PUBLIC_IOS_APP_URL','EXPO_PUBLIC_ANDROID_APP_URL']) match(name,/^https:\/\//i,'must use HTTPS');
if(failures.length) throw new Error(`Client production release config failed (${failures.length} issues):\n- ${failures.join('\n- ')}`);
console.log(`release-config-check: ${required.length} required values validated`);
