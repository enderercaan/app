import { json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/client.ts';
import { markWorkerHeartbeat } from '../_shared/workerHeartbeat.ts';
import { fetchWithTimeout, readResponseBytesBounded, readResponseJsonBounded } from '../_shared/http.ts';
import { verifyBearerSecret } from '../_shared/secretAuth.ts';
import { requireAllowlistedHttpsUrl } from '../_shared/outboundUrl.ts';

// Provider-neutral moderation worker.
// Configure MODERATION_API_URL + MODERATION_API_KEY. Provider accepts either:
// {signed_url,target_type,target_id} or {text,target_type,target_id}
// and must return the Tailmance policy contract:
// {approved:boolean,policy_version:string,categories:Record<string,boolean>,ocr_text:string,audio_transcript:string,pet_first_context:boolean,reason?:string,score?:object}.
// Media OCR may be empty when no text is visible. OCR + pet_first_context are mandatory for media targets, and video additionally requires an explicit audio_transcript (which may be empty when no speech is present).
// If no provider is configured, or the provider does not echo the complete policy contract, the queue remains pending for manual moderation.

const MAX_ATTEMPTS = 5;
const PROVIDER_TIMEOUT_MS = 10_000;
const SANITIZED_VIDEO_TIMEOUT_MS = 30_000;
const MAX_SANITIZED_VIDEO_BYTES = 40 * 1024 * 1024;
const VIDEO_DURATION_TOLERANCE_MS = 3_000;
const MODERATION_POLICY = Object.freeze({
  policy_version: 'tailmance-pet-first-v3',
  prohibited_categories: ['pet_sale','pet_rehoming_or_adoption','commercial_breeding_marketplace','human_dating_misuse'],
  require_pet_first_context: true,
  require_media_ocr_text: true,
  require_video_audio_transcript: true
});
const MEDIA_TARGETS=new Set(['pet_photo','post_media','story']);
type ProviderCategories=Record<(typeof MODERATION_POLICY.prohibited_categories)[number],boolean>;
type ProviderVerdict={approved:boolean;reason?:unknown;score?:unknown;policy_version?:unknown;categories?:unknown;ocr_text?:unknown;audio_transcript?:unknown;pet_first_context?:unknown;media_metadata?:unknown;sanitized_media_url?:unknown};

function parseProviderVerdict(input:unknown,targetType:string,mediaKind:'image'|'video'='image',declaredDurationMs?:number|null){
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  const verdict=input as ProviderVerdict;
  const allowedTopKeys=new Set(['approved','reason','score','policy_version','categories','ocr_text','audio_transcript','pet_first_context','media_metadata','sanitized_media_url']);
  if(Object.keys(verdict).some(key=>!allowedTopKeys.has(key)))return null;
  if(typeof verdict.approved!=='boolean'||verdict.policy_version!==MODERATION_POLICY.policy_version)return null;
  if(!verdict.categories||typeof verdict.categories!=='object'||Array.isArray(verdict.categories))return null;
  const raw=verdict.categories as Record<string,unknown>;
  if(Object.keys(raw).length!==MODERATION_POLICY.prohibited_categories.length||!MODERATION_POLICY.prohibited_categories.every(key=>typeof raw[key]==='boolean'))return null;
  const isMediaTarget=MEDIA_TARGETS.has(targetType);
  const ocrText=isMediaTarget
    ?(typeof verdict.ocr_text==='string'&&verdict.ocr_text.length<=20_000?verdict.ocr_text:null)
    :'';
  if(ocrText===null)return null;
  const audioTranscript=mediaKind==='video'
    ?(typeof verdict.audio_transcript==='string'&&verdict.audio_transcript.length<=20_000?verdict.audio_transcript:null)
    :'';
  if(audioTranscript===null)return null;
  const petFirstContext=isMediaTarget
    ?(typeof verdict.pet_first_context==='boolean'?verdict.pet_first_context:null)
    :true;
  if(petFirstContext===null)return null;
  let providerDurationMs:number|null=null;
  let sanitizedMediaUrl:string|null=null;
  if(mediaKind==='video'){
    const metadata=verdict.media_metadata;
    if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))return null;
    const metadataRecord=metadata as Record<string,unknown>;
    if(Object.keys(metadataRecord).length!==1||!Object.prototype.hasOwnProperty.call(metadataRecord,'duration_ms')||typeof metadataRecord.duration_ms!=='number')return null;
    const duration=metadataRecord.duration_ms;
    if(!Number.isFinite(duration)||duration<1000||duration>60000)return null;
    if(!Number.isFinite(Number(declaredDurationMs))||Math.abs(duration-Number(declaredDurationMs))>VIDEO_DURATION_TOLERANCE_MS)return null;
    providerDurationMs=Math.round(duration);
    if(verdict.approved){
      if(typeof verdict.sanitized_media_url!=='string'||!verdict.sanitized_media_url.trim())return null;
      sanitizedMediaUrl=verdict.sanitized_media_url.trim();
    }
  }
  return {verdict,categories:raw as ProviderCategories,ocrText,audioTranscript,petFirstContext,providerDurationMs,sanitizedMediaUrl};
}

