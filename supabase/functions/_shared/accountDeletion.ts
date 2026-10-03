import {edgeBestEffort} from './operational.ts';
import { fetchWithTimeout } from './http.ts';
import {revokeStoredOauthCredential,type OauthRevocationProvider} from './oauthRevocation.ts';

type StorageTarget={bucket:string;storagePath:string};

const STORAGE_BUCKETS=['pet-photos','social-media','health-documents','pet-verification'] as const;
const DB_PAGE_SIZE=500;
const FILTER_ID_CHUNK_SIZE=100;
const deletionEncoder=new TextEncoder();

async function normalizedEmailHash(email:string|null|undefined){
  const normalized=String(email??'').trim().toLowerCase();
  if(!normalized)return null;
  const digest=await crypto.subtle.digest('SHA-256',deletionEncoder.encode(normalized));
  return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
}

async function listAllStoragePaths(supabase:any,bucket:string,prefix:string,onProgress?:()=>Promise<void>):Promise<string[]>{
  const out:string[]=[];
  const walk=async(folder:string)=>{
    let offset=0;
    while(true){
      const {data,error}=await supabase.storage.from(bucket).list(folder,{limit:1000,offset,sortBy:{column:'name',order:'asc'}});
      if(error)throw new Error(`storage_inventory_failed:${bucket}:${folder}:${error.message}`);
      if(onProgress)await onProgress();
      const entries=data??[];
      for(const entry of entries){
        if(!entry?.name)continue;
        const path=folder?`${folder}/${entry.name}`:entry.name;
        if(entry.id)out.push(path); else await walk(path);
      }
      if(entries.length<1000)break;
      offset+=entries.length;
    }
  };
  await walk(prefix);
  return out;
}

async function mustRows<T=any>(promise:PromiseLike<{data:T|null;error:any}>,label:string):Promise<T>{
  const {data,error}=await promise;
  if(error)throw new Error(`${label}:${error.message}`);
  return (data??[]) as T;
}

async function pagedRows<T=any>(build:(from:number,to:number)=>PromiseLike<{data:T[]|null;error:any}>,label:string):Promise<T[]>{
  const rows:T[]=[];
  for(let from=0;;from+=DB_PAGE_SIZE){
    const page=await mustRows<T[]>(build(from,from+DB_PAGE_SIZE-1),label);
    rows.push(...page);
    if(page.length<DB_PAGE_SIZE)return rows;
  }
}

async function pagedByIdChunks<T=any>(ids:string[],build:(ids:string[],from:number,to:number)=>PromiseLike<{data:T[]|null;error:any}>,label:string):Promise<T[]>{
  const rows:T[]=[];
  for(let offset=0;offset<ids.length;offset+=FILTER_ID_CHUNK_SIZE){
    const idChunk=ids.slice(offset,offset+FILTER_ID_CHUNK_SIZE);
    rows.push(...await pagedRows<T>((from,to)=>build(idChunk,from,to),label));
  }
  return rows;
}


async function renewDeletionClaim(supabase:any,userId:string,claimToken:string){
  const {data,error}=await supabase.rpc('renew_account_deletion_claim',{p_user_id:userId,p_claim_token:claimToken});
  if(error||data!==true)throw new Error('deletion_claim_lost');
}

async function deleteModerationTargets(supabase:any,targetType:string,ids:string[]){
  for(let offset=0;offset<ids.length;offset+=FILTER_ID_CHUNK_SIZE){
    const idChunk=ids.slice(offset,offset+FILTER_ID_CHUNK_SIZE);
    const {error}=await supabase.from('moderation_items').delete().eq('target_type',targetType).in('target_id',idChunk);
    if(error)throw new Error(`moderation_cleanup_failed:${targetType}:${error.message}`);
  }
}

async function deleteNotificationsForEntities(supabase:any,type:string,ids:string[]){
  for(let offset=0;offset<ids.length;offset+=FILTER_ID_CHUNK_SIZE){
    const idChunk=ids.slice(offset,offset+FILTER_ID_CHUNK_SIZE);
    const {error}=await supabase.from('notifications').delete().eq('type',type).in('entity_id',idChunk);
    if(error)throw new Error(`notification_cleanup_failed:${type}:${error.message}`);
  }
}

