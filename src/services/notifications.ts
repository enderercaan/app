import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { secureStorage } from './secureStorage';
import { getRuntimeLocale, translate } from '../i18n';
import { confirmPrePermission } from './permissionPrompts';
import { configureSystemCalls, currentVoipPushToken } from './systemCalls';

const PUSH_TOKEN_STORAGE_KEY = 'tailmance.expoPushToken';
const VOIP_TOKEN_STORAGE_KEY = 'tailmance.apnsVoipPushToken';
let pushLifecycleEpoch=0;
let expoPushRegistrationIntent=0;
let voipPushRegistrationIntent=0;
let pushMutationQueue:Promise<unknown>=Promise.resolve();
const queuePushMutation=<T>(work:()=>Promise<T>):Promise<T>=>{
  const next=pushMutationQueue.catch(()=>undefined).then(work);
  pushMutationQueue=next.catch(()=>undefined);
  return next;
};
const invalidatePendingPushRegistrations=()=>{pushLifecycleEpoch+=1;expoPushRegistrationIntent+=1;voipPushRegistrationIntent+=1;return pushLifecycleEpoch};

export type PushTokenRollback={disabledIds:string[];localToken:string|null;localVoipToken?:string|null};
const normalizeIds=(value:unknown)=>Array.isArray(value)?value.filter((id):id is string=>typeof id==='string'&&id.length>0):[];

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true })
});

function projectId() {
  return Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
}

export async function ensureNotificationChannels(locale=getRuntimeLocale()) {
  if (Platform.OS !== 'android') return;
  await Promise.all([
    Notifications.setNotificationChannelAsync('default',{name:'Tailmance',importance:Notifications.AndroidImportance.HIGH,vibrationPattern:[0,200,100,200]}),
    Notifications.setNotificationChannelAsync('messages',{name:translate(locale,'notifications.channel.messages'),importance:Notifications.AndroidImportance.HIGH,vibrationPattern:[0,180,80,180]}),
    Notifications.setNotificationChannelAsync('health',{name:translate(locale,'notifications.channel.health'),importance:Notifications.AndroidImportance.DEFAULT})
  ]);
}

async function currentExpoPushTokenWithoutPrompt() {
  if (Platform.OS === 'web') return null;
  const stored = await secureStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
  if (stored) return stored;
  const permission = await Notifications.getPermissionsAsync();
  if (permission.status !== 'granted') return null;
  const id = projectId();
  if (!id || id.startsWith('REPLACE_')) return null;
  await ensureNotificationChannels();
  const token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  return token || null;
}

export async function registerPushToken(activePetId?: string, requestPermission=true) {
  if (Platform.OS === 'web') return null;
  const epoch=pushLifecycleEpoch;
  const intent=++expoPushRegistrationIntent;
  await ensureNotificationChannels();
  const permission = await Notifications.getPermissionsAsync();
  let status = permission.status;
  if (status !== 'granted' && requestPermission) {
    const proceed=await confirmPrePermission('notifications');
    if(!proceed)return null;
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted'||epoch!==pushLifecycleEpoch||intent!==expoPushRegistrationIntent) return null;
  const id = projectId();
  if (!id || id.startsWith('REPLACE_')) return null;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  if(epoch!==pushLifecycleEpoch||intent!==expoPushRegistrationIntent)return null;
  return queuePushMutation(async()=>{
    if(epoch!==pushLifecycleEpoch||intent!==expoPushRegistrationIntent)return null;
    const previousToken = await secureStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
    let rotationRollback:PushTokenRollback|null=null;
    if(previousToken && previousToken !== token){
      const {data,error:revokeError}=await supabase.functions.invoke('push-token-lifecycle',{body:{mode:'current',token:previousToken,transport:'expo'}});
      if(revokeError)throw revokeError;
      rotationRollback={disabledIds:normalizeIds(data?.disabledIds),localToken:previousToken};
    }
    if(epoch!==pushLifecycleEpoch||intent!==expoPushRegistrationIntent){
      if(rotationRollback)await restorePushTokensUnlocked(rotationRollback).catch(()=>undefined);
      return null;
    }
    const {error}=await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS, p_active_pet_id: activePetId ?? null, p_transport: 'expo' });
    if(error){
      if(rotationRollback)await restorePushTokensUnlocked(rotationRollback).catch(()=>undefined);
      throw error;
    }
    if(epoch!==pushLifecycleEpoch||intent!==expoPushRegistrationIntent){
      await supabase.functions.invoke('push-token-lifecycle',{body:{mode:'current',token,transport:'expo'}}).catch(()=>undefined);
      return null;
    }
    await secureStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
    return token;
  });
}

