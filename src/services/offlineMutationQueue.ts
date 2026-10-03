import { Platform } from 'react-native';
import TailmanceDeviceIntegrity from '../../modules/tailmance-device-integrity';
import { secureStorage } from './secureStorage';
import { supabase } from './supabase';
import { clearDurableClientOperation, clearDurableClientOperationForIntent } from './clientOperation';
import { runBestEffortSync } from './bestEffort';

export type ReplaySafeOfflineMutation =
  | { type:'message'; dedupeKey:string; durableKey:string; operationId:string; conversationId:string; senderPetId:string; body:string }
  | { type:'story_reply'; dedupeKey:string; durableKey:string; operationId:string; conversationId:string; senderPetId:string; storyId:string; body:string }
  | { type:'comment'; dedupeKey:string; durableKey:string; operationId:string; petId:string; postId:string; body:string }
  | { type:'post'; dedupeKey:string; durableKey:string; operationId:string; petId:string; caption:string }
  | { type:'pass'; dedupeKey:string; durableKey:string; operationId:string; fromPetId:string; toPetId:string }
  | { type:'undo_pass'; dedupeKey:string; durableKey:string; operationId:string; petId:string }
  | { type:'like'; dedupeKey:string; durableKey:string; operationId:string; fromPetId:string; toPetId:string; kind:'like' }
  | { type:'post_like'; dedupeKey:string; petId:string; postId:string; enabled:boolean }
  | { type:'post_save'; dedupeKey:string; petId:string; postId:string; enabled:boolean };

type QueueRow={
  id:number;
  user_id:string;
  mutation_type:ReplaySafeOfflineMutation['type'];
  dedupe_key:string;
  operation_id:string|null;
  payload_json:string;
  attempt_count:number;
  revision:number;
};

export type ReplaySummary={sent:number;retrying:number;failed:number;skipped:number};
type ReplayListener=(summary:ReplaySummary)=>void;
const replayListeners=new Set<ReplayListener>();

type SQLiteDb={
  execAsync:(sql:string)=>Promise<void>;
  runAsync:(sql:string,...params:(string|number|null)[])=>Promise<{changes:number;lastInsertRowId:number}>;
  getFirstAsync:<T>(sql:string,...params:(string|number|null)[])=>Promise<T|null>;
  getAllAsync:<T>(sql:string,...params:(string|number|null)[])=>Promise<T[]>;
  withExclusiveTransactionAsync:(task:(tx:SQLiteDb)=>Promise<void>)=>Promise<void>;
};

const DB_NAME='tailmance-offline-v2.db';
const DB_KEY_STORAGE='tailmance_offline_sqlcipher_key_v2';
const MAX_QUEUE_ROWS=100;
const MAX_REPLAY_BATCH=50;
const MAX_BACKOFF_EXPONENT=12;
const BASE_BACKOFF_MS=5_000;
let dbPromise:Promise<SQLiteDb>|null=null;
let replayPromise:Promise<ReplaySummary>|null=null;

class OfflineMutationQueuedError extends Error{
  readonly code='offline_mutation_queued';
  constructor(){super('offline_mutation_queued');this.name='OfflineMutationQueuedError'}
}

export function isOfflineMutationQueuedError(error:unknown):error is OfflineMutationQueuedError{
  return error instanceof OfflineMutationQueuedError||String((error as {message?:unknown})?.message??'')==='offline_mutation_queued';
}

function nativeOnly(){
  if(Platform.OS==='web')throw new Error('offline_queue_native_only');
}

async function databaseKey(){
  nativeOnly();
  const existing=await secureStorage.getItem(DB_KEY_STORAGE);
  if(existing){if(!/^[A-Za-z0-9_-]{40,128}$/.test(existing))throw new Error('offline_queue_key_invalid');return existing}
  if(!TailmanceDeviceIntegrity)throw new Error('offline_queue_key_unavailable');
  const created=await TailmanceDeviceIntegrity.generateSecureRandomBase64UrlAsync(32);
  if(!/^[A-Za-z0-9_-]{40,128}$/.test(created))throw new Error('offline_queue_key_invalid');
  await secureStorage.setItem(DB_KEY_STORAGE,created);
  return created;
}

