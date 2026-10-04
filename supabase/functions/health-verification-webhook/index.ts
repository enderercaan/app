import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/client.ts';
import { readRequestTextBounded } from '../_shared/http.ts';

const MAX_WEBHOOK_BYTES=64_000;
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_RE=/^[0-9a-f]{64}$/i;
const SIGNALS=new Set(['veterinarian_verified','microchip_verified','genetic_screening_available','pedigree_available','vaccination_complete','neutered']);
async function hmacHex(secret:string,message:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(message));return [...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,'0')).join('')}
async function sha256Hex(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('')}
function safeEqual(a:string,b:string){if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0}
function isoOrNull(value:unknown){if(value==null||value==='')return null;const d=new Date(String(value));return Number.isFinite(d.getTime())?d.toISOString():null}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json({error:'method_not_allowed'},405);
  const secret=Deno.env.get('HEALTH_VERIFICATION_WEBHOOK_SECRET');if(!secret||secret.length<32)return json({error:'not_configured'},503);
  let raw:string;try{raw=await readRequestTextBounded(req,MAX_WEBHOOK_BYTES)}catch(error){return json({error:error instanceof Error&&error.message==='body_too_large'?'payload_too_large':'invalid_payload'},error instanceof Error&&error.message==='body_too_large'?413:400)}
  const timestamp=req.headers.get('X-Tailmance-Timestamp')??'';const supplied=req.headers.get('X-Tailmance-Signature')??'';
  if(!/^\d{10}$/.test(timestamp)||!HASH_RE.test(supplied))return json({error:'invalid_signature'},401);
  const signedAt=Number(timestamp);if(!Number.isFinite(signedAt)||Math.abs(Date.now()/1000-signedAt)>300)return json({error:'stale_signature'},401);
  const expected=await hmacHex(secret,`${timestamp}.${raw}`);if(!safeEqual(supplied.toLowerCase(),expected.toLowerCase()))return json({error:'invalid_signature'},401);
  let event:any;try{event=JSON.parse(raw)}catch{return json({error:'invalid_json'},400)}
  const documentId=String(event?.healthDocumentId??'');const signal=String(event?.signal??'');const clinicPublicId=String(event?.clinicPublicId??'').trim();const providerCode=String(event?.providerCode??'').trim();const providerReference=String(event?.providerReference??'').trim();const integrityStatus=String(event?.integrityStatus??'');
  if(!UUID_RE.test(documentId)||!SIGNALS.has(signal)||clinicPublicId.length<2||clinicPublicId.length>80||!/^[A-Za-z0-9._-]{2,80}$/.test(providerCode)||!providerReference||providerReference.length>240||!['valid','invalid'].includes(integrityStatus))return json({error:'invalid_event'},400);
  const verifiedAt=isoOrNull(event?.verifiedAt)??new Date().toISOString();const expiresAt=isoOrNull(event?.expiresAt);const verifiedAtMs=new Date(verifiedAt).getTime();const expiresAtMs=expiresAt?new Date(expiresAt).getTime():null;if(event?.verifiedAt!=null&&!isoOrNull(event.verifiedAt)||verifiedAtMs>Date.now()+5*60*1000||event?.expiresAt!=null&&!expiresAt||(expiresAtMs!=null&&expiresAtMs<=verifiedAtMs))return json({error:'invalid_event'},400);
  try{
    const supabase=adminClient();const referenceHash=await sha256Hex(providerReference);
    const {data,error}=await supabase.rpc('service_apply_health_verification_attestation',{p_health_document_id:documentId,p_signal:signal,p_method:'provider_ocr_signature',p_clinic_public_id:clinicPublicId,p_provider_code:providerCode,p_provider_reference_sha256:referenceHash,p_integrity_status:integrityStatus,p_verified_at:verifiedAt,p_expires_at:expiresAt});
    if(error){const message=String(error.message??'');if(message.includes('health_document_not_found'))return json({error:'health_document_not_found'},404);throw new Error('health_attestation_write_failed')}
    return json(data??{ok:true});
  }catch{return json({error:'webhook_processing_failed'},500)}
});
