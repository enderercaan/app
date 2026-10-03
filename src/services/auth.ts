import {Platform} from 'react-native';
import {clearLocalOAuthRevocationCapture,flushPendingOAuthRevocationCredential,markPendingOAuthProviderCapture,supabase} from './supabase';
import { logOutPurchases } from './purchases';
import { clearLocalPushState, disableAllPushTokens, restorePushTokens, unregisterCurrentPushToken } from './notifications';
import { getRuntimeLocale, translate } from '../i18n';
import type { PreRegistrationLegalPresentation } from '../types/domain';
import { getPreRegistrationLegalPresentation } from './preRegistrationLegal';
import type { LegalMarketCountryCode } from '../data/legalMarkets';
import { passwordMeetsPolicy } from '../domain/passwordPolicy';
import { clearAllDurableClientOperations } from './clientOperation';
import { clearOfflineMutationQueue } from './offlineMutationQueue';
import { unregisterOfflineBackgroundSync } from './offlineSyncTask';
import { requestNativeAuthCaptcha } from './authChallenge';
import { env } from './config';
import { runBestEffort } from './bestEffort';
import { signInWithNativeSocialProvider } from './nativeSocialAuth';

async function validatePreRegistrationPresentation(acceptedAge18:boolean,presented:PreRegistrationLegalPresentation){
  if(!acceptedAge18)throw new Error(translate(getRuntimeLocale(),'auth.serviceAgeRequired'));
  const uiLocale=getRuntimeLocale();
  if(presented.status!=='ready'||!presented.preRegistrationBundleId||!presented.routeRevision||!presented.declaredCountryCode||presented.uiLocale!==uiLocale||!presented.presentationSha256)throw new Error('pre_registration_legal_presentation_not_ready');
  const current=await getPreRegistrationLegalPresentation(presented.declaredCountryCode as LegalMarketCountryCode,uiLocale,presented.declaredSubnationalCode??null);
  if(current.status!=='ready'||current.preRegistrationBundleId!==presented.preRegistrationBundleId||current.routeRevision!==presented.routeRevision||current.declaredCountryCode!==presented.declaredCountryCode||current.uiLocale!==uiLocale||current.documentLocale!==presented.documentLocale||current.declaredSubnationalCode!==presented.declaredSubnationalCode||current.subnationalScopeMode!==presented.subnationalScopeMode||current.subnationalScopeEvidenceSha256!==presented.subnationalScopeEvidenceSha256||current.presentationSha256!==presented.presentationSha256)throw new Error('pre_registration_legal_presentation_changed');
  return {uiLocale,current};
}

function preLegalMetadata(uiLocale:string,presented:PreRegistrationLegalPresentation){
  return {prelegal_age_attested:true,prelegal_age_attestation_version:'tailmance_age18_signup_v1',prelegal_age_attestation_locale:uiLocale,pre_registration_declared_country_code:presented.declaredCountryCode,pre_registration_declared_subnational_code:presented.declaredSubnationalCode??null,pre_registration_subnational_scope_mode:presented.subnationalScopeMode,pre_registration_subnational_scope_evidence_sha256:presented.subnationalScopeEvidenceSha256,pre_registration_bundle_id:presented.preRegistrationBundleId,pre_registration_route_revision:presented.routeRevision,pre_registration_presentation_sha256:presented.presentationSha256};
}

export async function signUp(email:string,password:string,acceptedAge18:boolean,presented:PreRegistrationLegalPresentation){
  if(!passwordMeetsPolicy(password))throw new Error(translate(getRuntimeLocale(),'auth.servicePasswordShort'));
  const {uiLocale}=await validatePreRegistrationPresentation(acceptedAge18,presented);
  const captchaToken=await requestNativeAuthCaptcha('sign_up');
  const {data,error}=await supabase.auth.signUp({email:email.trim().toLowerCase(),password,options:{emailRedirectTo:'tailmance://auth/callback',data:preLegalMetadata(uiLocale,presented),captchaToken}});
  if(error)throw error;
  if(data.session&&!data.user?.email_confirmed_at)await supabase.auth.signOut({scope:'local'}).catch(()=>undefined);
  return data;
}

export async function requestPhoneOtp(phone:string,mode:'login'|'signup',acceptedAge18=false,presented?:PreRegistrationLegalPresentation|null){
  const normalized=phone.replace(/[\s()-]/g,'').trim();
  if(!/^\+[1-9]\d{7,14}$/.test(normalized))throw new Error('phone_invalid');
  let metadata:Record<string,unknown>|undefined;
  if(mode==='signup'){
    if(!presented)throw new Error('pre_registration_legal_presentation_not_ready');
    const {uiLocale}=await validatePreRegistrationPresentation(acceptedAge18,presented);
    metadata=preLegalMetadata(uiLocale,presented);
  }
  const captchaToken=await requestNativeAuthCaptcha('phone_otp');
  const {error}=await supabase.auth.signInWithOtp({phone:normalized,options:{shouldCreateUser:mode==='signup',data:metadata,captchaToken}});
  if(error)throw error;
  return normalized;
}

