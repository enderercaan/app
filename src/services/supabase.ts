import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { env, isBackendConfigured } from './config';
import { secureStorage } from './secureStorage';

const noopUrl = 'https://backend.invalid';
const noopKey = 'tailmance-backend-disabled';
const APP_SCHEMES = new Set(['tailmance:','pawlink:']);
const CLIENT_HTTP_TIMEOUT_MS = 45_000;
const nativeFetch = globalThis.fetch.bind(globalThis);

const OAUTH_CAPTURE_PROVIDER_KEY='tailmance_oauth_capture_provider_v1';
const OAUTH_CAPTURE_CREDENTIAL_KEY='tailmance_oauth_capture_credential_v1';
const OAUTH_CAPTURE_MAX_AGE_MS=20*60*1000;
type OauthCaptureProvider='apple'|'google';
type PendingOauthProvider={provider:OauthCaptureProvider;startedAt:number};
type OauthCaptureTokenKind='access_token'|'refresh_token'|'authorization_code';
type PendingOauthCredential={provider:OauthCaptureProvider;tokenKind:OauthCaptureTokenKind;token:string;userId:string;capturedAt:number};

function parsePendingProvider(raw:string|null):PendingOauthProvider|null{
  if(!raw)return null;
  try{const value=JSON.parse(raw) as PendingOauthProvider;if(!['apple','google'].includes(value.provider)||!Number.isFinite(value.startedAt)||Date.now()-value.startedAt>OAUTH_CAPTURE_MAX_AGE_MS||value.startedAt>Date.now()+60_000)return null;return value}catch{return null}
}
function parsePendingCredential(raw:string|null):PendingOauthCredential|null{
  if(!raw)return null;
  try{const value=JSON.parse(raw) as PendingOauthCredential;if(!['apple','google'].includes(value.provider)||!['access_token','refresh_token','authorization_code'].includes(value.tokenKind)||typeof value.token!=='string'||value.token.length<16||value.token.length>12000||!/^[0-9a-f-]{36}$/i.test(value.userId)||!Number.isFinite(value.capturedAt)||Date.now()-value.capturedAt>OAUTH_CAPTURE_MAX_AGE_MS||value.capturedAt>Date.now()+60_000)return null;return value}catch{return null}
}

export async function markPendingOAuthProviderCapture(provider:OauthCaptureProvider){
  await secureStorage.setItem(OAUTH_CAPTURE_PROVIDER_KEY,JSON.stringify({provider,startedAt:Date.now()} satisfies PendingOauthProvider));
}
export async function clearLocalOAuthRevocationCapture(){
  await Promise.allSettled([secureStorage.removeItem(OAUTH_CAPTURE_PROVIDER_KEY),secureStorage.removeItem(OAUTH_CAPTURE_CREDENTIAL_KEY)]);
}
async function invokeOauthCredentialCapture(payload:PendingOauthCredential){
  const {data,error}=await supabase.functions.invoke('oauth-credential-capture',{method:'POST',body:{provider:payload.provider,tokenKind:payload.tokenKind,token:payload.token}});
  if(error||data?.ok!==true||data?.provider!==payload.provider)throw error??new Error('oauth_credential_capture_not_confirmed');
}
export async function flushPendingOAuthRevocationCredential(){
  const raw=await secureStorage.getItem(OAUTH_CAPTURE_CREDENTIAL_KEY);
  const payload=parsePendingCredential(raw);
  if(!payload){if(raw)await secureStorage.removeItem(OAUTH_CAPTURE_CREDENTIAL_KEY);return false}
  const {data}=await supabase.auth.getSession();
  if(!data.session||data.session.user.id!==payload.userId)return false;
  await invokeOauthCredentialCapture(payload);
  await secureStorage.removeItem(OAUTH_CAPTURE_CREDENTIAL_KEY);
  return true;
}
type OauthCaptureDisposition='not_applicable'|'captured'|'queued_retry'|'manual_required';

export async function stageOAuthProviderCredential(provider:OauthCaptureProvider,tokenKind:OauthCaptureTokenKind,credential:string):Promise<OauthCaptureDisposition>{
  const clean=credential.trim();
  if(clean.length<16||clean.length>12000||/[\u0000-\u001f\u007f]/.test(clean))throw new Error('oauth_provider_credential_invalid');
  const {data}=await supabase.auth.getSession();
  const userId=data.session?.user.id;
  if(!userId)throw new Error('oauth_provider_credential_session_missing');
  const payload:PendingOauthCredential={provider,tokenKind,token:clean,userId,capturedAt:Date.now()};
  try{
    await secureStorage.setItem(OAUTH_CAPTURE_CREDENTIAL_KEY,JSON.stringify(payload));
  }catch{
    await invokeOauthCredentialCapture(payload);
    return 'captured';
  }
  try{
    await flushPendingOAuthRevocationCredential();
    return 'captured';
  }catch{
    return 'queued_retry';
  }
}

export async function stageOAuthAuthorizationCode(provider:OauthCaptureProvider,authorizationCode:string){
  return stageOAuthProviderCredential(provider,'authorization_code',authorizationCode);
}

