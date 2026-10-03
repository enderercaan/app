import { AppState, Platform } from 'react-native';
import { Image } from 'expo-image';
import { recordOperationalIssue } from './crashReporting';
import { clearEdgeAiModelCache } from './edgeAi';

const IOS_MEMORY_CACHE_CEILING_BYTES=100*1024*1024;
const IOS_MEMORY_CACHE_MAX_ITEMS=128;
const DISK_CACHE_CEILING_BYTES=256*1024*1024;

let started=false;

async function clearImageMemoryCache(){
  try{await Image.clearMemoryCache()}catch{recordOperationalIssue('image_memory_cache_clear_failed')}
}

async function clearAiModelCache(){
  try{await clearEdgeAiModelCache()}catch{recordOperationalIssue('edge_ai_model_cache_clear_failed')}
}

export function startImageMemoryGuard(){
  if(started)return()=>undefined;
  started=true;

  if(Platform.OS==='ios'){
    Image.configureCache({
      maxMemoryCost:IOS_MEMORY_CACHE_CEILING_BYTES,
      maxMemoryCount:IOS_MEMORY_CACHE_MAX_ITEMS,
      maxDiskSize:DISK_CACHE_CEILING_BYTES
    });
  }

  const stateSubscription=AppState.addEventListener('change',state=>{
    if(state==='background'||state==='inactive'){void clearImageMemoryCache();void clearAiModelCache();}
  });
  const memorySubscription=Platform.OS==='ios'
    ?AppState.addEventListener('memoryWarning',()=>{void clearImageMemoryCache();void clearAiModelCache()})
    :null;

  return()=>{
    stateSubscription.remove();
    memorySubscription?.remove();
    started=false;
  };
}
