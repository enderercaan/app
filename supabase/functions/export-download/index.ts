import { adminClient } from '../_shared/client.ts';

const PAGE_SIZE=500;
const ID_CHUNK_SIZE=100;
const MEDIA_URL_TTL_SECONDS=3600;
const encoder=new TextEncoder();
const TOKEN_RE=/^[A-Za-z0-9_-]{43}$/;

async function sha256Hex(value:string){
  const digest=await crypto.subtle.digest('SHA-256',encoder.encode(value));
  return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
}
function line(dataset:string,row:unknown){return encoder.encode(JSON.stringify({dataset,row})+'\n')}
function safeFilename(){return `tailmance-account-export-${new Date().toISOString().slice(0,10)}.ndjson`}
async function must<T=any>(promise:PromiseLike<{data:T|null;error:any}>,label:string):Promise<T>{
  const {data,error}=await promise;
  if(error)throw new Error(label);
  return data as T;
}
async function forPages<T=any>(build:(from:number,to:number)=>PromiseLike<{data:T[]|null;error:any}>,visit:(rows:T[])=>Promise<void>,label:string){
  for(let from=0;;from+=PAGE_SIZE){
    const rows=(await must<T[]>(build(from,from+PAGE_SIZE-1),label))??[];
    if(rows.length)await visit(rows);
    if(rows.length<PAGE_SIZE)return;
  }
}
async function forIdChunks<T=any>(ids:string[],build:(ids:string[],from:number,to:number)=>PromiseLike<{data:T[]|null;error:any}>,visit:(rows:T[])=>Promise<void>,label:string){
  for(let offset=0;offset<ids.length;offset+=ID_CHUNK_SIZE){
    const chunk=ids.slice(offset,offset+ID_CHUNK_SIZE);
    await forPages<T>((from,to)=>build(chunk,from,to),visit,label);
  }
}

async function withSignedStorageUrls<T extends {storage_path?:unknown}>(supabase:any,bucket:string,rows:T[]):Promise<(T&{storage_download_url:string|null;storage_download_expires_at:string|null})[]>{
  if(!rows.length)return [];
  const paths=[...new Set(rows.map(row=>String(row.storage_path??'')).filter(Boolean))];
  if(paths.length===0)return rows.map(row=>({...row,storage_download_url:null,storage_download_expires_at:null}));
  const {data,error}=await supabase.storage.from(bucket).createSignedUrls(paths,MEDIA_URL_TTL_SECONDS);
  if(error)throw new Error(`signed_url_failed:${bucket}`);
  const byPath=new Map<string,string>();
  for(const item of data??[]){
    const path=String(item?.path??'');
    const signedUrl=typeof item?.signedUrl==='string'?item.signedUrl:'';
    if(path&&signedUrl)byPath.set(path,signedUrl);
  }
  for(const path of paths)if(!byPath.has(path))throw new Error(`signed_url_incomplete:${bucket}`);
  const expiresAt=new Date(Date.now()+MEDIA_URL_TTL_SECONDS*1000).toISOString();
  return rows.map(row=>{
    const path=String(row.storage_path??'');
    return {...row,storage_download_url:path?byPath.get(path)??null:null,storage_download_expires_at:path?expiresAt:null};
  });
}

