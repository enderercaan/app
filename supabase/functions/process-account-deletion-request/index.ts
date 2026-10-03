import { json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/client.ts';
import { hardDeleteAccount } from '../_shared/accountDeletion.ts';
import { readRequestJsonBounded } from '../_shared/http.ts';
import { verifyBearerSecret } from '../_shared/secretAuth.ts';
import {edgeBestEffort} from '../_shared/operational.ts';

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES=16_384;
const normalizeEmail=(value:unknown)=>String(value??'').trim().toLowerCase();

function authUserMissing(error:any){
  const status=Number(error?.status??0);
  const message=String(error?.message??'').toLowerCase();
  return status===404||message.includes('user not found')||message.includes('user_not_found');
}

Deno.serve(async(req)=>{
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  const secret=Deno.env.get('ACCOUNT_DELETION_ADMIN_SECRET');
  if(!verifyBearerSecret(req.headers.get('Authorization'),secret))return json({error:'Unauthorized'},401);

  let body:any;
  try{body=await readRequestJsonBounded<any>(req,MAX_BODY_BYTES)}catch(error){
    const tooLarge=error instanceof Error&&error.message==='body_too_large';
    return json({error:tooLarge?'payload_too_large':'invalid_request'},tooLarge?413:400);
  }
  const requestId=String(body?.requestId??'');
  const verificationReference=String(body?.verificationReference??'').trim();
  if(!UUID_RE.test(requestId)||body?.identityVerified!==true||verificationReference.length<1||verificationReference.length>255){
    return json({error:'identity_verification_required'},400);
  }

  const s=adminClient();
  const {data:claim,error:claimError}=await s.rpc('claim_web_account_deletion_request',{
    p_request_id:requestId,p_identity_verified:true,p_verification_reference:verificationReference
  });
  if(claimError)return json({error:'deletion_request_claim_failed'},500);
  if(claim?.claimed!==true)return json({ok:true,processed:false,status:String(claim?.status??'unavailable')});
  const claimToken=String(claim.claimToken??'');
  if(!UUID_RE.test(claimToken))return json({error:'deletion_request_claim_invalid'},500);

  try{
    const expectedEmail=normalizeEmail(claim.email);
    const expectedEmailHash=String(claim.emailHash??'').toLowerCase();
    let targetUserId=String(claim.targetUserId??'');

    if(!UUID_RE.test(targetUserId)){
      if(!/^[0-9a-f]{64}$/.test(expectedEmailHash))throw new Error('account_lookup_failed');
      const {data:lookup,error:lookupError}=await s.rpc('lookup_auth_user_by_email_hash',{p_email_hash:expectedEmailHash});
      if(lookupError)throw new Error('account_lookup_failed');
      if(!lookup){
        const {data:finished,error:finishError}=await s.rpc('finish_web_account_deletion_request',{
          p_request_id:requestId,p_claim_token:claimToken,p_status:'completed',p_resolution_note:'verified_account_not_found'
        });
        if(finishError||finished!==true)throw new Error('deletion_request_finish_failed');
        return json({ok:true,processed:true,accountAlreadyAbsent:true});
      }
      targetUserId=String(lookup);
      if(!UUID_RE.test(targetUserId))throw new Error('account_lookup_failed');

      const {data:authData,error:authError}=await s.auth.admin.getUserById(targetUserId);
      if(authError||!authData?.user)throw new Error('account_recheck_failed');
      if(normalizeEmail(authData.user.email)!==expectedEmail)throw new Error('account_recheck_failed');
      const {data:bound,error:bindError}=await s.rpc('bind_web_account_deletion_target',{
        p_request_id:requestId,p_claim_token:claimToken,p_user_id:targetUserId
      });
      if(bindError||bound!==true)throw new Error('deletion_target_bind_failed');
    }else{
      const {data:authData,error:authError}=await s.auth.admin.getUserById(targetUserId);
      if(authError){
        if(authUserMissing(authError)){
          const {data:finished,error:finishError}=await s.rpc('finish_web_account_deletion_request',{
            p_request_id:requestId,p_claim_token:claimToken,p_status:'completed',p_resolution_note:'deletion_completed_on_previous_attempt'
          });
          if(finishError||finished!==true)throw new Error('deletion_request_finish_failed');
          return json({ok:true,processed:true,recovered:true});
        }
        throw new Error('account_recheck_failed');
      }
      if(!authData?.user)throw new Error('account_recheck_failed');
      if(expectedEmail&&normalizeEmail(authData.user.email)!==expectedEmail)throw new Error('account_recheck_failed');
    }

    const result=await hardDeleteAccount(s,targetUserId);
    if(result?.hardDeleted!==true)throw new Error('hard_delete_not_confirmed');
    const {data:finished,error:finishError}=await s.rpc('finish_web_account_deletion_request',{
      p_request_id:requestId,p_claim_token:claimToken,p_status:'completed',p_resolution_note:result.cleanupPending?'hard_deleted_cleanup_pending':'hard_deleted'
    });
    if(finishError)throw new Error('deletion_request_finish_failed');
    if(finished!==true){
      const {data:requestState,error:requestStateError}=await s.from('account_deletion_requests').select('status').eq('id',requestId).maybeSingle();
      if(requestStateError||requestState?.status!=='completed')throw new Error('deletion_request_finish_failed');
    }
    return json({ok:true,processed:true,cleanupPending:Boolean(result.cleanupPending)});
  }catch(error){
    const code=error instanceof Error&&/^[a-z0-9_]{1,120}$/.test(error.message)?error.message:'web_deletion_processing_failed';
    await edgeBestEffort('web_account_deletion_release_claim',()=>s.rpc('release_web_account_deletion_request',{p_request_id:requestId,p_claim_token:claimToken,p_error_code:code}).then((result:{error?:unknown|null})=>{if(result.error)throw result.error}))
    return json({error:code},500);
  }
});
