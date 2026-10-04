import { json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/client.ts';
import { markWorkerHeartbeat } from '../_shared/workerHeartbeat.ts';
import { verifyBearerSecret } from '../_shared/secretAuth.ts';

async function hasReference(s:any,table:string,path:string,extra?:(q:any)=>any){
  let query=s.from(table).select('id',{count:'exact',head:true}).eq('storage_path',path);
  if(extra)query=extra(query);
  const {count,error}=await query;
  if(error)throw new Error(`reference_check_failed:${table}:${error.message}`);
  return (count??0)>0;
}

async function stillReferenced(s:any,bucket:string,path:string){
  if(bucket==='pet-photos')return hasReference(s,'pet_photos',path);
  if(bucket==='health-documents')return hasReference(s,'health_documents',path);
  if(bucket==='pet-verification')return hasReference(s,'pet_verification_requests',path,q=>q.eq('status','pending'));
  if(bucket==='social-media'){
    const [posts,stories]=await Promise.all([
      hasReference(s,'post_media',path),
      hasReference(s,'stories',path)
    ]);
    return posts||stories;
  }
  throw new Error(`unsupported_storage_bucket:${bucket}`);
}

async function queueExpiredUploadIntents(s:any){
  const now=new Date().toISOString();
  const {data,error}=await s.from('upload_intents')
    .select('id,bucket,storage_path')
    .is('consumed_at',null).is('cancelled_at',null).lt('expires_at',now).limit(250);
  if(error)throw error;
  let queued=0;
  for(const row of data??[]){
    const {data:cancelled,error:cancelError}=await s.from('upload_intents')
      .update({cancelled_at:now})
      .eq('id',row.id).is('consumed_at',null).is('cancelled_at',null)
      .select('id').maybeSingle();
    if(cancelError)throw new Error(`upload_intent_cancel_failed:${cancelError.message}`);
    if(!cancelled)continue;
    const {error:queueError}=await s.from('storage_gc_queue').upsert({
      bucket:row.bucket,storage_path:row.storage_path,queued_at:now,not_before:now,attempts:0,last_error:null
    },{onConflict:'bucket,storage_path'});
    if(queueError)throw new Error(`expired_upload_gc_queue_failed:${queueError.message}`);
    queued++;
  }
  return queued;
}

Deno.serve(async(req)=>{
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  const secret=Deno.env.get('STORAGE_GC_SECRET');
  if(!verifyBearerSecret(req.headers.get('Authorization'),secret))return json({error:'Unauthorized'},401);
  const s=adminClient();
  await markWorkerHeartbeat(s,'storage-gc','started');
  let expiredIntents=0;
  try{ expiredIntents=await queueExpiredUploadIntents(s); }
  catch{ return json({error:'expired_upload_gc_failed'},500); }
  const {data:rows,error}=await s.rpc('claim_storage_gc_items',{p_limit:100});
  if(error)return json({error:'storage_gc_queue_unavailable'},500);
  let deleted=0,retained=0,failed=0;
  for(const row of rows??[]){
    try{
      if(await stillReferenced(s,row.bucket,row.storage_path)){
        const {error:removeQueueError}=await s.from('storage_gc_queue').delete().eq('id',row.id);
        if(removeQueueError)throw new Error(`gc_queue_cleanup_failed:${removeQueueError.message}`);
        retained++;
        continue;
      }
      const {error:removeError}=await s.storage.from(row.bucket).remove([row.storage_path]);
      if(removeError)throw removeError;
      const {error:removeQueueError}=await s.from('storage_gc_queue').delete().eq('id',row.id);
      if(removeQueueError)throw new Error(`gc_queue_cleanup_failed:${removeQueueError.message}`);
      deleted++;
    }catch(e){
      const attempts=(row.attempts??0)+1;
      const delayMinutes=Math.min(1440,Math.pow(2,Math.min(attempts,8))*5);
      const {error:retryError}=await s.from('storage_gc_queue').update({
        attempts,last_error:'storage_gc_operation_failed',not_before:new Date(Date.now()+delayMinutes*60000).toISOString()
      }).eq('id',row.id);
      if(retryError)return json({error:'gc_retry_state_failed',expiredIntents,deleted,retained,failed},500);
      failed++;
    }
  }
  await markWorkerHeartbeat(s,'storage-gc','completed');
  return json({ok:true,expiredIntents,deleted,retained,failed});
});