function uniqTargets(items:StorageTarget[]){
  const seen=new Set<string>();
  return items.filter(item=>{
    const key=`${item.bucket}:${item.storagePath}`;
    if(seen.has(key))return false;
    seen.add(key); return true;
  });
}

async function queueStorageTargets(supabase:any,targets:StorageTarget[]){
  if(!targets.length)return;
  const now=new Date().toISOString();
  const rows=targets.map(t=>({bucket:t.bucket,storage_path:t.storagePath,queued_at:now,not_before:now,attempts:0,last_error:null}));
  for(let i=0;i<rows.length;i+=250){
    const {error}=await supabase.from('storage_gc_queue').upsert(rows.slice(i,i+250),{onConflict:'bucket,storage_path'});
    if(error)throw new Error(`storage_gc_queue_failed:${error.message}`);
  }
}

async function removeStorageTargets(supabase:any,targets:StorageTarget[]){
  const failed:StorageTarget[]=[];
  for(const bucket of STORAGE_BUCKETS){
    const paths=targets.filter(t=>t.bucket===bucket).map(t=>t.storagePath);
    for(let i=0;i<paths.length;i+=100){
      const batch=paths.slice(i,i+100);
      const {error}=await supabase.storage.from(bucket).remove(batch);
      if(error){failed.push(...batch.map(storagePath=>({bucket,storagePath})));continue;}
      for(const storagePath of batch){
        await supabase.from('storage_gc_queue').delete().eq('bucket',bucket).eq('storage_path',storagePath);
      }
    }
  }
  return failed;
}

async function deleteRevenueCatCustomer(userId:string){
  const apiKey=Deno.env.get('REVENUECAT_REST_API_KEY');
  if(!apiKey)throw new Error('REVENUECAT_REST_API_KEY_missing');
  const response=await fetchWithTimeout(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,{
    method:'DELETE',headers:{Authorization:`Bearer ${apiKey}`,Accept:'application/json'}
  },10000);
  if(response.status!==200&&response.status!==404)throw new Error(`revenuecat_delete_status_${response.status}`);
}

async function queueRevenueCatDeletion(supabase:any,userId:string){
  const now=new Date().toISOString();
  const {error}=await supabase.from('external_deletion_queue').upsert({
    provider:'revenuecat',external_user_id:userId,queued_at:now,not_before:now,attempts:0,last_error:null
  },{onConflict:'provider,external_user_id'});
  // external_deletion_queue is canonical schema (migration 011+). Missing/unusable queue
  // means deployment drift, so fail closed before deleting the local Auth identity.
  if(error)throw new Error(`external_deletion_queue_failed:${error.message}`);
}

async function markRevenueCatDeletionComplete(supabase:any,userId:string){
  const {error}=await supabase.from('external_deletion_queue').delete().eq('provider','revenuecat').eq('external_user_id',userId);
  if(error)throw new Error(`external_deletion_queue_cleanup_failed:${error.message}`);
}

function linkedOauthProviders(authUser:any):OauthRevocationProvider[]{
  const providers=new Set<string>();
  for(const identity of authUser?.identities??[])providers.add(String(identity?.provider??'').toLowerCase());
  for(const provider of Array.isArray(authUser?.app_metadata?.providers)?authUser.app_metadata.providers:[])providers.add(String(provider).toLowerCase());
  return (['apple','google'] as const).filter(provider=>providers.has(provider));
}

async function prepareOauthRevocations(supabase:any,userId:string,authUser:any){
  const queued:OauthRevocationProvider[]=[];const manualRequired:OauthRevocationProvider[]=[];
  const retentionDeadline=new Date(Date.now()+30*24*60*60*1000).toISOString();
  for(const provider of linkedOauthProviders(authUser)){
    const {data,error}=await supabase.rpc('service_prepare_oauth_revocation',{p_user_id:userId,p_provider:provider,p_retention_deadline:retentionDeadline});
    if(error)throw new Error(`oauth_revocation_prepare_failed:${provider}:${error.message}`);
    if(data===true)queued.push(provider);else manualRequired.push(provider);
  }
  return{queued,manualRequired};
}

