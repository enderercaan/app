import { json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/client.ts';
import { readRequestJsonBounded } from '../_shared/http.ts';
import { verifyBearerSecret } from '../_shared/secretAuth.ts';

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
Deno.serve(async(req)=>{
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  const secret=Deno.env.get('MODERATION_APPEALS_ADMIN_SECRET');
  if(!verifyBearerSecret(req.headers.get('Authorization'),secret))return json({error:'Unauthorized'},401);
  let body:any;
  try{body=await readRequestJsonBounded<any>(req,16_384)}catch(error){return json({error:error instanceof Error&&error.message==='body_too_large'?'Payload too large':'Invalid JSON'},error instanceof Error&&error.message==='body_too_large'?413:400)}
  const s=adminClient();
  const action=String(body?.action??'');
  if(action==='list'){
    const limit=Math.min(Math.max(Number(body?.limit)||50,1),100);
    const {data,error}=await s.from('moderation_appeals').select('id,decision_id,appellant_user_id,appellant_role,statement,status,submitted_at').eq('status','pending').order('submitted_at',{ascending:true}).limit(limit);
    if(error)return json({error:'appeal_list_failed'},500);
    return json({ok:true,appeals:data??[]});
  }
  if(action==='review'){
    const appealId=String(body?.appealId??'');
    const outcome=String(body?.outcome??'');
    const explanation=String(body?.outcomeExplanation??'').trim();
    const reviewerReference=String(body?.reviewerReference??'').trim();
    if(!UUID_RE.test(appealId)||!['accepted','rejected'].includes(outcome)||explanation.length<3||explanation.length>2000||reviewerReference.length<1||reviewerReference.length>200)return json({error:'Invalid review request'},400);
    const {data,error}=await s.rpc('admin_review_moderation_appeal',{p_appeal_id:appealId,p_outcome:outcome,p_outcome_explanation:explanation,p_reviewer_reference:reviewerReference});
    if(error)return json({error:String(error.message??'').includes('already')?'appeal_already_decided':'appeal_review_failed'},String(error.message??'').includes('already')?409:500);
    return json({ok:true,result:data});
  }
  if(action==='finalize_reversal'){
    const decisionId=String(body?.decisionId??'');
    const reviewerReference=String(body?.reviewerReference??'').trim();
    if(!UUID_RE.test(decisionId)||reviewerReference.length<1||reviewerReference.length>200)return json({error:'Invalid finalize request'},400);
    const {data,error}=await s.rpc('admin_finalize_decision_reversal',{p_decision_id:decisionId,p_reviewer_reference:reviewerReference});
    if(error)return json({error:String(error.message??'').includes('restore_product_state_before_reversal')?'restore_product_state_before_reversal':'decision_reversal_failed'},409);
    return json({ok:true,result:data});
  }
  return json({error:'Unsupported action'},400);
});
