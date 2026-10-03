import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

const read=p=>readFileSync(p,'utf8');
const migration=read('supabase/migrations/194_oauth_provider_revocation_credentials.sql');
const capture=read('supabase/functions/oauth-credential-capture/index.ts');
const shared=read('supabase/functions/_shared/oauthRevocation.ts');
const deletion=read('supabase/functions/_shared/accountDeletion.ts');
const worker=read('supabase/functions/external-deletion-worker/index.ts');
const client=read('src/services/supabase.ts');
const auth=read('src/services/auth.ts');
const paused=read('src/screens/PausedAccountScreen.tsx');
const suspended=read('src/screens/SuspendedAccountScreen.tsx');
const legalGateActions=read('src/components/LegalGateAccountActions.tsx');
const config=read('supabase/config.toml');
const env=read('supabase/.env.example');

assert.match(migration,/external_deletion_queue_provider_check[\s\S]*revenuecat[\s\S]*apple[\s\S]*google/i,'external deletion queue must explicitly accept RevenueCat, Apple and Google');
assert.match(migration,/create table if not exists public\.oauth_revocation_credentials[\s\S]*token_ciphertext[\s\S]*token_iv[\s\S]*key_version/i,'encrypted OAuth revocation credential vault is required');
assert.doesNotMatch(migration,/oauth_revocation_credentials[\s\S]{0,600}references\s+auth\.users/i,'OAuth revocation credential must survive auth.users hard delete');
assert.match(migration,/enable row level security[\s\S]*revoke all on table public\.oauth_revocation_credentials from public,anon,authenticated/i,'OAuth credential vault must be private');
assert.match(migration,/service_prepare_oauth_revocation[\s\S]*auth\.role\(\)<>'service_role'[\s\S]*external_deletion_queue/i,'only service role may queue provider revocation');
assert.match(migration,/service_expire_oauth_revocation_credentials[\s\S]*oauth_credential_retention_expired_manual_required/i,'expired post-delete provider secrets must be destroyed and surfaced operationally');