async function markOauthRevocationComplete(supabase:any,userId:string,provider:OauthRevocationProvider){
  const {error}=await supabase.from('external_deletion_queue').delete().eq('provider',provider).eq('external_user_id',userId);
  if(error)throw new Error(`oauth_revocation_queue_cleanup_failed:${provider}:${error.message}`);
}

async function purgeResidualOperationalData(supabase:any,userId:string,petIds:string[],targets:{
  petPhotoIds:string[];postIds:string[];postMediaIds:string[];commentIds:string[];messageIds:string[];storyIds:string[];eventIds:string[];meetupIds:string[];matchIds:string[];conversationIds:string[];healthDocumentIds:string[];
}){
  const moderationTargets:[string,string[]][]=[
    ['pet_text',petIds],['pet_photo',targets.petPhotoIds],['post_text',targets.postIds],['post_media',targets.postMediaIds],
    ['comment_text',targets.commentIds],['message_text',targets.messageIds],['story',targets.storyIds],['event_text',targets.eventIds],['meetup_text',targets.meetupIds],['health_document',targets.healthDocumentIds]
  ];
  for(const [targetType,ids] of moderationTargets){
    if(!ids.length)continue;
    await deleteModerationTargets(supabase,targetType,ids);
  }
  const notificationTargets:[string,string[]][]=[
    ['like',petIds],['follow',petIds],['match',targets.matchIds],['message',targets.conversationIds],
    ['comment',Array.from(new Set([...targets.postIds,...targets.commentIds]))],['event',targets.eventIds]
  ];
  for(const [type,ids] of notificationTargets){
    if(!ids.length)continue;
    await deleteNotificationsForEntities(supabase,type,ids);
  }
  for(let offset=0;offset<petIds.length;offset+=FILTER_ID_CHUNK_SIZE){
    const petChunk=petIds.slice(offset,offset+FILTER_ID_CHUNK_SIZE);
    const {error}=await supabase.from('notifications').delete().in('actor_pet_id',petChunk);
    if(error)throw new Error(`actor_notification_cleanup_failed:${error.message}`);
  }
  const auditFilters=[`user_id.eq.${userId}`,...petIds.map(id=>`pet_id.eq.${id}`)];
  if(auditFilters.length){
    const {error}=await supabase.from('audit_events').delete().or(auditFilters.join(','));
    if(error)throw new Error(`audit_cleanup_failed:${error.message}`);
  }
  const billingRows=await pagedRows<any>((from,to)=>supabase.from('billing_webhook_events').select('event_id,user_ids').contains('user_ids',[userId]).order('event_id').range(from,to),'billing_cleanup_read_failed');
  for(const row of billingRows??[]){
    const next=(row.user_ids??[]).filter((id:string)=>id!==userId);
    const {error}=await supabase.from('billing_webhook_events').update({user_ids:next}).eq('event_id',row.event_id);
    if(error)throw new Error(`billing_cleanup_write_failed:${error.message}`);
  }
}


