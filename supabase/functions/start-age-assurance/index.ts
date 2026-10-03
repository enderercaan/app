import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient, authenticatedUser, requireDeviceIntegrityIfEnforced } from '../_shared/client.ts';
import { fetchWithTimeout, readResponseJsonBounded } from '../_shared/http.ts';
import { requireAllowlistedHttpsUrl } from '../_shared/outboundUrl.ts';

const PROVIDER_TIMEOUT_MS=10000;
async function sha256Hex(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('')}
async function markAgeAssuranceFailed(admin:any,sessionId:string){const {error}=await admin.from('legal_age_assurance_sessions').update({status:'failed',updated_at:new Date().toISOString()}).eq('id',sessionId);if(error)throw new Error('age_assurance_state_write_failed')}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json({error:'method_not_allowed'},405);
  try{
    const {supabase,user}=await authenticatedUser(req);
    await requireDeviceIntegrityIfEnforced(supabase,user.id,'age_assurance');
    const admin=adminClient();
    const {data:runtime,error:runtimeError}=await admin.from('legal_country_runtime').select('legal_country_code,legal_subnational_code,resolution_status,expires_at').eq('user_id',user.id).maybeSingle();
    if(runtimeError)throw new Error('age_assurance_context_unavailable');
    if(!runtime||runtime.resolution_status!=='verified'||!runtime.legal_country_code||(runtime.expires_at&&new Date(runtime.expires_at).getTime()<=Date.now()))throw new Error('age_assurance_context_unavailable');
    const {data:policy,error:policyError}=await admin.from('legal_jurisdiction_policies').select('release_status,age_assurance_mode,minimum_user_age,subnational_review_required').eq('legal_country_code',runtime.legal_country_code).maybeSingle();
    if(policyError||!policy)throw new Error('age_assurance_policy_unavailable');
    if(policy.release_status!=='approved'||policy.age_assurance_mode!=='verified_external')throw new Error('verified_external_age_assurance_not_required');
    if(policy.subnational_review_required&&!runtime.legal_subnational_code)throw new Error('age_assurance_context_unavailable');

    const {data:events,error:eventsError}=await admin.from('legal_age_assurance_events').select('id,result,age_threshold,verified_at,expires_at,created_at').eq('user_id',user.id).eq('legal_country_code',runtime.legal_country_code).eq('legal_subnational_code',runtime.legal_subnational_code??null).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(20);
    if(eventsError)throw new Error('age_assurance_state_unavailable');
    const latestRevocation=(events??[]).find((x:any)=>x.result==='revoked');
    const activePass=(events??[]).find((x:any)=>x.result==='passed'&&Number(x.age_threshold)>=Number(policy.minimum_user_age)&&(!x.expires_at||new Date(x.expires_at).getTime()>Date.now())&&(!latestRevocation||new Date(latestRevocation.created_at).getTime()<new Date(x.created_at).getTime()));
    if(activePass)return json({alreadyVerified:true});

    const providerUrl=Deno.env.get('AGE_ASSURANCE_PROVIDER_SESSION_URL')??Deno.env.get('IDENTITY_PROVIDER_SESSION_URL');
    const providerSecret=Deno.env.get('AGE_ASSURANCE_PROVIDER_SECRET')??Deno.env.get('IDENTITY_PROVIDER_SECRET');
    const allowedHosts=Deno.env.get('AGE_ASSURANCE_PROVIDER_ALLOWED_HOSTS_JSON')??Deno.env.get('IDENTITY_PROVIDER_ALLOWED_HOSTS_JSON');
    if(!providerUrl||!providerSecret)throw new Error('age_assurance_provider_not_configured');
    const parsedProvider=requireAllowlistedHttpsUrl(providerUrl,allowedHosts,{errorCode:'age_assurance_provider_invalid_url'});
    const returnUrl=Deno.env.get('AGE_ASSURANCE_PROVIDER_RETURN_URL')??'tailmance://age-verification-complete';
    if(returnUrl!=='tailmance://age-verification-complete')throw new Error('age_assurance_return_url_invalid');

    const nowIso=new Date().toISOString();
    const {error:expireError}=await admin.from('legal_age_assurance_sessions').update({status:'expired',updated_at:nowIso}).eq('user_id',user.id).eq('status','pending').lte('expires_at',nowIso);
    if(expireError)throw new Error('age_assurance_state_write_failed');
    const {data:existing,error:existingError}=await admin.from('legal_age_assurance_sessions').select('id,expires_at').eq('user_id',user.id).eq('status','pending').maybeSingle();
    if(existingError)throw new Error('age_assurance_state_unavailable');
    if(existing?.id)return json({error:'age_assurance_already_in_progress',requestId:existing.id},409);
    const {error:limitError}=await supabase.rpc('service_rate_limit_user',{p_user_id:user.id,p_action:'age_assurance_start',p_limit:5,p_window_seconds:86400});
    if(limitError){if(String(limitError.message??'').includes('rate_limit_exceeded'))return json({error:'age_assurance_rate_limited'},429);throw new Error('age_assurance_rate_limit_failed')}
    const {data:session,error:sessionError}=await admin.from('legal_age_assurance_sessions').insert({user_id:user.id,legal_country_code:runtime.legal_country_code,legal_subnational_code:runtime.legal_subnational_code??null,age_threshold:policy.minimum_user_age,provider_code:'external',status:'pending',expires_at:new Date(Date.now()+30*60*1000).toISOString()}).select('id').single();
    if(sessionError){
      // Another device/request may have won the one-pending-session race after our read.
      // Preserve the semantic contract instead of surfacing a generic write failure.
      if(String((sessionError as any)?.code??'')==='23505'||String(sessionError.message??'').includes('legal_age_assurance_one_pending_per_user_idx')){
        const {data:concurrent,error:concurrentError}=await admin.from('legal_age_assurance_sessions').select('id').eq('user_id',user.id).eq('status','pending').maybeSingle();
        if(!concurrentError&&concurrent?.id)return json({error:'age_assurance_already_in_progress',requestId:concurrent.id},409);
        return json({error:'age_assurance_already_in_progress'},409);
      }
      throw new Error('age_assurance_state_write_failed');
    }
    let response:Response;
    try{response=await fetchWithTimeout(parsedProvider.toString(),{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${providerSecret}`},body:JSON.stringify({requestId:session.id,purpose:'age_assurance',minimumAge:Number(policy.minimum_user_age),countryCode:runtime.legal_country_code,subnationalCode:runtime.legal_subnational_code??undefined,returnUrl})},PROVIDER_TIMEOUT_MS)}catch{await markAgeAssuranceFailed(admin,session.id);throw new Error('age_assurance_provider_unreachable')}
    if(!response.ok){await markAgeAssuranceFailed(admin,session.id);throw new Error('age_assurance_provider_error')}
    const payload=await readResponseJsonBounded<any>(response,64_000).catch(()=>null);
    if(!payload?.url||String(payload.url).length>2048){await markAgeAssuranceFailed(admin,session.id);throw new Error('age_assurance_provider_invalid_response')}
    let verificationUrl:URL;
    try{verificationUrl=requireAllowlistedHttpsUrl(String(payload.url),allowedHosts,{allowQuery:true,errorCode:'age_assurance_provider_invalid_response'})}
    catch{await markAgeAssuranceFailed(admin,session.id);throw new Error('age_assurance_provider_invalid_response')}
    const reference=payload.reference==null?'':String(payload.reference);
    if(reference.length>200){await markAgeAssuranceFailed(admin,session.id);throw new Error('age_assurance_provider_invalid_response')}
    if(reference){const {error:referenceUpdateError}=await admin.from('legal_age_assurance_sessions').update({provider_reference_sha256:await sha256Hex(reference),updated_at:new Date().toISOString()}).eq('id',session.id);if(referenceUpdateError){await markAgeAssuranceFailed(admin,session.id);throw new Error('age_assurance_state_write_failed')}}
    return json({url:verificationUrl.toString(),requestId:session.id,minimumAge:Number(policy.minimum_user_age)});
  }catch(e){
    const code=e instanceof Error?e.message:'age_assurance_error';
    const safe=['Unauthorized','age_assurance_context_unavailable','age_assurance_policy_unavailable','verified_external_age_assurance_not_required','age_assurance_state_unavailable','age_assurance_provider_not_configured','age_assurance_provider_invalid_url','age_assurance_return_url_invalid','age_assurance_rate_limit_failed','age_assurance_state_write_failed','age_assurance_provider_unreachable','age_assurance_provider_error','age_assurance_provider_invalid_response','device_integrity_required','device_integrity_state_unavailable'].includes(code)?code:'age_assurance_error';
    return json({error:safe},safe==='Unauthorized'?401:safe==='device_integrity_required'?403:['age_assurance_provider_not_configured','age_assurance_return_url_invalid','device_integrity_state_unavailable'].includes(safe)?503:400);
  }
});
