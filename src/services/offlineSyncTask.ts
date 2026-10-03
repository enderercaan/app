import { AppState, Platform } from 'react-native';
import * as BackgroundTask from 'expo-background-task';
import * as Network from 'expo-network';
import * as TaskManager from 'expo-task-manager';
import { replayOfflineMutations } from './offlineMutationQueue';

const TASK_NAME='tailmance-offline-sync-v1';
let foregroundSubscription:{remove:()=>void}|null=null;
let networkSubscription:{remove:()=>void}|null=null;

if(Platform.OS!=='web'&&!TaskManager.isTaskDefined(TASK_NAME)){
  TaskManager.defineTask(TASK_NAME,async()=>{
    try{
      const result=await replayOfflineMutations();
      return result.retrying>0?BackgroundTask.BackgroundTaskResult.Failed:BackgroundTask.BackgroundTaskResult.Success;
    }catch{
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function ensureOfflineBackgroundSyncRegistered(){
  if(Platform.OS==='web')return;
  const status=await BackgroundTask.getStatusAsync();
  if(status!==BackgroundTask.BackgroundTaskStatus.Available)return;
  if(!await TaskManager.isTaskRegisteredAsync(TASK_NAME))await BackgroundTask.registerTaskAsync(TASK_NAME,{minimumInterval:15});
}

export async function unregisterOfflineBackgroundSync(){
  if(Platform.OS==='web')return;
  if(await TaskManager.isTaskRegisteredAsync(TASK_NAME))await BackgroundTask.unregisterTaskAsync(TASK_NAME);
}

export function bindOfflineForegroundReplay(){
  if(Platform.OS==='web'||foregroundSubscription||networkSubscription)return()=>undefined;
  const run=()=>{void replayOfflineMutations().catch(()=>undefined)};
  foregroundSubscription=AppState.addEventListener('change',state=>{if(state==='active')run()});
  networkSubscription=Network.addNetworkStateListener(state=>{if(state.isConnected===true&&state.isInternetReachable!==false)run()});
  run();
  return()=>{foregroundSubscription?.remove();foregroundSubscription=null;networkSubscription?.remove();networkSubscription=null};
}
