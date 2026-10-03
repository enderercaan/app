import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

const read=(p)=>readFileSync(p,'utf8');
const authScreen=read('src/screens/AuthScreen.tsx');
const authService=read('src/services/auth.ts');
const authContext=read('src/contexts/AuthContext.tsx');
const secureStorage=read('src/services/secureStorage.ts');
const appConfig=read('app.config.ts');
const brand=JSON.parse(read('brand.json'));
const settings=read('src/screens/SettingsScreen.tsx');
const oauthGuard=read('supabase/migrations/089_oauth_existing_account_only_guard.sql');
const verifiedIdentity=read('supabase/migrations/092_verified_identity_parity_strict_legal_gate.sql');
const oauthRevocation=read('supabase/functions/_shared/oauthRevocation.ts');
const oauthRevocationMigration=read('supabase/migrations/194_oauth_provider_revocation_credentials.sql');
const oauthClientBindingMigration=read('supabase/migrations/195_native_social_auth_revocation_client_binding.sql');
const serverRelease=read('scripts/server-release-config-check.mjs');
const notice=read('NOTICE.md');

assert.match(appConfig,/usesAppleSignIn:\s*true/,'iOS config must enable Sign in with Apple capability');
assert.match(authScreen,/mode==='login'[\s\S]*socialSignIn\('apple'\)[\s\S]*socialSignIn\('google'\)/,'Apple/Google entry points must remain login-only in the UI');
assert.match(authScreen,/mode==='signup'[\s\S]*age18[\s\S]*preRegistrationReady/,'Sign-up UI must require 18+ and verified pre-registration legal presentation');
assert.match(authService,/validatePreRegistrationPresentation\(acceptedAge18,presented\)/,'Email sign-up must revalidate the age/legal presentation in the service layer');
assert.match(authService,/shouldCreateUser:mode==='signup'/,'Phone login must not silently create an account');
assert.match(authService,/captchaToken/,'Auth flows must bind an anti-abuse challenge token');
assert.match(oauthGuard,/before insert on auth\.users/,'OAuth first-account guard must run before auth.users insertion');
assert.match(oauthGuard,/v_provider in \('google','apple'\)[\s\S]*not v_prelegal/,'Apple/Google first-account creation must fail without canonical prelegal age evidence');
assert.match(verifiedIdentity,/email_confirmed_at is not null or au\.phone_confirmed_at is not null/,'Legal acceptance must require a verified contact identity');
assert.match(secureStorage,/WHEN_UNLOCKED_THIS_DEVICE_ONLY/,'Native auth storage must use device-only Keychain accessibility');
assert.match(oauthRevocationMigration,/create table if not exists public\.oauth_revocation_credentials/,'OAuth revocation credentials must have a private durable server vault');
assert.match(oauthClientBindingMigration,/provider_client_id/,'OAuth revocation credentials must bind the exact provider client identifier used to mint the token');
assert.match(serverRelease,/APPLE_SIGN_IN_NATIVE_CLIENT_ID/,'production release validation must require the native Apple client identifier');
assert.match(serverRelease,/GOOGLE_OAUTH_SERVER_CLIENT_ID/,'production release validation must require the Google server OAuth client identifier');
assert.match(oauthRevocation,/appleid\.apple\.com\/auth\/revoke/,'Sign in with Apple deletion revocation must use Apple revoke endpoint');
assert.match(oauthRevocation,/oauth2\.googleapis\.com\/revoke/,'Google deletion revocation must use Google revoke endpoint');
assert.match(oauthRevocation,/OAUTH_REVOCATION_CREDENTIAL_PREVIOUS_KEYS_JSON[\s\S]*entries\.length>4/,'OAuth credential encryption must support bounded key rotation');
assert.match(authContext,/current_session_not_revoked/,'Bootstrap must reject revoked server sessions');
assert.match(authContext,/bootstrapStatus:'error'/,'Bootstrap network/security failure must have an explicit fail-closed error state');
assert.match(settings,/TAILMANCE_BRAND/,'Settings must render centralized ownership metadata');
assert.equal(brand.owner,'Yekta Özel','Owner must be Yekta Özel');
assert.equal(brand.trademark,'Tailmance™','Unregistered trademark marker must be Tailmance™');
assert.doesNotMatch(`${JSON.stringify(brand)}\n${settings}\n${notice}`,/Tailmance®|Yekta Özel®/,'Registered-mark symbol must not be claimed without verified registration');
assert.match(notice,/user-generated content[\s\S]*retain/i,'IP notice must not misappropriate user-generated content');
assert.match(notice,/Third-party open-source software[\s\S]*respective licenses/i,'IP notice must preserve third-party license rights');

const localeFiles=readdirSync('src/i18n/locales').filter(x=>x.endsWith('.ts')).sort();
const requiredKeys=['settings.sectionAbout','settings.ownerTitle','settings.ownerBody','settings.rightsNotice','settings.trademarkNotice'];
for(const file of localeFiles){
  const source=read(`src/i18n/locales/${file}`);
  for(const key of requiredKeys)assert.ok(source.includes(`"${key}"`),`${file} missing ${key}`);
  for(const variable of ['{owner}'])assert.ok(source.includes(variable),`${file} ownership strings must preserve ${variable}`);
  assert.ok(source.includes('{year}'),`${file} rights notice must preserve {year}`);
  assert.ok(source.includes('{mark}'),`${file} trademark notice must preserve {mark}`);
}
assert.equal(localeFiles.length,19,'All 19 runtime locale catalogs must be covered by Module 1 ownership/LQA checks');

console.log(`module1-core-auth-age-checks: auth/age/session/ownership invariants + ${localeFiles.length}/${localeFiles.length} locale ownership surfaces PASS`);