export async function registerVoipPushToken(activePetId?:string,providedToken?:string){
  if(Platform.OS!=='ios')return null;
  const epoch=pushLifecycleEpoch;
  const intent=++voipPushRegistrationIntent;
  if(!(await configureSystemCalls())||epoch!==pushLifecycleEpoch||intent!==voipPushRegistrationIntent)return null;
  const token=(providedToken??await currentVoipPushToken())?.trim().toLowerCase()??'';
  if(!/^[0-9a-f]{40,512}$/.test(token)||token.length%2!==0)return null;
  return queuePushMutation(async()=>{
    if(epoch!==pushLifecycleEpoch||intent!==voipPushRegistrationIntent)return null;
    const previousToken=await secureStorage.getItem(VOIP_TOKEN_STORAGE_KEY);
    let rotationRollback:PushTokenRollback|null=null;
    if(previousToken&&previousToken!==token){
      const {data,error}=await supabase.functions.invoke('push-token-lifecycle',{body:{mode:'current',token:previousToken,transport:'apns_voip'}});
      if(error)throw error;
      rotationRollback={disabledIds:normalizeIds(data?.disabledIds),localToken:previousToken};
    }
    if(epoch!==pushLifecycleEpoch||intent!==voipPushRegistrationIntent){
      if(rotationRollback)await restorePushTokensUnlocked(rotationRollback,VOIP_TOKEN_STORAGE_KEY).catch(()=>undefined);
      return null;
    }
    const {error}=await supabase.rpc('register_push_token',{p_token:token,p_platform:'ios',p_active_pet_id:activePetId??null,p_transport:'apns_voip'});
    if(error){
      if(rotationRollback)await restorePushTokensUnlocked(rotationRollback,VOIP_TOKEN_STORAGE_KEY).catch(()=>undefined);
      throw error;
    }
    if(epoch!==pushLifecycleEpoch||intent!==voipPushRegistrationIntent){
      await supabase.functions.invoke('push-token-lifecycle',{body:{mode:'current',token,transport:'apns_voip'}}).catch(()=>undefined);
      return null;
    }
    await secureStorage.setItem(VOIP_TOKEN_STORAGE_KEY,token);
    return token;
  });
}

export async function unregisterVoipPushToken(providedToken?:string):Promise<PushTokenRollback>{
  if(Platform.OS!=='ios')return {disabledIds:[],localToken:null};
  const intent=++voipPushRegistrationIntent;
  return queuePushMutation(async()=>{
    if(intent!==voipPushRegistrationIntent)return {disabledIds:[],localToken:null};
    const storedToken=await secureStorage.getItem(VOIP_TOKEN_STORAGE_KEY);
    const token=(providedToken??storedToken??'').trim().toLowerCase();
    if(!token){await secureStorage.removeItem(VOIP_TOKEN_STORAGE_KEY);return {disabledIds:[],localToken:null}}
    const {data,error}=await supabase.functions.invoke('push-token-lifecycle',{body:{mode:'current',token,transport:'apns_voip'}});
    if(error)throw error;
    if(intent===voipPushRegistrationIntent)await secureStorage.removeItem(VOIP_TOKEN_STORAGE_KEY);
    return {disabledIds:normalizeIds(data?.disabledIds),localToken:storedToken};
  });
}

