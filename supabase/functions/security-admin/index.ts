import { json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/client.ts';
import { readRequestJsonBounded } from '../_shared/http.ts';
import { verifyBearerSecret } from '../_shared/secretAuth.ts';

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASONS=new Set(['suspected_account_compromise','security_incident_response','credential_recovery','operator_emergency']);

Deno.serve(async(req)=>{
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  const secret=Deno.env.get('SECURITY_ADMIN_SECRET');
  if(!verifyBearerSecret(req.headers.get('Authorization'),secret,32))return json({error:'Unauthorized'},401);
  let body:any;
  try{body=await readRequestJsonBounded<any>(req,8_192)}catch(error){
    const tooLarge=error instanceof Error&&error.message==='body_too_large';
    return json({error:tooLarge?'payload_too_large':'invalid_json'},tooLarge?413:400);
  }
  if(body?.action!=='revoke_user_sessions')return json({error:'unsupported_action'},400);
  const userId=typeof body?.userId==='string'?body.userId.trim():'';
  const reason=typeof body?.reason==='string'?body.reason.trim():'';
  if(!UUID_RE.test(userId)||!REASONS.has(reason))return json({error:'invalid_request'},400);
  const supabase=adminClient();
  const {data,error}=await supabase.rpc('service_revoke_user_sessions',{p_user_id:userId,p_reason:reason});
  if(error)return json({error:'session_revocation_failed'},500);
  return json({ok:true,revoked:true,result:data??null});
});
