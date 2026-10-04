import { Linking } from 'react-native';
import TailmanceDeviceIntegrity from '../../modules/tailmance-device-integrity';
import { env } from './config';
import { getRuntimeLocale } from '../i18n';
import { openSafeExternalHttpsUrl, requireSafeExternalHttpsUrl } from './externalLinks';

type AuthChallengeAction='sign_in'|'sign_up'|'password_reset'|'phone_otp';
const CALLBACK_SCHEMES=new Set(['tailmance:']);
const CALLBACK_HOST='auth-challenge';
const TIMEOUT_MS=120_000;

function challengeBaseUrl(){
  const raw=env.authChallengeUrl.trim();
  if(!raw){
    if(env.appEnv==='production')throw new Error('auth_challenge_not_configured');
    return null;
  }
  let parsed:URL;
  try{parsed=new URL(requireSafeExternalHttpsUrl(raw))}catch{throw new Error('auth_challenge_url_invalid')}
  if(parsed.hash)throw new Error('auth_challenge_url_invalid');
  return parsed;
}

function callbackToken(url:string,action:AuthChallengeAction,state:string){
  let parsed:URL;
  try{parsed=new URL(url)}catch{return null}
  if(!CALLBACK_SCHEMES.has(parsed.protocol)||parsed.hostname.toLowerCase()!==CALLBACK_HOST)return null;
  if(parsed.searchParams.get('action')!==action||parsed.searchParams.get('state')!==state)return null;
  const error=parsed.searchParams.get('error');
  if(error)throw new Error(error==='cancelled'?'auth_challenge_cancelled':'auth_challenge_failed');
  const token=parsed.searchParams.get('token')??'';
  if(token.length<20||token.length>4096||/\s/.test(token))throw new Error('auth_challenge_token_invalid');
  return token;
}

export async function requestNativeAuthCaptcha(action:AuthChallengeAction):Promise<string|undefined>{
  const base=challengeBaseUrl();
  if(!base)return undefined;
  if(!TailmanceDeviceIntegrity)throw new Error('auth_challenge_secure_random_unavailable');
  const state=await TailmanceDeviceIntegrity.generateSecureRandomBase64UrlAsync(24);
  if(!/^[A-Za-z0-9_-]{32,128}$/.test(state))throw new Error('auth_challenge_state_invalid');
  base.searchParams.set('action',action);
  base.searchParams.set('state',state);
  base.searchParams.set('lang',getRuntimeLocale());

  return await new Promise<string>((resolve,reject)=>{
    let settled=false;
    const finish=(error?:unknown,token?:string)=>{
      if(settled)return;settled=true;clearTimeout(timer);sub.remove();
      if(error)reject(error);else if(token)resolve(token);else reject(new Error('auth_challenge_failed'));
    };
    const sub=Linking.addEventListener('url',event=>{
      try{const token=callbackToken(event.url,action,state);if(token)finish(undefined,token)}catch(error){finish(error)}
    });
    const timer=setTimeout(()=>finish(new Error('auth_challenge_timeout')),TIMEOUT_MS);
    void openSafeExternalHttpsUrl(base.toString()).catch(error=>finish(error));
  });
}