async function openDb():Promise<SQLiteDb>{
  nativeOnly();
  if(dbPromise)return dbPromise;
  dbPromise=(async()=>{
    const SQLite=await import('expo-sqlite');
    const db=await SQLite.openDatabaseAsync(DB_NAME) as unknown as SQLiteDb;
    const key=await databaseKey();
    await db.execAsync(`PRAGMA key = '${key}';`);
    const cipher=await db.getFirstAsync<{cipher_version?:string}>('PRAGMA cipher_version;');
    if(!cipher?.cipher_version)throw new Error('offline_queue_sqlcipher_unavailable');
    await db.execAsync(`
      PRAGMA foreign_keys = ON;
      PRAGMA secure_delete = ON;
      PRAGMA cipher_memory_security = ON;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS offline_meta (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS offline_mutations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        mutation_type TEXT NOT NULL CHECK (mutation_type IN ('message','story_reply','comment','post','pass','undo_pass','like','post_like','post_save')),
        dedupe_key TEXT NOT NULL UNIQUE,
        operation_id TEXT,
        payload_json TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','failed')),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        next_attempt_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_error_code TEXT,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
      );
      CREATE INDEX IF NOT EXISTS idx_offline_mutations_due
        ON offline_mutations(state,next_attempt_at,created_at);
    `);
    const schema=await db.getFirstAsync<{user_version?:number}>('PRAGMA user_version;');
    if(Number(schema?.user_version??0)<2){
      await db.execAsync(`
        BEGIN IMMEDIATE;
        DROP TABLE IF EXISTS offline_mutations_v2;
        CREATE TABLE offline_mutations_v2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          mutation_type TEXT NOT NULL CHECK (mutation_type IN ('message','story_reply','comment','post','pass','undo_pass','like','post_like','post_save')),
          dedupe_key TEXT NOT NULL UNIQUE,
          operation_id TEXT,
          payload_json TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','failed')),
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
          next_attempt_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_error_code TEXT
        );
        INSERT OR IGNORE INTO offline_mutations_v2(id,user_id,mutation_type,dedupe_key,operation_id,payload_json,state,attempt_count,next_attempt_at,created_at,updated_at,last_error_code)
        SELECT id,user_id,mutation_type,dedupe_key,operation_id,payload_json,state,attempt_count,next_attempt_at,created_at,updated_at,last_error_code
        FROM offline_mutations
        WHERE mutation_type IN ('message','story_reply','comment','post','pass','undo_pass','like','post_like','post_save');
        DROP TABLE offline_mutations;
        ALTER TABLE offline_mutations_v2 RENAME TO offline_mutations;
        CREATE INDEX idx_offline_mutations_due ON offline_mutations(state,next_attempt_at,created_at);
        PRAGMA user_version = 2;
        COMMIT;
      `);
    }
    const columns=await db.getAllAsync<{name:string}>('PRAGMA table_info(offline_mutations);');
    if(!columns.some(column=>column.name==='revision')){
      await db.execAsync(`
        BEGIN IMMEDIATE;
        ALTER TABLE offline_mutations ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1);
        PRAGMA user_version = 3;
        COMMIT;
      `);
    }else if(Number((await db.getFirstAsync<{user_version?:number}>('PRAGMA user_version;'))?.user_version??0)<3){
      await db.execAsync('PRAGMA user_version = 3;');
    }
    if(Number((await db.getFirstAsync<{user_version?:number}>('PRAGMA user_version;'))?.user_version??0)<4){
      await db.execAsync(`
        BEGIN IMMEDIATE;
        CREATE TABLE offline_mutations_v4 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          mutation_type TEXT NOT NULL CHECK (mutation_type IN ('message','story_reply','comment','post','pass','undo_pass','like','post_like','post_save')),
          dedupe_key TEXT NOT NULL UNIQUE,
          operation_id TEXT,
          payload_json TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','failed')),
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
          next_attempt_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_error_code TEXT,
          revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
        );
        INSERT OR IGNORE INTO offline_mutations_v4(id,user_id,mutation_type,dedupe_key,operation_id,payload_json,state,attempt_count,next_attempt_at,created_at,updated_at,last_error_code,revision)
        SELECT id,user_id,mutation_type,dedupe_key,operation_id,payload_json,state,attempt_count,next_attempt_at,created_at,updated_at,last_error_code,revision
        FROM offline_mutations
        WHERE mutation_type IN ('message','story_reply','comment','post','pass','undo_pass','like','post_like','post_save');
        DROP TABLE offline_mutations;
        ALTER TABLE offline_mutations_v4 RENAME TO offline_mutations;
        CREATE INDEX idx_offline_mutations_due ON offline_mutations(state,next_attempt_at,created_at);
        PRAGMA user_version = 4;
        COMMIT;
      `);
    }
    if(Number((await db.getFirstAsync<{user_version?:number}>('PRAGMA user_version;'))?.user_version??0)<5){
      await db.execAsync(`
        BEGIN IMMEDIATE;
        CREATE TABLE offline_mutations_v5 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          mutation_type TEXT NOT NULL CHECK (mutation_type IN ('message','story_reply','comment','post','pass','undo_pass','like','post_like','post_save')),
          dedupe_key TEXT NOT NULL UNIQUE,
          operation_id TEXT,
          payload_json TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','failed')),
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
          next_attempt_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_error_code TEXT,
          revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
        );
        INSERT OR IGNORE INTO offline_mutations_v5(id,user_id,mutation_type,dedupe_key,operation_id,payload_json,state,attempt_count,next_attempt_at,created_at,updated_at,last_error_code,revision)
        SELECT id,user_id,mutation_type,dedupe_key,operation_id,payload_json,state,attempt_count,next_attempt_at,created_at,updated_at,last_error_code,revision
        FROM offline_mutations
        WHERE mutation_type IN ('message','story_reply','comment','post','pass','undo_pass','like','post_like','post_save');
        DROP TABLE offline_mutations;
        ALTER TABLE offline_mutations_v5 RENAME TO offline_mutations;
        CREATE INDEX idx_offline_mutations_due ON offline_mutations(state,next_attempt_at,created_at);
        PRAGMA user_version = 5;
        COMMIT;
      `);
    }
    await db.runAsync("DELETE FROM offline_mutations WHERE state='failed'");
    return db;
  })().catch(error=>{dbPromise=null;throw error});
  return dbPromise;
}