export async function verifyPhoneOtp(phone:string,token:string){
  const normalized=phone.replace(/[\s()-]/g,'').trim();
  const {data,error}=await supabase.auth.verifyOtp({phone:normalized,token:token.trim(),type:'sms'});
  if(error)throw error;
  if(data.session&&!data.user?.phone_confirmed_at){await supabase.auth.signOut({scope:'local'}).catch(()=>undefined);throw new Error('phone_verification_required')}
  return data;
}

export async function signIn(email:string,password:string){
  const captchaToken=await requestNativeAuthCaptcha('sign_in');
  const {data,error}=await supabase.auth.signInWithPassword({email:email.trim().toLowerCase(),password,options:{captchaToken}});
  if(error)throw error;
  if(data.session&&!data.user?.email_confirmed_at){await supabase.auth.signOut({scope:'local'}).catch(()=>undefined);throw new Error('email_verification_required')}
  return data;
}
export async function resendSignupVerification(email:string){
  const normalized=email.trim().toLowerCase();
  if(!normalized)throw new Error(translate(getRuntimeLocale(),'auth.serviceEmailRequired'));
  const {error}=await supabase.auth.resend({type:'signup',email:normalized,options:{emailRedirectTo:'tailmance://auth/callback'}});
  if(error)throw error;
}
export async function requestPasswordReset(email:string){const captchaToken=await requestNativeAuthCaptcha('password_reset');const {error}=await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(),{redirectTo:'tailmance://reset-password',captchaToken});if(error)throw error}

export async function updatePasswordAndRevokeSessions(password:string){
  if(!passwordMeetsPolicy(password))throw new Error('password_policy_not_met');
  const {error}=await supabase.auth.updateUser({password});
  if(error)throw error;
  try{
    await signOut('global');
    return {sessionsRevoked:true as const};
  }catch{
    // The password update has already succeeded. Never keep a potentially stale recovery
    // session on this device just because global revocation could not be confirmed.
    await runBestEffort('auth_clear_local_push_state',()=>clearLocalPushState())
    await runBestEffort('auth_logout_purchases_cleanup',()=>logOutPurchases())
    await runBestEffort('auth_local_signout_cleanup',async()=>{const {error}=await supabase.auth.signOut({scope:'local'});if(error)throw error})
    await runBestEffort('auth_clear_durable_operations',()=>clearAllDurableClientOperations())
    await runBestEffort('auth_clear_offline_queue',()=>clearOfflineMutationQueue())
    await runBestEffort('auth_unregister_offline_sync',()=>unregisterOfflineBackgroundSync())
    throw new Error('password_changed_session_revocation_unverified');
  }
}
export async function signOut(scope:'local'|'global'='local'){
  await runBestEffort('oauth_revocation_capture_flush',()=>flushPendingOAuthRevocationCredential())
  const {data:userData}=await supabase.auth.getUser();
  const userId=userData.user?.id??null;
  const pushRollback=scope==='global'?await disableAllPushTokens():await unregisterCurrentPushToken();
  let purchasesLoggedOut=false;
  let revocationCommitted=false;
  try{
    await logOutPurchases();
    purchasesLoggedOut=true;
    if(scope==='global'){
      const {error:revokeError}=await supabase.rpc('mark_all_sessions_revoked',{p_reason:'global_sign_out'});
      if(revokeError)throw new Error('session_revocation_state_failed');
      revocationCommitted=true;
    }
    const {error}=await supabase.auth.signOut({scope});
    if(error)throw error;
    await runBestEffort('auth_clear_durable_operations',()=>clearAllDurableClientOperations())
    await runBestEffort('auth_clear_offline_queue',()=>clearOfflineMutationQueue())
    await runBestEffort('auth_unregister_offline_sync',()=>unregisterOfflineBackgroundSync())
    await runBestEffort('oauth_revocation_capture_clear',()=>clearLocalOAuthRevocationCapture())
  }catch(error){
    if(scope==='global'&&revocationCommitted){
      // Never roll back security cleanup after server-side session IDs are revoked. Even if the
      // GoTrue call is temporarily unavailable, product RPCs and Edge Functions now reject them.
      await runBestEffort('auth_local_signout_cleanup',async()=>{const {error}=await supabase.auth.signOut({scope:'local'});if(error)throw error})
      await runBestEffort('auth_clear_durable_operations',()=>clearAllDurableClientOperations())
      await runBestEffort('auth_clear_offline_queue',()=>clearOfflineMutationQueue())
      await runBestEffort('auth_unregister_offline_sync',()=>unregisterOfflineBackgroundSync())
      throw error;
    }
    if(purchasesLoggedOut&&userId)await runBestEffort('auth_restore_purchase_identity',async()=>{const {logInPurchases}=await import('./purchases');await logInPurchases(userId)})
    await runBestEffort('auth_restore_push_tokens',()=>restorePushTokens(pushRollback))
    throw error;
  }
}

