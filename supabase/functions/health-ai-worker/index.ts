import { json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/client.ts';
import { fetchWithTimeout, readResponseJsonBounded } from '../_shared/http.ts';
import { verifyBearerSecret } from '../_shared/secretAuth.ts';
import { requireAllowlistedHttpsUrl } from '../_shared/outboundUrl.ts';
import { markWorkerHeartbeat } from '../_shared/workerHeartbeat.ts';

const PROVIDER_TIMEOUT_MS=15_000;
const MAX_RESPONSE_BYTES=192_000;
const MAX_BOOKLET_PAGES=12;
const ALLOWED_SIGNALS=new Set(['veterinarian_verified','microchip_verified','genetic_screening_available','pedigree_available','vaccination_complete','neutered']);

type Signal={signal:string;confidence:number;verifiedAt?:string|null;expiresAt?:string|null};
type ProviderResult={
  schema_version:1;
  provider_code:string;
  provider_reference:string;
  model_version:string;
  document_confidence:number;
  credential_integrity:'valid'|'invalid'|'unverified';
  clinic_public_id:string;
  signals:Signal[];
};

function finiteConfidence(value:unknown){return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1?value:null}
function isoOrNull(value:unknown){if(value==null)return null;if(typeof value!=='string'||!value.trim()||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value.trim()))return null;const d=new Date(value.trim());return Number.isFinite(d.getTime())?d.toISOString():null}
function parseProviderResult(raw:unknown,expectedProviderCode:string):ProviderResult|null{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const x=raw as Record<string,unknown>;
  const topKeys=new Set(['schema_version','provider_code','provider_reference','model_version','document_confidence','credential_integrity','clinic_public_id','signals']);
  if(Object.keys(x).some(key=>!topKeys.has(key))||Object.keys(x).length!==topKeys.size)return null;
  if(x.schema_version!==1||typeof x.provider_code!=='string'||x.provider_code!==expectedProviderCode)return null;
  if(typeof x.provider_reference!=='string'||typeof x.model_version!=='string'||typeof x.credential_integrity!=='string'||typeof x.clinic_public_id!=='string')return null;
  const providerReference=x.provider_reference.trim();
  const modelVersion=x.model_version.trim();
  const confidence=finiteConfidence(x.document_confidence);
  const integrity=String(x.credential_integrity??'') as ProviderResult['credential_integrity'];
  const clinicPublicId=String(x.clinic_public_id??'').trim();
  if(!providerReference||providerReference.length>240||!modelVersion||modelVersion.length>120||confidence==null||!['valid','invalid','unverified'].includes(integrity)||clinicPublicId.length<2||clinicPublicId.length>80)return null;
  if(!Array.isArray(x.signals)||x.signals.length<1||x.signals.length>16)return null;
  const signals:Signal[]=[];
  const seen=new Set<string>();
  for(const rawSignal of x.signals){
    if(!rawSignal||typeof rawSignal!=='object'||Array.isArray(rawSignal))return null;
    const s=rawSignal as Record<string,unknown>;
    const signalKeys=new Set(['signal','confidence','verified_at','expires_at']);
    if(Object.keys(s).some(key=>!signalKeys.has(key))||!Object.prototype.hasOwnProperty.call(s,'signal')||!Object.prototype.hasOwnProperty.call(s,'confidence'))return null;
    if(typeof s.signal!=='string')return null;
    const signal=s.signal.trim();const c=finiteConfidence(s.confidence);
    if(!ALLOWED_SIGNALS.has(signal)||seen.has(signal)||c==null)return null;
    seen.add(signal);
    const verifiedAt=isoOrNull(s.verified_at);const expiresAt=isoOrNull(s.expires_at);
    if(s.verified_at!=null&&!verifiedAt||s.expires_at!=null&&!expiresAt)return null;
    if(verifiedAt&&Date.parse(verifiedAt)>Date.now()+5*60_000)return null;
    if(expiresAt&&Date.parse(expiresAt)<=Date.parse(verifiedAt??new Date().toISOString()))return null;
    signals.push({signal,confidence:c,verifiedAt,expiresAt});
  }
  return{schema_version:1,provider_code:expectedProviderCode,provider_reference:providerReference,model_version:modelVersion,document_confidence:confidence,credential_integrity:integrity,clinic_public_id:clinicPublicId,signals};
}
async function sha256Hex(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('')}