function errorMeta(error:unknown){
  const value=error as {message?:unknown;code?:unknown;status?:unknown;name?:unknown};
  const message=String(value?.message??error??'unknown_error').slice(0,240);
  const code=String(value?.code??value?.name??'unknown').slice(0,80);
  const status=Number(value?.status);
  const retryable=status===429||(Number.isFinite(status)&&status>=500)||/network|fetch|timeout|timed out|request_failed|client_http_timeout|connection|offline|socket/i.test(message);
  return {retryable,code:code||'unknown'};
}

function parseMutation(row:QueueRow):ReplaySafeOfflineMutation{
  const parsed=JSON.parse(row.payload_json) as ReplaySafeOfflineMutation;
  if(!parsed||parsed.type!==row.mutation_type||parsed.dedupeKey!==row.dedupe_key)throw new Error('offline_queue_payload_invalid');
  if('operationId' in parsed&&parsed.operationId!==row.operation_id)throw new Error('offline_queue_operation_mismatch');
  return parsed;
}

async function clearDurableForMutation(mutation:ReplaySafeOfflineMutation){
  if('durableKey' in mutation&&'operationId' in mutation)await clearDurableClientOperation(mutation.durableKey,mutation.operationId).catch(()=>undefined);
}

async function removeRow(db:SQLiteDb,id:number,revision:number,mutation:ReplaySafeOfflineMutation){
  const result=await db.runAsync('DELETE FROM offline_mutations WHERE id=? AND revision=?',id,revision);
  if(result.changes!==1)return false;
  await clearDurableForMutation(mutation);
  if(mutation.type==='pass')await clearDurableClientOperationForIntent('undo-pass',[mutation.fromPetId]).catch(()=>undefined);
  return true;
}

async function markRetry(db:SQLiteDb,row:QueueRow,code:string){
  const attempts=row.attempt_count+1;
  const delay=Math.min(6*60*60*1000,BASE_BACKOFF_MS*(2**Math.min(attempts-1,MAX_BACKOFF_EXPONENT)));
  const result=await db.runAsync("UPDATE offline_mutations SET state='pending',attempt_count=?,next_attempt_at=?,updated_at=?,last_error_code=? WHERE id=? AND revision=?",attempts,Date.now()+delay,Date.now(),code,row.id,row.revision);
  return result.changes===1;
}

