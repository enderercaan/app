import { Platform } from 'react-native';
import { secureStorage } from './secureStorage';
import TailmanceDeviceIntegrity from '../../modules/tailmance-device-integrity';

type OperationPart=string|number|boolean|null|undefined;
type StoredOperation=[fingerprint:string,operationId:string,createdAt:number];

const STORE_KEY='tailmance_client_operations_v1';
const STORE_OWNER_KEY='tailmance_client_operations_owner_v1';
const STORE_TTL_MS=24*60*60*1000;
const STORE_MAX_ENTRIES=12;
const DURABLE_STORAGE_CAPACITY_ERROR='durable_operation_storage_capacity_exceeded';
const DURABLE_STORAGE_ERROR='durable_operation_storage_unavailable';
let memoryEntries:StoredOperation[]|null=null;
let serialized:Promise<void>=Promise.resolve();
let durableUnavailable=false;

async function secureRandomOperationSuffix(){
  if(Platform.OS!=='web'){
    if(!TailmanceDeviceIntegrity)throw new Error('secure_operation_random_unavailable');
    const value=await TailmanceDeviceIntegrity.generateSecureRandomBase64UrlAsync(18);
    if(!/^[A-Za-z0-9_-]{24,128}$/.test(value))throw new Error('secure_operation_random_invalid');
    return value;
  }
  const webCrypto=(globalThis as unknown as {crypto?:{getRandomValues:(array:Uint8Array)=>Uint8Array}}).crypto;
  if(!webCrypto?.getRandomValues)throw new Error('secure_operation_random_unavailable');
  const bytes=webCrypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
}

export async function createClientOperationId(scope:string){
  const safe=scope.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,20)||'op';
  const random=await secureRandomOperationSuffix();
  return `${safe}_${Date.now().toString(36)}_${random}`.slice(0,96);
}

export function stableOperationKey(parts:OperationPart[]){
  return parts.map(value=>value==null?'':String(value)).join('\u001f');
}

function hash32(input:string,seed:number){
  let h=seed>>>0;
  for(let i=0;i<input.length;i++){h^=input.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0;}
  return h.toString(16).padStart(8,'0');
}

function operationFingerprint(scope:string,parts:OperationPart[]){
  // Only this fixed-length fingerprint is persisted. User-authored request text never is.
  const raw=`${scope}\u001e${stableOperationKey(parts)}`;
  return [0x811c9dc5,0x9e3779b9,0x85ebca6b,0xc2b2ae35].map(seed=>hash32(raw,seed)).join('');
}

function prune(entries:StoredOperation[],now=Date.now()){
  return entries
    .filter(entry=>Array.isArray(entry)&&/^[0-9a-f]{32}$/.test(entry[0])&&/^[A-Za-z0-9_-]{16,96}$/.test(entry[1])&&Number.isFinite(entry[2])&&now-entry[2]>=0&&now-entry[2]<=STORE_TTL_MS)
    .sort((a,b)=>b[2]-a[2]);
}

async function loadEntries(){
  if(durableUnavailable)throw new Error(DURABLE_STORAGE_ERROR);
  if(memoryEntries)return prune(memoryEntries);
  try{
    const raw=Platform.OS==='web'
      ?(globalThis as unknown as {localStorage?:{getItem:(key:string)=>string|null}}).localStorage?.getItem(STORE_KEY)
      :await secureStorage.getItem(STORE_KEY);
    if(Platform.OS==='web'&&!(globalThis as unknown as {localStorage?:unknown}).localStorage)throw new Error(DURABLE_STORAGE_ERROR);
    const parsed=raw?JSON.parse(raw):[];
    memoryEntries=prune(Array.isArray(parsed)?parsed:[]);
  }catch{
    durableUnavailable=true;
    memoryEntries=[];
    throw new Error(DURABLE_STORAGE_ERROR);
  }
  return memoryEntries;
}

async function persistEntries(entries:StoredOperation[]){
  memoryEntries=prune(entries);
  if(durableUnavailable)throw new Error(DURABLE_STORAGE_ERROR);
  try{
    if(Platform.OS==='web'){
      const storage=(globalThis as unknown as {localStorage?:{setItem:(key:string,value:string)=>void}}).localStorage;
      if(!storage)throw new Error(DURABLE_STORAGE_ERROR);
      storage.setItem(STORE_KEY,JSON.stringify(memoryEntries));
    }else await secureStorage.setItem(STORE_KEY,JSON.stringify(memoryEntries));
  }
  catch{durableUnavailable=true;throw new Error(DURABLE_STORAGE_ERROR);}
}