async function deterministicOcrPolicy(supabase:any,text:string){
  const normalized=text.trim();
  if(!normalized)return null;
  const [commerce,rehoming,dating]=await Promise.all([
    supabase.rpc('contains_prohibited_pet_commerce_intent',{p_text:normalized}),
    supabase.rpc('contains_prohibited_pet_rehoming_intent',{p_text:normalized}),
    supabase.rpc('contains_prohibited_human_dating_intent',{p_text:normalized})
  ]);
  if(commerce.error||rehoming.error||dating.error)throw new Error('moderation_ocr_policy_unavailable');
  if(commerce.data===true)return 'pet_sale';
  if(rehoming.data===true)return 'pet_rehoming_or_adoption';
  if(dating.data===true)return 'human_dating_misuse';
  return null;
}


async function stageSanitizedVideo(supabase:any,storagePath:string,sanitizedUrl:string,providerDurationMs:number){
  const allowedHosts=Deno.env.get('MODERATION_ALLOWED_HOSTS_JSON');
  const url=requireAllowlistedHttpsUrl(sanitizedUrl,allowedHosts,{errorCode:'sanitized_media_url_invalid'});
  let response:Response;
  try{response=await fetchWithTimeout(url.toString(),{method:'GET',headers:{'Accept':'video/mp4'},redirect:'error'},SANITIZED_VIDEO_TIMEOUT_MS)}
  catch(error:any){throw new Error(error?.name==='AbortError'?'sanitized_media_timeout':'sanitized_media_network_error')}
  if(!response.ok)throw new Error(`sanitized_media_http_${response.status}`);
  const contentType=String(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
  if(contentType!=='video/mp4')throw new Error('sanitized_media_mime_invalid');
  let bytes:Uint8Array;
  try{bytes=await readResponseBytesBounded(response,MAX_SANITIZED_VIDEO_BYTES)}
  catch{throw new Error('sanitized_media_size_invalid')}
  if(bytes.byteLength<12)throw new Error('sanitized_media_container_invalid');
  const boxType=String.fromCharCode(bytes[4]??0,bytes[5]??0,bytes[6]??0,bytes[7]??0);
  if(boxType!=='ftyp')throw new Error('sanitized_media_container_invalid');
  const blob=new Blob([new Uint8Array(bytes)],{type:'video/mp4'});
  const dot=storagePath.lastIndexOf('.');
  const rawBase=dot>storagePath.lastIndexOf('/')?storagePath.slice(0,dot):storagePath;
  const base=rawBase.replace(/(?:\.sanitized)+$/i,'');
  const sanitizedPath=`${base}.sanitized.mp4`;
  const {error:uploadError}=await supabase.storage.from('social-media').upload(sanitizedPath,blob,{contentType:'video/mp4',upsert:true,cacheControl:'3600'});
  if(uploadError)throw new Error('sanitized_media_storage_replace_failed');
  return {durationMs:providerDurationMs,path:sanitizedPath};
}


function providerEndpoint(raw: string) {
  return requireAllowlistedHttpsUrl(raw,Deno.env.get('MODERATION_ALLOWED_HOSTS_JSON'),{errorCode:'moderation_provider_invalid'});
}


async function sha256Hex(blob:Blob){
  const digest=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
}

async function registerPetPhotoFingerprint(supabase:any,photoId:string,petId:string,storagePath:string){
  const {data:blob,error:downloadError}=await supabase.storage.from('pet-photos').download(storagePath);
  if(downloadError||!blob)throw new Error('photo_fingerprint_download_failed');
  const sha256=await sha256Hex(blob);
  const {data:duplicate,error:duplicateError}=await supabase.from('pet_photo_fingerprints').select('photo_id,pet_id').eq('sha256',sha256).neq('photo_id',photoId).limit(1).maybeSingle();
  if(duplicateError)throw duplicateError;
  const {error:writeError}=await supabase.from('pet_photo_fingerprints').upsert({photo_id:photoId,pet_id:petId,sha256},{onConflict:'photo_id'});
  if(writeError)throw writeError;
  return Boolean(duplicate);
}

async function refreshPet(supabase: any, petId: string) {
  const [photosResult, textReviewResult] = await Promise.all([
    supabase.from('pet_photos').select('moderation_status').eq('pet_id', petId),
    supabase.from('moderation_items').select('status').eq('target_type', 'pet_text').eq('target_id', petId).maybeSingle()
  ]);
  if (photosResult.error) throw photosResult.error;
  if (textReviewResult.error) throw textReviewResult.error;
  const photos = photosResult.data ?? [];
  const textReview = textReviewResult.data;
  const threeApproved = photos.length === 3 && photos.every((x: any) => x.moderation_status === 'approved');
  const rejected = photos.some((x: any) => x.moderation_status === 'rejected') || textReview?.status === 'rejected';
  const status = rejected ? 'rejected' : threeApproved && textReview?.status === 'approved' ? 'approved' : 'pending';
  const { error } = await supabase.from('pets').update({ moderation_status: status }).eq('id', petId);
  if (error) throw error;
}

async function refreshPost(supabase: any, postId: string) {
  const [mediaResult, textReviewResult] = await Promise.all([
    supabase.from('post_media').select('moderation_status').eq('post_id', postId),
    supabase.from('moderation_items').select('status').eq('target_type', 'post_text').eq('target_id', postId).maybeSingle()
  ]);
  if (mediaResult.error) throw mediaResult.error;
  if (textReviewResult.error) throw textReviewResult.error;
  const media = mediaResult.data ?? [];
  const textReview = textReviewResult.data;
  const mediaOk = !media.some((x: any) => x.moderation_status !== 'approved');
  const rejected = media.some((x: any) => x.moderation_status === 'rejected') || textReview?.status === 'rejected';
  const status = rejected ? 'rejected' : mediaOk && textReview?.status === 'approved' ? 'approved' : 'pending';
  const { error } = await supabase.from('posts').update({ moderation_status: status }).eq('id', postId);
  if (error) throw error;
}

async function claimPendingItems(supabase: any) {
  const { data, error } = await supabase.rpc('claim_moderation_items', { p_limit: 25 });
  if (error) throw new Error('moderation_claim_unavailable');
  return data ?? [];
}

async function deferItem(supabase: any, item: any, code: string) {
  const attempts = Number(item.attempts ?? 0) + 1;
  const manualReviewRequired = attempts >= MAX_ATTEMPTS;
  const delaySeconds = Math.min(3600, 60 * 2 ** Math.max(0, attempts - 1));
  const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
  const retryState = {
    status: 'pending',
    attempts,
    last_attempt_at: new Date().toISOString(),
    next_attempt_at: manualReviewRequired ? null : nextAttemptAt,
    last_error_code: code.slice(0, 120),
    manual_review_required: manualReviewRequired
  };
  const { error } = await supabase.from('moderation_items').update(retryState).eq('id', item.id);
  if (error) throw new Error('moderation_retry_state_write_failed');
}

async function discardMissingTarget(supabase: any, itemId: string) {
  const { error } = await supabase.from('moderation_items').delete().eq('id', itemId);
  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const secret = Deno.env.get('MODERATION_WORKER_SECRET');
  if (!verifyBearerSecret(req.headers.get('Authorization'),secret)) return json({ error: 'Unauthorized' }, 401);

  const supabase = adminClient();
  await markWorkerHeartbeat(supabase,'moderate-media','started');
  const providerUrl = Deno.env.get('MODERATION_API_URL');
  const providerKey = Deno.env.get('MODERATION_API_KEY');
  if (!providerUrl || !providerKey) return json({ error: 'moderation_provider_not_configured' }, 503);

  let endpoint: URL;
  try {
    endpoint = providerEndpoint(providerUrl);
  } catch {
    return json({ error: 'invalid_moderation_provider' }, 500);
  }

  let items: any[];
  try {
    items = await claimPendingItems(supabase);
  } catch {
    return json({ error: 'moderation_queue_unavailable' }, 500);
  }
  let processed = 0;
  let deferred = 0;

  for (const item of items) {
    try {
      let requestBody: Record<string, unknown> | null = null;
      let parentId: string | null = null;
      let updateTable: string | null = null;
      let mediaKind:'image'|'video'='image';
      let mediaStoragePath:string|null=null;
      let declaredDurationMs:number|null=null;

      if (item.target_type === 'pet_photo') {
        const { data, error } = await supabase.from('pet_photos').select('storage_path,pet_id').eq('id', item.target_id).maybeSingle();
        if (error) throw error;
        if (!data) { await discardMissingTarget(supabase, item.id); continue; }
        const { data: signed, error: signedError } = await supabase.storage.from('pet-photos').createSignedUrl(data.storage_path, 60);
        if (signedError || !signed?.signedUrl) { await deferItem(supabase, item, 'signed_url_unavailable'); deferred++; continue; }
        const duplicatePhoto=await registerPetPhotoFingerprint(supabase,item.target_id,data.pet_id,data.storage_path);
        if(duplicatePhoto){
          const {error:duplicateStateError}=await supabase.from('moderation_items').update({manual_review_required:true,next_attempt_at:null,last_error_code:'duplicate_photo_hash'}).eq('id',item.id);
          if(duplicateStateError)throw duplicateStateError;
          deferred++;
          continue;
        }
        requestBody = { signed_url: signed.signedUrl, target_type: item.target_type, target_id: item.target_id };
        parentId = data.pet_id; updateTable = 'pet_photos';
      } else if (item.target_type === 'post_media') {
        const { data, error } = await supabase.from('post_media').select('storage_path,post_id,media_kind,duration_ms,mime_type').eq('id', item.target_id).maybeSingle();
        if (error) throw error;
        if (!data) { await discardMissingTarget(supabase, item.id); continue; }
        mediaKind=data.media_kind==='video'?'video':'image';
        mediaStoragePath=data.storage_path;
        declaredDurationMs=mediaKind==='video'?Number(data.duration_ms):null;
        if(mediaKind==='video'&&(!Number.isFinite(declaredDurationMs)||Number(declaredDurationMs)<1000||Number(declaredDurationMs)>60000)){await deferItem(supabase,item,'declared_video_duration_invalid');deferred++;continue;}
        const { data: signed, error: signedError } = await supabase.storage.from('social-media').createSignedUrl(data.storage_path, 60);
        if (signedError || !signed?.signedUrl) { await deferItem(supabase, item, 'signed_url_unavailable'); deferred++; continue; }
        requestBody = { signed_url: signed.signedUrl, target_type: item.target_type, target_id: item.target_id, media_kind:mediaKind, declared_duration_ms:declaredDurationMs, require_sanitized_derivative:mediaKind==='video', require_audio_transcript:mediaKind==='video' };
        parentId = data.post_id; updateTable = 'post_media';
      } else if (item.target_type === 'story') {
        const { data, error } = await supabase.from('stories').select('storage_path').eq('id', item.target_id).maybeSingle();
        if (error) throw error;
        if (!data) { await discardMissingTarget(supabase, item.id); continue; }
        const { data: signed, error: signedError } = await supabase.storage.from('social-media').createSignedUrl(data.storage_path, 60);
        if (signedError || !signed?.signedUrl) { await deferItem(supabase, item, 'signed_url_unavailable'); deferred++; continue; }
        requestBody = { signed_url: signed.signedUrl, target_type: item.target_type, target_id: item.target_id };
        updateTable = 'stories';
      } else if (item.target_type === 'pet_text') {
        const [petResult, promptsResult] = await Promise.all([
          supabase.from('pets').select('name,breed,bio,city,district,neighborhood,temperament_tags').eq('id', item.target_id).maybeSingle(),
          supabase.from('pet_prompts').select('prompt_key,answer').eq('pet_id', item.target_id).order('sort_order', { ascending: true })
        ]);
        if (petResult.error) throw petResult.error;
        if (promptsResult.error) throw promptsResult.error;
        if (!petResult.data) { await discardMissingTarget(supabase, item.id); continue; }
        const p = petResult.data;
        const promptText = (promptsResult.data ?? []).map((x: any) => `${x.prompt_key}: ${x.answer}`).join('\n');
        const tags = Array.isArray(p.temperament_tags) ? p.temperament_tags.join(', ') : '';
        requestBody = {
          text: [p.name, p.breed, p.bio, p.city, p.district, p.neighborhood, tags, promptText].filter(Boolean).join('\n'),
          target_type: item.target_type,
          target_id: item.target_id
        };
        parentId = item.target_id;
      } else if (item.target_type === 'post_text') {
        const { data, error } = await supabase.from('posts').select('caption').eq('id', item.target_id).maybeSingle();
        if (error) throw error;
        if (!data) { await discardMissingTarget(supabase, item.id); continue; }
        requestBody = { text: data.caption, target_type: item.target_type, target_id: item.target_id }; parentId = item.target_id;
      } else if (item.target_type === 'comment_text') {
        const { data, error } = await supabase.from('comments').select('body').eq('id', item.target_id).maybeSingle();
        if (error) throw error;
        if (!data) { await discardMissingTarget(supabase, item.id); continue; }
        requestBody = { text: data.body, target_type: item.target_type, target_id: item.target_id }; updateTable = 'comments';
      } else if (item.target_type === 'message_text') {
        const { data, error } = await supabase.from('messages').select('body').eq('id', item.target_id).maybeSingle();
        if (error) throw error;
        if (!data) { await discardMissingTarget(supabase, item.id); continue; }
        requestBody = { text: data.body, target_type: item.target_type, target_id: item.target_id };
      } else if (item.target_type === 'event_text') {
        const { data, error } = await supabase.from('pet_events').select('title,description,city,district,neighborhood').eq('id', item.target_id).maybeSingle();
        if (error) throw error;
        if (!data) { await discardMissingTarget(supabase, item.id); continue; }
        requestBody = {
          text: [data.title, data.description, data.city, data.district, data.neighborhood].filter(Boolean).join('\n'),
          target_type: item.target_type,
          target_id: item.target_id
        };
        updateTable = 'pet_events';
      } else if (item.target_type === 'meetup_text') {
        const { data, error } = await supabase.from('meetup_requests').select('public_place_label,note').eq('id', item.target_id).maybeSingle();
        if (error) throw error;
        if (!data) { await discardMissingTarget(supabase, item.id); continue; }
        requestBody = {
          text: [data.public_place_label, data.note].filter(Boolean).join('\n'),
          target_type: item.target_type,
          target_id: item.target_id
        };
        updateTable = 'meetup_requests';
      } else {
        await deferItem(supabase, item, 'unsupported_target_type'); deferred++;
        continue;
      }

      requestBody = {...requestBody, moderation_policy: MODERATION_POLICY};

      const {error:budgetError}=await supabase.rpc('service_consume_ai_provider_budget',{p_provider_key:'content_moderation'});
      if(budgetError){await deferItem(supabase,item,'provider_cost_budget_exhausted');deferred++;continue;}

      let response: Response;
      try {
        response = await fetchWithTimeout(endpoint.toString(), {
          method: 'POST',
          redirect: 'error',
          headers: { 'Authorization': `Bearer ${providerKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        }, PROVIDER_TIMEOUT_MS);
      } catch (error: any) {
        await deferItem(supabase, item, error?.name === 'AbortError' ? 'provider_timeout' : 'provider_network_error');
        deferred++;
        continue;
      }
      if (!response.ok) { await deferItem(supabase, item, `provider_http_${response.status}`); deferred++; continue; }

      let verdictRaw: unknown;
      try {
        verdictRaw = await readResponseJsonBounded<unknown>(response, 128_000);
      } catch {
        await deferItem(supabase, item, 'provider_invalid_json'); deferred++;
        continue;
      }
      const parsedVerdict=parseProviderVerdict(verdictRaw,item.target_type,mediaKind,declaredDurationMs);
      if(!parsedVerdict){
        await deferItem(supabase,item,'provider_policy_contract_missing');deferred++;
        continue;
      }
      const {verdict,categories,ocrText,audioTranscript,petFirstContext,providerDurationMs,sanitizedMediaUrl}=parsedVerdict;
      const providerBlockedCategory=MODERATION_POLICY.prohibited_categories.find(key=>categories[key]===true)??null;
      const deterministicOcrBlockedCategory=await deterministicOcrPolicy(supabase,ocrText);
      const deterministicAudioBlockedCategory=mediaKind==='video'?await deterministicOcrPolicy(supabase,audioTranscript):null;
      const blockedCategory=deterministicOcrBlockedCategory??deterministicAudioBlockedCategory??providerBlockedCategory;
      let status = verdict.approved&&!blockedCategory&&petFirstContext ? 'approved' : 'rejected';
      if(status==='approved'&&item.target_type==='post_media'&&mediaKind==='video'){
        if(!mediaStoragePath||!sanitizedMediaUrl||providerDurationMs==null){await deferItem(supabase,item,'sanitized_video_contract_missing');deferred++;continue;}
        try{
          const sanitized=await stageSanitizedVideo(supabase,mediaStoragePath,sanitizedMediaUrl,providerDurationMs);
          const {data:finalized,error:videoFinalizeError}=await supabase.rpc('service_finalize_sanitized_reel_media',{
            p_media_id:item.target_id,p_expected_current_path:mediaStoragePath,p_sanitized_path:sanitized.path,p_duration_ms:sanitized.durationMs
          });
          if(videoFinalizeError||finalized!==true){
            const now=new Date().toISOString();
            await supabase.from('storage_gc_queue').upsert({bucket:'social-media',storage_path:sanitized.path,queued_at:now,not_before:now,attempts:0,last_error:null},{onConflict:'bucket,storage_path'}).catch(()=>undefined);
            throw new Error('sanitized_video_finalize_failed');
          }
        }catch(error:any){await deferItem(supabase,item,String(error?.message??'sanitized_video_failed').slice(0,120));deferred++;continue;}
      }
      const policyReason=blockedCategory?`Tailmance pet-first policy blocked category: ${blockedCategory}.`:!petFirstContext?'Tailmance pet-first policy requires pet-centered media.':null;
      if(item.target_type==='comment_text'||item.target_type==='message_text'){
        const rpcName=item.target_type==='comment_text'?'finalize_comment_moderation':'finalize_message_moderation';
        const userVisibleReason=policyReason??(typeof verdict.reason==='string'&&verdict.reason.trim().length>=3&&verdict.reason.length<=500?verdict.reason.trim():'This item was restricted because it did not pass Tailmance content-safety checks.');
        const {error:finalizeError}=await supabase.rpc(rpcName,{
          p_item_id:item.id,p_status:status,p_provider:endpoint.hostname,
          p_reason:userVisibleReason,
          p_score:verdict.score&&typeof verdict.score==='object'&&JSON.stringify(verdict.score).length<=8_000?verdict.score:{}
        });
        if(finalizeError)throw new Error(item.target_type==='comment_text'?'comment_moderation_finalize_failed':'message_moderation_finalize_failed');
        if(status==='rejected'){
          const {data:decisionId,error:decisionError}=await supabase.rpc('record_moderation_restriction_decision_v2',{p_target_type:item.target_type,p_target_id:item.target_id,p_source:'automated',p_user_visible_reason:userVisibleReason,p_source_reference:`moderation_item:${item.id}`,p_basis_type:'terms_violation',p_legal_ground_reference:null,p_terms_ground_reference:'community_guidelines:content_safety',p_facts_summary:userVisibleReason,p_territorial_scope:[],p_automated_detection_used:true,p_automated_decision_used:true});
          if(decisionError||!decisionId)throw new Error('formal_moderation_decision_statement_write_failed');
        }
        processed++;
        continue;
      }
      const { error: reviewError } = await supabase.from('moderation_items').update({
        status,
        provider: endpoint.hostname,
        reason: policyReason??(typeof verdict.reason === 'string' && verdict.reason.length<=500 ? verdict.reason : null),
        score: verdict.score && typeof verdict.score === 'object' && JSON.stringify(verdict.score).length<=8_000 ? verdict.score : {},
        reviewed_at: new Date().toISOString()
      }).eq('id', item.id);
      if (reviewError) throw reviewError;

      if (updateTable) {
        const { error: targetUpdateError } = await supabase.from(updateTable).update({ moderation_status: status }).eq('id', item.target_id);
        if (targetUpdateError) throw targetUpdateError;
      }
      if (item.target_type === 'pet_photo' || item.target_type === 'pet_text') await refreshPet(supabase, parentId ?? item.target_id);
      if (item.target_type === 'post_media' || item.target_type === 'post_text') await refreshPost(supabase, parentId ?? item.target_id);
      if(status==='rejected'){
        const userVisibleReason=policyReason??(typeof verdict.reason==='string'&&verdict.reason.trim().length>=3&&verdict.reason.length<=500?verdict.reason.trim():'This item was restricted because it did not pass Tailmance content-safety checks.');
        const {data:decisionId,error:decisionError}=await supabase.rpc('record_moderation_restriction_decision_v2',{p_target_type:item.target_type,p_target_id:item.target_id,p_source:'automated',p_user_visible_reason:userVisibleReason,p_source_reference:`moderation_item:${item.id}`,p_basis_type:'terms_violation',p_legal_ground_reference:null,p_terms_ground_reference:'community_guidelines:content_safety',p_facts_summary:userVisibleReason,p_territorial_scope:[],p_automated_detection_used:true,p_automated_decision_used:true});
        if(decisionError||!decisionId)throw new Error('formal_moderation_decision_statement_write_failed');
      }
      processed++;
    } catch (error: any) {
      await deferItem(supabase, item, error?.name ?? 'worker_exception');
      deferred++;
    }
  }
  await markWorkerHeartbeat(supabase,'moderate-media','completed');
  return json({ ok: true, processed, deferred });
});