async function replayRemote(mutation:ReplaySafeOfflineMutation){
  if(mutation.type==='message'){
    const {error}=await supabase.rpc('send_message_idempotent',{p_conversation_id:mutation.conversationId,p_sender_pet_id:mutation.senderPetId,p_body:mutation.body,p_client_operation_id:mutation.operationId});
    if(error)throw error; return;
  }
  if(mutation.type==='story_reply'){
    const {error}=await supabase.rpc('send_story_reply_idempotent',{p_conversation_id:mutation.conversationId,p_sender_pet_id:mutation.senderPetId,p_story_id:mutation.storyId,p_body:mutation.body,p_client_operation_id:mutation.operationId});
    if(error)throw error; return;
  }
  if(mutation.type==='comment'){
    const {error}=await supabase.rpc('create_comment_idempotent',{p_pet_id:mutation.petId,p_post_id:mutation.postId,p_body:mutation.body,p_client_operation_id:mutation.operationId});
    if(error)throw error; return;
  }
  if(mutation.type==='post'){
    const {error}=await supabase.rpc('create_post_idempotent',{p_pet_id:mutation.petId,p_caption:mutation.caption,p_media_paths:[],p_client_operation_id:mutation.operationId});
    if(error)throw error; return;
  }
  if(mutation.type==='pass'){
    const {error}=await supabase.rpc('pass_pet_idempotent',{p_from_pet_id:mutation.fromPetId,p_to_pet_id:mutation.toPetId,p_client_operation_id:mutation.operationId});
    if(error)throw error; return;
  }
  if(mutation.type==='undo_pass'){
    const {error}=await supabase.rpc('undo_last_pass_idempotent',{p_pet_id:mutation.petId,p_client_operation_id:mutation.operationId});
    if(error)throw error; return;
  }
  if(mutation.type==='like'){
    const {error}=await supabase.rpc('like_pet_idempotent',{p_from_pet_id:mutation.fromPetId,p_to_pet_id:mutation.toPetId,p_kind:'like',p_client_operation_id:mutation.operationId});
    if(error)throw error; return;
  }
  if(mutation.type==='post_like'){
    const {error}=await supabase.rpc('set_post_like',{p_pet_id:mutation.petId,p_post_id:mutation.postId,p_liked:mutation.enabled});
    if(error)throw error; return;
  }
  const {error}=await supabase.rpc('set_saved_post',{p_pet_id:mutation.petId,p_post_id:mutation.postId,p_saved:mutation.enabled});
  if(error)throw error;
}

async function bindOwner(db:SQLiteDb,userId:string|null){
  await db.withExclusiveTransactionAsync(async tx=>{
    const current=await tx.getFirstAsync<{value:string}>("SELECT value FROM offline_meta WHERE key='owner_user_id'");
    const next=userId?.trim()||null;
    if(!next||current?.value!==next)await tx.runAsync('DELETE FROM offline_mutations');
    if(next)await tx.runAsync("INSERT INTO offline_meta(key,value) VALUES('owner_user_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",next);
    else await tx.runAsync("DELETE FROM offline_meta WHERE key='owner_user_id'");
  });
}

export async function bindOfflineMutationQueueToUser(userId:string|null){
  if(Platform.OS==='web')return;
  const db=await openDb();
  await bindOwner(db,userId);
}

export async function clearOfflineMutationQueue(){
  if(Platform.OS==='web')return;
  const db=await openDb();
  await bindOwner(db,null);
}

type OfflineQueueReceipt={id:number;revision:number};

