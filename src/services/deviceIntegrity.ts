import { Platform } from 'react-native';
import TailmanceDeviceIntegrity from '../../modules/tailmance-device-integrity';
import { env } from './config';
import { secureStorage } from './secureStorage';
import { supabase } from './supabase';

const PREPARED_PROJECTS=new Set<string>();

type Challenge={challengeId:string;clientData:string;expiresAt:string};
type LocalRiskSignals={debuggerAttached:boolean;emulatorOrSimulator:boolean;rootOrJailbreakHeuristic:boolean;debugBuild:boolean};
const keyStorageName=(userId:string)=>`tailmance_app_attest_key_v1_${userId}`;

async function currentUserId(){
  const {data,error}=await supabase.auth.getUser();
  if(error||!data.user)throw new Error('device_integrity_auth_required');
  return data.user.id;
}
async function challenge(action:string,platform:'ios'|'android'){
  const {data,error}=await supabase.functions.invoke('verify-device-integrity',{body:{operation:'challenge',action,platform}});
  if(error||!data?.challengeId||!data?.clientData)throw new Error('device_integrity_challenge_failed');
  return data as Challenge;
}
async function localRiskSignals():Promise<LocalRiskSignals|null>{
  try{return await TailmanceDeviceIntegrity?.getLocalRiskSignalsAsync()??null}catch{return null}
}
async function submit(body:Record<string,unknown>){
  const {data,error}=await supabase.functions.invoke('verify-device-integrity',{body:{operation:'verify',...body}});
  if(error||data?.verified!==true)throw new Error(String(data?.error??'device_integrity_verification_failed'));
  return data as {verified:true;expiresAt:string};
}

async function verifyDeviceIntegrity(action:string){
  if(!/^[a-z][a-z0-9_.:-]{1,79}$/.test(action))throw new Error('device_integrity_action_invalid');
  if(Platform.OS!=='ios'&&Platform.OS!=='android')return {supported:false as const,verified:false as const};
  if(!TailmanceDeviceIntegrity)throw new Error('device_integrity_native_module_unavailable');
  const platform=Platform.OS as 'ios'|'android';
  const [c,clientRiskSignals]=await Promise.all([challenge(action,platform),localRiskSignals()]);
  if(platform==='android'){
    const project=env.playIntegrityCloudProjectNumber;
    if(!/^\d{6,20}$/.test(project))throw new Error('play_integrity_project_number_missing');
    if(!PREPARED_PROJECTS.has(project)){
      await TailmanceDeviceIntegrity.preparePlayIntegrityAsync(project);
      PREPARED_PROJECTS.add(project);
    }
    const token=await TailmanceDeviceIntegrity.requestPlayIntegrityTokenAsync(c.clientData);
    const result=await submit({challengeId:c.challengeId,clientData:c.clientData,platform,token,clientRiskSignals});
    return {supported:true as const,...result};
  }
  if(!(await TailmanceDeviceIntegrity.isAppAttestSupportedAsync()))return {supported:false as const,verified:false as const};
  const userId=await currentUserId(); const storageKey=keyStorageName(userId);
  let keyId=await secureStorage.getItem(storageKey);
  if(!keyId){
    const candidate=await TailmanceDeviceIntegrity.generateAppAttestKeyAsync();
    const attestation=await TailmanceDeviceIntegrity.attestAppAttestKeyAsync(candidate,c.clientData);
    const result=await submit({challengeId:c.challengeId,clientData:c.clientData,platform,appleMode:'attestation',keyId:candidate,attestation,clientRiskSignals});
    await secureStorage.setItem(storageKey,candidate);
    keyId=candidate;
    return {supported:true as const,...result};
  }
  const assertion=await TailmanceDeviceIntegrity.generateAppAttestAssertionAsync(keyId,c.clientData);
  const result=await submit({challengeId:c.challengeId,clientData:c.clientData,platform,appleMode:'assertion',keyId,assertion,clientRiskSignals});
  return {supported:true as const,...result};
}

export async function bestEffortDeviceIntegrity(action:string){
  try{return await verifyDeviceIntegrity(action)}catch{return {supported:Platform.OS==='ios'||Platform.OS==='android',verified:false as const}}
}
