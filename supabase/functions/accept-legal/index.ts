import { corsHeaders, json } from '../_shared/cors.ts';
import { authenticatedUser } from '../_shared/client.ts';
import { readRequestJsonBounded } from '../_shared/http.ts';

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCALE_RE=/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;
const SHA256_RE=/^[0-9a-f]{64}$/;

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  try{
    const {supabase,user}=await authenticatedUser(req);
    if(!user.email_confirmed_at&&!user.phone_confirmed_at)return json({error:'identity_verification_required'},403);
    let body:any;
    try{body=await readRequestJsonBounded<any>(req,8_192)}catch(error){return json({error:error instanceof Error&&error.message==='body_too_large'?'payload_too_large':'invalid_json'},error instanceof Error&&error.message==='body_too_large'?413:400)}
    const age18Confirmed=body?.age18Confirmed===true;
    const bundleId=String(body?.bundleId??'').trim();
    const uiLocale=String(body?.uiLocale??'').trim();
    const applicabilityMatrixId=String(body?.applicabilityMatrixId??'').trim();
    const acceptancePresentationSha256=String(body?.acceptancePresentationSha256??'').trim().toLowerCase();
    if(age18Confirmed!==true)return json({error:'age_confirmation_required'},400);
    if(!UUID_RE.test(bundleId)||!LOCALE_RE.test(uiLocale)||!UUID_RE.test(applicabilityMatrixId)||!SHA256_RE.test(acceptancePresentationSha256))return json({error:'legal_context_required'},400);

    const {data:config,error:configError}=await supabase.from('app_security_config')
      .select('current_legal_version,current_terms_version,current_community_guidelines_version,current_privacy_notice_version')
      .eq('singleton',true).single();
    if(configError||!config||!config.current_legal_version||!config.current_terms_version||!config.current_community_guidelines_version||!config.current_privacy_notice_version)return json({error:'server_legal_versions_not_configured'},503);

    const {data:bundle,error:bundleError}=await supabase.from('legal_document_bundles')
      .select('bundle_id,legal_country_code,legal_subnational_code,ui_locale,document_locale,legal_version,terms_version,community_guidelines_version,privacy_notice_version,source_evidence_reference,localization_evidence_reference,effective_at')
      .eq('bundle_id',bundleId).maybeSingle();
    if(bundleError||!bundle)return json({error:'legal_bundle_missing'},409);
    if(bundle.ui_locale!==uiLocale||bundle.legal_version!==config.current_legal_version||bundle.terms_version!==config.current_terms_version||bundle.community_guidelines_version!==config.current_community_guidelines_version||bundle.privacy_notice_version!==config.current_privacy_notice_version)return json({error:'outdated_or_mismatched_legal_bundle'},409);
    if(Date.parse(bundle.effective_at)>Date.now()||!Array.isArray(bundle.source_evidence_reference)||bundle.source_evidence_reference.length===0||!Array.isArray(bundle.localization_evidence_reference)||bundle.localization_evidence_reference.length===0)return json({error:'legal_bundle_release_evidence_missing'},409);

    const {data,error}=await supabase.rpc('accept_current_legal_bundle',{p_user_id:user.id,p_bundle_id:bundleId,p_ui_locale:uiLocale,p_age_18_confirmed:true,p_expected_applicability_matrix_id:applicabilityMatrixId,p_expected_presentation_sha256:acceptancePresentationSha256});
    if(error)throw new Error('legal_acceptance_write_failed');
    if(!data||data.ok!==true||data.bundleId!==bundleId||data.legalCountryCode!==bundle.legal_country_code||data.uiLocale!==uiLocale||data.documentLocale!==bundle.document_locale||data.applicabilityMatrixId!==applicabilityMatrixId||data.presentationSha256!==acceptancePresentationSha256||!SHA256_RE.test(String(data.overlayDocumentSetSha256??'')))return json({error:'legal_acceptance_not_confirmed'},500);
    return json(data);
  }catch(error){
    const message=error instanceof Error?error.message:'';
    if(message==='Unauthorized')return json({error:'Unauthorized'},401);
    return json({error:'legal_acceptance_failed'},500);
  }
});