assert.match(capture,/authenticatedUser\(req\)/,'capture must require an authenticated Tailmance user');
assert.match(capture,/requireDeviceIntegrityIfEnforced[\s\S]*oauth_credential_capture/,'capture must use device-integrity policy');
assert.match(capture,/identityProviders[\s\S]*oauth_identity_not_linked/,'capture must reject credentials for identities not linked to the authenticated account');
assert.match(capture,/sealOauthCredential/,'capture must encrypt provider tokens before persistence');
assert.doesNotMatch(capture,/json\(\{[^}]*token(?:Ciphertext|Iv|:)/i,'capture response must never echo provider tokens or ciphertext');

assert.match(shared,/AES-GCM/,'provider credential encryption must use AES-GCM');
assert.match(shared,/keyBytes\.length!==32/,'OAuth credential encryption key must be 256-bit');
assert.match(shared,/OAUTH_REVOCATION_CREDENTIAL_PREVIOUS_KEYS_JSON/,'OAuth revocation encryption must support bounded prior-key rotation');
assert.match(shared,/entries\.length>4/,'OAuth revocation prior-key ring must be bounded');
assert.match(shared,/cfg\.keys\.get\(row\.key_version\)/,'decryption must select credential key material by persisted key version');
assert.match(shared,/additionalData:aad\(/,'ciphertext must be context-bound with authenticated additional data');
assert.match(shared,/https:\/\/appleid\.apple\.com\/auth\/revoke/,'Apple revocation must target the official Sign in with Apple revoke endpoint');
assert.match(shared,/https:\/\/oauth2\.googleapis\.com\/revoke/,'Google revocation must target the official OAuth revoke endpoint');
assert.match(shared,/alg:'ES256'[\s\S]*aud:'https:\/\/appleid\.apple\.com'/,'Apple client secret must be a server-signed ES256 JWT for Apple');
assert.match(shared,/APPLE_SIGN_IN_PRIVATE_KEY_P8/,'Apple private key must stay server-side');

assert.match(client,/OAUTH_CAPTURE_CREDENTIAL_KEY[\s\S]*secureStorage\.setItem/,'callback credential buffering must use platform SecureStore');
assert.match(client,/provider_refresh_token[\s\S]*provider_token/,'callback must prefer a provider refresh token and fall back to access token');
assert.match(client,/functions\.invoke\('oauth-credential-capture'/,'captured provider credential must be transmitted only to the authenticated Edge capture function');
assert.match(client,/secureStorage\.removeItem\(OAUTH_CAPTURE_CREDENTIAL_KEY\)/,'client-side provider credential must be removed after confirmed server capture');
assert.match(client,/queued_retry/,'temporary server-capture failure must remain an explicit bounded SecureStore retry state');
assert.match(client,/if\(exchanged\)await supabase\.auth\.signOut/,'hard OAuth credential-protection failure after code exchange must fail closed by removing the local session');
assert.match(auth,/markPendingOAuthProviderCapture\(provider\)[\s\S]*signInWithOAuth/,'social sign-in must bind callback credential capture to the intended provider');
assert.match(auth,/markPendingOAuthProviderCapture\(provider\)[\s\S]*linkIdentity/,'identity linking must bind callback credential capture to the intended provider');
assert.match(auth,/provider==='google'[\s\S]*access_type:'offline'[\s\S]*prompt:'consent'/,'Google OAuth must request offline consent so a durable provider refresh token can be captured when Google returns one');
assert.match(paused,/finalizeDeletedAccountSession\(\)/,'paused-account deletion must use post-hard-delete local cleanup that does not depend on authenticated server endpoints');
assert.match(paused,/manualProviderRevocations[\s\S]*oauthRevocationManualBody/,'paused-account deletion must surface localized manual provider-revocation guidance when automatic revocation is impossible');
assert.match(suspended,/manualProviderRevocations[\s\S]*oauthRevocationManualBody/,'suspended-account deletion must surface localized manual provider-revocation guidance when automatic revocation is impossible');
assert.match(legalGateActions,/manualProviderRevocations[\s\S]*oauthRevocationManualBody/,'normal account deletion must surface localized manual provider-revocation guidance when automatic revocation is impossible');

assert.match(deletion,/prepareOauthRevocations[\s\S]*authRecord\.user/,'account deletion must inspect linked OAuth identities before deleting Auth identity');
assert.match(deletion,/revokeStoredOauthCredential[\s\S]*oauth_cleanup_pending/,'account deletion must attempt provider revocation and retain durable retry on provider failure');
assert.match(deletion,/manualProviderRevocations:oauthRevocations\.manualRequired/,'missing historic provider tokens must return a manual-revocation requirement without blocking account deletion');
assert.match(deletion,/oauth_cleanup_pending:[^`]*[\s\S]*manualRequired\.includes\(provider\)[\s\S]*manualRequired\.push\(provider\)/,'provider revoke failure must preserve durable retry and also surface a manual fallback before the deleted user loses app access');
assert.match(worker,/row\.provider==='apple'\|\|row\.provider==='google'[\s\S]*revokeStoredOauthCredential/,'durable deletion worker must retry Apple and Google revocation');
assert.match(worker,/service_expire_oauth_revocation_credentials/,'worker must enforce bounded retention of deletion-time provider credentials');
assert.match(worker,/currentOauthRevocationKeyVersion[\s\S]*neq\('key_version',currentKeyVersion\)[\s\S]*rewrapStoredOauthCredential/,'scheduled deletion worker must progressively re-wrap stored provider credentials after key rotation');
assert.match(worker,/limit\(100\)/,'OAuth key rotation work per invocation must be bounded');
assert.match(shared,/rewrapStoredOauthCredential[\s\S]*eq\('key_version',row\.key_version\)/,'credential re-wrap must be concurrency-safe against a newer key-version write');

assert.match(config,/\[functions\.oauth-credential-capture\][\s\S]*verify_jwt\s*=\s*true/,'OAuth credential capture must have JWT verification enabled');
for(const key of ['OAUTH_REVOCATION_CREDENTIAL_KEY_B64','OAUTH_REVOCATION_CREDENTIAL_KEY_VERSION','OAUTH_REVOCATION_CREDENTIAL_PREVIOUS_KEYS_JSON','APPLE_SIGN_IN_TEAM_ID','APPLE_SIGN_IN_KEY_ID','APPLE_SIGN_IN_CLIENT_ID','APPLE_SIGN_IN_PRIVATE_KEY_P8','APPLE_SIGN_IN_NATIVE_CLIENT_ID','GOOGLE_OAUTH_SERVER_CLIENT_ID','GOOGLE_OAUTH_SERVER_CLIENT_SECRET','GOOGLE_OAUTH_SERVER_REDIRECT_URI'])assert.match(env,new RegExp(`^${key}=`,`m`),`server env template missing ${key}`);
const serverRelease=read('scripts/server-release-config-check.mjs');
for(const key of ['APPLE_SIGN_IN_NATIVE_CLIENT_ID','GOOGLE_OAUTH_SERVER_CLIENT_ID','GOOGLE_OAUTH_SERVER_CLIENT_SECRET'])assert.match(serverRelease,new RegExp(`'${key}'`),`production release gate must require ${key}`);
assert.match(serverRelease,/GOOGLE_OAUTH_SERVER_REDIRECT_URI[\s\S]*credential-free HTTPS redirect URI/,'production release gate must validate an explicitly configured Google OAuth redirect URI without incorrectly requiring one for native server-auth-code exchange');
assert.match(serverRelease,/APPLE_SIGN_IN_NATIVE_CLIENT_ID[\s\S]*APNS_BUNDLE_ID/,'production release gate must bind Apple native authorization client ID to the shipped iOS bundle identifier');

const locales=readdirSync('src/i18n/locales').filter(name=>name.endsWith('.ts'));
let covered=0;
for(const file of locales){
  const body=read(`src/i18n/locales/${file}`);
  if(!body.includes('"settings.oauthRevocationManualTitle"'))continue;
  assert.match(body,/"settings\.oauthRevocationManualBody"\s*:\s*"[^"]*\{providers\}/,`${file} manual OAuth revocation copy must preserve {providers}`);
  covered++;
}
assert.equal(covered,19,'manual OAuth revocation guidance must be localized in every runtime locale');

console.log('oauth-revocation-checks: encrypted capture, Apple/Google revoke, durable retry, bounded retention and 19/19 manual fallback PASS');
