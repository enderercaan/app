import { fetchWithTimeout, readResponseJsonBounded } from './http.ts';
import {edgeBestEffort} from './operational.ts';

const APNS_TIMEOUT_MS=8_000;
const APNS_MAX_RESPONSE_BYTES=16_384;
const TOKEN_TTL_MS=45*60*1000;
let cachedJwt:{value:string;createdAt:number;fingerprint:string}|null=null;

const base64Url=(bytes:Uint8Array)=>{
  let binary='';
  for(const byte of bytes)binary+=String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
};
const utf8=(value:string)=>new TextEncoder().encode(value);
const pemBytes=(pem:string)=>{
  const begin='-----BEGIN '+'PRIVATE KEY-----';
  const end='-----END '+'PRIVATE KEY-----';
  const body=pem.replaceAll(begin,'').replaceAll(end,'').replace(/\s+/g,'');
  if(!body||!/^[A-Za-z0-9+/=]+$/.test(body))throw new Error('apns_voip_private_key_invalid');
  const binary=atob(body);const out=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)out[i]=binary.charCodeAt(i);
  return out;
};
const credentialFingerprint=async(teamId:string,keyId:string,pem:string)=>{
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',utf8(pem)));
  return `${teamId}:${keyId}:${base64Url(digest)}`;
};

async function providerJwt(teamId:string,keyId:string,pem:string){
  const now=Date.now();const fingerprint=await credentialFingerprint(teamId,keyId,pem);
  if(cachedJwt&&cachedJwt.fingerprint===fingerprint&&now-cachedJwt.createdAt<TOKEN_TTL_MS)return cachedJwt.value;
  const header=base64Url(utf8(JSON.stringify({alg:'ES256',kid:keyId})));
  const claims=base64Url(utf8(JSON.stringify({iss:teamId,iat:Math.floor(now/1000)})));
  const signingInput=`${header}.${claims}`;
  const key=await crypto.subtle.importKey('pkcs8',pemBytes(pem),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const signature=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,utf8(signingInput)));
  if(signature.length!==64)throw new Error('apns_voip_signature_invalid');
  const value=`${signingInput}.${base64Url(signature)}`;
  cachedJwt={value,createdAt:now,fingerprint};
  return value;
}

export type ApnsVoipInput={
  token:string;
  callId:string;
  callerPetName:string;
  callType:'audio'|'video';
  recipientPetId:string;
  userId:string;
};
export type ApnsVoipResult={ok:boolean;retryable:boolean;disableToken:boolean;reason:string|null};

function config(){
  const teamId=(Deno.env.get('APNS_TEAM_ID')??'').trim();
  const keyId=(Deno.env.get('APNS_KEY_ID')??'').trim();
  const privateKey=(Deno.env.get('APNS_VOIP_PRIVATE_KEY_P8')??'').trim().replace(/\\n/g,'\n');
  const bundleId=(Deno.env.get('APNS_BUNDLE_ID')??'').trim();
  const environment=(Deno.env.get('APNS_ENVIRONMENT')??'').trim().toLowerCase();
  if(!/^[A-Z0-9]{10}$/.test(teamId)||!/^[A-Z0-9]{10}$/.test(keyId)||!privateKey.includes('BEGIN PRIVATE KEY')||!/^[A-Za-z0-9.-]{3,200}$/.test(bundleId)||!['production','sandbox'].includes(environment))throw new Error('apns_voip_configuration_missing');
  return{teamId,keyId,privateKey,bundleId,environment};
}

export async function sendApnsVoipPush(input:ApnsVoipInput):Promise<ApnsVoipResult>{
  if(!/^[0-9a-f]{40,512}$/i.test(input.token)||input.token.length%2!==0)return{ok:false,retryable:false,disableToken:true,reason:'BadDeviceToken'};
  if(!/^[0-9a-f-]{36}$/i.test(input.callId)||!/^[0-9a-f-]{36}$/i.test(input.recipientPetId)||!/^[0-9a-f-]{36}$/i.test(input.userId)||!['audio','video'].includes(input.callType))return{ok:false,retryable:false,disableToken:false,reason:'InvalidCallPayload'};
  let cfg:ReturnType<typeof config>;
  try{cfg=config()}catch{return{ok:false,retryable:true,disableToken:false,reason:'ConfigurationMissing'}}
  let jwt:string;
  try{jwt=await providerJwt(cfg.teamId,cfg.keyId,cfg.privateKey)}catch{return{ok:false,retryable:true,disableToken:false,reason:'ProviderTokenInvalid'}}
  const host=cfg.environment==='production'?'https://api.push.apple.com':'https://api.sandbox.push.apple.com';
  const payload={
    aps:{'content-available':1},
    callId:input.callId,
    callerPetName:String(input.callerPetName??'').slice(0,80),
    callType:input.callType,
    recipientPetId:input.recipientPetId,
    userId:input.userId
  };
  try{
    const response=await fetchWithTimeout(`${host}/3/device/${input.token}`,{
      method:'POST',
      headers:{
        authorization:`bearer ${jwt}`,
        'apns-topic':`${cfg.bundleId}.voip`,
        'apns-push-type':'voip',
        'apns-priority':'10',
        'apns-expiration':String(Math.floor(Date.now()/1000)+60),
        'apns-collapse-id':input.callId,
        'content-type':'application/json'
      },
      body:JSON.stringify(payload)
    },APNS_TIMEOUT_MS);
    if(response.ok)return{ok:true,retryable:false,disableToken:false,reason:null};
    let reason=`HTTP_${response.status}`;
    await edgeBestEffort('apns_error_response_parse',async()=>{const body=await readResponseJsonBounded<{reason?:unknown}>(response,APNS_MAX_RESPONSE_BYTES);if(typeof body?.reason==='string'&&/^[A-Za-z0-9_.-]{1,80}$/.test(body.reason))reason=body.reason})
    const disableToken=['BadDeviceToken','DeviceTokenNotForTopic','Unregistered'].includes(reason);
    const retryable=response.status===429||response.status>=500||['TooManyRequests','InternalServerError','ServiceUnavailable','Shutdown'].includes(reason);
    return{ok:false,retryable,disableToken,reason};
  }catch(error){
    const retryable=error instanceof DOMException&&error.name==='AbortError'||error instanceof Error;
    return{ok:false,retryable,disableToken:false,reason:'TransportError'};
  }
}
