import { json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/client.ts';
import { markWorkerHeartbeat } from '../_shared/workerHeartbeat.ts';
import { fetchWithTimeout } from '../_shared/http.ts';
import { verifyBearerSecret } from '../_shared/secretAuth.ts';
import {currentOauthRevocationKeyVersion,rewrapStoredOauthCredential,revokeStoredOauthCredential,type OauthRevocationProvider} from '../_shared/oauthRevocation.ts';

async function deleteRevenueCatCustomer(userId:string){
  const apiKey=Deno.env.get('REVENUECAT_REST_API_KEY');
  if(!apiKey)throw new Error('REVENUECAT_REST_API_KEY_missing');
  const response=await fetchWithTimeout(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,{
    method:'DELETE',
    headers:{Authorization:`Bearer ${apiKey}`,Accept:'application/json'}
  },10000);
  if(response.status!==200&&response.status!==404)throw new Error(`revenuecat_delete_status_${response.status}`);
}

Deno.serve(async(req)=>{
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  const secret=Deno.env.get('EXTERNAL_DELETION_WORKER_SECRET');
  if(!verifyBearerSecret(req.headers.get('Authorization'),secret))return json({error:'Unauthorized'},401);
  const supabase=adminClient();
  await markWorkerHeartbeat(supabase,'external-deletion-worker','started');
  const {data:rows,error}=await supabase.rpc('claim_external_deletion_items',{p_limit:100});
  if(error)return json({error:'external_deletion_queue_unavailable'},500);

  const {error:expiryError}=await supabase.rpc('service_expire_oauth_revocation_credentials');
  if(expiryError)return json({error:'oauth_revocation_retention_cleanup_failed'},500);

  const currentKeyVersion=currentOauthRevocationKeyVersion();
  const {data:rotationRows,error:rotationReadError}=await supabase.from('oauth_revocation_credentials')
    .select('account_user_id,provider,token_kind,token_ciphertext,token_iv,key_version,retention_deadline')
    .neq('key_version',currentKeyVersion).order('updated_at',{ascending:true}).limit(100);
  if(rotationReadError)return json({error:'oauth_revocation_rotation_inventory_failed'},500);
  let rewrapped=0,rotationFailed=0;
  for(const credential of rotationRows??[]){
    try{if(await rewrapStoredOauthCredential(supabase,credential))rewrapped++;}
    catch{rotationFailed++;}
  }

  let completed=0,failed=0;
  for(const row of rows??[]){
    try{
      const externalUserId=String(row.external_user_id);
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(externalUserId))throw new Error('invalid_external_user_id');
      if(row.provider==='revenuecat'){
        await deleteRevenueCatCustomer(externalUserId);
        const {error:requestFinalizeError}=await supabase.rpc('finalize_account_deletion_requests_for_deleted_user',{p_user_id:externalUserId});
        if(requestFinalizeError)throw new Error('deletion_request_finalize_failed');
      }else if(row.provider==='apple'||row.provider==='google'){
        await revokeStoredOauthCredential(supabase,externalUserId,row.provider as OauthRevocationProvider);
      }else throw new Error('unsupported_provider');
      const {error:removeError}=await supabase.from('external_deletion_queue')
        .delete().eq('provider',row.provider).eq('external_user_id',row.external_user_id);
      if(removeError)throw removeError;
      completed++;
    }catch(error){
      const attempts=(row.attempts??0)+1;
      const delayMinutes=Math.min(1440,Math.pow(2,Math.min(attempts,8))*5);
      const message=error instanceof Error?error.message:'';
      const revenueCatTimeout=error instanceof DOMException&&error.name==='AbortError'?'revenuecat_timeout':null;
      const failureCode=/^(?:revenuecat_delete_status_|apple_oauth_revoke_status_|google_oauth_revoke_status_)\d{3}$/.test(message)?message:message==='unsupported_provider'?'unsupported_provider':message==='invalid_external_user_id'?'invalid_external_user_id':message==='deletion_request_finalize_failed'?'deletion_request_finalize_failed':message==='REVENUECAT_REST_API_KEY_missing'?'revenuecat_rest_key_missing':message==='oauth_revocation_credential_missing'?'oauth_revocation_credential_missing':message==='apple_sign_in_revocation_config_missing'?'apple_sign_in_revocation_config_missing':message.startsWith('oauth_revocation_')?message.slice(0,120):revenueCatTimeout??'external_deletion_failed';
      const {error:retryUpdateError}=await supabase.from('external_deletion_queue').update({
        attempts,
        last_error:failureCode,
        not_before:new Date(Date.now()+delayMinutes*60000).toISOString()
      }).eq('provider',row.provider).eq('external_user_id',row.external_user_id);
      if(retryUpdateError)throw new Error('external_deletion_retry_state_write_failed');
      failed++;
    }
  }
  await markWorkerHeartbeat(supabase,'external-deletion-worker','completed');
  return json({ok:true,completed,failed,rewrapped,rotationFailed});
});
