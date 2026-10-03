import { Linking } from 'react-native';
import { supabase } from './supabase';

type MfaFactorType='totp'|'phone';
export type MfaFactor={id:string;friendlyName:string;status:string;type:MfaFactorType;phone?:string};
type MfaAalState={currentLevel:'aal1'|'aal2'|null;nextLevel:'aal1'|'aal2'|null;required:boolean};
export type TotpEnrollment={id:string;secret:string;uri:string};
export type PhoneEnrollment={id:string;phone:string;challengeId:string};

function requireSafeTotpEnrollmentUri(input:string){
  const raw=input.trim();
  if(!raw||/[\u0000-\u001F\u007F]/.test(raw))throw new Error('mfa_enrollment_invalid');
  let parsed:URL;try{parsed=new URL(raw)}catch{throw new Error('mfa_enrollment_invalid')}
  if(parsed.protocol!=='otpauth:'||parsed.hostname.toLowerCase()!=='totp'||!parsed.pathname||!parsed.searchParams.get('secret'))throw new Error('mfa_enrollment_invalid');
  return parsed.toString();
}

export async function openTotpEnrollmentUri(input:string):Promise<void>{
  const url=requireSafeTotpEnrollmentUri(input);
  if(!(await Linking.canOpenURL(url)))throw new Error('mfa_authenticator_unavailable');
  await Linking.openURL(url);
}

export async function getMfaAalState():Promise<MfaAalState>{
  const {data,error}=await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if(error)throw error;
  if(data.currentLevel!=null&&data.currentLevel!=='aal1'&&data.currentLevel!=='aal2')throw new Error('mfa_assurance_invalid');
  if(data.nextLevel!=null&&data.nextLevel!=='aal1'&&data.nextLevel!=='aal2')throw new Error('mfa_assurance_invalid');
  const currentLevel=data.currentLevel==='aal1'?'aal1':data.currentLevel==='aal2'?'aal2':null;
  const nextLevel=data.nextLevel==='aal1'?'aal1':data.nextLevel==='aal2'?'aal2':null;
  return {currentLevel,nextLevel,required:currentLevel==='aal1'&&nextLevel==='aal2'};
}

export async function listMfaFactors():Promise<MfaFactor[]>{
  const {data,error}=await supabase.auth.mfa.listFactors();
  if(error)throw error;
  const totp=(data.totp??[]).map(f=>({id:f.id,friendlyName:f.friendly_name||'Authenticator',status:f.status,type:'totp' as const}));
  const phone=(data.phone??[]).map(f=>({id:f.id,friendlyName:f.friendly_name||'Phone',status:f.status,type:'phone' as const}));
  return [...totp,...phone];
}

export async function enrollTotp():Promise<TotpEnrollment>{
  const {data,error}=await supabase.auth.mfa.enroll({factorType:'totp',friendlyName:'Tailmance Authenticator'});
  if(error)throw error;
  if(!data?.id)throw new Error('mfa_enrollment_invalid');
  try{if(!data.totp?.secret||!data.totp?.uri)throw new Error('mfa_enrollment_invalid');return {id:data.id,secret:data.totp.secret,uri:requireSafeTotpEnrollmentUri(data.totp.uri)}}
  catch(e){await supabase.auth.mfa.unenroll({factorId:data.id}).catch(()=>undefined);throw e}
}

export async function enrollPhone(phone:string):Promise<PhoneEnrollment>{
  const normalized=phone.trim().replace(/[\s()-]/g,'');
  if(!/^\+[1-9]\d{7,14}$/.test(normalized))throw new Error('phone_e164_required');
  const {data,error}=await supabase.auth.mfa.enroll({factorType:'phone',friendlyName:'Tailmance Phone',phone:normalized});
  if(error)throw error;
  if(!data?.id)throw new Error('mfa_enrollment_invalid');
  try{
    const {data:challenge,error:challengeError}=await supabase.auth.mfa.challenge({factorId:data.id});
    if(challengeError)throw challengeError;
    if(!challenge?.id)throw new Error('mfa_challenge_invalid');
    return {id:data.id,phone:normalized,challengeId:challenge.id};
  }catch(e){await supabase.auth.mfa.unenroll({factorId:data.id}).catch(()=>undefined);throw e}
}

export async function challengePhoneFactor(factorId:string){
  const {data,error}=await supabase.auth.mfa.challenge({factorId});
  if(error)throw error;
  if(!data?.id)throw new Error('mfa_challenge_invalid');
  return data.id;
}

export async function verifyPhoneFactor(factorId:string,challengeId:string,code:string){
  const normalized=code.replace(/\s/g,'');
  if(!/^\d{6}$/.test(normalized))throw new Error('mfa_code_invalid');
  if(!challengeId)throw new Error('mfa_challenge_required');
  const {data,error}=await supabase.auth.mfa.verify({factorId,challengeId,code:normalized});
  if(error)throw error;
  return data;
}

export async function verifyTotp(factorId:string,code:string){
  const normalized=code.replace(/\s/g,'');
  if(!/^\d{6}$/.test(normalized))throw new Error('mfa_code_invalid');
  const {data,error}=await supabase.auth.mfa.challengeAndVerify({factorId,code:normalized});
  if(error)throw error;
  return data;
}

export async function cancelMfaEnrollment(factorId:string){
  const {error}=await supabase.auth.mfa.unenroll({factorId});
  if(error)throw error;
}

export async function unenrollMfaFactor(factorId:string){
  await cancelMfaEnrollment(factorId);
  const {error:refreshError}=await supabase.auth.refreshSession();
  return {refreshError};
}