export async function enqueueOfflineMutation(userId:string,mutation:ReplaySafeOfflineMutation):Promise<OfflineQueueReceipt>{
  nativeOnly();
  const db=await openDb();
  const now=Date.now();
  let receipt:OfflineQueueReceipt|null=null;
  await db.withExclusiveTransactionAsync(async tx=>{
    const owner=await tx.getFirstAsync<{value:string}>("SELECT value FROM offline_meta WHERE key='owner_user_id'");
    if(owner?.value!==userId)throw new Error('offline_queue_owner_mismatch');
    const existing=await tx.getFirstAsync<{id:number}>('SELECT id FROM offline_mutations WHERE dedupe_key=?',mutation.dedupeKey);
    if(!existing){
      const count=await tx.getFirstAsync<{count:number}>("SELECT count(*) AS count FROM offline_mutations");
      if(Number(count?.count??0)>=MAX_QUEUE_ROWS)throw new Error('offline_queue_capacity_exceeded');
    }
    const operationId='operationId' in mutation?mutation.operationId:null;
    await tx.runAsync(
      `INSERT INTO offline_mutations(user_id,mutation_type,dedupe_key,operation_id,payload_json,state,attempt_count,next_attempt_at,created_at,updated_at,last_error_code,revision)
       VALUES(?,?,?,?,?,'pending',0,?,?,?,NULL,1)
       ON CONFLICT(dedupe_key) DO UPDATE SET
         user_id=excluded.user_id,mutation_type=excluded.mutation_type,operation_id=excluded.operation_id,payload_json=excluded.payload_json,
         state='pending',attempt_count=0,next_attempt_at=excluded.next_attempt_at,created_at=excluded.created_at,updated_at=excluded.updated_at,last_error_code=NULL,
         revision=offline_mutations.revision+1`,
      userId,mutation.type,mutation.dedupeKey,operationId,JSON.stringify(mutation),now,now,now
    );
    receipt=await tx.getFirstAsync<OfflineQueueReceipt>('SELECT id,revision FROM offline_mutations WHERE dedupe_key=? AND user_id=?',mutation.dedupeKey,userId);
    if(!receipt)throw new Error('offline_queue_enqueue_unverified');
  });
  if(!receipt)throw new Error('offline_queue_enqueue_unverified');
  return receipt;
}

export async function executeWithOfflineQueue<T>(mutation:ReplaySafeOfflineMutation,execute:()=>Promise<T>):Promise<T>{
  if(Platform.OS==='web')return execute();
  const {data}=await supabase.auth.getSession();
  const userId=data.session?.user.id;
  if(!userId)return execute();
  // Native replay-safe mutations are fail-closed on durable queue preparation.
  // Sending without a verified encrypted receipt would reintroduce response-loss duplication
  // and silently defeat the offline/restart safety contract.
  const receipt=await enqueueOfflineMutation(userId,mutation);
  try{
    const result=await execute();
    const db=await openDb();
    await removeRow(db,receipt.id,receipt.revision,mutation);
    return result;
  }catch(error){
    const meta=errorMeta(error);
    if(meta.retryable)throw new OfflineMutationQueuedError();
    const db=await openDb();
    await removeRow(db,receipt.id,receipt.revision,mutation);
    throw error;
  }
}

export function subscribeOfflineReplay(listener:ReplayListener){
  replayListeners.add(listener);
  return()=>{replayListeners.delete(listener)};
}

function emitReplay(summary:ReplaySummary){
  for(const listener of replayListeners)runBestEffortSync('offline_replay_listener',()=>listener(summary))
}

async function replayOfflineMutationsInternal():Promise<ReplaySummary>{
  const summary:ReplaySummary={sent:0,retrying:0,failed:0,skipped:0};
  if(Platform.OS==='web')return summary;
  const {data,error}=await supabase.auth.getSession();
  if(error||!data.session?.user.id){summary.skipped+=1;return summary}
  const userId=data.session.user.id;
  const db=await openDb();
  await bindOwner(db,userId);
  const rows=await db.getAllAsync<QueueRow>(
    "SELECT id,user_id,mutation_type,dedupe_key,operation_id,payload_json,attempt_count,revision FROM offline_mutations WHERE user_id=? AND state='pending' AND next_attempt_at<=? ORDER BY created_at,id LIMIT ?",
    userId,Date.now(),MAX_REPLAY_BATCH
  );
  for(const row of rows){
    let mutation:ReplaySafeOfflineMutation;
    try{mutation=parseMutation(row)}catch{
      await db.runAsync('DELETE FROM offline_mutations WHERE id=? AND revision=?',row.id,row.revision);
      summary.failed+=1;continue;
    }
    try{
      const session=await supabase.auth.getSession();
      if(session.data.session?.user.id!==userId){summary.skipped+=1;break}
      await replayRemote(mutation);
      if(await removeRow(db,row.id,row.revision,mutation))summary.sent+=1;else summary.skipped+=1;
    }catch(error){
      const meta=errorMeta(error);
      if(meta.retryable){if(await markRetry(db,row,meta.code))summary.retrying+=1;else summary.skipped+=1}
      else{if(await removeRow(db,row.id,row.revision,mutation))summary.failed+=1;else summary.skipped+=1}
    }
  }
  emitReplay(summary);
  return summary;
}

export async function replayOfflineMutations():Promise<ReplaySummary>{
  if(replayPromise)return replayPromise;
  replayPromise=replayOfflineMutationsInternal().finally(()=>{replayPromise=null});
  return replayPromise;
}
