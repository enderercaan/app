import { corsHeaders, json } from '../_shared/cors.ts';
import { authenticatedUser, requireDeviceIntegrityIfEnforced } from '../_shared/client.ts';
import { fetchWithTimeout, readResponseJsonBounded } from '../_shared/http.ts';
import { requireAllowlistedHttpsUrl } from '../_shared/outboundUrl.ts';

const PROVIDER_TIMEOUT_MS = 10000;
async function sha256Hex(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('')}


async function markVerificationFailed(supabase:any,sessionId:string){
  const {error}=await supabase.from('owner_verification_sessions')
    .update({status:'failed',updated_at:new Date().toISOString()})
    .eq('id',sessionId);
  if(error) throw new Error('verification_state_write_failed');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok',{headers:corsHeaders});
  if (req.method !== 'POST') return json({error:'method_not_allowed'},405);
  try {
    const {supabase,user}=await authenticatedUser(req);
    await requireDeviceIntegrityIfEnforced(supabase,user.id,'owner_verification');
    const providerUrl=Deno.env.get('IDENTITY_PROVIDER_SESSION_URL');
    const providerSecret=Deno.env.get('IDENTITY_PROVIDER_SECRET');
    if(!providerUrl||!providerSecret) throw new Error('identity_provider_not_configured');
    let parsedProviderUrl:URL;
    try{parsedProviderUrl=requireAllowlistedHttpsUrl(providerUrl,Deno.env.get('IDENTITY_PROVIDER_ALLOWED_HOSTS_JSON'),{errorCode:'identity_provider_invalid_url'})}
    catch{throw new Error('identity_provider_invalid_url')}
    const returnUrl=Deno.env.get('IDENTITY_PROVIDER_RETURN_URL') ?? 'tailmance://verification-complete';
    if(returnUrl!=='tailmance://verification-complete')throw new Error('identity_return_url_invalid');

    const {data:account,error:accountError}=await supabase.from('users').select('identity_verified').eq('id',user.id).single();
    if(accountError) throw accountError;
    if(account?.identity_verified) return json({alreadyVerified:true});

    const nowIso=new Date().toISOString();
    const {error:expireError}=await supabase.from('owner_verification_sessions')
      .update({status:'expired',updated_at:nowIso})
      .eq('user_id',user.id).eq('status','pending').lte('expires_at',nowIso);
    if(expireError) throw new Error('verification_state_write_failed');

    const {data:existing,error:existingError}=await supabase.from('owner_verification_sessions')
      .select('id,expires_at').eq('user_id',user.id).eq('status','pending').maybeSingle();
    if(existingError) throw new Error('verification_state_read_failed');
    if(existing?.id) return json({error:'verification_already_in_progress',requestId:existing.id},409);

    const {error:limitError}=await supabase.rpc('service_rate_limit_user',{p_user_id:user.id,p_action:'owner_verification_start',p_limit:5,p_window_seconds:86400});
    if(limitError){
      const message=String(limitError.message??'');
      if(message.includes('rate_limit_exceeded')) return json({error:'verification_rate_limited'},429);
      throw new Error('verification_rate_limit_failed');
    }

    const {data:session,error}=await supabase.from('owner_verification_sessions').insert({user_id:user.id,status:'pending',provider:'external',expires_at:new Date(Date.now()+30*60*1000).toISOString()}).select('id').single();
    if(error){
      const message=String(error.message??'');
      if(message.includes('owner_verification_one_pending_per_user_idx')||message.includes('duplicate key')) return json({error:'verification_already_in_progress'},409);
      throw error;
    }

    let response:Response;
    try{
      response=await fetchWithTimeout(parsedProviderUrl.toString(),{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${providerSecret}`},body:JSON.stringify({requestId:session.id,userId:user.id,returnUrl})},PROVIDER_TIMEOUT_MS);
    }catch(error){
      await markVerificationFailed(supabase,session.id);
      throw new Error(error instanceof DOMException&&error.name==='AbortError'?'identity_provider_timeout':'identity_provider_unreachable');
    }
    if(!response.ok){await markVerificationFailed(supabase,session.id);throw new Error('identity_provider_error')}
    let payload:any;
    try{payload=await readResponseJsonBounded<any>(response,64_000)}catch{await markVerificationFailed(supabase,session.id);throw new Error('identity_provider_invalid_response')}
    if(!payload?.url||String(payload.url).length>2048){await markVerificationFailed(supabase,session.id);throw new Error('identity_provider_invalid_response')}
    let verificationUrl:URL;
    try{verificationUrl=requireAllowlistedHttpsUrl(String(payload.url),Deno.env.get('IDENTITY_PROVIDER_ALLOWED_HOSTS_JSON'),{allowQuery:true,errorCode:'identity_provider_invalid_response'})}
    catch{await markVerificationFailed(supabase,session.id);throw new Error('identity_provider_invalid_response')}
    const providerReference=payload.reference==null?null:String(payload.reference);
    if(providerReference&&providerReference.length>200){await markVerificationFailed(supabase,session.id);throw new Error('identity_provider_invalid_response')}
    const {error:referenceUpdateError}=await supabase.from('owner_verification_sessions').update({provider_reference_sha256:providerReference?await sha256Hex(providerReference):null,provider_reference:null,updated_at:new Date().toISOString()}).eq('id',session.id);
    if(referenceUpdateError){await markVerificationFailed(supabase,session.id);throw new Error('verification_state_write_failed')}
    return json({url:verificationUrl.toString(),requestId:session.id});
  } catch(e) {
    const code=e instanceof Error&&['Unauthorized','identity_provider_not_configured','identity_provider_invalid_url','identity_return_url_invalid','identity_provider_timeout','identity_provider_unreachable','identity_provider_error','identity_provider_invalid_response','verification_state_write_failed','verification_state_read_failed','verification_rate_limit_failed','device_integrity_required','device_integrity_state_unavailable'].includes(e.message)?e.message:'verification_error';
    return json({error:code},code==='Unauthorized'?401:code==='device_integrity_required'?403:(code==='identity_provider_not_configured'||code==='identity_return_url_invalid'||code==='device_integrity_state_unavailable')?503:400);
  }
});
