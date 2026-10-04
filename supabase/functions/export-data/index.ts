import { corsHeaders, json } from '../_shared/cors.ts';
import { authenticatedUser, requireAal2IfEnrolled, requireDeviceIntegrityIfEnforced } from '../_shared/client.ts';

const encoder=new TextEncoder();
const TOKEN_TTL_MS=5*60*1000;

function base64Url(bytes:Uint8Array){
  let binary='';
  for(const byte of bytes)binary+=String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
async function sha256Hex(value:string){
  const digest=await crypto.subtle.digest('SHA-256',encoder.encode(value));
  return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  try{
    const {supabase,user,token:authToken}=await authenticatedUser(req);
    await requireAal2IfEnrolled(supabase,user.id,authToken);
    await requireDeviceIntegrityIfEnforced(supabase,user.id,'account_export');
    const {error:limitError}=await supabase.rpc('service_rate_limit_user',{
      p_user_id:user.id,p_action:'account_export_issue',p_limit:10,p_window_seconds:3600
    });
    if(limitError){
      if(String(limitError.message??'').includes('rate_limit_exceeded'))return json({error:'rate_limit_exceeded'},429);
      throw new Error('export_rate_limit_failed');
    }
    const tokenBytes=crypto.getRandomValues(new Uint8Array(32));
    const token=base64Url(tokenBytes);
    const tokenHash=await sha256Hex(token);
    const expiresAt=new Date(Date.now()+TOKEN_TTL_MS).toISOString();

    // Keep at most one fresh, unclaimed export capability per user. Claimed/expired rows are
    // audit-minimal and may be purged operationally without affecting the export itself.
    const {error:invalidateError}=await supabase.from('account_export_download_tokens')
      .delete().eq('user_id',user.id);
    if(invalidateError)throw new Error('export_token_rotation_failed');

    const {error:insertError}=await supabase.from('account_export_download_tokens').insert({
      user_id:user.id,token_hash:tokenHash,expires_at:expiresAt
    });
    if(insertError)throw new Error('export_token_issue_failed');

    return json({ok:true,token,expiresAt});
  }catch(error){
    const code=error instanceof Error?error.message:'export_token_failed';
    if(code==='mfa_required')return json({error:'mfa_required'},403);
    if(code==='mfa_state_unavailable')return json({error:'mfa_state_unavailable'},503);
    if(code==='device_integrity_required')return json({error:'device_integrity_required'},403);
    if(code==='device_integrity_state_unavailable')return json({error:'device_integrity_state_unavailable'},503);
    return json({error:code==='Unauthorized'?'unauthorized':'export_token_failed'},code==='Unauthorized'?401:500);
  }
});