export async function hardDeleteAccount(supabase:any,userId:string){
  const {data:claim,error:claimError}=await supabase.rpc('claim_account_deletion',{p_user_id:userId});
  if(claimError)throw new Error('deletion_claim_failed');
  if(claim?.claimed!==true)throw new Error('deletion_in_progress');
  const claimToken=String(claim.claimToken??'');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claimToken))throw new Error('deletion_claim_invalid');
  let hardDeleted=false;
  try{
    const keepClaimAlive=()=>renewDeletionClaim(supabase,userId,claimToken);
    await keepClaimAlive();
    const {data:authRecord,error:authReadError}=await supabase.auth.admin.getUserById(userId);
    if(authReadError||!authRecord?.user)throw new Error('auth_identity_read_failed');
    const emailHash=await normalizedEmailHash(authRecord.user.email);
    const {error:minimizeRequestError}=await supabase.rpc('minimize_account_deletion_requests_for_user',{p_user_id:userId,p_email_hash:emailHash});
    if(minimizeRequestError)throw new Error('deletion_request_minimization_failed');
    await keepClaimAlive();
    const pets=await pagedRows<any>((from,to)=>supabase.from('pets').select('id').eq('owner_id',userId).order('id').range(from,to),'pets_read_failed');
    const petIds=pets.map(p=>String(p.id));

    const storageTargets:StorageTarget[]=[];
    for(const petId of petIds){
      for(const bucket of STORAGE_BUCKETS){
        for(const storagePath of await listAllStoragePaths(supabase,bucket,petId,keepClaimAlive))storageTargets.push({bucket,storagePath});
      }
    }
    const [photos,documents,verification,uploadIntents,posts,comments,stories,events,matches]=await Promise.all([
      petIds.length?pagedRows<any>((from,to)=>supabase.from('pet_photos').select('id,storage_path').in('pet_id',petIds).order('id').range(from,to),'pet_photos_read_failed'):[],
      petIds.length?pagedRows<any>((from,to)=>supabase.from('health_documents').select('id,storage_path').in('pet_id',petIds).order('id').range(from,to),'health_documents_read_failed'):[],
      petIds.length?pagedRows<any>((from,to)=>supabase.from('pet_verification_requests').select('id,storage_path').in('pet_id',petIds).order('id').range(from,to),'pet_verification_read_failed'):[],
      pagedRows<any>((from,to)=>supabase.from('upload_intents').select('id,bucket,storage_path').eq('user_id',userId).order('id').range(from,to),'upload_intents_read_failed'),
      petIds.length?pagedRows<any>((from,to)=>supabase.from('posts').select('id').in('pet_id',petIds).order('id').range(from,to),'posts_read_failed'):[],
      petIds.length?pagedRows<any>((from,to)=>supabase.from('comments').select('id').in('pet_id',petIds).order('id').range(from,to),'comments_read_failed'):[],
      petIds.length?pagedRows<any>((from,to)=>supabase.from('stories').select('id,storage_path').in('pet_id',petIds).order('id').range(from,to),'stories_read_failed'):[],
      petIds.length?pagedRows<any>((from,to)=>supabase.from('pet_events').select('id').in('creator_pet_id',petIds).order('id').range(from,to),'events_read_failed'):[],
      petIds.length?pagedRows<any>((from,to)=>supabase.from('pet_matches').select('id').or(`pet_low_id.in.(${petIds.join(',')}),pet_high_id.in.(${petIds.join(',')})`).order('id').range(from,to),'matches_read_failed'):[]
    ]);
    storageTargets.push(...photos.map((x:any)=>({bucket:'pet-photos',storagePath:x.storage_path})),...documents.map((x:any)=>({bucket:'health-documents',storagePath:x.storage_path})),...verification.map((x:any)=>({bucket:'pet-verification',storagePath:x.storage_path})),...uploadIntents.map((x:any)=>({bucket:x.bucket,storagePath:x.storage_path})));
    const postIds=posts.map((x:any)=>String(x.id));
    const matchIds=matches.map((x:any)=>String(x.id));
    const [postMedia,meetups,conversations]=await Promise.all([
      postIds.length?pagedByIdChunks<any>(postIds,(ids,from,to)=>supabase.from('post_media').select('id,storage_path').in('post_id',ids).order('id').range(from,to),'post_media_read_failed'):[],
      matchIds.length?pagedByIdChunks<any>(matchIds,(ids,from,to)=>supabase.from('meetup_requests').select('id').in('match_id',ids).order('id').range(from,to),'meetups_read_failed'):[],
      matchIds.length?pagedByIdChunks<any>(matchIds,(ids,from,to)=>supabase.from('conversations').select('id').in('match_id',ids).order('id').range(from,to),'conversations_read_failed'):[]
    ]);
    const conversationIds=conversations.map((x:any)=>String(x.id));
    const messages=conversationIds.length?await pagedByIdChunks<any>(conversationIds,(ids,from,to)=>supabase.from('messages').select('id').in('conversation_id',ids).order('id').range(from,to),'messages_read_failed'):[];
    storageTargets.push(...postMedia.map((x:any)=>({bucket:'social-media',storagePath:x.storage_path})),...stories.map((x:any)=>({bucket:'social-media',storagePath:x.storage_path})));
    const uniqueStorageTargets=uniqTargets(storageTargets.filter(t=>t.storagePath));
    await keepClaimAlive();

    const cleanupErrors:string[]=[];
    await queueStorageTargets(supabase,uniqueStorageTargets);
    await keepClaimAlive();
    const oauthRevocations=await prepareOauthRevocations(supabase,userId,authRecord.user);
    if(oauthRevocations.manualRequired.length)cleanupErrors.push(`oauth_manual_revocation_required:${oauthRevocations.manualRequired.join(',')}`);
    for(const provider of oauthRevocations.queued){
      try{
        await revokeStoredOauthCredential(supabase,userId,provider);
        await markOauthRevocationComplete(supabase,userId,provider);
      }catch(error){
        cleanupErrors.push(`oauth_cleanup_pending:${provider}:${error instanceof Error?error.message:String(error)}`);
        if(!oauthRevocations.manualRequired.includes(provider))oauthRevocations.manualRequired.push(provider);
      }
    }
    await keepClaimAlive();
    await queueRevenueCatDeletion(supabase,userId);
    let revenueCatErased=false;
    try{
      await deleteRevenueCatCustomer(userId);
      revenueCatErased=true;
    }catch(error){
      // The durable queue already exists before this attempt, so provider outages can be retried
      // after the local identity is removed without losing the external-erasure obligation.
      cleanupErrors.push(`revenuecat_cleanup_pending:${error instanceof Error?error.message:String(error)}`);
    }
    await keepClaimAlive();

    // Residual operational records do not have a durable retry queue. Purge them before
    // deleting the Auth identity so a transient DB error fails closed and the user can retry.
    await purgeResidualOperationalData(supabase,userId,petIds,{
      petPhotoIds:photos.map((x:any)=>String(x.id)),postIds,postMediaIds:postMedia.map((x:any)=>String(x.id)),
      commentIds:comments.map((x:any)=>String(x.id)),messageIds:messages.map((x:any)=>String(x.id)),storyIds:stories.map((x:any)=>String(x.id)),
      eventIds:events.map((x:any)=>String(x.id)),meetupIds:meetups.map((x:any)=>String(x.id)),matchIds,
      conversationIds,healthDocumentIds:documents.map((x:any)=>String(x.id))
    });
    await keepClaimAlive();

    const {data:legalErasure,error:legalErasureError}=await supabase.rpc('prepare_account_legal_evidence_erasure',{p_user_id:userId});
    if(legalErasureError||legalErasure?.ok!==true)throw new Error('legal_evidence_erasure_failed');
    await keepClaimAlive();

    const {error:deleteError}=await supabase.auth.admin.deleteUser(userId,false);
    if(deleteError)throw new Error(`auth_delete_failed:${deleteError.message}`);
    hardDeleted=true;

    let deletionRequestsFinalized=false;
    try{
      const {error:requestFinalizeError}=await supabase.rpc('finalize_account_deletion_requests_for_deleted_user',{p_user_id:userId});
      if(requestFinalizeError)throw requestFinalizeError;
      deletionRequestsFinalized=true;
    }catch{
      cleanupErrors.push('deletion_request_cleanup_pending');
    }
    if(revenueCatErased&&deletionRequestsFinalized){
      try{await markRevenueCatDeletionComplete(supabase,userId)}catch{cleanupErrors.push('external_deletion_queue_cleanup_pending')}
    }

    const failedStorage=await removeStorageTargets(supabase,uniqueStorageTargets);
    if(failedStorage.length)cleanupErrors.push(`storage_cleanup_pending:${failedStorage.length}`);

    return {ok:true,hardDeleted:true,cleanupPending:cleanupErrors.length>0,manualProviderRevocations:oauthRevocations.manualRequired};
  }catch(error){
    if(!hardDeleted)await edgeBestEffort('account_deletion_release_claim',()=>supabase.rpc('release_account_deletion_claim',{p_user_id:userId,p_claim_token:claimToken}).then((result:{error?:unknown|null})=>{if(result.error)throw result.error}))
    throw error;
  }
}