async function restorePushTokensUnlocked(rollback:PushTokenRollback,storageKey=PUSH_TOKEN_STORAGE_KEY){
  if(Platform.OS==='web')return;
  if(rollback.disabledIds.length){
    const {error}=await supabase.functions.invoke('push-token-lifecycle',{body:{mode:'restore',ids:rollback.disabledIds}});
    if(error)throw error;
  }
  if(rollback.localToken)await secureStorage.setItem(storageKey,rollback.localToken);
}

export async function unregisterCurrentPushToken():Promise<PushTokenRollback> {
  if (Platform.OS === 'web') return {disabledIds:[],localToken:null};
  invalidatePendingPushRegistrations();
  return queuePushMutation(async()=>{
    const storedToken=await secureStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
    const token = storedToken ?? await currentExpoPushTokenWithoutPrompt();
    if (!token) {
      await secureStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
      return {disabledIds:[],localToken:storedToken};
    }
    const { data, error } = await supabase.functions.invoke('push-token-lifecycle', { body: { mode: 'current', token, transport: 'expo' } });
    if (error) throw error;
    await secureStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
    return {disabledIds:normalizeIds(data?.disabledIds),localToken:storedToken??token};
  });
}

export async function disableAllPushTokens():Promise<PushTokenRollback> {
  if (Platform.OS === 'web') return {disabledIds:[],localToken:null};
  invalidatePendingPushRegistrations();
  return queuePushMutation(async()=>{
    const [localToken,localVoipToken]=await Promise.all([secureStorage.getItem(PUSH_TOKEN_STORAGE_KEY),secureStorage.getItem(VOIP_TOKEN_STORAGE_KEY)]);
    const { data, error } = await supabase.functions.invoke('push-token-lifecycle', { body: { mode: 'all' } });
    if (error) throw error;
    await Promise.all([secureStorage.removeItem(PUSH_TOKEN_STORAGE_KEY),secureStorage.removeItem(VOIP_TOKEN_STORAGE_KEY)]);
    return {disabledIds:normalizeIds(data?.disabledIds),localToken,localVoipToken};
  });
}

export async function restorePushTokens(rollback:PushTokenRollback){
  return queuePushMutation(async()=>{
    if(Platform.OS==='web')return;
    if(rollback.disabledIds.length){
      const {error}=await supabase.functions.invoke('push-token-lifecycle',{body:{mode:'restore',ids:rollback.disabledIds}});
      if(error)throw error;
    }
    const writes:Promise<void>[]=[];
    if(rollback.localToken)writes.push(secureStorage.setItem(PUSH_TOKEN_STORAGE_KEY,rollback.localToken));
    if(rollback.localVoipToken)writes.push(secureStorage.setItem(VOIP_TOKEN_STORAGE_KEY,rollback.localVoipToken));
    await Promise.all(writes);
  });
}

export async function clearLocalPushState(){
  if(Platform.OS==='web')return;
  invalidatePendingPushRegistrations();
  return queuePushMutation(async()=>{
    // Serialize local cleanup behind any registration already in flight. Otherwise a
    // registration can pass its final epoch check, then write the token after this
    // function has removed it during logout/account deletion.
    await Promise.all([secureStorage.removeItem(PUSH_TOKEN_STORAGE_KEY),secureStorage.removeItem(VOIP_TOKEN_STORAGE_KEY)]);
    await Notifications.clearLastNotificationResponseAsync().catch(()=>undefined);
  });
}

export function subscribeToPushTokenRefresh(activePetId: string) {
  if (Platform.OS === 'web') return { remove: () => undefined };
  return Notifications.addPushTokenListener(() => {
    void registerPushToken(activePetId, false).catch(() => undefined);
  });
}