export async function finalizeDeletedAccountSession(){
  let cleanupError:unknown=null;
  // The server account no longer exists, so local cleanup must not depend on authenticated server endpoints.
  try{await clearLocalPushState()}catch(error){cleanupError=error}
  try{await logOutPurchases()}catch(error){if(!cleanupError)cleanupError=error}
  try{const {error}=await supabase.auth.signOut({scope:'local'});if(error&&!cleanupError)cleanupError=error}catch(error){if(!cleanupError)cleanupError=error}
  try{await clearAllDurableClientOperations()}catch(error){if(!cleanupError)cleanupError=error}
  try{await clearOfflineMutationQueue()}catch(error){if(!cleanupError)cleanupError=error}
  try{await unregisterOfflineBackgroundSync()}catch(error){if(!cleanupError)cleanupError=error}
  try{await clearLocalOAuthRevocationCapture()}catch(error){if(!cleanupError)cleanupError=error}
  if(cleanupError)throw cleanupError;
}

function requireExpectedSupabaseOAuthStartUrl(input:string){
  const raw=input.trim();
  if(!raw||!env.supabaseUrl)throw new Error('oauth_url_untrusted');
  let candidate:URL,backend:URL;
  try{candidate=new URL(raw);backend=new URL(env.supabaseUrl)}catch{throw new Error('oauth_url_untrusted')}
  if(candidate.protocol!=='https:'||candidate.username||candidate.password||candidate.origin!==backend.origin)throw new Error('oauth_url_untrusted');
  const basePath=backend.pathname.replace(/\/+$/,'');
  const authBase=`${basePath}/auth/v1`.replace(/\/{2,}/g,'/');
  if(!(candidate.pathname===`${authBase}/authorize`||candidate.pathname===`${authBase}/user/identities/authorize`))throw new Error('oauth_url_untrusted');
  return candidate.toString();
}

export type SocialAuthProvider='apple'|'google';

function socialOAuthOptions(provider:SocialAuthProvider){
  return {
    redirectTo:'tailmance://auth/callback',
    skipBrowserRedirect:true,
    ...(provider==='google'?{queryParams:{access_type:'offline',prompt:'consent'}}:{})
  };
}

type SocialAuthStartResult={kind:'native_complete'}|{kind:'external_oauth';url:string};

async function startBrowserSocialSignIn(provider:SocialAuthProvider):Promise<SocialAuthStartResult>{
  await markPendingOAuthProviderCapture(provider);
  const {data,error}=await supabase.auth.signInWithOAuth({provider,options:socialOAuthOptions(provider)});
  if(error){await clearLocalOAuthRevocationCapture();throw error}
  if(!data.url){await clearLocalOAuthRevocationCapture();throw new Error('oauth_url_missing')}
  try{return{kind:'external_oauth',url:requireExpectedSupabaseOAuthStartUrl(data.url)}}catch(error){await clearLocalOAuthRevocationCapture();throw error}
}

export async function startLinkedSocialSignIn(provider:SocialAuthProvider):Promise<SocialAuthStartResult>{
  // Apple has a true native AuthenticationServices flow on iOS. On Android, Apple
  // necessarily uses its standards-based web authorization flow. Google uses the
  // modern native Credential Manager / Google Sign-In SDK adapter on both platforms.
  const nativeExpected=provider==='google'||(provider==='apple'&&Platform.OS==='ios');
  if(!nativeExpected)return startBrowserSocialSignIn(provider);
  try{
    await signInWithNativeSocialProvider(provider);
    return{kind:'native_complete'};
  }catch(error){
    const message=error instanceof Error?error.message:'';
    if(/cancelled|canceled|ERR_REQUEST_CANCELED/i.test(message))throw error;
    // A production binary must not silently downgrade Google or iOS Apple sign-in to a
    // browser flow when its native integration is misconfigured. Development builds can
    // still use the browser path so the rest of the local stack remains testable without
    // real provider credentials.
    if(env.appEnv==='production')throw error;
    return startBrowserSocialSignIn(provider);
  }
}

export async function linkSocialIdentity(provider:SocialAuthProvider){
  await markPendingOAuthProviderCapture(provider);
  const {data,error}=await supabase.auth.linkIdentity({provider,options:socialOAuthOptions(provider)});
  if(error){await clearLocalOAuthRevocationCapture();throw error}
  if(!data.url){await clearLocalOAuthRevocationCapture();throw new Error('oauth_url_missing')}
  try{return requireExpectedSupabaseOAuthStartUrl(data.url)}catch(error){await clearLocalOAuthRevocationCapture();throw error}
}

export async function requestPhoneVerification(phone:string){
  const normalized=phone.trim().replace(/[\s()-]/g,'');
  if(!/^\+[1-9]\d{7,14}$/.test(normalized))throw new Error('phone_e164_required');
  const {data,error}=await supabase.auth.updateUser({phone:normalized});
  if(error)throw error;
  return {phone:normalized,user:data.user};
}

export async function verifyPhoneChange(phone:string,token:string){
  const normalized=phone.trim().replace(/[\s()-]/g,'');
  const otp=token.trim();
  if(!/^\+[1-9]\d{7,14}$/.test(normalized)||!/^\d{4,10}$/.test(otp))throw new Error('invalid_phone_verification_code');
  const {data,error}=await supabase.auth.verifyOtp({phone:normalized,token:otp,type:'phone_change'});
  if(error)throw error;
  return data;
}