Deno.serve(async req=>{
  if(req.method!=='POST')return json({error:'method_not_allowed'},405);
  const workerSecret=Deno.env.get('HEALTH_AI_WORKER_SECRET')??'';
  if(!verifyBearerSecret(req.headers.get('Authorization'),workerSecret,32))return json({error:'unauthorized'},401);
  const rawEndpoint=Deno.env.get('HEALTH_AI_API_URL')??'';
  const providerKey=Deno.env.get('HEALTH_AI_API_KEY')??'';
  const providerCode=(Deno.env.get('HEALTH_AI_PROVIDER_CODE')??'').trim();
  if(providerKey.length<20||!/^[A-Za-z0-9._-]{2,80}$/.test(providerCode))return json({error:'health_ai_not_configured'},503);
  let endpoint:URL;try{endpoint=requireAllowlistedHttpsUrl(rawEndpoint,Deno.env.get('HEALTH_AI_ALLOWED_HOSTS_JSON'),{errorCode:'health_ai_provider_invalid'})}catch{return json({error:'health_ai_provider_invalid'},503)}

  const supabase=adminClient();
  await markWorkerHeartbeat(supabase,'health-ai-worker','started');
  const {data:jobs,error:claimError}=await supabase.rpc('claim_health_ai_jobs',{p_limit:10});
  if(claimError)return json({error:'health_ai_claim_failed'},503)
  let processed=0,manual=0,rejected=0,deferred=0;
  for(const job of jobs??[]){
    const documentId=String(job.health_document_id??'');
    try{
      const {data:doc,error:docError}=await supabase.from('health_documents').select('id,pet_id,document_type,storage_path').eq('id',documentId).maybeSingle();
      if(docError||!doc)throw new Error('health_document_read_failed');
      if(doc.document_type!=='health_record'){
        const {error:manualError}=await supabase.rpc('service_route_health_ai_manual_review',{p_health_document_id:documentId,p_error_code:'health_ai_unsupported_document_type'});
        if(manualError)throw new Error('health_ai_manual_review_route_failed');
        manual++;
        continue;
      }
      const {data:signed,error:signedError}=await supabase.storage.from('health-documents').createSignedUrl(doc.storage_path,60);
      if(signedError||!signed?.signedUrl)throw new Error('health_document_signed_url_failed');
      // The whole booklet is evaluated together: every uploaded health-record page of this pet is passed to the provider,
      // together with the pet facts the owner entered (species, birth date, owner-entered breed, sex). Breed is never inferred from images.
      const {data:pet}=await supabase.from('pets').select('species,breed,sex,birth_date').eq('id',doc.pet_id).maybeSingle();
      const {data:pages}=await supabase.from('health_documents').select('id,storage_path').eq('pet_id',doc.pet_id).eq('document_type','health_record').order('created_at',{ascending:true}).limit(MAX_BOOKLET_PAGES);
      const pageUrls:{page_index:number;signed_url:string}[]=[];
      for(const [index,page] of (pages??[]).entries()){
        const {data:pageSigned}=await supabase.storage.from('health-documents').createSignedUrl(page.storage_path,60);
        if(pageSigned?.signedUrl)pageUrls.push({page_index:index+1,signed_url:pageSigned.signedUrl});
      }
      if(!pageUrls.some(p=>p.signed_url===signed.signedUrl)&&pageUrls.length<MAX_BOOKLET_PAGES)pageUrls.push({page_index:pageUrls.length+1,signed_url:signed.signedUrl});
      const birthMs=pet?.birth_date?Date.parse(String(pet.birth_date)):NaN;
      const ageMonths=Number.isFinite(birthMs)?Math.max(0,Math.floor((Date.now()-birthMs)/(30.4375*86_400_000))):null;
      const {error:budgetError}=await supabase.rpc('service_consume_ai_provider_budget',{p_provider_key:'health_ai'});
      if(budgetError)throw new Error('health_ai_provider_cost_budget_exhausted');
      const started=Date.now();
      let response:Response;
      try{
        response=await fetchWithTimeout(endpoint.toString(),{
          method:'POST',redirect:'error',headers:{Authorization:`Bearer ${providerKey}`,'Content-Type':'application/json'},
          body:JSON.stringify({
            schema_version:1,
            document:{signed_url:signed.signedUrl,declared_document_type:doc.document_type},
            documents:pageUrls,
            pet_context:{species:pet?.species??null,age_months:ageMonths,breed_owner_entered:pet?.breed??null,sex:pet?.sex??null},
            evaluation_date:new Date().toISOString().slice(0,10),
            policy:{
              pet_health_only:true,
              require_registry_or_credential_verification:true,
              auto_verify_confidence_gt:0.85,
              manual_review_confidence_min:0.65,
              reject_confidence_lt:0.65,
              iso_microchip_standards:['ISO 11784','ISO 11785'],
              never_infer_missing_fields:true,
              auto_verify_only_when_complete:['microchip','vaccinations','internal_parasite_treatment','external_parasite_treatment'],
              incomplete_or_inconsistent_to_manual_review:true,
              breed_inference:false,
              require_all_filled_pages:true,
              evaluate_against_current_schedule:true,
              schedule_basis:['species','age_months','breed_owner_entered','evaluation_date'],
              result_scope:'document_check_only_not_a_health_assessment'
            }
          })
        },PROVIDER_TIMEOUT_MS);
      }catch(error:any){throw new Error(error?.name==='AbortError'?'health_ai_timeout':'health_ai_network_error')}
      if(!response.ok)throw new Error(`health_ai_http_${response.status}`);
      const raw=await readResponseJsonBounded<unknown>(response,MAX_RESPONSE_BYTES);
      const parsed=parseProviderResult(raw,providerCode);
      if(!parsed)throw new Error('health_ai_schema_invalid');
      const referenceHash=await sha256Hex(parsed.provider_reference);
      const latencyMs=Math.min(Date.now()-started,120000);
      const {data:result,error:applyError}=await supabase.rpc('service_apply_health_ai_result',{
        p_health_document_id:documentId,
        p_provider_code:providerCode,
        p_provider_reference_sha256:referenceHash,
        p_clinic_public_id:parsed.clinic_public_id,
        p_model_version:parsed.model_version,
        p_document_confidence:parsed.document_confidence,
        p_credential_integrity:parsed.credential_integrity,
        p_signals:parsed.signals,
        p_latency_ms:latencyMs
      });
      if(applyError)throw new Error('health_ai_result_apply_failed');
      const decision=String(result?.decision??'');
      if(decision==='manual_review')manual++;else if(decision==='rejected')rejected++;else processed++;
    }catch(error:any){
      deferred++;
      await supabase.rpc('service_defer_health_ai_job',{p_health_document_id:documentId,p_error_code:String(error?.message??'health_ai_provider_error').slice(0,120)}).catch(()=>undefined);
    }
  }
  await markWorkerHeartbeat(supabase,'health-ai-worker','completed');
  return json({ok:true,claimed:(jobs??[]).length,processed,manual,rejected,deferred});
});
