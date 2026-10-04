import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/client.ts';
import { readRequestTextBounded } from '../_shared/http.ts';

const MAX_WEBHOOK_BYTES=128_000;
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function hmacHex(secret:string,message:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(message));return [...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,'0')).join('')}
async function sha256Hex(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('')}
function safeEqual(a:string,b:string){if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0}
async function evidenceReferenceHashes(value:unknown){if(!Array.isArray(value)||value.length>10)return null;const out:string[]=[];for(const item of value){if(typeof item!=='string')return null;const v=item.trim();if(!v||v.length>200)return null;out.push(`sha256:${await sha256Hex(v)}`)}return [...new Set(out)]}
function isoOrNull(value:unknown){if(value==null||value==='')return null;const date=new Date(String(value));return Number.isFinite(date.getTime())?date.toISOString():null}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json({error:'method_not_allowed'},405);
  const secret=Deno.env.get('IDENTITY_WEBHOOK_SECRET');if(!secret||secret.length<32)return json({error:'not_configured'},503);
  let raw:string;try{raw=await readRequestTextBounded(req,MAX_WEBHOOK_BYTES)}catch(error){return json({error:error instanceof Error&&error.message==='body_too_large'?'payload_too_large':'invalid_payload'},error instanceof Error&&error.message==='body_too_large'?413:400)}
  const timestamp=req.headers.get('X-Tailmance-Timestamp')??'';const supplied=req.headers.get('X-Tailmance-Signature')??'';
  if(!/^\d{10}$/.test(timestamp)||!/^[0-9a-f]{64}$/i.test(supplied))return json({error:'invalid_signature'},401);
  const signedAt=Number(timestamp);if(!Number.isFinite(signedAt)||Math.abs(Date.now()/1000-signedAt)>300)return json({error:'stale_signature'},401);
  const expected=await hmacHex(secret,`${timestamp}.${raw}`);if(!safeEqual(supplied.toLowerCase(),expected.toLowerCase()))return json({error:'invalid_signature'},401);
  let event:any;try{event=JSON.parse(raw)}catch{return json({error:'invalid_json'},400)}
  const requestId=String(event?.requestId??'');if(!UUID_RE.test(requestId))return json({error:'invalid_event'},400);
  try{
    const supabase=adminClient();
    if(String(event?.type??'owner_identity')==='age_assurance'){
      const status=String(event?.status??'');if(!['passed','failed','expired','cancelled','revoked'].includes(status))return json({error:'invalid_event'},400);
      const reference=event?.reference==null?'':String(event.reference);if(reference.length>200)return json({error:'invalid_event'},400);
      const evidence=await evidenceReferenceHashes(event?.evidenceReference);if(status==='passed'&&(!evidence||evidence.length===0))return json({error:'invalid_event'},400);
      if(status!=='passed'&&event?.evidenceReference!=null&&!evidence)return json({error:'invalid_event'},400);
      const verifiedAt=isoOrNull(event?.verifiedAt)??(status==='passed'||status==='revoked'?new Date().toISOString():null);
      const expiresAt=isoOrNull(event?.expiresAt);if(event?.expiresAt!=null&&!expiresAt)return json({error:'invalid_event'},400);
      const providerHash=reference?await sha256Hex(reference):null;
      const {data,error}=await supabase.rpc('service_apply_legal_age_assurance_result',{p_session_id:requestId,p_status:status,p_provider_reference_sha256:providerHash,p_evidence_reference:evidence??[],p_verified_at:verifiedAt,p_result_expires_at:expiresAt});
      if(error){const message=String(error.message??'');if(message.includes('age_assurance_session_not_found'))return json({error:'age_assurance_session_not_found'},404);throw new Error('age_assurance_result_write_failed')}
      return json(data??{ok:true});
    }
    const status=String(event?.status??'');if(!['verified','failed','expired','cancelled','revoked'].includes(status))return json({error:'invalid_event'},400);
    const {data,error}=await supabase.rpc('apply_owner_verification_result',{p_request_id:requestId,p_status:status});
    if(error){const message=String(error.message??'');if(message.includes('verification_session_not_found'))return json({error:'verification_session_not_found'},404);throw new Error('verification_result_write_failed')}
    return json(data??{ok:true});
  }catch{return json({error:'webhook_processing_failed'},500)}
});
