import {fetchWithTimeout} from './http.ts';

export type OauthRevocationProvider='apple'|'google';
export type OauthTokenKind='access_token'|'refresh_token';
export type OauthCaptureTokenKind=OauthTokenKind|'authorization_code';

type StoredCredential={
  account_user_id:string;
  provider:OauthRevocationProvider;
  token_kind:OauthTokenKind;
  token_ciphertext:string;
  token_iv:string;
  key_version:string;
  retention_deadline?:string|null;
  provider_client_id?:string|null;
};

const encoder=new TextEncoder();
const decoder=new TextDecoder();
const PKCS8_BEGIN=['-----BEGIN ','PRIVATE KEY-----'].join('');
const PKCS8_END=['-----END ','PRIVATE KEY-----'].join('');

function b64(bytes:Uint8Array){let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary)}
function fromB64(input:string){if(!/^[A-Za-z0-9+/]+={0,2}$/.test(input))throw new Error('oauth_credential_encoding_invalid');const binary=atob(input);const out=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)out[i]=binary.charCodeAt(i);return out}
function b64url(bytes:Uint8Array){return b64(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function pemBytes(pem:string){
  const body=pem.replace(PKCS8_BEGIN,'').replace(PKCS8_END,'').replace(/\s+/g,'');
  if(!body||!/^[A-Za-z0-9+/=]+$/.test(body))throw new Error('apple_sign_in_private_key_invalid');
  return fromB64(body);
}
function exactAes256Key(raw:string){
  const clean=raw.trim();
  const keyBytes=fromB64(clean);
  if(keyBytes.length!==32||b64(keyBytes).replace(/=+$/,'')!==clean.replace(/=+$/,''))throw new Error('oauth_revocation_encryption_key_invalid');
  return keyBytes;
}
function encryptionConfig(){
  const currentRaw=(Deno.env.get('OAUTH_REVOCATION_CREDENTIAL_KEY_B64')??'').trim();
  const keyVersion=(Deno.env.get('OAUTH_REVOCATION_CREDENTIAL_KEY_VERSION')??'').trim();
  if(!/^[A-Za-z0-9._-]{1,40}$/.test(keyVersion))throw new Error('oauth_revocation_encryption_config_invalid');
  const currentKeyBytes=exactAes256Key(currentRaw);
  const keys=new Map<string,Uint8Array>([[keyVersion,currentKeyBytes]]);
  const previousRaw=(Deno.env.get('OAUTH_REVOCATION_CREDENTIAL_PREVIOUS_KEYS_JSON')??'{}').trim()||'{}';
  let previous:unknown;
  try{previous=JSON.parse(previousRaw)}catch{throw new Error('oauth_revocation_previous_keyring_invalid')}
  if(!previous||typeof previous!=='object'||Array.isArray(previous))throw new Error('oauth_revocation_previous_keyring_invalid');
  const entries=Object.entries(previous as Record<string,unknown>);
  if(entries.length>4)throw new Error('oauth_revocation_previous_keyring_too_large');
  for(const [version,value] of entries){
    if(!/^[A-Za-z0-9._-]{1,40}$/.test(version)||version===keyVersion||typeof value!=='string')throw new Error('oauth_revocation_previous_keyring_invalid');
    keys.set(version,exactAes256Key(value));
  }
  return{currentKeyBytes,keyVersion,keys};
}
async function aesKey(bytes:Uint8Array,usage:KeyUsage[]){return crypto.subtle.importKey('raw',new Uint8Array(bytes),{name:'AES-GCM'},false,usage)}
function aad(userId:string,provider:OauthRevocationProvider,keyVersion:string){return encoder.encode(`tailmance:oauth-revocation:v1:${userId}:${provider}:${keyVersion}`)}

export async function sealOauthCredential(userId:string,provider:OauthRevocationProvider,token:string){
  const clean=token.trim();
  if(clean.length<16||clean.length>12000||/[\u0000-\u001f\u007f]/.test(clean))throw new Error('oauth_provider_token_invalid');
  const cfg=encryptionConfig();
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await aesKey(cfg.currentKeyBytes,['encrypt']);
  const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(userId,provider,cfg.keyVersion),tagLength:128},key,encoder.encode(clean)));
  return{tokenCiphertext:b64(encrypted),tokenIv:b64(iv),keyVersion:cfg.keyVersion};
}

