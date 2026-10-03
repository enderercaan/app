import { json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/client.ts';
import { readRequestJsonBounded } from '../_shared/http.ts';
import { verifyBearerSecret } from '../_shared/secretAuth.ts';

const ALLOWED_TARGET_TYPES = new Set(['pet_verification','pet_photo','pet_text','post_media','post_text','comment_text','message_text','story','event_text','meetup_text','health_document']);
const ALLOWED_HEALTH_SIGNALS = new Set(['veterinarian_verified','microchip_verified','genetic_screening_available','pedigree_available','vaccination_complete','neutered']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ADMIN_BODY_BYTES=16_384;
const MAX_REASON_LENGTH=500;

function assertDbOk(error:any,code:string){if(error)throw new Error(code)}

async function assertRestorationSafe(s:any,sourceReference:string){
  const {error}=await s.rpc('assert_moderation_restoration_safe',{p_source_reference:sourceReference});
  assertDbOk(error,'moderation_restoration_preflight_failed');
}

async function confirmRestorationIfPresent(s:any,sourceReference:string){
  const {error}=await s.rpc('confirm_moderation_restoration_for_source',{p_source_reference:sourceReference,p_reviewer_reference:null});
  assertDbOk(error,'moderation_restoration_confirmation_failed');
}

async function refreshPet(s:any,petId:string){
  const [{data:photos,error:photosError},{data:textReview,error:textError}]=await Promise.all([
    s.from('pet_photos').select('moderation_status').eq('pet_id',petId),
    s.from('moderation_items').select('status').eq('target_type','pet_text').eq('target_id',petId).maybeSingle()
  ]);
  assertDbOk(photosError,'pet_photo_state_read_failed');
  assertDbOk(textError,'pet_text_state_read_failed');
  const three=(photos??[]).length===3&&(photos??[]).every((x:any)=>x.moderation_status==='approved');
  const rejected=(photos??[]).some((x:any)=>x.moderation_status==='rejected')||textReview?.status==='rejected';
  const {error}=await s.from('pets').update({moderation_status:rejected?'rejected':three&&textReview?.status==='approved'?'approved':'pending'}).eq('id',petId);
  assertDbOk(error,'pet_moderation_state_write_failed');
}

async function refreshPost(s:any,postId:string){
  const [{data:media,error:mediaError},{data:textReview,error:textError}]=await Promise.all([
    s.from('post_media').select('moderation_status').eq('post_id',postId),
    s.from('moderation_items').select('status').eq('target_type','post_text').eq('target_id',postId).maybeSingle()
  ]);
  assertDbOk(mediaError,'post_media_state_read_failed');
  assertDbOk(textError,'post_text_state_read_failed');
  const rejected=(media??[]).some((x:any)=>x.moderation_status==='rejected')||textReview?.status==='rejected';
  const ok=!(media??[]).some((x:any)=>x.moderation_status!=='approved');
  const {error}=await s.from('posts').update({moderation_status:rejected?'rejected':ok&&textReview?.status==='approved'?'approved':'pending'}).eq('id',postId);
  assertDbOk(error,'post_moderation_state_write_failed');
}

Deno.serve(async(req)=>{
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  const secret=Deno.env.get('MODERATION_ADMIN_SECRET');
  if(!verifyBearerSecret(req.headers.get('Authorization'),secret))return json({error:'Unauthorized'},401);

  let body:any;
  try{body=await readRequestJsonBounded<any>(req,MAX_ADMIN_BODY_BYTES)}
  catch(error){return json({error:error instanceof Error&&error.message==='body_too_large'?'Payload too large':'Invalid JSON'},error instanceof Error&&error.message==='body_too_large'?413:400)}

  const {targetType,targetId,decision,healthSignal}=body??{};
  const rawReason=typeof body?.reason==='string'?body.reason.trim():'';
  if(rawReason.length>MAX_REASON_LENGTH)return json({error:'Reason too long'},400);
  const reason=rawReason||null;
  if(decision==='rejected'&&!reason)return json({error:'User-visible reason required for rejection'},400);
  if(typeof targetType!=='string'||!ALLOWED_TARGET_TYPES.has(targetType)||typeof targetId!=='string'||!UUID_RE.test(targetId)||!['approved','rejected'].includes(decision))return json({error:'Invalid request'},400);
  if(healthSignal!=null&&(typeof healthSignal!=='string'||!ALLOWED_HEALTH_SIGNALS.has(healthSignal)))return json({error:'Invalid health signal'},400);
  if(healthSignal&&targetType!=='health_document')return json({error:'Health signal requires health document target'},400);
  if(targetType==='health_document'&&decision==='approved'&&healthSignal==='veterinarian_verified')return json({error:'Provider attestation required for veterinarian verification'},400);

  const s=adminClient();
  const now=new Date().toISOString();
  const recordRejectedDecision=async(sourceReference:string)=>{
    if(decision!=='rejected')return;
    const {error}=await s.rpc('record_moderation_restriction_decision',{
      p_target_type:targetType,p_target_id:targetId,p_source:'manual',p_user_visible_reason:reason,p_source_reference:sourceReference
    });
    assertDbOk(error,'formal_moderation_decision_write_failed');
  };
  try{
    if(targetType==='pet_verification'){
      const sourceReference=`pet_verification:${targetId}`;
      if(decision==='approved')await assertRestorationSafe(s,sourceReference);
      const {error}=await s.rpc('review_pet_verification',{p_request_id:targetId,p_approved:decision==='approved',p_reason:reason});
      assertDbOk(error,'pet_verification_review_failed');
      await recordRejectedDecision(sourceReference);
      if(decision==='approved')await confirmRestorationIfPresent(s,sourceReference);
      return json({ok:true});
    }

    if(targetType==='comment_text'||targetType==='message_text'){
      const {data:item,error:itemReadError}=await s.from('moderation_items').select('id').eq('target_type',targetType).eq('target_id',targetId).maybeSingle();
      assertDbOk(itemReadError,'moderation_item_read_failed');
      if(!item?.id)return json({error:'Moderation item not found'},404);
      const sourceReference=`moderation_item:${item.id}`;
      if(decision==='approved')await assertRestorationSafe(s,sourceReference);
      const rpcName=targetType==='comment_text'?'finalize_comment_moderation':'finalize_message_moderation';
      const {error}=await s.rpc(rpcName,{p_item_id:item.id,p_status:decision,p_provider:'manual_admin',p_reason:reason,p_score:{}});
      assertDbOk(error,targetType==='comment_text'?'comment_review_failed':'message_review_failed');
      await recordRejectedDecision(sourceReference);
      if(decision==='approved')await confirmRestorationIfPresent(s,sourceReference);
      return json({ok:true});
    }

    if(decision==='approved'){
      const {data:preItem,error:preItemError}=await s.from('moderation_items').select('id').eq('target_type',targetType).eq('target_id',targetId).maybeSingle();
      assertDbOk(preItemError,'moderation_item_read_failed');
      if(!preItem?.id)return json({error:'Moderation item not found'},404);
      await assertRestorationSafe(s,`moderation_item:${preItem.id}`);
    }
    const {data:item,error:itemError}=await s.from('moderation_items')
      .update({status:decision,reason,reviewed_at:now,provider:'manual_admin'})
      .eq('target_type',targetType).eq('target_id',targetId)
      .select('id').maybeSingle();
    assertDbOk(itemError,'moderation_item_write_failed');
    if(!item)return json({error:'Moderation item not found'},404);

    if(targetType==='pet_photo'){
      const {data:r,error}=await s.from('pet_photos').update({moderation_status:decision,moderation_reason:reason}).eq('id',targetId).select('pet_id').maybeSingle();
      assertDbOk(error,'pet_photo_review_failed');
      if(r?.pet_id)await refreshPet(s,r.pet_id);
    }else if(targetType==='pet_text'){
      await refreshPet(s,targetId);
    }else if(targetType==='post_media'){
      const {data:r,error}=await s.from('post_media').update({moderation_status:decision}).eq('id',targetId).select('post_id').maybeSingle();
      assertDbOk(error,'post_media_review_failed');
      if(r?.post_id)await refreshPost(s,r.post_id);
    }else if(targetType==='post_text'){
      await refreshPost(s,targetId);
    }else if(targetType==='comment_text'){
      throw new Error('comment_review_unreachable');
    }else if(targetType==='story'){
      const {error}=await s.from('stories').update({moderation_status:decision}).eq('id',targetId);assertDbOk(error,'story_review_failed');
    }else if(targetType==='event_text'){
      const {error}=await s.from('pet_events').update({moderation_status:decision}).eq('id',targetId);assertDbOk(error,'event_review_failed');
    }else if(targetType==='meetup_text'){
      const {error}=await s.from('meetup_requests').update({moderation_status:decision,moderation_reason:reason}).eq('id',targetId);assertDbOk(error,'meetup_review_failed');
    }else if(targetType==='health_document'){
      const {error}=await s.rpc('service_review_health_document',{p_health_document_id:targetId,p_approved:decision==='approved',p_signal:healthSignal??null,p_reviewed_at:now});
      assertDbOk(error,'health_document_review_failed');
    }
    const sourceReference=`moderation_item:${item.id}`;
    await recordRejectedDecision(sourceReference);
    if(decision==='approved')await confirmRestorationIfPresent(s,sourceReference);
    return json({ok:true});
  }catch(error){
    const code=error instanceof Error&&/^[a-z0-9_]{1,80}$/.test(error.message)?error.message:'moderation_admin_failed';
    return json({error:code},500);
  }
});