async function stageOauthCredentialFromSession(session:any,provider:OauthCaptureProvider|null):Promise<OauthCaptureDisposition>{
  if(!session?.user?.id)return 'not_applicable';
  const inferred=String(session.user?.app_metadata?.provider??'').toLowerCase();
  const resolved=provider??(inferred==='apple'||inferred==='google'?inferred as OauthCaptureProvider:null);
  if(!resolved)return 'not_applicable';
  const refresh=typeof session.provider_refresh_token==='string'?session.provider_refresh_token.trim():'';
  const access=typeof session.provider_token==='string'?session.provider_token.trim():'';
  const token=refresh||access;
  if(!token)return 'manual_required';
  const payload:PendingOauthCredential={provider:resolved,tokenKind:refresh?'refresh_token':'access_token',token,userId:String(session.user.id),capturedAt:Date.now()};
  try{
    await secureStorage.setItem(OAUTH_CAPTURE_CREDENTIAL_KEY,JSON.stringify(payload));
  }catch{
    await invokeOauthCredentialCapture(payload);
    return 'captured';
  }
  try{
    await flushPendingOAuthRevocationCredential();
    return 'captured';
  }catch{
    // The raw provider credential remains only in device-protected SecureStore for the
    // bounded retry window. Auth bootstrap/foreground replay retries server capture.
    return 'queued_retry';
  }
}

async function waitForRetry(ms:number,signal?:AbortSignal|null){
  if(signal?.aborted)throw signal.reason??new Error('request_aborted');
  await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve()},ms);
    const abort=()=>{clearTimeout(timer);reject(signal?.reason??new Error('request_aborted'))};
    signal?.addEventListener('abort',abort,{once:true});
  });
}

function requestMethod(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1]){
  const inherited=typeof input==='object'&&input&&'method' in input?String((input as Request).method||'GET'):'GET';
  return String(init?.method??inherited??'GET').toUpperCase();
}

async function supabaseFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) {
  const upstreamSignal=init?.signal;
  const method=requestMethod(input,init);
  const idempotentRead=method==='GET'||method==='HEAD';
  const maxAttempts=idempotentRead?3:1;
  let lastError:unknown;
  for(let attempt=0;attempt<maxAttempts;attempt++){
    const controller=new AbortController();
    const relayAbort=()=>controller.abort(upstreamSignal?.reason);
    if(upstreamSignal?.aborted)relayAbort();
    else upstreamSignal?.addEventListener('abort',relayAbort,{once:true});
    const timeout=setTimeout(()=>controller.abort(new Error('client_http_timeout')),CLIENT_HTTP_TIMEOUT_MS);
    try{
      const response=await nativeFetch(input,{...init,signal:controller.signal});
      const retryableStatus=idempotentRead&&[429,502,503,504].includes(response.status);
      if(!retryableStatus||attempt===maxAttempts-1)return response;
      const retryAfterRaw=response.headers?.get?.('Retry-After');
      const retryAfterSeconds=retryAfterRaw&&/^\d+$/.test(retryAfterRaw)?Number(retryAfterRaw):null;
      const delay=retryAfterSeconds!==null?Math.min(retryAfterSeconds*1000,2_000):250*(2**attempt);
      await waitForRetry(delay,upstreamSignal);
    }catch(error){
      lastError=error;
      if(!idempotentRead||attempt===maxAttempts-1||upstreamSignal?.aborted)throw error;
      await waitForRetry(250*(2**attempt),upstreamSignal);
    }finally{
      clearTimeout(timeout);
      upstreamSignal?.removeEventListener('abort',relayAbort);
    }
  }
  throw lastError??new Error('request_failed');
}

export const supabase = createClient(
  isBackendConfigured ? env.supabaseUrl : noopUrl,
  isBackendConfigured ? env.supabaseAnonKey : noopKey,
  {
    auth: {
      storage: Platform.OS === 'web' ? undefined : secureStorage,
      autoRefreshToken: Platform.OS !== 'web',
      persistSession: Platform.OS !== 'web',
      detectSessionInUrl: Platform.OS === 'web',
      flowType: 'pkce'
    },
    global: { fetch: supabaseFetch },
    realtime: { params: { eventsPerSecond: 10 } }
  }
);

let appStateSubscription: { remove: () => void } | undefined;

export function bindAuthAutoRefresh() {
  if (Platform.OS === 'web' || appStateSubscription) return () => undefined;
  appStateSubscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
  return () => {
    appStateSubscription?.remove();
    appStateSubscription = undefined;
  };
}

function isAllowedAuthRedirect(parsed: URL) {
  if (!APP_SCHEMES.has(parsed.protocol)) return false;
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  return (host === 'auth' && path === '/callback') || (host === 'reset-password' && path === '/');
}

export async function handleAuthDeepLink(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { recovery: false };
  }

  const recovery = parsed.hostname.toLowerCase() === 'reset-password';
  if (!isAllowedAuthRedirect(parsed)) return { recovery: false };

  const authCode = parsed.searchParams.get('code');
  if (!authCode) return { recovery: false };

  let exchanged=false;
  try {
    const flowId = parsed.searchParams.get('sb_flow_id') ?? undefined;
    const pending=parsePendingProvider(await secureStorage.getItem(OAUTH_CAPTURE_PROVIDER_KEY));
    const { data, error } = await supabase.auth.exchangeCodeForSession(authCode, flowId ? { flowId } : undefined);
    if (error) throw error;
    exchanged=true;
    const oauthCapture=await stageOauthCredentialFromSession(data.session,pending?.provider??null);
    await secureStorage.removeItem(OAUTH_CAPTURE_PROVIDER_KEY).catch(()=>undefined);
    return { recovery, oauthCapture };
  } catch {
    if(exchanged)await supabase.auth.signOut({scope:'local'}).catch(()=>undefined);
    await clearLocalOAuthRevocationCapture().catch(()=>undefined);
    return { recovery: false, oauthCapture:'failed' as const };
  }
}