async function openOauthCredential(row:StoredCredential){
  const cfg=encryptionConfig();
  const keyBytes=cfg.keys.get(row.key_version);
  if(!keyBytes)throw new Error('oauth_revocation_key_version_unavailable');
  const key=await aesKey(keyBytes,['decrypt']);
  try{
    const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromB64(row.token_iv),additionalData:aad(row.account_user_id,row.provider,row.key_version),tagLength:128},key,fromB64(row.token_ciphertext));
    const token=decoder.decode(plaintext);
    if(token.length<16||token.length>12000)throw new Error('oauth_provider_token_invalid');
    return token;
  }catch(error){
    if(error instanceof Error&&error.message==='oauth_provider_token_invalid')throw error;
    throw new Error('oauth_revocation_credential_decrypt_failed');
  }
}

async function appleClientSecret(clientIdOverride?:string|null){
  const teamId=(Deno.env.get('APPLE_SIGN_IN_TEAM_ID')??'').trim();
  const keyId=(Deno.env.get('APPLE_SIGN_IN_KEY_ID')??'').trim();
  const clientId=(clientIdOverride??Deno.env.get('APPLE_SIGN_IN_CLIENT_ID')??'').trim();
  const privateKey=(Deno.env.get('APPLE_SIGN_IN_PRIVATE_KEY_P8')??'').trim().replace(/\\n/g,'\n');
  if(!/^[A-Z0-9]{10}$/.test(teamId)||!/^[A-Z0-9]{10}$/.test(keyId)||!/^[A-Za-z0-9.-]{3,200}$/.test(clientId)||!privateKey.includes(PKCS8_BEGIN.slice(5,-5)))throw new Error('apple_sign_in_revocation_config_missing');
  const now=Math.floor(Date.now()/1000);
  const header=b64url(encoder.encode(JSON.stringify({alg:'ES256',kid:keyId})));
  const payload=b64url(encoder.encode(JSON.stringify({iss:teamId,iat:now-30,exp:now+300,aud:'https://appleid.apple.com',sub:clientId})));
  const input=`${header}.${payload}`;
  const key=await crypto.subtle.importKey('pkcs8',pemBytes(privateKey),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const signature=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,encoder.encode(input)));
  if(signature.length!==64)throw new Error('apple_sign_in_client_secret_signature_invalid');
  return{clientId,clientSecret:`${input}.${b64url(signature)}`};
}

async function exchangeAppleAuthorizationCode(code:string){
  const nativeClientId=(Deno.env.get('APPLE_SIGN_IN_NATIVE_CLIENT_ID')??'').trim();
  if(!nativeClientId)throw new Error('apple_native_client_id_missing');
  const {clientId,clientSecret}=await appleClientSecret(nativeClientId);
  const body=new URLSearchParams({client_id:clientId,client_secret:clientSecret,code,grant_type:'authorization_code'}).toString();
  const response=await fetchWithTimeout('https://appleid.apple.com/auth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','accept':'application/json'},body},10000);
  if(response.status!==200)throw new Error(`apple_oauth_code_exchange_status_${response.status}`);
  const payload=await response.json().catch(()=>null) as {refresh_token?:unknown;access_token?:unknown}|null;
  const refresh=typeof payload?.refresh_token==='string'?payload.refresh_token.trim():'';
  const access=typeof payload?.access_token==='string'?payload.access_token.trim():'';
  const token=refresh||access;
  if(token.length<16)throw new Error('apple_oauth_code_exchange_token_missing');
  return{token,tokenKind:(refresh?'refresh_token':'access_token') as OauthTokenKind,providerClientId:clientId};
}