async function serial<T>(task:()=>Promise<T>):Promise<T>{
  let release!:()=>void;
  const previous=serialized;
  serialized=new Promise<void>(resolve=>{release=resolve});
  await previous;
  try{return await task();}finally{release();}
}

export async function getOrCreateDurableClientOperation(scope:string,parts:OperationPart[]){
  const fingerprint=operationFingerprint(scope,parts);
  return serial(async()=>{
    const entries=await loadEntries();
    const existing=entries.find(entry=>entry[0]===fingerprint);
    if(existing)return {key:fingerprint,id:existing[1],createdAt:existing[2]};
    // Never evict a live retry identity to make room for a new mutation. Losing an
    // unexpired operation id can turn an ambiguous response-loss retry into a duplicate
    // server mutation. Fail closed until an existing operation is completed or expires.
    if(entries.length>=STORE_MAX_ENTRIES)throw new Error(DURABLE_STORAGE_CAPACITY_ERROR);
    const createdAt=Date.now();
    const id=await createClientOperationId(scope);
    await persistEntries([[fingerprint,id,createdAt],...entries.filter(entry=>entry[0]!==fingerprint)]);
    return {key:fingerprint,id,createdAt};
  });
}

export async function clearDurableClientOperation(key:string,operationId:string){
  await serial(async()=>{
    try{
      const entries=await loadEntries();
      await persistEntries(entries.filter(entry=>!(entry[0]===key&&entry[1]===operationId)));
    }catch{
      // The server mutation may already be committed. Keep cleanup best-effort, but
      // durableUnavailable makes every later native get/create fail closed this process.
      durableUnavailable=true;
      if(memoryEntries)memoryEntries=memoryEntries.filter(entry=>!(entry[0]===key&&entry[1]===operationId));
    }
  });
}

export async function clearDurableClientOperationForIntent(scope:string,parts:OperationPart[]){
  const fingerprint=operationFingerprint(scope,parts);
  await serial(async()=>{
    try{
      const entries=await loadEntries();
      await persistEntries(entries.filter(entry=>entry[0]!==fingerprint));
    }catch{
      durableUnavailable=true;
      if(memoryEntries)memoryEntries=memoryEntries.filter(entry=>entry[0]!==fingerprint);
    }
  });
}

async function readStoredOwner(){
  if(Platform.OS==='web'){
    const storage=(globalThis as unknown as {localStorage?:{getItem:(key:string)=>string|null}}).localStorage;
    if(!storage)throw new Error(DURABLE_STORAGE_ERROR);
    return storage.getItem(STORE_OWNER_KEY);
  }
  return secureStorage.getItem(STORE_OWNER_KEY);
}

async function writeStoredOwner(userId:string|null){
  if(Platform.OS==='web'){
    const storage=(globalThis as unknown as {localStorage?:{setItem:(key:string,value:string)=>void;removeItem:(key:string)=>void}}).localStorage;
    if(!storage)throw new Error(DURABLE_STORAGE_ERROR);
    if(userId)storage.setItem(STORE_OWNER_KEY,userId);else storage.removeItem(STORE_OWNER_KEY);
    return;
  }
  if(userId)await secureStorage.setItem(STORE_OWNER_KEY,userId);else await secureStorage.removeItem(STORE_OWNER_KEY);
}

async function removeStoredOperations(){
  if(Platform.OS==='web'){
    const storage=(globalThis as unknown as {localStorage?:{removeItem:(key:string)=>void}}).localStorage;
    if(!storage)throw new Error(DURABLE_STORAGE_ERROR);
    storage.removeItem(STORE_KEY);
  }else await secureStorage.removeItem(STORE_KEY);
}

export async function bindDurableClientOperationsToUser(userId:string|null){
  await serial(async()=>{
    try{
      const next=userId?.trim()||null;
      const owner=await readStoredOwner();
      const entries=await loadEntries();
      // A pre-binding store cannot be proven to belong to the current account. Prefer
      // dropping ambiguous retry state once over ever carrying it across accounts.
      if(!next||owner!==next){
        if(entries.length)await removeStoredOperations();
        memoryEntries=[];
      }
      await writeStoredOwner(next);
      durableUnavailable=false;
    }catch{
      durableUnavailable=true;
      throw new Error(DURABLE_STORAGE_ERROR);
    }
  });
}

export async function clearAllDurableClientOperations(){
  await serial(async()=>{
    memoryEntries=[];
    try{
      await removeStoredOperations();
      await writeStoredOwner(null);
      durableUnavailable=false;
    }catch{
      durableUnavailable=true;
      throw new Error(DURABLE_STORAGE_ERROR);
    }
  });
}