Deno.serve(async(req)=>{
  if(req.method!=='GET')return new Response('Method not allowed',{status:405,headers:{'Cache-Control':'no-store'}});
  const url=new URL(req.url);
  const token=url.searchParams.get('token')??'';
  if(!TOKEN_RE.test(token))return new Response('Invalid or expired export link',{status:401,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});

  const supabase=adminClient();
  const tokenHash=await sha256Hex(token);
  const {data:userId,error:claimError}=await supabase.rpc('claim_account_export_download_token',{p_token_hash:tokenHash});
  if(claimError||typeof userId!=='string')return new Response('Invalid or expired export link',{status:401,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});

  const stream=new ReadableStream<Uint8Array>({
    async start(controller){
      const emit=(dataset:string,row:unknown)=>controller.enqueue(line(dataset,row));
      const emitRows=async(dataset:string,rows:any[])=>{for(const row of rows)emit(dataset,row)};
      const moderationFor=async(targetType:string,ids:string[])=>{
        if(!ids.length)return;
        await forIdChunks<any>(ids,(chunk,from,to)=>supabase.from('moderation_items')
          .select('id,target_type,target_id,status,reason,manual_review_required,reviewed_at,created_at')
          .eq('target_type',targetType).in('target_id',chunk).order('id').range(from,to),rows=>emitRows('moderation_provider_items',rows),`moderation_${targetType}_export_failed`);
      };
      try{
        const {data:authData,error:authError}=await supabase.auth.admin.getUserById(userId);
        if(authError||!authData.user)throw new Error('export_user_not_found');
        const user=authData.user;
        const account=await must<any>(supabase.from('users').select('*').eq('id',userId).maybeSingle(),'account_export_failed');
        emit('meta',{exported_at:new Date().toISOString(),export_version:19,format:'ndjson',media_download_url_ttl_seconds:MEDIA_URL_TTL_SECONDS});
        emit('account',{auth:{id:user.id,email:user.email??null,created_at:user.created_at??null},profile:account??null});

        const pets:any[]=[];
        await forPages<any>((from,to)=>supabase.from('pets').select('*').eq('owner_id',userId).order('id').range(from,to),async rows=>{pets.push(...rows);await emitRows('pets',rows)},'pets_export_failed');
        const petIds=pets.map(p=>String(p.id));

        // Export the user's jurisdiction-applicability history without privileged counsel/internal evidence.
        // The signal snapshot is personal context used to determine applicable-law overlays, so it belongs in access exports.
        const applicabilityMatrixIds:string[]=[];
        await forPages<any>((from,to)=>supabase.from('legal_applicability_matrices')
          .select('matrix_id,primary_country_code,primary_subnational_code,review_status,signal_snapshot,signal_snapshot_sha256,reviewed_at,valid_until,created_at')
          .eq('user_id',userId).order('created_at').range(from,to),async rows=>{
            applicabilityMatrixIds.push(...rows.map(r=>String(r.matrix_id)));
            await emitRows('legal_applicability_matrices',rows);
          },'legal_applicability_matrices_export_failed');
        if(applicabilityMatrixIds.length){
          await forIdChunks<any>(applicabilityMatrixIds,(ids,from,to)=>supabase.from('legal_applicability_overlays')
            .select('overlay_id,matrix_id,jurisdiction_country_code,jurisdiction_subnational_code,applicability_basis,applicability_status,control_families,required_document_types,required_document_locales,reviewed_at,valid_until,created_at')
            .in('matrix_id',ids).order('created_at').range(from,to),rows=>emitRows('legal_applicability_overlays',rows),'legal_applicability_overlays_export_failed');
          await forIdChunks<any>(applicabilityMatrixIds,(ids,from,to)=>supabase.from('legal_bundle_overlay_documents')
            .select('overlay_document_id,matrix_id,overlay_id,bundle_id,document_type,document_locale,document_version,document_url,document_sha256,user_action_requirement,reviewed_at,valid_until,created_at')
            .in('matrix_id',ids).order('created_at').range(from,to),rows=>emitRows('legal_overlay_documents',rows),'legal_overlay_documents_export_failed');
        }

        const direct:[string,(from:number,to:number)=>any][]=[
          ['notifications',(from,to)=>supabase.from('notifications').select('id,type,title,body,entity_id,actor_pet_id,read_at,created_at').eq('user_id',userId).order('id').range(from,to)],
          ['subscriptions',(from,to)=>supabase.from('subscriptions').select('id,platform,product_id,entitlement_id,store_transaction_id,status,current_period_end,will_renew,created_at,updated_at').eq('user_id',userId).order('id').range(from,to)],
          ['consumable_balances',(from,to)=>supabase.from('consumable_balances').select('boost_credits,super_like_credits,boost_credit_debt,super_like_credit_debt,updated_at').eq('user_id',userId).order('updated_at').range(from,to)],
          ['consumable_credit_history',(from,to)=>supabase.from('consumable_credit_ledger').select('credit_kind,quantity,store_product_id,store_transaction_id,granted_at').eq('user_id',userId).order('granted_at').range(from,to)],
          ['consumable_transaction_state',(from,to)=>supabase.from('consumable_store_transaction_state').select('provider_environment,store_transaction_id,store_product_id,credit_kind,quantity,state,created_at,updated_at').eq('user_id',userId).order('updated_at').range(from,to)],
          ['travel_mode',(from,to)=>supabase.from('user_travel_mode').select('zone_id,enabled,updated_at').eq('user_id',userId).order('updated_at').range(from,to)],
          ['community_waitlist',(from,to)=>supabase.from('community_waitlist').select('pet_id,city,district,neighborhood,created_at').eq('user_id',userId).order('created_at').range(from,to)],
          ['lost_pet_alerts',(from,to)=>supabase.from('lost_pet_alerts').select('id,pet_id,status,last_seen_at,city,district,neighborhood,alert_radius_km,latitude,longitude,created_at,resolved_at').eq('owner_user_id',userId).order('created_at').range(from,to)],
          ['pet_boosts',(from,to)=>supabase.from('pet_boosts').select('id,pet_id,source,starts_at,ends_at,created_at').eq('user_id',userId).order('created_at').range(from,to)],
          ['device_registrations',(from,to)=>supabase.from('push_tokens').select('id,platform,transport,active_pet_id,enabled,last_seen_at,created_at').eq('user_id',userId).order('id').range(from,to)],
          ['device_integrity_assessments',(from,to)=>supabase.from('security_device_assessments').select('platform,action,verdict,app_integrity,device_integrity,app_id,app_version,verified_at,expires_at').eq('user_id',userId).order('verified_at').range(from,to)],
          // User-linked processing history belongs in access exports, but keep replay capabilities and
          // anti-abuse hashes private. Mutation operation IDs/request hashes and security challenge secrets are excluded.
          ['client_mutation_history',(from,to)=>supabase.from('client_mutation_receipts').select('action,result,created_at').eq('user_id',userId).order('created_at').range(from,to)],
          ['rate_limit_history',(from,to)=>supabase.from('rate_limits').select('action,window_start,count').eq('user_id',userId).order('window_start').range(from,to)],
          ['daily_product_quota',(from,to)=>supabase.from('daily_product_quotas').select('local_date,time_zone,window_started_at,reset_at,swipes_used,conversations_started,updated_at').eq('user_id',userId).order('updated_at').range(from,to)],
          ['owner_verification_sessions',(from,to)=>supabase.from('owner_verification_sessions').select('id,provider,status,created_at,updated_at,expires_at').eq('user_id',userId).order('id').range(from,to)],
          ['legal_age_assurance_sessions',(from,to)=>supabase.from('legal_age_assurance_sessions').select('id,legal_country_code,legal_subnational_code,age_threshold,provider_code,status,expires_at,created_at,updated_at').eq('user_id',userId).order('created_at').range(from,to)],
          ['legal_country_runtime',(from,to)=>supabase.from('legal_country_runtime').select('legal_country_code,legal_subnational_code,resolution_status,resolution_source,habitual_residence_country_code,service_contract_country_code,current_presence_country_code,storefront_country_code,operational_country_code,country_mismatch_reviewed,current_applicability_matrix_id,resolved_at,expires_at,updated_at').eq('user_id',userId).order('updated_at').range(from,to)],
          ['legal_age_assurance_history',(from,to)=>supabase.from('legal_age_assurance_events').select('legal_country_code,legal_subnational_code,age_threshold,verification_method,provider_code,result,verified_at,expires_at,created_at').eq('user_id',userId).order('created_at').range(from,to)],
          ['prelegal_age_attestations',(from,to)=>supabase.from('prelegal_age_attestations').select('age_threshold,statement_version,ui_locale,source,attested_at,created_at').eq('user_id',userId).order('attested_at').range(from,to)],
          ['pre_registration_legal_presentations',(from,to)=>supabase.from('pre_registration_legal_presentations').select('pre_registration_bundle_id,route_revision,declared_country_code,declared_subnational_code,subnational_scope_mode,subnational_scope_evidence_sha256,ui_locale,document_locale,presentation_sha256,privacy_notice_sha256,source,presented_at,created_at').eq('user_id',userId).order('presented_at').range(from,to)],
          ['legal_overlay_document_actions',(from,to)=>supabase.from('legal_overlay_document_actions').select('matrix_id,overlay_id,bundle_id,overlay_document_id,document_type,document_locale,document_version,document_sha256,action_type,accepted_source,accepted_at').eq('user_id',userId).order('accepted_at').range(from,to)],
          ['legal_acceptance_presentations',(from,to)=>supabase.from('legal_acceptance_presentations').select('matrix_id,bundle_id,presentation_sha256,accepted_source,accepted_at').eq('user_id',userId).order('accepted_at').range(from,to)],
          ['subscription_precontract_presentations',(from,to)=>supabase.from('subscription_precontract_presentations').select('bundle_id,applicability_matrix_id,ui_locale,document_set_sha256,store_platform,store_product_id,presentation_source,acknowledged_at,created_at').eq('user_id',userId).order('acknowledged_at').range(from,to)],
          ['legal_acceptances',(from,to)=>supabase.from('legal_acceptances').select('legal_version,terms_version,community_guidelines_version,bundle_id,applicability_matrix_id,accepted_country_code,accepted_subnational_code,accepted_ui_locale,document_locale,terms_sha256,community_guidelines_sha256,overlay_document_set_sha256,accepted_source,accepted_at').eq('user_id',userId).order('accepted_at').range(from,to)],
          ['privacy_notice_acknowledgements',(from,to)=>supabase.from('privacy_notice_acknowledgements').select('notice_version,bundle_id,applicability_matrix_id,country_code,legal_subnational_code,locale,document_locale,notice_sha256,overlay_document_set_sha256,acknowledged_source,acknowledged_at').eq('user_id',userId).order('acknowledged_at').range(from,to)],
          ['marketing_consent_history',(from,to)=>supabase.from('marketing_consent_events').select('channel,purpose,consent_version,granted,bundle_id,applicability_matrix_id,country_code,legal_subnational_code,locale,document_locale,consent_text_sha256,consent_document_set_sha256,source,created_at').eq('user_id',userId).order('created_at').range(from,to)],
          ['moderation_decisions',(from,to)=>supabase.from('moderation_decisions').select('id,report_id,target_type,target_id,action,source,user_visible_reason,status,restoration_required,restoration_completed_at,decided_at,reversed_at,created_at').or(`affected_user_id.eq.${userId},reporter_user_id.eq.${userId}`).order('created_at').range(from,to)],
          ['moderation_statements',(from,to)=>supabase.from('moderation_statement_of_reasons').select('id,moderation_decision_id,basis_type,legal_ground_reference,terms_ground_reference,facts_summary,territorial_scope,automated_detection_used,automated_decision_used,redress_available,redress_deadline,created_at').eq('affected_user_id',userId).order('created_at').range(from,to)],
          ['moderation_appeals',(from,to)=>supabase.from('moderation_appeals').select('id,decision_id,appellant_role,statement,status,submitted_at,decided_at,outcome_explanation').eq('appellant_user_id',userId).order('submitted_at').range(from,to)],
          ['upload_intents',(from,to)=>supabase.from('upload_intents').select('id,pet_id,bucket,purpose,storage_path,mime_type,created_at,expires_at,consumed_at,cancelled_at').eq('user_id',userId).order('id').range(from,to)],
          ['reports_submitted',(from,to)=>supabase.from('reports').select('*').eq('reporter_user_id',userId).order('id').range(from,to)]
        ];
        for(const [name,build] of direct)await forPages<any>(build,rows=>emitRows(name,rows),`${name}_export_failed`);

        // User-related billing processing history is exported without provider event IDs,
        // claim tokens, raw user-id arrays or internal error details.
        await forPages<any>((from,to)=>supabase.from('billing_webhook_events')
          .select('event_type,status,received_at,processed_at')
          .contains('user_ids',[userId]).order('received_at').range(from,to),rows=>emitRows('billing_activity',rows),'billing_activity_export_failed');
        await forPages<any>((from,to)=>supabase.from('billing_state_versions')
          .select('last_observed_at,updated_at').eq('user_id',userId).order('updated_at').range(from,to),rows=>emitRows('billing_state_observation',rows),'billing_state_export_failed');

        // Export deletion-request lifecycle without raw anti-abuse hashes.
        await forPages<any>((from,to)=>supabase.from('account_deletion_requests')
          .select('id,source,status,requested_at,resolved_at,identity_verified_at')
          .eq('target_user_id',userId).order('requested_at').range(from,to),rows=>emitRows('account_deletion_requests',rows),'deletion_requests_export_failed');

        // Push receipts are streamed page-by-page by the user's notification ids so no unbounded id list is retained.
        await forPages<any>((from,to)=>supabase.from('notifications').select('id').eq('user_id',userId).order('id').range(from,to),async rows=>{
          const ids=rows.map(r=>String(r.id));
          await forIdChunks<any>(ids,(chunk,f,t)=>supabase.from('push_receipts')
            .select('id,notification_id,receipt_status,checked_at,created_at').in('notification_id',chunk).order('id').range(f,t),r=>emitRows('push_delivery_receipts',r),'push_receipts_export_failed');
        },'notification_ids_export_failed');

        if(petIds.length){
          const petIdList=petIds.join(',');

          // Calls are personal interaction history and belong in access exports. Never export the
          // private LiveKit room name or any provider token/credential material. The call room is
          // only a short-lived transport capability; pet identities/status/timestamps are the
          // durable user-facing record.
          await forPages<any>((from,to)=>supabase.from('pet_call_sessions')
            .select('id,match_id,caller_pet_id,callee_pet_id,call_type,status,created_at,answered_at,ended_at,ring_expires_at,hard_expires_at')
            .or(`caller_pet_id.in.(${petIdList}),callee_pet_id.in.(${petIdList})`)
            .order('id').range(from,to),rows=>emitRows('pet_calls',rows),'pet_calls_export_failed');

          const ownPetDatasets:[string,(from:number,to:number)=>any][]=[
            ['private_location_and_microchip',(from,to)=>supabase.from('pet_private').select('*').in('pet_id',petIds).order('pet_id').range(from,to)],
            ['health_summary',(from,to)=>supabase.from('pet_health_summary').select('*').in('pet_id',petIds).order('pet_id').range(from,to)],
            ['purposes',(from,to)=>supabase.from('pet_purposes').select('*').in('pet_id',petIds).order('pet_id').order('purpose').range(from,to)],
            ['vaccinations',(from,to)=>supabase.from('pet_vaccinations').select('*').in('pet_id',petIds).order('id').range(from,to)],
            ['health_documents',(from,to)=>supabase.from('health_documents').select('id,pet_id,document_type,storage_path,verification_status,created_at').in('pet_id',petIds).order('id').range(from,to)],
            ['health_verification_attestations',(from,to)=>supabase.from('health_verification_attestations').select('id,pet_id,health_document_id,signal,method,provider_code,verified_at,expires_at,revoked_at,created_at').in('pet_id',petIds).order('id').range(from,to)],
            ['profile_prompts',(from,to)=>supabase.from('pet_prompts').select('*').in('pet_id',petIds).order('pet_id').order('sort_order').range(from,to)],
            ['pet_verification_requests',(from,to)=>supabase.from('pet_verification_requests').select('id,pet_id,storage_path,status,reason,created_at,reviewed_at').eq('owner_id',userId).order('id').range(from,to)],
            ['likes_sent',(from,to)=>supabase.from('pet_likes').select('*').in('from_pet_id',petIds).order('from_pet_id').order('to_pet_id').range(from,to)],
            ['passes',(from,to)=>supabase.from('pet_passes').select('*').in('from_pet_id',petIds).order('id').range(from,to)],
            ['favorites',(from,to)=>supabase.from('pet_favorites').select('*').in('from_pet_id',petIds).order('from_pet_id').order('to_pet_id').range(from,to)],
            ['blocks_sent',(from,to)=>supabase.from('blocks').select('*').in('blocker_pet_id',petIds).order('blocker_pet_id').order('blocked_pet_id').range(from,to)],
            ['follows_sent',(from,to)=>supabase.from('follows').select('*').in('from_pet_id',petIds).order('from_pet_id').order('to_pet_id').range(from,to)],
            ['comments',(from,to)=>supabase.from('comments').select('*').in('pet_id',petIds).order('id').range(from,to)],
            ['stories',(from,to)=>supabase.from('stories').select('*').in('pet_id',petIds).order('id').range(from,to)],
            ['events',(from,to)=>supabase.from('pet_events').select('*').in('creator_pet_id',petIds).order('id').range(from,to)],
            ['event_attendance',(from,to)=>supabase.from('event_attendees').select('*').in('pet_id',petIds).order('event_id').order('pet_id').range(from,to)],
            ['post_likes',(from,to)=>supabase.from('post_likes').select('*').in('pet_id',petIds).order('post_id').order('pet_id').range(from,to)],
            ['saved_posts',(from,to)=>supabase.from('saved_posts').select('*').in('pet_id',petIds).order('pet_id').order('post_id').range(from,to)],
            ['story_views',(from,to)=>supabase.from('story_views').select('*').in('viewer_pet_id',petIds).order('story_id').order('viewer_pet_id').range(from,to)],
            ['meetup_feedback',(from,to)=>supabase.from('meetup_feedback').select('*').in('reviewer_pet_id',petIds).order('id').range(from,to)],
            ['activity_log',(from,to)=>supabase.from('audit_events').select('id,user_id,pet_id,action,entity_type,entity_id,created_at').eq('user_id',userId).order('id').range(from,to)],
            ['photo_fingerprint_records',(from,to)=>supabase.from('pet_photo_fingerprints').select('photo_id,pet_id,created_at').in('pet_id',petIds).order('photo_id').range(from,to)]
          ];
          for(const [name,build] of ownPetDatasets){
            if(name==='health_documents')await forPages<any>(build,async rows=>{
              await emitRows(name,await withSignedStorageUrls(supabase,'health-documents',rows));
              const healthDocumentIds=rows.map(r=>String(r.id));
              await forIdChunks<any>(healthDocumentIds,(chunk,f,t)=>supabase.from('ai_inference_logs')
                .select('system_name,target_type,target_id,provider_code,model_version,decision,confidence,latency_ms,signal_count,metadata,created_at')
                .eq('target_type','health_document').in('target_id',chunk).order('id').range(f,t),
                r=>emitRows('health_ai_processing_history',r),'health_ai_processing_history_export_failed');
            },`${name}_export_failed`);
            else if(name==='pet_verification_requests')await forPages<any>(build,async rows=>emitRows(name,await withSignedStorageUrls(supabase,'pet-verification',rows)),`${name}_export_failed`);
            else if(name==='stories')await forPages<any>(build,async rows=>emitRows(name,await withSignedStorageUrls(supabase,'social-media',rows)),`${name}_export_failed`);
            else await forPages<any>(build,rows=>emitRows(name,rows),`${name}_export_failed`);
          }

          // Photos + moderation decisions.
          await forPages<any>((from,to)=>supabase.from('pet_photos').select('*').in('pet_id',petIds).order('id').range(from,to),async rows=>{
            await emitRows('photos',await withSignedStorageUrls(supabase,'pet-photos',rows)); await moderationFor('pet_photo',rows.map(r=>String(r.id)));
          },'photos_export_failed');
          await moderationFor('pet_text',petIds);

          // Posts are streamed in pages; each page fans out only bounded child-id chunks.
          await forPages<any>((from,to)=>supabase.from('posts').select('*').in('pet_id',petIds).order('id').range(from,to),async rows=>{
            await emitRows('posts',rows);
            const postIds=rows.map(r=>String(r.id));
            await moderationFor('post_text',postIds);
            await forIdChunks<any>(postIds,(chunk,f,t)=>supabase.from('post_media').select('*').in('post_id',chunk).order('id').range(f,t),async media=>{
              await emitRows('post_media',await withSignedStorageUrls(supabase,'social-media',media)); await moderationFor('post_media',media.map(r=>String(r.id)));
            },'post_media_export_failed');
          },'posts_export_failed');

          await forPages<any>((from,to)=>supabase.from('comments').select('id').in('pet_id',petIds).order('id').range(from,to),rows=>moderationFor('comment_text',rows.map(r=>String(r.id))),'comment_ids_export_failed');
          await forPages<any>((from,to)=>supabase.from('stories').select('id').in('pet_id',petIds).order('id').range(from,to),rows=>moderationFor('story',rows.map(r=>String(r.id))),'story_ids_export_failed');
          await forPages<any>((from,to)=>supabase.from('pet_events').select('id').in('creator_pet_id',petIds).order('id').range(from,to),rows=>moderationFor('event_text',rows.map(r=>String(r.id))),'event_ids_export_failed');
          await forPages<any>((from,to)=>supabase.from('health_documents').select('id').in('pet_id',petIds).order('id').range(from,to),rows=>moderationFor('health_document',rows.map(r=>String(r.id))),'health_document_ids_export_failed');

          // Matches are processed page-by-page; conversations/messages never accumulate in memory.
          await forPages<any>((from,to)=>supabase.from('pet_matches').select('*').or(`pet_low_id.in.(${petIdList}),pet_high_id.in.(${petIdList})`).order('id').range(from,to),async matches=>{
            await emitRows('matches',matches);
            const matchIds=matches.map(r=>String(r.id));
            await forIdChunks<any>(matchIds,(chunk,f,t)=>supabase.from('meetup_requests').select('*').in('match_id',chunk).order('id').range(f,t),async meetups=>{
              await emitRows('meetup_requests',meetups); await moderationFor('meetup_text',meetups.map(r=>String(r.id)));
            },'meetups_export_failed');
            await forIdChunks<any>(matchIds,(chunk,f,t)=>supabase.from('conversations').select('*').in('match_id',chunk).order('id').range(f,t),async conversations=>{
              await emitRows('conversations',conversations);
              const conversationIds=conversations.map(r=>String(r.id));
              await forIdChunks<any>(conversationIds,(ids,f,t)=>supabase.from('messages').select('*')
                .in('conversation_id',ids)
                .or(`moderation_status.eq.approved,sender_pet_id.in.(${petIds.join(',')})`)
                .order('id').range(f,t),async messages=>{
                await emitRows('messages',messages); await moderationFor('message_text',messages.map(r=>String(r.id)));
              },'messages_export_failed');
            },'conversations_export_failed');
          },'matches_export_failed');
        }
        emit('complete',{complete:true,completed_at:new Date().toISOString()});
        controller.close();
      }catch(error){
        console.error('account_export_stream_failed');
        controller.error(error);
      }
    }
  });

  return new Response(stream,{status:200,headers:{
    'Content-Type':'application/x-ndjson; charset=utf-8',
    'Content-Disposition':`attachment; filename="${safeFilename()}"`,
    'Cache-Control':'no-store, max-age=0',
    'Pragma':'no-cache',
    'Referrer-Policy':'no-referrer',
    'X-Content-Type-Options':'nosniff',
    'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; sandbox",
  }});
});