async function exchangeGoogleAuthorizationCode(code:string){
  const clientId=(Deno.env.get('GOOGLE_OAUTH_SERVER_CLIENT_ID')??'').trim();
  const clientSecret=(Deno.env.get('GOOGLE_OAUTH_SERVER_CLIENT_SECRET')??'').trim();
  const redirectUri=(Deno.env.get('GOOGLE_OAUTH_SERVER_REDIRECT_URI')??'').trim();
  if(!/^[A-Za-z0-9._:-]{8,255}$/.test(clientId)||clientSecret.length<8)throw new Error('google_oauth_server_config_missing');
  const body=new URLSearchParams({client_id:clientId,client_secret:clientSecret,code,grant_type:'authorization_code',redirect_uri:redirectUri}).toString();
  const response=await fetchWithTimeout('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','accept':'application/json'},body},10000);
  if(response.status!==200)throw new Error(`google_oauth_code_exchange_status_${response.status}`);
  const payload=await response.json().catch(()=>null) as {refresh_token?:unknown;access_token?:unknown}|null;
  const refresh=typeof payload?.refresh_token==='string'?payload.refresh_token.trim():'';
  const access=typeof payload?.access_token==='string'?payload.access_token.trim():'';
  const token=refresh||access;
  if(token.length<16)throw new Error('google_oauth_code_exchange_token_missing');
  return{token,tokenKind:(refresh?'refresh_token':'access_token') as OauthTokenKind,providerClientId:clientId};
}

export async function resolveOauthCredentialForStorage(provider:OauthRevocationProvider,tokenKind:OauthCaptureTokenKind,token:string){
  const clean=token.trim();
  if(clean.length<8||clean.length>12000||/[\u0000-\u001f\u007f]/.test(clean))throw new Error('oauth_provider_token_invalid');
  if(tokenKind==='authorization_code')return provider==='apple'?exchangeAppleAuthorizationCode(clean):exchangeGoogleAuthorizationCode(clean);
  const providerClientId=provider==='apple'?(Deno.env.get('APPLE_SIGN_IN_CLIENT_ID')??'').trim():(Deno.env.get('GOOGLE_OAUTH_SERVER_CLIENT_ID')??'').trim();
  return{token:clean,tokenKind,providerClientId:providerClientId||null};
}

async function revokeApple(token:string,kind:OauthTokenKind,providerClientId?:string|null){
  const {clientId,clientSecret}=await appleClientSecret(providerClientId);
  const body=new URLSearchParams({client_id:clientId,client_secret:clientSecret,token,token_type_hint:kind}).toString();
  const response=await fetchWithTimeout('https://appleid.apple.com/auth/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','accept':'application/json'},body},10000);
  if(response.status!==200)throw new Error(`apple_oauth_revoke_status_${response.status}`);
}
async function revokeGoogle(token:string){
  const body=new URLSearchParams({token}).toString();
  const response=await fetchWithTimeout('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','accept':'application/json'},body},10000);
  if(response.status!==200)throw new Error(`google_oauth_revoke_status_${response.status}`);
}

export function currentOauthRevocationKeyVersion(){return encryptionConfig().keyVersion}

export async function rewrapStoredOauthCredential(supabase:any,row:StoredCredential){
  const cfg=encryptionConfig();
  if(row.key_version===cfg.keyVersion)return false;
  const token=await openOauthCredential(row);
  const sealed=await sealOauthCredential(row.account_user_id,row.provider,token);
  const {error}=await supabase.from('oauth_revocation_credentials').update({
    token_ciphertext:sealed.tokenCiphertext,token_iv:sealed.tokenIv,key_version:sealed.keyVersion,updated_at:new Date().toISOString()
  }).eq('account_user_id',row.account_user_id).eq('provider',row.provider).eq('key_version',row.key_version);
  if(error)throw new Error(`oauth_revocation_credential_rewrap_failed:${error.message}`);
  return true;
}

export async function revokeStoredOauthCredential(supabase:any,userId:string,provider:OauthRevocationProvider){
  const {data,error}=await supabase.from('oauth_revocation_credentials').select('account_user_id,provider,token_kind,token_ciphertext,token_iv,key_version,retention_deadline,provider_client_id').eq('account_user_id',userId).eq('provider',provider).maybeSingle();
  if(error)throw new Error(`oauth_revocation_credential_read_failed:${error.message}`);
  if(!data)throw new Error('oauth_revocation_credential_missing');
  const row=data as StoredCredential;
  const token=await openOauthCredential(row);
  if(provider==='apple')await revokeApple(token,row.token_kind,row.provider_client_id); else await revokeGoogle(token);
  const {error:deleteError}=await supabase.from('oauth_revocation_credentials').delete().eq('account_user_id',userId).eq('provider',provider);
  if(deleteError)throw new Error(`oauth_revocation_credential_cleanup_failed:${deleteError.message}`);
}
