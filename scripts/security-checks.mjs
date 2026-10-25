import assert from 'node:assert/strict';
import { existsSync, globSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const read=(p)=>readFileSync(p,'utf8');
const schema=read('supabase/migrations/001_schema.sql');
const security=read('supabase/migrations/002_security_and_rpcs.sql');
const accountControls=read('supabase/migrations/006_account_controls_and_health_reminders.sql');
const releaseOps=read('supabase/migrations/007_release_operations.sql');
const storageLifecycle=read('supabase/migrations/008_storage_lifecycle.sql');
const billingHardening=read('supabase/migrations/009_billing_webhook_hardening.sql');
const finalHardening=read('supabase/migrations/010_final_hardening.sql');
const appConfig=read('app.config.ts');
const locationClient=read('src/services/location.ts');
const supabaseClient=read('src/services/supabase.ts');
const premiumScreen=read('src/screens/PremiumScreen.tsx');
const purchasesClient=read('src/services/purchases.ts');
const syncSubscription=read('supabase/functions/sync-subscription/index.ts');
const webhook=read('supabase/functions/revenuecat-webhook/index.ts');
const del=read('supabase/functions/delete-account/index.ts')+'\n'+read('supabase/functions/_shared/accountDeletion.ts');
const exportData=read('supabase/functions/export-data/index.ts');
const exportDownload=read('supabase/functions/export-download/index.ts');
const webDelete=read('supabase/functions/request-account-deletion/index.ts');
const push=read('supabase/functions/push-dispatch/index.ts');
const receipts=read('supabase/functions/push-receipts/index.ts');
const moderation=read('supabase/functions/moderate-media/index.ts');
const moderationAdmin=read('supabase/functions/moderation-admin/index.ts');
const reportsAdmin=read('supabase/functions/reports-admin/index.ts');
const reminders=read('supabase/functions/vaccination-reminders/index.ts');
const pushLifecycle=read('supabase/functions/push-token-lifecycle/index.ts');
const externalDeletionWorker=read('supabase/functions/external-deletion-worker/index.ts');
const httpShared=read('supabase/functions/_shared/http.ts');
const notificationClient=read('src/services/notifications.ts');
const authClient=read('src/services/auth.ts');
const prelegalAgeBoundary=read('supabase/migrations/074_v19_prelegal_age_attestation_authority_boundary.sql');
const ageAssuranceFlow=read('supabase/migrations/108_verified_external_age_assurance_flow.sql');
const ageAssuranceEvidencePrivacy=read('supabase/migrations/109_age_assurance_evidence_reference_hash_only.sql');
const startAgeAssurance=read('supabase/functions/start-age-assurance/index.ts');
const identityWebhook=read('supabase/functions/identity-verification-webhook/index.ts');
const legalBlockScreen=read('src/components/LegalBlockScreen.tsx');
const legalConsentScreen=read('src/screens/LegalConsentScreen.tsx');
const legalGateAccountActions=read('src/components/LegalGateAccountActions.tsx');
const uploadsClient=read('src/services/uploads.ts');
const apiClient=read('src/services/api.ts');
const navigator=read('src/navigation/AppNavigator.tsx');
const canonicalHardening=globSync('supabase/migrations/{011,012,013,014,015,016,017,018,019,020,021,022,023,024}_*.sql').sort().map(read).join('\n');
const pendingPatch=canonicalHardening;
const productQuota196=read('supabase/migrations/196_daily_swipe_conversation_quota_and_premium_naming_alignment.sql');
const storageGc=read('supabase/functions/storage-gc/index.ts');
const config=read('src/services/config.ts');
const deletePage=read('web/delete-account.html');
const deletePageJs=read('web/delete-account.js');
const checks=[]; const check=(name,fn)=>{fn();checks.push(name)};
check('private location split',()=>assert.match(schema,/create table public\.pet_private/));
check('private health documents',()=>assert.match(schema,/health_documents/));
check('3-photo moderation',()=>assert.match(security,/count\(\*\).*pet_photos[\s\S]*moderation_status='approved'\)\=3/));
check('RLS enabled',()=>assert.match(security,/enable row level security/));
check('direct grants revoked',()=>assert.match(security,/revoke all on public\.%I from anon, authenticated/));
check('cold DM blocked',()=>assert.match(security,/active_match_required/));
check('daily product quotas are server-authoritative and private',()=>{assert.match(productQuota196,/daily_product_quotas/);assert.match(productQuota196,/swipes_used integer[^\n]*between 0 and 50/);assert.match(productQuota196,/conversations_started integer[^\n]*between 0 and 3/);assert.match(productQuota196,/revoke all on function public\.consume_standard_daily_product_quota\(text\) from public,anon,authenticated/)});
check('message UPDATE not granted',()=>assert.doesNotMatch(security,/grant update on public\.messages/i));
check('verification fields owner-protected',()=>assert.doesNotMatch(security,/update public\.pet_health_summary set veterinarian_verified/i));
check('rate limiting',()=>assert.match(security,/create or replace function public\.rate_limit/));
check('block unmatches',()=>assert.match(security,/update public\.pet_matches set unmatched_at=now\(\)/));

check('local root/jailbreak/debugger/emulator heuristics are risk-only and never server-authoritative',()=>{
  const client=read('src/services/deviceIntegrity.ts');
  const edge=read('supabase/functions/verify-device-integrity/index.ts');
  const android=read('modules/tailmance-device-integrity/android/src/main/java/expo/modules/tailmancedeviceintegrity/TailmanceDeviceIntegrityModule.kt');
  const ios=read('modules/tailmance-device-integrity/ios/TailmanceDeviceIntegrityModule.swift');
  assert.match(android,/Debug\.isDebuggerConnected\(\)/);
  assert.match(android,/emulatorOrSimulator/);
  assert.match(android,/rootOrJailbreakHeuristic/);
  assert.match(ios,/P_TRACED/);
  assert.match(ios,/targetEnvironment\(simulator\)/);
  assert.match(ios,/rootOrJailbreakHeuristic/);
  assert.match(client,/clientRiskSignals/);
  assert.match(edge,/untrustedClientRiskSignals/);
  const verdictIndex=edge.indexOf("if(result.verified!==true)");
  const signalIndex=edge.indexOf('const clientRiskSignals=');
  assert.ok(verdictIndex>=0&&signalIndex>verdictIndex,'Local heuristic metadata must be attached only after authoritative attestation verification');
  const androidVerifier=edge.slice(edge.indexOf('async function verifyAndroid'),edge.indexOf('async function verifyApple'));
  assert.doesNotMatch(androidVerifier,/clientRiskSignals|untrustedClientRiskSignals/,'Client heuristics must not influence the Play Integrity verdict');
});

check('Play Integrity optional licensing semantics fail closed only when licensing is required',()=>{
  const fn=read('supabase/functions/verify-device-integrity/index.ts');
  assert.match(fn,/const requireLicensed=.*PLAY_INTEGRITY_REQUIRE_LICENSED/);
  assert.match(fn,/const licensed=!requireLicensed\|\|account\.appLicensingVerdict==='LICENSED'/);
  assert.match(fn,/recognized&&deviceOk&&licensed&&certOk&&versionOk&&requestPackageOk&&hashOk&&fresh/);
});

check('RevenueCat auth',()=>assert.match(webhook,/REVENUECAT_WEBHOOK_AUTH/));
check('RevenueCat Authorization + HMAC webhook auth + production environment/app binding',()=>{
  assert.match(webhook,/verifyRevenueCatAuthorization/);
  assert.match(webhook,/REVENUECAT_WEBHOOK_AUTH/);
  assert.match(webhook,/verifyRevenueCatHmac/);
  assert.match(webhook,/X-RevenueCat-Webhook-Signature/);
  assert.match(webhook,/REVENUECAT_WEBHOOK_SIGNING_SECRET/);
  assert.match(webhook,/timestamp[\s\S]*raw/);
  assert.match(webhook,/maxSkewSeconds=300/);
  assert.match(webhook,/crypto\.subtle\.sign\('HMAC'/);
  assert.match(webhook,/REVENUECAT_WEBHOOK_ENVIRONMENT/);
  assert.match(webhook,/event\.environment/);
  assert.match(webhook,/REVENUECAT_ALLOWED_APP_IDS_JSON/);
});
check('RevenueCat environment and app scope are server authoritative',()=>{
  assert.match(webhook,/REVENUECAT_WEBHOOK_ENVIRONMENT[\s\S]*PRODUCTION[\s\S]*SANDBOX/);
  assert.match(webhook,/event\.environment[\s\S]*environment_mismatch/);
  assert.match(webhook,/REVENUECAT_ALLOWED_APP_IDS_JSON[\s\S]*event\.app_id[\s\S]*app_not_allowed/);
});
check('RevenueCat current entitlement reconciliation',()=>assert.match(webhook,/REVENUECAT_REST_API_KEY[\s\S]*api\.revenuecat\.com\/v1\/subscribers/));
check('authenticated RevenueCat reconciliation function exists',()=>{assert.match(syncSubscription,/authenticatedUser[\s\S]*api\.revenuecat\.com\/v1\/subscribers[\s\S]*apply_manual_subscription_sync/);assert.doesNotMatch(syncSubscription,/from\('users'\)\.update/)});
check('purchase and restore trigger server entitlement reconciliation',()=>assert.match(purchasesClient,/purchasePremium[\s\S]*syncPremiumEntitlement[\s\S]*restorePurchases[\s\S]*syncPremiumEntitlement/));
check('subscription precontract evidence is durable-operation idempotent across lost RPC responses',()=>{
  const m=read('supabase/migrations/147_subscription_precontract_response_loss_idempotency.sql');
  const purchases=read('src/services/purchases.ts');
  assert.match(m,/record_current_subscription_precontract_presentation_idempotent[\s\S]*p_client_operation_id text[\s\S]*require_active_authenticated_session\(\)/i);
  assert.match(m,/pg_advisory_xact_lock[\s\S]*:subscription_precontract:/i);
  assert.match(m,/client_mutation_receipts[\s\S]*action='subscription_precontract'[\s\S]*client_operation_id_reused/i);
  assert.match(m,/v_result:=public\.record_current_subscription_precontract_presentation\([\s\S]*insert into public\.client_mutation_receipts/i);
  assert.match(m,/revoke all on function public\.record_current_subscription_precontract_presentation\(uuid,uuid,text,text,text,text\) from public,anon,authenticated/i);
  assert.match(purchases,/getOrCreateDurableClientOperation\('subscription-precontract'/);
  assert.match(purchases,/rpc\('record_current_subscription_precontract_presentation_idempotent',[\s\S]*p_client_operation_id:operation\.id/);
  assert.match(purchases,/clearDurableClientOperation\(operation\.key,operation\.id\)/);
});

check('billing mutations use a shared service-level single-flight guard',()=>{assert.match(purchasesClient,/billingMutationInFlight/);assert.match(purchasesClient,/runBillingSingleFlight/);assert.match(purchasesClient,/purchasePremium[\s\S]*runBillingSingleFlight\('purchase'/);assert.match(purchasesClient,/restorePurchases[\s\S]*runBillingSingleFlight\('restore'/)});
check('duplicate billing action reuses the in-flight promise while purchase and restore cannot overlap',()=>{assert.match(purchasesClient,/if\(current\)[\s\S]*current\.kind===kind[\s\S]*return current\.promise[\s\S]*current\.promise\.then\(\(\)=>runBillingSingleFlight/);assert.match(purchasesClient,/finally\(\(\)=>\{[\s\S]*billingMutationInFlight\?\.promise===promise[\s\S]*billingMutationInFlight=null/)});
check('consumable purchase single-flight is product-aware and serializes different store products',()=>{assert.match(purchasesClient,/consumablePurchaseInFlight:\{productIdentifier:string,promise:/);assert.match(purchasesClient,/current\.productIdentifier===productIdentifier[\s\S]*return current\.promise/);assert.match(purchasesClient,/current\.promise\.then\(\(\)=>purchaseConsumable\(product\),\(\)=>purchaseConsumable\(product\)\)/);assert.match(purchasesClient,/consumable_product_identifier_missing/)});
check('premium package is pinned to the exact RevenueCat package identifier',()=>{
  assert.match(purchasesClient,/availablePackages\?\?\[\][\s\S]*pkg=>pkg\.identifier===env\.revenueCatPremiumPackageId/);
  assert.match(purchasesClient,/premium_package_identifier_mismatch/);
  assert.match(config,/revenueCatPremiumPackageId:\s*value\(process\.env\.EXPO_PUBLIC_REVENUECAT_PREMIUM_PACKAGE_ID\)/);
});
check('Premium exposes subscription management',()=>{assert.match(premiumScreen,/premium\.manage/);assert.match(premiumScreen,/openSubscriptionManagement/)});

check('legal gate preserves account export, subscription management, sign-out and deletion rights independently of legal acceptance',()=>{
  assert.match(legalGateAccountActions,/getAccountExportDownloadUrl/);
  assert.match(legalGateAccountActions,/openSafeExternalHttpsUrl/);
  assert.match(legalGateAccountActions,/openSubscriptionManagement/);
  assert.match(legalGateAccountActions,/signOut\('local'\)/);
  assert.match(legalGateAccountActions,/deleteAccount\(\)/);
  assert.match(legalGateAccountActions,/finalizeDeletedAccountSession\(\)/);
  assert.ok((legalConsentScreen.match(/<LegalGateAccountActions\/>/g)||[]).length>=3,'Consent loading/error/ready states must retain account-rights controls');
  assert.match(legalBlockScreen,/<LegalGateAccountActions\/>/);
  assert.match(legalBlockScreen,/ScrollView[\s\S]*contentContainerStyle=\{styles\.root\}/);
  assert.doesNotMatch(legalGateAccountActions,/acceptLegalTerms|getCurrentLegalContext|accepted\s*&&/);
  assert.match(legalGateAccountActions,/mountedRef=useRef\(true\)[\s\S]*useEffect\(\(\)=>\(\)=>\{mountedRef\.current=false/);
  assert.match(legalGateAccountActions,/finally\{actionRef\.current=null;if\(mountedRef\.current\)setBusy\(null\)\}/);
  assert.ok((legalGateAccountActions.match(/if\(mountedRef\.current\)Alert\.alert/g)||[]).length>=5,'Legal-gate account actions must not surface async alerts after unmount');
});

check('legal consent async loads and acceptance are lifecycle guarded',()=>{
  assert.match(legalConsentScreen,/mountedRef=useRef\(true\)/);
  assert.match(legalConsentScreen,/return\(\)=>\{mountedRef\.current=false;contextRequestRef\.current\+=1;acceptRef\.current=false\}/);
  assert.match(legalConsentScreen,/if\(!mountedRef\.current\|\|requestId!==contextRequestRef\.current\|\|localeRef\.current!==requestedLocale\)return/);
  assert.match(legalConsentScreen,/if\(!mountedRef\.current\|\|!accepted\|\|acceptRef\.current\|\|!context\)return/);
  assert.match(legalConsentScreen,/finally\{acceptRef\.current=false;if\(mountedRef\.current\)setBusy\(false\)\}/);
});

check('signup self-attestation cannot directly set authoritative age/legal state',()=>{
  assert.match(authClient,/prelegal_age_attested:true/);
  assert.doesNotMatch(authClient,/data:\{[^}]*age_18_confirmed:true/);
  assert.match(prelegalAgeBoundary,/values\(new\.id,false,null\)/i);
  assert.match(prelegalAgeBoundary,/current_legal_age_assurance_satisfied[\s\S]*prelegal_age_attestations/i);
  assert.match(prelegalAgeBoundary,/revoke all on table public\.prelegal_age_attestations from public,anon,authenticated/i);
});
check('account deletion requests RevenueCat customer erasure',()=>assert.match(del,/deleteRevenueCatCustomer[\s\S]*method\s*:\s*'DELETE'[\s\S]*status\s*!==\s*200[\s\S]*status\s*!==\s*404/));
check('RevenueCat private idempotency ledger',()=>assert.match(billingHardening,/billing_webhook_events[\s\S]*revoke all/));
check('RevenueCat transfer candidates handled',()=>assert.match(webhook,/event\?\.type==='TRANSFER'/));
check('account deletes auth user',()=>assert.match(del,/auth\.admin\.deleteUser/));
check('RevenueCat deletion has a durable retry queue before auth deletion',()=>{assert.match(pendingPatch,/create table if not exists public\.external_deletion_queue/);const q=del.indexOf('await queueRevenueCatDeletion');const d=del.indexOf('auth.admin.deleteUser');assert.ok(q>=0&&d>q)});
check('RevenueCat cleanup failure does not block local hard deletion',()=>assert.match(del,/catch\(error\)\{[\s\S]*revenuecat_cleanup_pending[\s\S]*auth\.admin\.deleteUser/));
check('account deletion removes actor-bound notification remnants before pet cascade',()=>assert.match(del,/from\('notifications'\)\.delete\(\)\.in\('actor_pet_id',petChunk\)/));
check('external deletion worker is secret protected and retries',()=>{assert.match(externalDeletionWorker,/EXTERNAL_DELETION_WORKER_SECRET[\s\S]*Unauthorized/);assert.match(externalDeletionWorker,/external_deletion_queue[\s\S]*attempts[\s\S]*not_before/)});


check('account deletion destructive work has an atomic stale-recoverable claim',()=>{
  const sql=read('supabase/migrations/029_account_deletion_atomic_claim.sql');
  assert.match(sql,/account_deletion_claims[\s\S]*references auth\.users\(id\) on delete cascade/);
  assert.match(sql,/insert into public\.account_deletion_claims[\s\S]*on conflict\(user_id\) do nothing[\s\S]*get diagnostics v_inserted=row_count/);
  assert.match(sql,/for update[\s\S]*interval '15 minutes'/);
  assert.match(sql,/release_account_deletion_claim[\s\S]*claim_token=p_claim_token/);
  assert.match(sql,/auth\.role\(\)<>'service_role'/);
  assert.match(del,/claim_account_deletion[\s\S]*deletion_in_progress/);
  assert.match(del,/release_account_deletion_claim/);
  assert.match(del,/hardDeleted=true/);
});

check('account deletion inventories all private buckets recursively',()=>{assert.match(del,/STORAGE_BUCKETS=.*pet-photos.*social-media.*health-documents.*pet-verification/s);assert.match(del,/listAllStoragePaths[\s\S]*await walk\(path\)/)});
check('account deletion queues storage before auth hard delete',()=>{const q=del.indexOf('await queueStorageTargets');const d=del.indexOf('auth.admin.deleteUser');assert.ok(q>=0&&d>q)});
check('account deletion strips user ids from billing ledger',()=>assert.match(del,/billing_webhook_events[\s\S]*user_ids[\s\S]*filter\(\(id:string\)=>id!==userId\)/));
check('account deletion cleans orphan moderation and audit rows',()=>{assert.match(del,/moderation_items.*delete/s);assert.match(del,/audit_events.*delete/s)});
check('account deletion paginates long-lived rows and chunks large id filters',()=>{assert.match(del,/DB_PAGE_SIZE=500/);assert.match(del,/FILTER_ID_CHUNK_SIZE=100/);assert.match(del,/async function pagedRows/);assert.match(del,/async function pagedByIdChunks/);assert.match(del,/posts_read_failed[\s\S]*\.range\(from,to\)/);assert.match(del,/post_media_read_failed[\s\S]*pagedByIdChunks|pagedByIdChunks[\s\S]*post_media_read_failed/);assert.doesNotMatch(del,/\.in\('post_id',postIds\)/)});
check('account deletion chunks orphan moderation cleanup',()=>assert.match(del,/async function deleteModerationTargets[\s\S]*ids\.slice\(offset,offset\+FILTER_ID_CHUNK_SIZE\)[\s\S]*\.in\('target_id',idChunk\)/));
check('account deletion removes pet and meetup moderation orphans before cascade',()=>{assert.match(del,/\['pet_text',petIds\]/);assert.match(del,/matches_read_failed[\s\S]*meetups_read_failed/);assert.match(del,/\['meetup_text',targets\.meetupIds\]/)});
check('account deletion removes cross-account notification traces for deleted entities',()=>{assert.match(del,/async function deleteNotificationsForEntities[\s\S]*notifications[\s\S]*entity_id/);for(const type of ['like','follow','match','message','comment','event'])assert.ok(del.includes(`[\'${type}\',`)||del.includes(`['${type}',`));assert.match(del,/conversations_read_failed[\s\S]*conversationIds/)});
check('account deletion does not expose database/provider error details to the client',()=>{assert.match(del,/message\.split\(':',1\)[\s\S]*return json\(\{error:code\},500\)/);assert.doesNotMatch(del,/return json\(\{error:message\},status\)/);assert.doesNotMatch(del,/cleanupErrors:cleanupErrors/)});
check('account export never exposes received blocks',()=>assert.doesNotMatch(exportDownload,/blocks_received|blocked_pet_id.*blocks_received/));
check('account export fails closed on query errors without exposing provider details',()=>{assert.match(exportDownload,/if\(error\)throw new Error\(label\)/);assert.doesNotMatch(exportData,/json\(\{error:error\.message/);assert.doesNotMatch(exportDownload,/new Response\([^\n]*error\.message/)});
check('account export redacts raw push tokens',()=>{assert.match(exportDownload,/push_tokens'\)\.select\('id,platform/);assert.doesNotMatch(exportDownload,/push_tokens'\)\.select\('\*'\)/)});
check('account export includes missing owned datasets',()=>{for(const name of ['pet_prompts','post_media','post_likes','saved_posts','story_views','meetup_feedback','owner_verification_sessions'])assert.match(exportDownload,new RegExp(name))});

check('account export includes user-linked processing history without replay or anti-abuse secrets',()=>{
  assert.match(exportDownload,/client_mutation_history[\s\S]*client_mutation_receipts[\s\S]*select\('action,result,created_at'\)[\s\S]*\.eq\('user_id',userId\)/);
  assert.match(exportDownload,/rate_limit_history[\s\S]*rate_limits[\s\S]*select\('action,window_start,count'\)[\s\S]*\.eq\('user_id',userId\)/);
  assert.ok(!/client_mutation_receipts'\)\.select\([^)]*(?:operation_id|request_hash)/.test(exportDownload));
  assert.doesNotMatch(exportDownload,/account_export_download_tokens|account_deletion_claims|account_email_lookup|security_attestation_challenges|security_app_attest_keys|security_revoked_sessions/);
});

check('account export classifies every user/pet-linked persisted table as exported or security-sensitive',()=>{
  const migrationSql=globSync('supabase/migrations/[0-9][0-9][0-9]_*.sql').sort().map(read).join('\n');
  const personalTables=new Set();
  const tableRe=/create\s+table(?:\s+if\s+not\s+exists)?\s+public\.([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\n\);/gi;
  for(const match of migrationSql.matchAll(tableRe)){
    const [,name,body]=match;
    if(/\b(?:user_id|owner_id|owner_user_id|target_user_id|affected_user_id|reporter_user_id|appellant_user_id|pet_id|from_pet_id|to_pet_id|sender_pet_id|reviewer_pet_id|blocker_pet_id|blocked_pet_id|creator_pet_id|viewer_pet_id)\b/i.test(body))personalTables.add(name);
  }
  const securitySensitiveExclusions=new Set([
    'account_deletion_claims','account_email_lookup','account_export_download_tokens',
    'security_app_attest_keys','security_attestation_challenges','security_revoked_sessions','security_user_revocation_state',
    'pet_match_embeddings'
  ]);
  const unclassified=[...personalTables].filter(name=>!exportDownload.includes(`from('${name}')`)&&!securitySensitiveExclusions.has(name));
  assert.deepEqual(unclassified,[],`user/pet-linked persisted tables missing export/exclusion classification: ${unclassified.join(', ')}`);
  for(const name of securitySensitiveExclusions)assert.ok(!exportDownload.includes(`from('${name}')`),`${name} must stay out of self-service export`);
});
check('account export streams every long-lived dataset page-by-page',()=>{assert.match(exportDownload,/PAGE_SIZE=500[\s\S]*async function forPages[\s\S]*\.range\(from,to\)[\s\S]*messages_export_failed/);assert.match(exportDownload,/ReadableStream<Uint8Array>/);assert.doesNotMatch(exportDownload,/MAX_INLINE_EXPORT_ROWS_PER_DATASET|export_too_large_for_inline_delivery/)});
check('account export chunks large identifier filters instead of building unbounded in() query strings',()=>{assert.match(exportDownload,/ID_CHUNK_SIZE=100[\s\S]*async function forIdChunks/);for(const field of ['post_id','match_id','conversation_id'])assert.match(exportDownload,new RegExp(`\\.in\\('${field}',(?:chunk|ids)\\)`));assert.doesNotMatch(exportDownload,/\.in\('post_id',postIds\)|\.in\('match_id',matchIds\)|\.in\('conversation_id',conversationIds\)/)});

check('storage private',()=>assert.match(schema,/\('pet-photos','pet-photos',false/));
check('push tokens private by default',()=>assert.match(schema,/create table public\.push_tokens/));
check('audit events',()=>assert.match(schema,/create table public\.audit_events/));
check('moderation queue',()=>assert.match(schema,/create table public\.moderation_items/));
check('exact GPS not in public pets',()=>{const pets=schema.match(/create table public\.pets \([\s\S]*?\n\);/)?.[0]??'';assert.doesNotMatch(pets,/latitude|longitude|microchip_number|exact_address/)});
check('notification preferences default marketing off',()=>assert.match(accountControls,/"marketing":false/));
check('notification preferences enforced by push worker',()=>assert.match(push,/skippedByPreference/));
check('marketing push delivery requires authoritative current document-set consent',()=>{
  const marketingAuthority=read('supabase/migrations/077_v19_marketing_consent_presentation_and_delivery_authority.sql');
  assert.match(marketingAuthority,/service_marketing_push_consent_user_ids[\s\S]*current_marketing_push_consent_granted/i);
  assert.match(marketingAuthority,/consent_document_set_sha256=v_sha/i);
  assert.match(push,/service_marketing_push_consent_user_ids/);
  assert.match(push,/marketingConsentError[\s\S]*push_status:'pending'/);
  assert.match(push,/!marketingConsentUsers\.has\(n\.user_id\)[\s\S]*push_status:'skipped'/);
});
check('marketing consent fails closed when current overlay publication evidence is stale, untrusted or unclassified',()=>{
  const integrity=read('supabase/migrations/079_v19_marketing_overlay_document_integrity.sql');
  assert.match(integrity,/marketing_consent_overlay_documents_complete/);
  assert.match(integrity,/legal_document_url_allowed\(d\.document_url\)/);
  assert.match(integrity,/marketing_consent_document_set_unavailable/);
  assert.match(integrity,/revoke all on function public\.marketing_consent_overlay_documents_complete\(uuid,uuid\) from public,anon,authenticated/);
});
check('quiet hours defer non-system push without consuming an attempt',()=>{
  assert.match(push,/n\.type!==['"]system['"][\s\S]*quietHoursState\(prefs\)[\s\S]*next_push_attempt_at:nextAttempt[\s\S]*deferredByQuietHours/);
  assert.doesNotMatch(push,/quiet\.active[\s\S]{0,350}push_attempts/,'Quiet-hour deferral must not consume a retry attempt');
});
check('quiet-hours evaluation is timezone aware and fail-safe',()=>{
  assert.match(push,/Intl\.DateTimeFormat\(['"]en-US['"],\{timeZone,hour:['"]2-digit['"],minute:['"]2-digit['"],hourCycle:['"]h23['"]\}\)/);
  assert.match(push,/catch\{return\{active:false,minutesUntilEnd:0\}\}/);
});
check('push worker secret protected',()=>assert.match(push,/PUSH_WORKER_SECRET[\s\S]*Unauthorized/));
check('push worker fails closed when preferences cannot be read',()=>assert.match(push,/usersError[\s\S]*return json\(\{error:'notification_user_state_unavailable'\},500\)/));
check('push worker terminal failures are not re-dispatched',()=>{assert.match(push,/rpc\('claim_pending_notifications'/);assert.match(pendingPatch,/claim_pending_notifications[\s\S]*push_status='pending'[\s\S]*push_attempts<6/);assert.doesNotMatch(push,/\.in\('push_status', \['pending', 'failed'\]\)/)});
check('push worker revalidates relationship state before delivery',()=>assert.match(push,/shouldSkipForRelationshipState[\s\S]*message[\s\S]*match[\s\S]*like[\s\S]*follow/));
check('push worker avoids duplicate delivery on partial retry',()=>assert.match(push,/alreadyAccepted[\s\S]*receipt_status==='pending'\|\|r\.receipt_status==='ok'[\s\S]*candidates/));
check('sign-out disables device push registration before auth sign-out',()=>{const fn=authClient.match(/export async function signOut\([\s\S]*?\n\}/)?.[0]??'';assert.match(fn,/unregisterCurrentPushToken|disableAllPushTokens/);const cleanup=fn.indexOf("unregisterCurrentPushToken");const logout=fn.indexOf('supabase.auth.signOut');assert.ok(cleanup>=0&&logout>cleanup)});
check('push token cleanup is scoped to authenticated user',()=>assert.match(pushLifecycle,/authenticatedUser[\s\S]*eq\('user_id',user\.id\)/));
check('push token is stored securely for deterministic logout cleanup',()=>assert.match(notificationClient,/secureStorage[\s\S]*PUSH_TOKEN_STORAGE_KEY[\s\S]*setItem/));
check('push token rotation listener re-registers backend token',()=>assert.match(notificationClient,/addPushTokenListener[\s\S]*registerPushToken/));
check('sign-out fails closed when push revocation fails',()=>{const fn=authClient.match(/export async function signOut\([\s\S]*?\n\}/)?.[0]??'';const cleanup=fn.indexOf("scope==='global'?await disableAllPushTokens():await unregisterCurrentPushToken()");const logout=fn.indexOf('supabase.auth.signOut');assert.ok(cleanup>=0&&logout>cleanup);assert.doesNotMatch(fn,/pushCleanupError/)});
check('rotated push token revokes previous token before registering replacement',()=>{assert.match(notificationClient,/previousToken[\s\S]*push-token-lifecycle[\s\S]*register_push_token/);const revoke=notificationClient.indexOf("push-token-lifecycle");const register=notificationClient.indexOf("register_push_token");assert.ok(revoke>=0&&register>revoke)});
check('push lifecycle rejects implausible token lengths',()=>assert.match(pushLifecycle,/token\.length<20\|\|token\.length>512/));
check('account deletion fails closed when the canonical external-erasure queue is unavailable',()=>{assert.doesNotMatch(del,/error\?\.code==='42P01'/);assert.doesNotMatch(del,/revenueCatQueueAvailable/);assert.match(del,/external_deletion_queue_failed/);const q=del.indexOf('await queueRevenueCatDeletion');const d=del.indexOf('auth.admin.deleteUser');assert.ok(q>=0&&d>q)});
check('user-facing signed media uses bounded short-lived URLs',()=>assert.match(read('src/services/api.ts'),/SIGNED_MEDIA_TTL_SECONDS\s*=\s*600[\s\S]*createSignedUrls\(local, SIGNED_MEDIA_TTL_SECONDS\)/));
check('notification responses are idempotent and cleared after routing',()=>{assert.match(navigator,/handledNotificationResponses/);assert.match(navigator,/request\.identifier/);assert.match(navigator,/clearLastNotificationResponseAsync/) });
check('push receipt worker secret protected',()=>assert.match(receipts,/PUSH_WORKER_SECRET[\s\S]*Unauthorized/));
check('moderation worker secret protected',()=>assert.match(moderation,/MODERATION_WORKER_SECRET[\s\S]*Unauthorized/));
check('moderation admin secret protected',()=>assert.match(moderationAdmin,/MODERATION_ADMIN_SECRET[\s\S]*Unauthorized/));
check('moderation worker uses bounded backoff and manual review escape hatch',()=>{assert.match(moderation,/MAX_ATTEMPTS[\s\S]*deferItem[\s\S]*manual_review_required/);assert.match(pendingPatch,/moderation_items add column if not exists attempts[\s\S]*manual_review_required[\s\S]*idx_moderation_retry_queue/)});
check('safety reports have a secret-protected atomic admin review workflow',()=>{assert.match(reportsAdmin,/REPORTS_ADMIN_SECRET[\s\S]*Unauthorized/);assert.match(reportsAdmin,/action === 'list'[\s\S]*action === 'update'[\s\S]*admin_update_report_status/);assert.match(pendingPatch,/admin_update_report_status[\s\S]*report_status_update/)});
check('vaccination reminder worker secret protected',()=>assert.match(reminders,/REMINDER_WORKER_SECRET[\s\S]*Unauthorized/));
check('vaccination reminder worker delegates to a deduplicated server-side enqueue RPC',()=>{assert.match(reminders,/rpc\('enqueue_vaccination_reminders'\)/);assert.doesNotMatch(reminders,/limit\(1000\)/);});
check('web deletion table has no client grants',()=>assert.match(releaseOps,/revoke all on public\.account_deletion_requests from anon, authenticated/));
check('web deletion avoids account enumeration',()=>assert.match(webDelete,/do not disclose whether the email belongs to an account/i));
check('web deletion supports bot challenge',()=>assert.match(webDelete,/TURNSTILE_SECRET_KEY/));
check('iOS Release build strips shipped product without sacrificing dSYM symbolication',()=>{const plugin=read('plugins/withIosReleaseHardening.cjs');const appConfig=read('app.config.ts');assert.match(appConfig,/withIosReleaseHardening\.cjs/);assert.match(plugin,/ENABLE_TESTABILITY\s*=\s*'NO'/);assert.match(plugin,/COPY_PHASE_STRIP\s*=\s*'YES'/);assert.match(plugin,/STRIP_INSTALLED_PRODUCT\s*=\s*'YES'/);assert.match(plugin,/DEAD_CODE_STRIPPING\s*=\s*'YES'/);assert.match(plugin,/DEBUG_INFORMATION_FORMAT\s*=\s*'dwarf-with-dsym'/);});
check('native auth challenge token is state-bound and wired into Supabase Auth',()=>{const challenge=read('src/services/authChallenge.ts');assert.match(challenge,/generateSecureRandomBase64UrlAsync/);assert.match(challenge,/searchParams\.get\('state'\)!==state/);assert.match(challenge,/CALLBACK_SCHEMES\.has\(parsed\.protocol\)/);assert.match(authClient,/requestNativeAuthCaptcha\('sign_up'\)/);assert.match(authClient,/requestNativeAuthCaptcha\('sign_in'\)/);assert.match(authClient,/requestNativeAuthCaptcha\('phone_otp'\)/);assert.match(authClient,/requestNativeAuthCaptcha\('password_reset'\)/);assert.match(authClient,/captchaToken/);});
check('web deletion sends challenge token',()=>assert.match(deletePageJs,/turnstileToken/));
check('production demo fail-safe',()=>assert.match(config,/isDemoEnabled = !isBackendConfigured && env\.enableDemo && env\.appEnv !== 'production'/));
check('detached media queued for deletion',()=>assert.match(storageLifecycle,/create table if not exists public\.storage_gc_queue/));
check('storage GC queue private',()=>assert.match(storageLifecycle,/revoke all on public\.storage_gc_queue from anon, authenticated/));
check('storage GC re-checks live references',()=>assert.match(storageGc,/stillReferenced/));
check('storage GC fails closed when reference queries fail',()=>{assert.match(storageGc,/reference_check_failed/);assert.match(storageGc,/if\(error\)throw new Error/)});
check('expired upload GC verifies cancellation and queue writes',()=>assert.match(storageGc,/upload_intent_cancel_failed[\s\S]*expired_upload_gc_queue_failed/));
check('storage GC worker secret protected',()=>assert.match(storageGc,/STORAGE_GC_SECRET[\s\S]*Unauthorized/));
check('signed media URL lifetime balances private-media exposure with real scrolling time',()=>assert.match(apiClient,/SIGNED_MEDIA_TTL_SECONDS\s*=\s*600[\s\S]*createSignedUrls\(local, SIGNED_MEDIA_TTL_SECONDS\)/));

check('upload intents are private',()=>assert.match(finalHardening,/create table if not exists public\.upload_intents[\s\S]*revoke all on public\.upload_intents from anon,authenticated/));
check('upload intent is short lived',()=>assert.match(finalHardening,/expires_at timestamptz not null default \(?now\(\)\+interval '15 minutes'\)?/));
check('pending upload-intent consume is concurrency safe',()=>assert.match(pendingPatch,/consume_upload_intent[\s\S]*update public\.upload_intents[\s\S]*consumed_at is null[\s\S]*cancelled_at is null[\s\S]*returning id into v_id/));
check('storage writes require active intent',()=>assert.match(finalHardening,/can_upload_storage_object[\s\S]*upload_intents[\s\S]*expires_at>now\(\)/));
check('upload intent is purpose scoped',()=>assert.match(finalHardening,/p_purpose[\s\S]*pet_photo_1[\s\S]*health_document[\s\S]*pet_verification/));
check('cancelled uploads queue cleanup',()=>assert.match(finalHardening,/cancel_upload_intent[\s\S]*storage_gc_queue/));
check('expired upload intents are garbage collected',()=>assert.match(storageGc,/queueExpiredUploadIntents[\s\S]*expires_at/));
check('pet verification media bucket is private',()=>assert.match(finalHardening,/values\('pet-verification','pet-verification',false/));
check('pet verification review is service role only',()=>assert.match(finalHardening,/review_pet_verification[\s\S]*service_role_required/));
check('pet verification owner grants revoked',()=>assert.match(finalHardening,/revoke all on function public\.review_pet_verification[\s\S]*authenticated/));
check('pet identity changes revoke verification',()=>assert.match(finalHardening,/revoke_pet_verification_on_identity_change[\s\S]*profile_verified:=false/));
check('pet profile server validation requires birth and neighborhood',()=>assert.match(finalHardening,/birth_date_required[\s\S]*neighborhood/));
check('pet profile server validation requires purpose',()=>assert.match(finalHardening,/purpose_required/));
check('discovery supports deep health filters',()=>assert.match(finalHardening,/microchipVerifiedOnly[\s\S]*geneticScreeningOnly[\s\S]*pedigreeOnly/));
check('discovery supports weight and energy filters',()=>assert.match(finalHardening,/minWeightKg[\s\S]*energyLevels/));
check('search text normalized server side',()=>assert.match(finalHardening,/normalize_search_text/));
check('message keyset pagination capped',()=>assert.match(finalHardening,/get_conversation_messages_page[\s\S]*least\(greatest\(p_limit,1\),100\)/));
check('notification keyset pagination user scoped',()=>assert.match(finalHardening,/get_notifications_page[\s\S]*user_id=auth\.uid\(\)/));
check('feed pagination freezes snapshot',()=>assert.match(finalHardening,/get_feed_page[\s\S]*v_snapshot[\s\S]*created_at<=v_snapshot/));
check('approximate location rounded before backend',()=>assert.match(locationClient,/function coarse\(value:number\)\{return Math\.round\(value\*1000\)\/1000;\}[\s\S]*p_latitude: coarse\(current\.coords\.latitude\)/));
check('Android precise location blocked',()=>assert.match(appConfig,/blockedPermissions:[\s\S]*ACCESS_FINE_LOCATION/));
check('Premium does not invent a fallback price',()=>assert.doesNotMatch(premiumScreen,/\$9\.99/));
check('moderation admin handles pet verification separately',()=>assert.match(moderationAdmin,/targetType==='pet_verification'[\s\S]*review_pet_verification/));
check('mobile auth uses PKCE',()=>assert.match(supabaseClient,/flowType: 'pkce'/));
check('mobile auth rejects raw token deep links',()=>assert.doesNotMatch(supabaseClient,/setSession\(\{ access_token/));
check('mobile auth deep links use canonical Tailmance scheme with a single-scheme allowlist',()=>{assert.match(supabaseClient,/APP_SCHEMES = new Set\(\['tailmance:'\]\)/);assert.match(supabaseClient,/host === 'auth' && path === '\/callback'[\s\S]*host === 'reset-password' && path === '\/'/);assert.match(authClient,/tailmance:\/\/auth\/callback/);assert.match(authClient,/tailmance:\/\/reset-password/)});

check('dynamic backend/provider HTTPS URLs are client-validated before opening',()=>{
  const externalLinks=read('src/services/externalLinks.ts');
  const surfaces=['src/screens/AuthScreen.tsx','src/screens/VerificationCenterScreen.tsx','src/components/LegalBlockScreen.tsx','src/screens/SettingsScreen.tsx','src/screens/PausedAccountScreen.tsx','src/screens/SuspendedAccountScreen.tsx','src/screens/LegalPrivacyScreen.tsx','App.tsx'].map(read).join('\n');
  assert.match(externalLinks,/parsed\.protocol!==['"]https:['"]/);
  assert.match(externalLinks,/parsed\.username\|\|parsed\.password\|\|parsed\.port/);
  assert.match(externalLinks,/Linking\.canOpenURL/);
  assert.match(surfaces,/openSafeExternalHttpsUrl/);
  assert.doesNotMatch(surfaces,/Linking\.openURL\((?:result\.url|downloadUrl|url)\)/);
});
check('TOTP authenticator deep link is constrained to otpauth totp with a secret',()=>{
  const mfa=read('src/services/mfa.ts');
  assert.match(mfa,/requireSafeTotpEnrollmentUri/);
  assert.match(mfa,/parsed\.protocol!==['"]otpauth:['"]/);
  assert.match(mfa,/parsed\.hostname\.toLowerCase\(\)!==['"]totp['"]/);
  assert.match(mfa,/searchParams\.get\(['"]secret['"]\)/);
  assert.match(mfa,/uri:requireSafeTotpEnrollmentUri\(data\.totp\.uri\)/);
});
check('Android production map key is fail-closed in client release config',()=>{
  const releaseConfig=read('scripts/release-config-check.mjs');
  assert.match(releaseConfig,/['"]GOOGLE_MAPS_ANDROID_API_KEY['"]/);
  assert.match(releaseConfig,/match\(['"]GOOGLE_MAPS_ANDROID_API_KEY['"]/);
});
check('client release config requires explicit RevenueCat boost and super-like product identifiers',()=>{
  const releaseConfig=read('scripts/release-config-check.mjs');
  assert.match(releaseConfig,/EXPO_PUBLIC_REVENUECAT_BOOST_PRODUCT_IDS/);
  assert.match(releaseConfig,/EXPO_PUBLIC_REVENUECAT_SUPER_LIKE_PRODUCT_IDS/);
  assert.match(releaseConfig,/new Set\(ids\)\.size!==ids\.length/);
});
check('consumable product IDs cannot map to both boost and super-like',()=>{
  const releaseConfig=read('scripts/release-config-check.mjs');
  assert.match(releaseConfig,/overlappingConsumables[\s\S]*must map to exactly one client product kind/);
  assert.match(purchasesClient,/boostIds[\s\S]*superLikeIds[\s\S]*consumable_product_mapping_ambiguous/);
});
check('release pipeline cross-checks client consumable products against server credit authority',()=>{
  const gate=read('scripts/consumable-config-consistency-check.mjs');
  const releaseAll=read('scripts/release-check-all.mjs');
  assert.match(gate,/EXPO_PUBLIC_REVENUECAT_BOOST_PRODUCT_IDS[\s\S]*EXPO_PUBLIC_REVENUECAT_SUPER_LIKE_PRODUCT_IDS[\s\S]*REVENUECAT_CONSUMABLE_PRODUCTS_JSON/);
  assert.match(gate,/products\[id\]\?\.kind!==['"]boost['"][\s\S]*products\[id\]\?\.kind!==['"]super_like['"]/);
  assert.match(releaseAll,/consumable client\/server mapping[\s\S]*release:consumable-config/);
});
check('production server config requires a validated RevenueCat consumable product map and documents security-admin secret',()=>{
  const releaseConfig=read('scripts/server-release-config-check.mjs');
  const serverEnvExample=read('supabase/.env.example');
  assert.match(releaseConfig,/['"]REVENUECAT_CONSUMABLE_PRODUCTS_JSON['"]/);
  assert.match(releaseConfig,/boost['"],['"]super_like/);
  assert.match(releaseConfig,/quantity<1\|\|def\.quantity>1000/);
  assert.match(serverEnvExample,/SECURITY_ADMIN_SECRET=/);
  assert.match(serverEnvExample,/REVENUECAT_CONSUMABLE_PRODUCTS_JSON=/);
});
check('dedicated external age-assurance provider config is all-or-nothing and HTTPS allowlisted',()=>{
  const releaseConfig=read('scripts/server-release-config-check.mjs');
  assert.match(releaseConfig,/AGE_ASSURANCE_PROVIDER_SESSION_URL/);
  assert.match(releaseConfig,/AGE_ASSURANCE_PROVIDER_SECRET/);
  assert.match(releaseConfig,/AGE_ASSURANCE_PROVIDER_ALLOWED_HOSTS_JSON/);
  assert.match(releaseConfig,/validateHttpsEndpointAgainstAllowlist\(['"]AGE_ASSURANCE_PROVIDER_SESSION_URL['"],['"]AGE_ASSURANCE_PROVIDER_ALLOWED_HOSTS_JSON['"]\)/);
  assert.match(releaseConfig,/tailmance:\/\/age-verification-complete/);
});



check('verified-external age assurance is privacy-minimized, provider-bound and append-only',()=>{
  assert.match(ageAssuranceFlow,/create table if not exists public\.legal_age_assurance_sessions/);
  assert.match(ageAssuranceFlow,/provider_reference_sha256/);
  assert.doesNotMatch(ageAssuranceFlow,/date_of_birth|dob\s+date|id_image|document_image|biometric_template/i);
  assert.match(ageAssuranceFlow,/service_apply_legal_age_assurance_result/);
  assert.match(ageAssuranceFlow,/service_record_legal_age_assurance/);
  assert.match(ageAssuranceFlow,/status='revoked'/);
  assert.match(startAgeAssurance,/age_assurance_mode!=='verified_external'/);
  assert.match(startAgeAssurance,/minimumAge:Number\(policy\.minimum_user_age\)/);
  assert.match(startAgeAssurance,/purpose:'age_assurance'/);
  assert.match(startAgeAssurance,/tailmance:\/\/age-verification-complete/);
  assert.doesNotMatch(startAgeAssurance,/dateOfBirth|date_of_birth|documentImage|idImage|biometric/i);
  assert.match(identityWebhook,/event\?\.type\?\?'owner_identity'\)===['"]age_assurance['"]/);
  assert.match(identityWebhook,/service_apply_legal_age_assurance_result/);
  assert.match(identityWebhook,/sha256Hex\(reference\)/);
  assert.match(identityWebhook,/evidenceReferenceHashes/);
  assert.match(identityWebhook,/`sha256:\$\{await sha256Hex\(v\)\}`/);
  assert.match(ageAssuranceEvidencePrivacy,/privacy_minimized_external_age_assurance/);
  assert.match(ageAssuranceEvidencePrivacy,/\^sha256:\[0-9a-f\]\{64\}\$/);
  assert.match(ageAssuranceEvidencePrivacy,/before insert on public\.legal_age_assurance_events/);
  assert.match(legalBlockScreen,/blocked_age_assurance_required/);
  assert.match(legalBlockScreen,/startAgeAssurance/);
});
check('Android MAIN activity is singleTop hardened',()=>{const plugin=read('plugins/withAndroidSingleTop.cjs');assert.match(plugin,/android:launchMode'\]: 'singleTop'|android:launchMode.*singleTop/)});
check('modern Expo splash plugin configured',()=>{assert.match(appConfig,/expo-splash-screen/);assert.doesNotMatch(appConfig,/\n\s*splash:\s*\{/)});

check('moderation provider is exact-host HTTPS allowlisted, timeout bounded and malformed verdicts are deferred',()=>{
  const outbound=read('supabase/functions/_shared/outboundUrl.ts');
  assert.match(moderation,/requireAllowlistedHttpsUrl/);
  assert.match(moderation,/MODERATION_ALLOWED_HOSTS_JSON/);
  assert.match(outbound,/parsed\.protocol!==['"]https:['"]/);
  assert.match(outbound,/parsed\.port&&parsed\.port!==['"]443['"]/);
  assert.match(outbound,/isUnsafeLiteralOrLocalHost/);
  assert.match(outbound,/allowed\.has\(host\)/);
  assert.match(moderation,/PROVIDER_TIMEOUT_MS[\s\S]*provider_timeout/);
  assert.match(moderation,/parseProviderVerdict[\s\S]*typeof verdict\.approved!=='boolean'[\s\S]*policy_version!==MODERATION_POLICY\.policy_version[\s\S]*prohibited_categories\.every/);
  assert.match(moderation,/if\(!parsedVerdict\)[\s\S]*provider_policy_contract_missing/);
});
check('pet text moderation covers prompts tags and location text',()=>{
  assert.match(moderation,/pet_prompts[\s\S]*prompt_key,answer/);
  assert.match(moderation,/temperament_tags/);
  assert.match(moderation,/city,district,neighborhood/);
});
check('event text moderation covers location text',()=>{
  assert.match(moderation,/pet_events[\s\S]*title,description,city,district,neighborhood/);
});
check('moderation parent refresh and target updates fail closed on database errors',()=>{
  assert.match(moderation,/photosResult\.error[\s\S]*throw photosResult\.error/);
  assert.match(moderation,/textReviewResult\.error[\s\S]*throw textReviewResult\.error/);
  assert.match(moderation,/targetUpdateError[\s\S]*throw targetUpdateError/);
});

check('meetup text moderation covers place and note',()=>{
  assert.match(moderation,/target_type === 'meetup_text'[\s\S]*public_place_label,note[\s\S]*updateTable = 'meetup_requests'/);
});
check('meetup safety reports are exposed through the client API',()=>{
  const meetupScreen=read('src/screens/MeetupsScreen.tsx');
  assert.match(apiClient,/targetType:'pet'\|'post'\|'comment'\|'message'\|'story'\|'event'\|'meetup'/);
  assert.match(meetupScreen,/reportContent\(ownPet\.id,'meetup',request\.id,'safety_concern'/);
});

check('moderation retry state is explicit and fails closed if persistence fails',()=>{
  assert.match(moderation,/const retryState = \{[\s\S]*status: 'pending'[\s\S]*manual_review_required: manualReviewRequired/);
  assert.match(moderation,/moderation_retry_state_write_failed/);
  assert.doesNotMatch(moderation,/moderation_retry_metadata_unavailable|legacy schemas|legacy fallback/i);
});

check('identity webhook is timestamp-HMAC protected and delegates to atomic verification RPC',()=>{
  const identityWebhook=read('supabase/functions/identity-verification-webhook/index.ts');
  assert.match(identityWebhook,/X-Tailmance-Timestamp/);
  assert.match(identityWebhook,/X-Tailmance-Signature/);
  assert.match(identityWebhook,/Math\.abs\(Date\.now\(\)\/1000-signedAt\)>300/);
  assert.match(identityWebhook,/hmacHex\(secret,`\$\{timestamp\}\.\$\{raw\}`\)/);
  assert.match(identityWebhook,/apply_owner_verification_result/);
  assert.doesNotMatch(identityWebhook,/from\('users'\)\.update/);
});
check('owner identity verification provider is exact-host HTTPS-only, POST-only and timeout bounded',()=>{
  const startVerification=read('supabase/functions/start-owner-verification/index.ts');
  const outbound=read('supabase/functions/_shared/outboundUrl.ts');
  assert.match(startVerification,/req\.method !== 'POST'/);
  assert.match(startVerification,/requireAllowlistedHttpsUrl/);
  assert.match(startVerification,/IDENTITY_PROVIDER_ALLOWED_HOSTS_JSON/);
  assert.match(outbound,/parsed\.protocol!==['"]https:['"]/);
  assert.match(outbound,/parsed\.port&&parsed\.port!==['"]443['"]/);
  assert.match(startVerification,/fetchWithTimeout[\s\S]*PROVIDER_TIMEOUT_MS/);
  assert.match(startVerification,/readResponseJsonBounded[\s\S]*64_000/);
  assert.match(startVerification,/verificationUrl=requireAllowlistedHttpsUrl/);
});
check('reports admin delegates status transition to atomic audited RPC',()=>{
  assert.match(reportsAdmin,/admin_update_report_status/);
  assert.doesNotMatch(reportsAdmin,/from\('audit_events'\)\.insert/);
});

check('subscription sync is user-scoped rate-limited and RevenueCat calls are bounded',()=>{
  const syncSubscription=read('supabase/functions/sync-subscription/index.ts');
  assert.match(syncSubscription,/service_rate_limit_user[\s\S]*subscription_sync[\s\S]*p_limit:30/);
  assert.match(syncSubscription,/REVENUECAT_TIMEOUT_MS[\s\S]*fetchWithTimeout/);
  assert.match(syncSubscription,/readResponseJsonBounded[\s\S]*REVENUECAT_MAX_RESPONSE_BYTES/);
  assert.match(syncSubscription,/REVENUECAT_ENTITLEMENT_ID[\s\S]*configuration missing/);
});
check('RevenueCat webhook uses claim-bound atomic billing apply and bounded REST calls',()=>{
  const revenuecatWebhook=read('supabase/functions/revenuecat-webhook/index.ts');
  assert.match(revenuecatWebhook,/REVENUECAT_TIMEOUT_MS[\s\S]*fetchWithTimeout/);
  assert.match(revenuecatWebhook,/claim_billing_webhook_event[\s\S]*billing_ledger_unavailable/);
  assert.match(revenuecatWebhook,/claim\?\.claimed!==true[\s\S]*duplicate:true/);
  assert.match(revenuecatWebhook,/apply_billing_webhook_event[\s\S]*p_claim_token:claimToken[\s\S]*p_user_states:states/);
  assert.match(revenuecatWebhook,/apply_consumable_billing_webhook_event_ordered[\s\S]*p_claim_token:claimToken[\s\S]*p_credit_kind:consumableLifecycle\.kind/);
  assert.match(revenuecatWebhook,/consumable_transaction_id_missing[\s\S]*p_store_transaction_id:consumableTransactionId[\s\S]*p_provider_app_id:eventAppId[\s\S]*p_provider_environment:eventEnvironment/);
  assert.match(revenuecatWebhook,/allCandidateUsers=candidateUsers\(event\)\.slice\(0,20\)[\s\S]*from\('users'\)\.select\('id'\)\.in\('id',allCandidateUsers\)[\s\S]*billing_user_resolution_failed/);
  assert.match(revenuecatWebhook,/directConsumableUser=uuid\.test\(directId\)&&allUsers\.includes\(directId\)\?directId:null/);
  const consumableTxnSql=read('supabase/migrations/152_consumable_store_transaction_idempotency.sql');
  assert.match(consumableTxnSql,/unique index[\s\S]*provider_app_id,provider_environment,store_transaction_id/);
  assert.match(consumableTxnSql,/on conflict do nothing[\s\S]*get diagnostics v_inserted=row_count/);
  assert.match(consumableTxnSql,/drop function if exists public\.apply_consumable_billing_webhook_event\(text,uuid,uuid,text,text,integer,text\)/);
  assert.match(consumableTxnSql,/revoke all on function public\.apply_consumable_billing_webhook_event\(text,uuid,uuid,text,text,integer,text,text,text\) from public,anon,authenticated/);
  const consumableRefundSql=read('supabase/migrations/154_consumable_refund_and_reversal_accounting.sql');
  assert.match(consumableRefundSql,/consumable_store_transaction_state[\s\S]*state in \('active','refunded'\)/);
  assert.match(consumableRefundSql,/boost_credit_debt[\s\S]*super_like_credit_debt/);
  assert.match(consumableRefundSql,/apply_consumable_refund_billing_webhook_event[\s\S]*availableCreditsRemoved[\s\S]*refundDebtAdded/);
  assert.match(consumableRefundSql,/apply_consumable_refund_reversal_billing_webhook_event[\s\S]*debtOffset/);
  const consumableOrderingSql=read('supabase/migrations/155_consumable_provider_event_ordering.sql');
  assert.match(consumableOrderingSql,/last_provider_event_timestamp_ms[\s\S]*last_provider_event_rank[\s\S]*last_provider_event_id/);
  assert.match(consumableOrderingSql,/apply_consumable_billing_webhook_event_ordered[\s\S]*p_event_timestamp_ms bigint/);
  assert.match(consumableOrderingSql,/p_event_timestamp_ms<v_state\.last_provider_event_timestamp_ms/);
  assert.match(consumableOrderingSql,/apply_consumable_refund_billing_webhook_event_ordered/);
  assert.match(consumableOrderingSql,/apply_consumable_refund_reversal_billing_webhook_event_ordered/);
  assert.match(revenuecatWebhook,/event_timestamp_ms[\s\S]*consumable_event_timestamp_invalid/);
  assert.match(revenuecatWebhook,/p_event_timestamp_ms:consumableEventTimestampMs/);
  assert.match(revenuecatWebhook,/CANCELLATION[\s\S]*REFUND_REVERSED[\s\S]*apply_consumable_refund_billing_webhook_event[\s\S]*apply_consumable_refund_reversal_billing_webhook_event/);
  assert.match(revenuecatWebhook,/applied!==true[\s\S]*staleClaim:true/);
  assert.doesNotMatch(revenuecatWebhook,/\.from\('users'\)\.update\(/,'Webhook must not update user tier outside the claim-bound DB transaction');
  assert.doesNotMatch(revenuecatWebhook,/\.from\('subscriptions'\)\.upsert\(/,'Webhook must not update subscriptions outside the claim-bound DB transaction');
  assert.doesNotMatch(revenuecatWebhook,/finish_billing_webhook_event[\s\S]*p_status:'processed'/,'Processed finalization must be part of the claim-bound apply transaction');
  assert.match(revenuecatWebhook,/finish_billing_webhook_event[\s\S]*p_status:'failed'[\s\S]*p_last_error:failureCode/);
});

check('RevenueCat consumables are claim-bound, idempotent and atomically finalized',()=>{
  const sql=read('supabase/migrations/094_consumable_billing_claim_bound_atomic_apply.sql');
  assert.match(sql,/select \* into v_row from public\.billing_webhook_events[\s\S]*for update/);
  assert.match(sql,/claim_token is distinct from p_claim_token/);
  assert.match(sql,/consumable_credit_ledger[\s\S]*on conflict\(event_key\) do nothing/);
  assert.match(sql,/consumable_balances[\s\S]*boost_credits[\s\S]*super_like_credits/);
  assert.match(sql,/update public\.billing_webhook_events[\s\S]*status='processed'[\s\S]*claim_token=p_claim_token/);
  assert.match(sql,/auth\.role\(\)<>'service_role'/);
});

check('RevenueCat webhook claim finish and business side effects are token bound and concurrency safe',()=>{
  const sql=read('supabase/migrations/027_billing_webhook_atomic_claim.sql');
  const applySql=read('supabase/migrations/030_billing_webhook_claim_bound_apply.sql');
  assert.match(sql,/claim_token uuid/);
  assert.match(sql,/claimed_at timestamptz/);
  assert.match(sql,/select \* into v_row from public\.billing_webhook_events where event_id=p_event_id for update/);
  assert.match(sql,/v_row\.status='processing'[\s\S]*interval '10 minutes'/);
  assert.match(sql,/where event_id=p_event_id and status='processing' and claim_token=p_claim_token/);
  assert.match(sql,/auth\.role\(\)<>'service_role'/);
  assert.match(sql,/revoke all on function public\.claim_billing_webhook_event/);
  assert.match(sql,/revoke all on function public\.finish_billing_webhook_event/);
  assert.match(applySql,/select \* into v_row[\s\S]*billing_webhook_events[\s\S]*for update/);
  assert.match(applySql,/v_row\.claim_token is distinct from p_claim_token[\s\S]*return false/);
  assert.match(applySql,/update public\.users[\s\S]*set tier=/);
  assert.match(applySql,/insert into public\.subscriptions[\s\S]*on conflict\(raw_event_id\) do update/);
  assert.match(applySql,/update public\.billing_webhook_events[\s\S]*status='processed'[\s\S]*claim_token=p_claim_token/);
  assert.match(applySql,/revoke all on function public\.apply_billing_webhook_event/);
  assert.match(applySql,/grant execute on function public\.apply_billing_webhook_event[\s\S]*service_role/);
});

check('v19 legal acceptance is authenticated, verified by email or phone, immutable-bundle pinned and country/locale fail-closed',()=>{
  const body=readFileSync('supabase/functions/accept-legal/index.ts','utf8');
  const architecture=readFileSync('supabase/migrations/054_v19_legal_country_bundle_architecture.sql','utf8');
  const enforcement=readFileSync('supabase/migrations/055_v19_legal_country_bundle_enforcement.sql','utf8');
  assert.match(body,/authenticatedUser\(req\)/);
  assert.match(body,/email_confirmed_at[\s\S]*phone_confirmed_at[\s\S]*identity_verification_required/);
  assert.match(body,/bundleId[\s\S]*applicabilityMatrixId[\s\S]*acceptancePresentationSha256[\s\S]*accept_current_legal_bundle/);
  assert.match(body,/p_user_id:user\.id[\s\S]*p_bundle_id:bundleId[\s\S]*p_ui_locale:uiLocale[\s\S]*p_expected_applicability_matrix_id:applicabilityMatrixId[\s\S]*p_expected_presentation_sha256:acceptancePresentationSha256/);
  assert.match(body,/age18Confirmed!==true/);
  assert.doesNotMatch(body,/TAILMANCE_LEGAL_VERSION|TAILMANCE_TERMS_VERSION|TAILMANCE_PRIVACY_NOTICE_VERSION/,'Client/Edge environment versions must not substitute for the immutable country bundle');
  assert.match(architecture,/create table if not exists public\.legal_country_runtime/);
  assert.match(architecture,/create table if not exists public\.legal_document_bundles/);
  assert.match(enforcement,/legal_country_unresolved[\s\S]*subnational_review_required[\s\S]*legal_bundle_not_current_for_context/);
  assert.match(enforcement,/verified_session_immutable_bundle/);
  assert.doesNotMatch(body,/\.from\('users'\)\.update\(/,'Legal acceptance must not bypass the atomic server RPC with a direct users update');
  assert.match(body,/source_evidence_reference[\s\S]*localization_evidence_reference/);
  assert.doesNotMatch(body,/bundle\.counsel_evidence_reference/,'External counsel evidence must remain optional for configured-market source acceptance');
});

check('v19 jurisdiction policy and age-assurance evidence tables are service-only, RLS-protected, and age evidence is append-only',()=>{
  const jurisdiction=readFileSync('supabase/migrations/057_v19_jurisdiction_runtime_policy_and_age_assurance.sql','utf8');
  for(const table of ['legal_jurisdiction_policies','legal_age_assurance_events']){
    assert.match(jurisdiction,new RegExp(`alter table public\.${table} enable row level security`,'i'),`${table}: RLS missing`);
    assert.match(jurisdiction,new RegExp(`revoke all on table public\.${table} from public,anon,authenticated`,'i'),`${table}: direct privileges not revoked`);
  }
  assert.match(jurisdiction,/grant select,insert,update on table public\.legal_jurisdiction_policies to service_role/i);
  assert.match(jurisdiction,/grant select,insert on table public\.legal_age_assurance_events to service_role/i);
  assert.match(jurisdiction,/trg_legal_age_assurance_events_append_only[\s\S]*before update or delete on public\.legal_age_assurance_events/i);
  assert.match(jurisdiction,/provider_reference_sha256[\s\S]*evidence_reference[\s\S]*verified_at[\s\S]*expires_at/i);
  assert.doesNotMatch(jurisdiction,/create policy[\s\S]{0,200}legal_age_assurance_events/i,'No authenticated/anon row policy may expose age-assurance evidence');
});

check('v19 legal country and document-bundle tables have explicit RLS privilege and immutability coverage',()=>{
  const architecture=readFileSync('supabase/migrations/054_v19_legal_country_bundle_architecture.sql','utf8');
  const enforcement=readFileSync('supabase/migrations/055_v19_legal_country_bundle_enforcement.sql','utf8');
  const integrity=readFileSync('supabase/migrations/056_v19_legal_bundle_release_integrity.sql','utf8');
  for(const table of ['legal_country_runtime','legal_document_bundles','legal_document_bundle_routes']){
    assert.match(architecture,new RegExp(`alter table public\.${table} enable row level security`,'i'),`${table}: RLS missing`);
    assert.match(architecture,new RegExp(`revoke all on table public\.${table} from public,anon,authenticated`,'i'),`${table}: direct privileges not revoked`);
  }
  assert.match(architecture,/prevent_immutable_legal_bundle_mutation[\s\S]*before update or delete on public\.legal_document_bundles/);
  assert.match(architecture,/service_set_legal_country_runtime[\s\S]*auth\.role\(\)<>'service_role'[\s\S]*country_mismatch_review_required/);
  assert.match(enforcement,/prevent_append_only_legal_event_update/);
  for(const table of ['legal_acceptances','privacy_notice_acknowledgements','marketing_consent_events'])assert.match(enforcement,new RegExp(`before update or delete on public\.${table}`,'i'));
  assert.match(integrity,/legal_bundle_official_source_evidence_required/);
  assert.match(integrity,/legal_bundle_counsel_evidence_required/);
  assert.match(integrity,/legal_bundle_professional_localization_evidence_required/);
  assert.match(integrity,/country_mismatch_reviewed is distinct from true/);
  assert.match(integrity,/current_session_satisfies_mfa_if_enrolled/);
  assert.match(integrity,/email_confirmed_at is not null/);
  assert.match(integrity,/revoke all on table public\.legal_document_bundles,public\.legal_document_bundle_routes,public\.legal_country_runtime from public,anon,authenticated/);
});

check('v19 legal evidence is append-only and exact current bundle is required by product access',()=>{
  const base=readFileSync('supabase/migrations/025_current_legal_consent_and_product_access.sql','utf8');
  const legacy=readFileSync('supabase/migrations/050_v19_legal_consent_evidence.sql','utf8');
  const sql=readFileSync('supabase/migrations/055_v19_legal_country_bundle_enforcement.sql','utf8');
  assert.match(base,/create table if not exists public\.legal_acceptances/);
  assert.match(legacy,/create table if not exists public\.privacy_notice_acknowledgements/);
  assert.match(legacy,/create table if not exists public\.marketing_consent_events/);
  assert.match(sql,/drop constraint if exists legal_acceptances_pkey/);
  assert.match(sql,/insert into public\.legal_acceptances[\s\S]*bundle_id[\s\S]*verified_session_immutable_bundle/);
  assert.doesNotMatch(sql,/insert into public\.legal_acceptances[\s\S]{0,900}on conflict\(user_id,legal_version\)/i);
  assert.match(sql,/legacy_legal_bundle_signature_disabled/);
  assert.match(sql,/resolve_current_legal_bundle_id[\s\S]*legal_acceptances[\s\S]*privacy_notice_acknowledgements/);
  assert.match(sql,/set_marketing_push_consent[\s\S]*bundle_id[\s\S]*consent_text_sha256[\s\S]*marketing_product_updates/);
  assert.match(base,/drop function if exists public\.owns_pet\(uuid,uuid\)/);
});


check('comment moderation and recipient notification are finalized atomically',()=>{
  const sql=readFileSync('supabase/migrations/026_comment_moderation_notification_atomicity.sql','utf8');
  const worker=readFileSync('supabase/functions/moderate-media/index.ts','utf8');
  const admin=readFileSync('supabase/functions/moderation-admin/index.ts','utf8');
  assert.match(sql,/create or replace function public\.create_comment[\s\S]*moderation_status\)[\s\S]*'pending'[\s\S]*moderation_items/);
  const createComment=sql.match(/create or replace function public\.create_comment[\s\S]*?grant execute on function public\.create_comment\(uuid,uuid,text\) to authenticated;/)?.[0]??'';
  assert.doesNotMatch(createComment,/insert into public\.notifications/,'Pending comments must not notify recipients');
  assert.match(sql,/create or replace function public\.finalize_comment_moderation/);
  assert.match(sql,/p_status='approved'[\s\S]*insert into public\.notifications[\s\S]*format\('comment:%s',v_comment\.id\)/);
  assert.match(sql,/actor_pet_id/);
  assert.match(sql,/auth\.role\(\)<>'service_role'/);
  assert.match(worker,/item\.target_type==='comment_text'[\s\S]*finalize_comment_moderation/);
  assert.match(admin,/targetType==='comment_text'[\s\S]*finalize_comment_moderation/);
});

check('push delivery revalidates social/comment relationship and current product access fail closed',()=>{
  const push=readFileSync('supabase/functions/push-dispatch/index.ts','utf8');
  for(const type of ['message','match','like','follow','comment']) assert.match(push,new RegExp(`['\"]${type}['\"]`),`push dispatcher must retain ${type} notification localization`);
  assert.match(push,/template_key==='incoming_pet_call'[\s\S]*callerPetName[\s\S]*notifications\.item\.callTitle[\s\S]*notifications\.item\.callBody/,'call notifications must use the localized template contract');
  assert.match(push,/n\.type==='comment'[\s\S]*moderation_status!=='approved'[\s\S]*actor_pet_id[\s\S]*ownerPairBlocked/);
  assert.match(push,/service_product_access_user_ids[\s\S]*productAccessUsers/);
  assert.match(push,/!productAccessUsers\.has\(n\.user_id\)/);
  assert.match(push,/releaseClaimedBatch[\s\S]*notification_user_state_unavailable/);
  assert.match(push,/data: \{ type: n\.type, entityId: n\.entity_id, recipientPetId: n\.recipient_pet_id, notificationId: n\.id, userId: n\.user_id \}/);
});

check('non-queued residual account data is purged before Auth hard delete',()=>{const p=del.indexOf('await purgeResidualOperationalData');const d=del.indexOf('auth.admin.deleteUser');assert.ok(p>=0&&d>p)});
check('moderation admin rejects unsupported target types',()=>{
  const src=readFileSync('supabase/functions/moderation-admin/index.ts','utf8');
  assert.match(src,/ALLOWED_TARGET_TYPES[\s\S]*ALLOWED_HEALTH_SIGNALS[\s\S]*UUID_RE/);
  assert.match(src,/Payload too large[\s\S]*ALLOWED_TARGET_TYPES\.has\(targetType\)[\s\S]*Invalid health signal/);
  assert.match(src,/ALLOWED_TARGET_TYPES[\s\S]*meetup_text[\s\S]*targetType==='meetup_text'[\s\S]*meetup_requests[\s\S]*moderation_status:decision/,'Manual moderation must resolve meetup text queued by the worker');
});

check('production server logs avoid raw identifiers and provider/database messages',()=>{
  const moderation=readFileSync('supabase/functions/moderate-media/index.ts','utf8');
  const revenue=readFileSync('supabase/functions/revenuecat-webhook/index.ts','utf8');
  assert.doesNotMatch(moderation,/console\.error\([^\n]*item\.id/);
  assert.doesNotMatch(moderation,/console\.error\([^\n]*error\.message/);
  assert.match(revenue,/safeFailureCode[\s\S]*last_error:failureCode/);
  assert.doesNotMatch(revenue,/console\.error\([^\n]*failedLedgerError\.message/);
  assert.doesNotMatch(revenue,/json\(\{error:error\.message\}/);
});

check('data export does not expose database error details',()=>{
  const issuer=readFileSync('supabase/functions/export-data/index.ts','utf8');
  const download=readFileSync('supabase/functions/export-download/index.ts','utf8');
  assert.doesNotMatch(issuer,/json\(\{error:error\.message/);
  assert.doesNotMatch(download,/new Response\([^\n]*error\.message/);
  assert.match(download,/if\(error\)throw new Error\(label\)/);
});

check('duplicate-photo fingerprinting must route reuse to manual review',()=>{
  const worker=readFileSync('supabase/functions/moderate-media/index.ts','utf8');
  assert.match(worker,/registerPetPhotoFingerprint[\s\S]*manual_review_required:true[\s\S]*duplicate_photo_hash/);
});


check('paused accounts cannot receive push and admin suspension stays distinct',()=>{
  const push=readFileSync('supabase/functions/push-dispatch/index.ts','utf8');
  const accountState=readFileSync('src/contexts/AccountStateContext.tsx','utf8');
  assert.match(push,/paused_at[\s\S]*suspended_at[\s\S]*pausedUsers[\s\S]*suspendedUsers[\s\S]*updateNotificationState\(supabase,n\.id,\{push_status:'skipped'\}\)[\s\S]*skippedByPause[\s\S]*skippedBySuspension/);
  assert.match(accountState,/mutationEpoch=useRef\(0\)/);
  assert.match(accountState,/pauseQueue=useRef<Promise<void>>\(Promise\.resolve\(\)\)/);
  assert.match(accountState,/const mutation=\+\+mutationEpoch\.current/);
  assert.match(accountState,/refreshEpoch\.current\+\+/);
  assert.match(accountState,/pauseQueue\.current\.catch\(\(\)=>undefined\)\.then\(async\(\)=>\{if\(!mountedRef\.current\|\|userIdRef\.current!==subject\)return;result=await updateAccountPaused\(paused\)\}\)/);
  assert.match(accountState,/userIdRef\.current!==subject\|\|mutation!==mutationEpoch\.current\|\|!result/);
  assert.match(accountState,/paused:result!\.paused/);
  assert.doesNotMatch(accountState,/suspended_at|suspension/,'User pause controls must never manipulate administrative suspension');
});


check('shared outbound HTTP helper enforces true streamed body caps and timeouts',()=>{
  assert.match(httpShared,/readStreamBounded[\s\S]*total > maxBytes[\s\S]*BodyTooLargeError/);
  assert.match(httpShared,/fetchWithTimeout[\s\S]*AbortController[\s\S]*setTimeout/);
  assert.match(httpShared,/readRequestJsonBounded[\s\S]*readRequestTextBounded/);
  assert.match(httpShared,/readResponseJsonBounded[\s\S]*readResponseTextBounded/);
});
check('public account deletion challenge is fail closed, origin/action-bound and bounded',()=>{
  const client=read('web/delete-account.js');
  assert.match(webDelete,/TURNSTILE_SECRET_KEY[\s\S]*if\(!secret\)return false/);
  assert.match(webDelete,/TURNSTILE_EXPECTED_HOSTNAME[\s\S]*TURNSTILE_EXPECTED_ACTION/);
  assert.match(webDelete,/hostname[\s\S]*expectedHostname[\s\S]*action[\s\S]*expectedAction/);
  assert.match(client,/action:'account_deletion'/);
  assert.ok(client.includes("siteKeyReady=/^[A-Za-z0-9_-]{10,200}$/.test(siteKey)"));
  assert.ok(client.includes("url.protocol!=='https:'"));
  assert.ok(client.includes("url.username||url.password"));
  assert.ok(client.includes("host==='localhost'"));
  assert.ok(client.includes("if(!endpoint||!siteKeyReady)"));
  assert.ok(client.includes("if(!turnstileToken)"));
  assert.match(webDelete,/fetchWithTimeout[\s\S]*siteverify[\s\S]*8000/);
  assert.match(webDelete,/readResponseJsonBounded[\s\S]*32_000/);
  assert.match(webDelete,/readRequestJsonBounded[\s\S]*16_000/);
});
check('health verification trust rejects future-dated authority and invalid expiry',()=>{
  const sql=read('supabase/migrations/143_health_verification_temporal_authority.sql');
  const m201=read('supabase/migrations/205_health_document_check_without_veterinarian_signals.sql');
  assert.match(sql,/new\.verified_at>now\(\)\+interval '5 minutes'/);
  assert.match(m201,/v_verified_at>v_now\+interval '5 minutes'/);
  assert.match(m201,/v_expires_at<=coalesce\(v_verified_at,v_now\)/);
  assert.match(m201,/create or replace function public\.has_current_vaccination_check[\s\S]*a\.verified_at<=now\(\)[\s\S]*a\.expires_at is null or a\.expires_at>now\(\)/);
});
check('HMAC webhook secrets fail closed below production strength',()=>{
  const identity=read('supabase/functions/identity-verification-webhook/index.ts');
  const releaseGate=read('scripts/server-release-config-check.mjs');
  assert.match(identity,/IDENTITY_WEBHOOK_SECRET['"]\);if\(!secret\|\|secret\.length<32\)/);
  assert.match(releaseGate,/\['IDENTITY_WEBHOOK_SECRET'\][\s\S]*length<32/);
  assert.equal(existsSync('supabase/functions/health-verification-webhook'),false,'the clinic/provider health webhook no longer exists');
});
check('server production gate covers every Edge runtime environment variable',()=>{
  const releaseGate=read('scripts/server-release-config-check.mjs');
  const edgeSources=globSync('supabase/functions/**/*.ts').map(read).join('\n');
  const envNames=[...edgeSources.matchAll(/Deno\.env\.get\(['"]([A-Z][A-Z0-9_]+)['"]\)/g)].map(match=>match[1]);
  const missing=[...new Set(envNames)].filter(name=>!releaseGate.includes(`'${name}'`)&&!releaseGate.includes(`"${name}"`));
  assert.deepEqual(missing,[],`Edge env values missing from production release validation: ${missing.join(', ')}`);
});
check('unused durable mutation identities are cleared before stale-context preflight aborts',()=>{
  const files=['src/screens/DiscoverScreen.tsx','src/screens/ChatScreen.tsx','src/screens/EventsScreen.tsx','src/screens/FeedScreen.tsx','src/screens/MeetupsScreen.tsx','src/screens/LostPetAlertsScreen.tsx'];
  for(const file of files){
    const source=read(file);
    const allocations=[...source.matchAll(/const operation=await getOrCreateDurableClientOperation\([^;]+;/g)];
    for(const match of allocations){
      const tail=source.slice((match.index??0)+match[0].length,(match.index??0)+match[0].length+260);
      const staleReturn=tail.match(/^if\([^;{}]+\)\{?([^}]{0,180})return/);
      if(staleReturn)assert.match(staleReturn[0],/clearDurableClientOperation\(operation\.key,operation\.id\)/,`${file} abandons an operation id before the server call without clearing it`);
    }
  }
});
check('generated frozen web runtime config remains accepted by release structure validation',()=>{
  const generator=read('scripts/generate-web-runtime-config.mjs');
  const structure=read('scripts/release-structure-check.mjs');
  assert.ok(generator.includes('TAILMANCE_WEB_CONFIG = Object.freeze('));
  assert.ok(structure.includes('(?:Object\\.freeze\\s*\\()?'));
});
check('Expo push dispatch and receipt provider bodies are bounded and errors sanitized',()=>{
  assert.match(push,/fetchWithTimeout[\s\S]*EXPO_PUSH_TIMEOUT_MS/);
  assert.match(push,/readResponseJsonBounded[\s\S]*EXPO_PUSH_MAX_RESPONSE_BYTES/);
  assert.doesNotMatch(push,/throw new Error\(JSON\.stringify\(result\)\)/);
  assert.match(receipts,/readResponseJsonBounded[\s\S]*EXPO_MAX_RESPONSE_BYTES/);
  assert.match(receipts,/push_receipt_queue_unavailable/);
  assert.doesNotMatch(receipts,/json\(\{error:error\.message\}/);
});
check('RevenueCat webhook request and reconciliation responses are bounded and entitlement is fail closed',()=>{
  assert.match(webhook,/readRequestTextBounded\(req,1_000_000\)/);
  assert.match(webhook,/readResponseJsonBounded[\s\S]*REVENUECAT_MAX_RESPONSE_BYTES/);
  assert.match(webhook,/REVENUECAT_ENTITLEMENT_ID[\s\S]*revenuecat_entitlement_not_configured/);
  assert.doesNotMatch(webhook,/REVENUECAT_ENTITLEMENT_ID'\)\?\?'premium'/);
});
check('external deletion retry state stores safe codes and checks update failures',()=>{
  assert.match(externalDeletionWorker,/failureCode[\s\S]*last_error:failureCode/);
  assert.match(externalDeletionWorker,/retryUpdateError[\s\S]*external_deletion_retry_state_write_failed/);
  assert.doesNotMatch(externalDeletionWorker,/last_error:error instanceof Error\?error\.message/);
});
check('moderation provider outbound SSRF boundary and verdict body are bounded',()=>{
  const outbound=read('supabase/functions/_shared/outboundUrl.ts');
  assert.match(moderation,/providerEndpoint[\s\S]*requireAllowlistedHttpsUrl/);
  assert.match(outbound,/localhost/);
  assert.match(outbound,/literal IPs/);
  assert.match(outbound,/parsed\.username\|\|parsed\.password/);
  assert.match(moderation,/readResponseJsonBounded<unknown>\(response, 128_000\)/);
});


check('identity webhook body is bounded and database errors are not reflected',()=>{
  const src=read('supabase/functions/identity-verification-webhook/index.ts');
  assert.match(src,/readRequestTextBounded\(req,MAX_WEBHOOK_BYTES\)/);
  assert.match(src,/MAX_WEBHOOK_BYTES\s*=\s*128_000/);
  assert.match(src,/^[\s\S]*X-Tailmance-Timestamp[\s\S]*X-Tailmance-Signature[\s\S]*apply_owner_verification_result/);
  assert.doesNotMatch(src,/json\(\{error:e instanceof Error\?e\.message/);
  assert.match(src,/webhook_processing_failed/);
});
check('admin and authenticated mutation bodies are bounded and raw DB errors are hidden',()=>{
  const legal=read('supabase/functions/accept-legal/index.ts');
  const pushTokens=read('supabase/functions/push-token-lifecycle/index.ts');
  assert.match(moderationAdmin,/readRequestJsonBounded<any>\(req,MAX_ADMIN_BODY_BYTES\)/);
  assert.match(moderationAdmin,/rawReason\.length>MAX_REASON_LENGTH/);
  assert.doesNotMatch(moderationAdmin,/reason\.trim\(\)\.slice\(/);
  assert.match(moderationAdmin,/assertDbOk\(itemError,'moderation_item_write_failed'\)/);
  assert.doesNotMatch(moderationAdmin,/json\(\{error:[a-zA-Z]+Err\.message\}/);
  assert.match(reportsAdmin,/readRequestJsonBounded<any>\(req, 16_384\)/);
  assert.match(reportsAdmin,/report_list_failed[\s\S]*report_update_failed/);
  assert.doesNotMatch(reportsAdmin,/json\(\{ error: error\.message \}/);
  assert.match(legal,/readRequestJsonBounded<any>\(req,8_192\)/);
  assert.match(legal,/legal_acceptance_failed/);
  assert.match(pushTokens,/readRequestJsonBounded<any>\(req,8_192\)/);
  assert.match(pushTokens,/push_token_cleanup_failed/);
});
check('worker queues persist safe error codes and outbound RevenueCat deletes use shared timeout helper',()=>{
  assert.match(storageGc,/last_error:'storage_gc_operation_failed'/);
  assert.match(storageGc,/storage_gc_queue_unavailable/);
  assert.doesNotMatch(storageGc,/last_error:e instanceof Error\?e\.message/);
  assert.doesNotMatch(storageGc,/json\(\{error:error\.message\}/);
  assert.match(del,/fetchWithTimeout[\s\S]*api\.revenuecat\.com\/v1\/subscribers/);
  assert.match(externalDeletionWorker,/fetchWithTimeout[\s\S]*api\.revenuecat\.com\/v1\/subscribers/);
  assert.doesNotMatch(del,/AbortSignal\.timeout/);
  assert.doesNotMatch(externalDeletionWorker,/AbortSignal\.timeout/);
});


check('release migration gate validates the recovered canonical hardening chain',()=>{
  const pkg=JSON.parse(read('package.json'));
  const structure=read('scripts/release-structure-check.mjs');
  assert.equal(pkg.scripts['release:migrations'],'node scripts/migration-release-check.mjs');
  assert.match(structure,/import '\.\/migration-release-check\.mjs'/);
  const result=spawnSync(process.execPath,['scripts/migration-release-check.mjs'],{encoding:'utf8'});
  assert.equal(result.status,0,`Canonical migrations must pass release gate: ${result.stderr}`);
  assert.match(result.stdout,/canonical migrations 001-\d{3} contiguous/);
  const pending=read('supabase/patches/PENDING_CANONICAL_SECURITY_HARDENING.sql')
    .replace(/\/\*[\s\S]*?\*\//g,'')
    .replace(/^\s*--.*$/gm,'')
    .trim();
  assert.equal(pending,'','Pending hardening file must remain comment-only');
});
check('internal SECURITY DEFINER helpers are not directly executable by app roles',()=>{
  assert.match(pendingPatch,/revoke all on function public\.pet_json\(uuid,uuid\) from public,anon,authenticated/);
  assert.match(pendingPatch,/revoke all on function public\.rate_limit\(text,integer,integer\) from public,anon,authenticated/);
  assert.match(pendingPatch,/revoke all on function public\.haversine_km\(double precision,double precision,double precision,double precision\) from public,anon,authenticated/);
  assert.match(pendingPatch,/revoke all on function public\.normalize_search_text\(text\) from public,anon,authenticated/);
});


check('upload client verifies actual payload size even when picker metadata is absent',()=>{
  assert.match(uploadsClient,/response\.headers\.get\('content-length'\)[\s\S]*declaredLength>maxBytes/);
  assert.match(uploadsClient,/const blob = await response\.blob\(\)[\s\S]*blob\.size>maxBytes/);
  assert.match(uploadsClient,/HEALTH_MAX_BYTES = 15 \* 1024 \* 1024/);
  assert.match(uploadsClient,/IMAGE_MAX_BYTES = 10 \* 1024 \* 1024/);
  assert.match(uploadsClient,/safeMax=Math\.min\(5,Math\.max\(1,Math\.trunc\(max\)\|\|1\)\)/);
});


check('push worker claims queue rows atomically and checks every critical state write',()=>{
  assert.match(push,/rpc\('claim_pending_notifications',\{p_limit:100\}\)/);
  assert.match(push,/async function updateNotificationState[\s\S]*notification_state_write_failed/);
  assert.match(push,/scheduleRetry[\s\S]*updateNotificationState/);
  assert.match(push,/push_token_disable_failed/);
  assert.match(push,/receiptWriteError[\s\S]*push_receipt_write_failed/);
  assert.match(push,/safeExpoErrorCode[\s\S]*\{1,80\}/);
});


check('all Edge Function outbound fetches go through the shared timeout helper',()=>{
  const files=globSync('supabase/functions/**/*.ts').filter(file=>!file.endsWith('/_shared/http.ts'));
  for(const file of files){
    const src=read(file);
    assert.doesNotMatch(src,/\bfetch\s*\(/,`${file} must use fetchWithTimeout`);
  }
});
check('all parsed Edge Function request bodies use bounded readers',()=>{
  const files=globSync('supabase/functions/**/*.ts');
  for(const file of files){
    const src=read(file);
    assert.doesNotMatch(src,/\b(?:req|request)\.json\s*\(/,`${file} must use readRequestJsonBounded`);
    assert.doesNotMatch(src,/\b(?:req|request)\.text\s*\(/,`${file} must use readRequestTextBounded`);
  }
});
check('shared bounded reader cancels oversized streams',()=>{
  assert.match(httpShared,/total > maxBytes[\s\S]*reader\.cancel\('body_too_large'\)[\s\S]*BodyTooLargeError/);
});
check('external deletion timeout classification matches AbortController behavior',()=>{
  assert.match(externalDeletionWorker,/error instanceof DOMException&&error\.name==='AbortError'\?'revenuecat_timeout'/);
  assert.doesNotMatch(externalDeletionWorker,/TimeoutError/);
});
check('public deletion returns 413 for oversized request bodies',()=>{
  assert.match(webDelete,/body_too_large[\s\S]*payload_too_large[\s\S]*tooLarge\?413:400/);
});
check('subscription sync hides upstream RevenueCat status details',()=>{
  assert.match(syncSubscription,/revenuecat_upstream_error/);
  assert.doesNotMatch(syncSubscription,/RevenueCat status \$\{response\.status\}/);
  assert.match(syncSubscription,/fetchWithTimeout[\s\S]*REVENUECAT_TIMEOUT_MS/);
});

check('RevenueCat client entitlement id is explicit and purchase configuration fails closed',()=>{
  const config=read('src/services/config.ts');
  const releaseConfig=read('scripts/release-config-check.mjs');
  assert.doesNotMatch(config,/REVENUECAT_ENTITLEMENT_ID'\) \|\| 'premium'/);
  assert.match(config,/isPlaceholder\(env\.revenueCatEntitlementId\)[\s\S]*isPlaceholder\(env\.revenueCatPremiumPackageId\)/);
  assert.match(releaseConfig,/EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID/);
  assert.match(releaseConfig,/tailmance_premium/);
  assert.match(releaseConfig,/premium_access/);
});


check('moderation worker uses the atomic claim RPC instead of selecting the queue directly',()=>{
  const worker=readFileSync('supabase/functions/moderate-media/index.ts','utf8');
  assert.match(worker,/\.rpc\('claim_moderation_items',\s*\{\s*p_limit:\s*25\s*\}\)/);
  assert.doesNotMatch(worker,/from\('moderation_items'\)\.select\('\*'\)\.eq\('status',\s*'pending'\)/);
  assert.doesNotMatch(worker,/legacy schema|legacy fallback/i);
});


check('destructive background queues are claimed atomically before processing',()=>{
  const gc=readFileSync('supabase/functions/storage-gc/index.ts','utf8');
  const deletion=readFileSync('supabase/functions/external-deletion-worker/index.ts','utf8');
  assert.match(gc,/\.rpc\('claim_storage_gc_items',\{p_limit:100\}\)/);
  assert.doesNotMatch(gc,/from\('storage_gc_queue'\)\.select\('id,bucket,storage_path,attempts'/);
  assert.match(deletion,/\.rpc\('claim_external_deletion_items',\{p_limit:100\}\)/);
  assert.doesNotMatch(deletion,/from\('external_deletion_queue'\)[\s\S]{0,250}\.select\('provider,external_user_id,attempts'/);
});


check('chat messages are server-moderated before recipient visibility or notification',()=>{
  const sql=read('supabase/migrations/031_chat_message_server_moderation.sql');
  const worker=read('supabase/functions/moderate-media/index.ts');
  const admin=read('supabase/functions/moderation-admin/index.ts');
  const chat=read('src/screens/ChatScreen.tsx');
  const domain=read('src/types/domain.ts');
  assert.match(sql,/alter table public\.messages add column if not exists moderation_status public\.moderation_state/);
  assert.match(sql,/alter table public\.messages alter column moderation_status set default 'pending'/);
  assert.match(sql,/target_type in \([^)]*'message_text'/);
  assert.match(sql,/messages\.moderation_status='approved'[\s\S]*sender\.owner_id=auth\.uid\(\)/);
  assert.match(sql,/insert into public\.messages\(conversation_id,sender_pet_id,body,moderation_status\)[\s\S]*'pending'/);
  assert.match(sql,/insert into public\.moderation_items\(target_type,target_id,status\)[\s\S]*'message_text'/);
  const sendBlock=sql.match(/create or replace function public\.send_message[\s\S]*?grant execute on function public\.send_message\(uuid,uuid,text\) to authenticated;/)?.[0]??'';
  assert.doesNotMatch(sendBlock,/insert into public\.notifications/,'send_message must not notify before moderation approval');
  assert.match(sql,/create or replace function public\.finalize_message_moderation/);
  assert.match(sql,/auth\.role\(\)<>'service_role'/);
  assert.match(sql,/update public\.messages set moderation_status=p_status::public\.moderation_state/);
  assert.match(sql,/p_status='approved'[\s\S]*not public\.is_blocked[\s\S]*insert into public\.notifications/);
  assert.match(sql,/dedupe_key[\s\S]*format\('message:%s',v_msg\.id\)/);
  assert.match(sql,/msg\.read_at is null and msg\.moderation_status='approved'/);
  assert.match(sql,/set read_at=coalesce\(read_at,now\(\)\)[\s\S]*moderation_status='approved'/);
  assert.match(worker,/item\.target_type === 'message_text'[\s\S]*from\('messages'\)\.select\('body'\)/);
  assert.match(worker,/finalize_message_moderation/);
  assert.match(admin,/ALLOWED_TARGET_TYPES[\s\S]*message_text/);
  assert.match(admin,/finalize_message_moderation/);
  assert.match(domain,/Message = \{[^}]*moderationStatus\?: ModerationState/);
  assert.match(chat,/chat\.pendingReview/);
  assert.match(chat,/chat\.rejectedReview/);
});


check('account deletion purges chat moderation rows introduced by server-side message moderation',()=>{
  const deletion=read('supabase/functions/_shared/accountDeletion.ts');
  assert.match(deletion,/messages_read_failed/);
  assert.match(deletion,/messageIds:messages\.map/);
  assert.match(deletion,/\['message_text',targets\.messageIds\]/);
});


check('web account deletion processor requires verified identity and token-bound destructive processing',()=>{
  const sql=read('supabase/migrations/032_web_account_deletion_processing.sql');
  const processor=read('supabase/functions/process-account-deletion-request/index.ts');
  const publicRequest=read('supabase/functions/request-account-deletion/index.ts');
  assert.match(sql,/claim_web_account_deletion_request[\s\S]*p_identity_verified boolean[\s\S]*p_identity_verified is distinct from true/i);
  assert.match(sql,/bind_web_account_deletion_target[\s\S]*p_claim_token uuid[\s\S]*claim_token=p_claim_token/i);
  assert.match(sql,/lookup_auth_user_by_email[\s\S]*u\.email=v_email[\s\S]*lower\(trim\(u\.email\)\)=v_email/i);
  assert.match(sql,/finish_web_account_deletion_request[\s\S]*verification_reference=null[\s\S]*email=null[\s\S]*email_hash=null[\s\S]*ip_hash=null[\s\S]*request_fingerprint=null/i);
  assert.match(processor,/identityVerified\s*!==\s*true/);
  assert.match(processor,/ACCOUNT_DELETION_ADMIN_SECRET/);
  assert.match(processor,/expectedEmail=normalizeEmail\(claim\.email\)[\s\S]*normalizeEmail\(authData\.user\.email\)!==expectedEmail/);
  assert.match(processor,/lookup_auth_user_by_email_hash/);
  assert.match(processor,/bind_web_account_deletion_target/);
  assert.match(processor,/hardDeleteAccount/);
  assert.match(processor,/authUserMissing[\s\S]*status===404[\s\S]*user_not_found/i);
  assert.match(processor,/finish_web_account_deletion_request/);
  assert.match(publicRequest,/error(?:\?\.)?\.code|error\.code/);
  assert.match(publicRequest,/23505[\s\S]*request_received/);
});


check('hard delete minimizes prior web deletion request PII before Auth identity removal',()=>{
  const sql=read('supabase/migrations/041_account_deletion_request_predelete_minimization.sql');
  const engine=read('supabase/functions/_shared/accountDeletion.ts');
  const processor=read('supabase/functions/process-account-deletion-request/index.ts');
  assert.match(sql,/minimize_account_deletion_requests_for_user[\s\S]*target_user_id=p_user_id[\s\S]*email=null[\s\S]*email_hash=null[\s\S]*ip_hash=null[\s\S]*request_fingerprint=null/i);
  assert.match(sql,/v_row\.target_user_id is null and \(v_row\.email_hash is null or v_row\.email is null\)/i);
  assert.match(sql,/revoke all on function public\.minimize_account_deletion_requests_for_user\(uuid,text\) from public,anon,authenticated/i);
  assert.match(engine,/getUserById\(userId\)[\s\S]*normalizedEmailHash[\s\S]*minimize_account_deletion_requests_for_user[\s\S]*auth\.admin\.deleteUser\(userId,false\)/);
  assert.match(processor,/if\(expectedEmail&&normalizeEmail\(authData\.user\.email\)!==expectedEmail\)/);
});

check('durable external deletion recovery finalizes deletion requests before dropping the queue anchor',()=>{
  const sql=read('supabase/migrations/042_account_deletion_postdelete_request_finalization.sql');
  const engine=read('supabase/functions/_shared/accountDeletion.ts');
  const worker=read('supabase/functions/external-deletion-worker/index.ts');
  const processor=read('supabase/functions/process-account-deletion-request/index.ts');
  assert.match(sql,/finalize_account_deletion_requests_for_deleted_user[\s\S]*status=case when status in \('pending','verifying'\) then 'completed'[\s\S]*target_user_id=null[\s\S]*email=null[\s\S]*request_fingerprint=null/i);
  assert.match(sql,/auth\.role\(\)<>'service_role'/i);
  const authDelete=engine.indexOf('auth.admin.deleteUser(userId,false)');
  const requestFinalize=engine.indexOf("finalize_account_deletion_requests_for_deleted_user");
  const queueDelete=engine.lastIndexOf('markRevenueCatDeletionComplete');
  assert.ok(authDelete>=0&&requestFinalize>authDelete&&queueDelete>requestFinalize);
  assert.match(worker,/deleteRevenueCatCustomer\(externalUserId\)[\s\S]*finalize_account_deletion_requests_for_deleted_user[\s\S]*external_deletion_queue/);
  assert.match(processor,/finished!==true[\s\S]*account_deletion_requests[\s\S]*status!=='completed'/);
});

check('resolved web deletion audit rows support counsel-controlled service-only purge',()=>{
  const sql=read('supabase/migrations/033_web_deletion_retention_purge.sql');
  assert.match(sql,/purge_resolved_account_deletion_requests\(p_before timestamptz\)/i);
  assert.match(sql,/auth\.role\(\)<>'service_role'/i);
  assert.match(sql,/status in \('completed','rejected'\)[\s\S]*resolved_at<p_before/i);
  assert.match(sql,/p_before is null or p_before>now\(\)/i);
  assert.match(sql,/revoke all on function public\.purge_resolved_account_deletion_requests\(timestamptz\) from public,anon,authenticated/i);
});


check('upload intents cannot bind nonexistent or mismatched Storage objects',()=>{
  const sql=read('supabase/migrations/036_upload_intent_object_verification.sql');
  assert.match(sql,/from storage\.objects[\s\S]*bucket_id=v_intent\.bucket[\s\S]*name=v_intent\.storage_path/i);
  assert.match(sql,/metadata->>'size'[\s\S]*metadata->>'mimetype'/i);
  assert.match(sql,/invalid_uploaded_object_size/);
  assert.match(sql,/uploaded_object_mime_mismatch/);
  assert.match(sql,/update public\.upload_intents set consumed_at=now\(\) where id=v_intent\.id/i);
  assert.match(sql,/revoke all on function public\.consume_upload_intent\(uuid,text,text,text\) from public,anon,authenticated/i);
});


check('manual subscription sync cannot overwrite newer webhook billing state',()=>{
  const sql=read('supabase/migrations/034_subscription_sync_monotonicity.sql');
  const sync=read('supabase/functions/sync-subscription/index.ts');
  assert.match(sql,/billing_state_versions[\s\S]*last_observed_at timestamptz/i);
  assert.match(sql,/apply_manual_subscription_sync[\s\S]*pg_advisory_xact_lock[\s\S]*v_last>p_observed_at[\s\S]*newer_state_present/i);
  assert.match(sql,/apply_billing_webhook_event[\s\S]*order by x[\s\S]*pg_advisory_xact_lock[\s\S]*billing_state_versions/i);
  assert.match(sql,/status='processed'[\s\S]*processed_at=v_apply_time/i);
  assert.match(sync,/observedAt=new Date\(\)\.toISOString\(\)/);
  assert.match(sync,/\.rpc\('apply_manual_subscription_sync'/);
  assert.doesNotMatch(sync,/from\('users'\)\.update\(\{ tier:/);
  assert.match(sync,/premium:effectivePremium/);
});


check('multi-device push retries unresolved tokens without duplicating accepted devices',()=>{
  const push=read('supabase/functions/push-dispatch/index.ts');
  assert.match(push,/alreadyAccepted=new Set[\s\S]*receipt_status==='pending'\|\|r\.receipt_status==='ok'/);
  assert.match(push,/const accepted=ticket\.status==='ok'&&typeof ticket\.id==='string'&&ticket\.id\.length>0/);
  assert.match(push,/MissingTicketId/);
  assert.match(push,/if\(enabledCandidateRemains\)[\s\S]*scheduleRetry\(supabase,n\)[\s\S]*else if\(alreadyAccepted\.size\+acceptedNow>0\)/);
  assert.match(push,/expo_ticket_id:accepted\?ticket\.id:null[\s\S]*receipt_status:accepted\?'pending':'error'/);
});

check('push delivery uses the strict database product-access rule including confirmed Auth email or phone',()=>{
  const sql=read('supabase/migrations/092_verified_identity_parity_strict_legal_gate.sql');
  const push=read('supabase/functions/push-dispatch/index.ts');
  assert.match(sql,/service_product_access_user_ids[\s\S]*auth\.users au[\s\S]*email_confirmed_at is not null or au\.phone_confirmed_at is not null[\s\S]*legal_acceptances[\s\S]*privacy_notice_acknowledgements[\s\S]*legal_acceptance_presentation_complete/i);
  assert.match(sql,/auth\.role\(\)<>'service_role'/i);
  assert.match(sql,/cardinality\(p_user_ids\)>200/);
  assert.match(push,/service_product_access_user_ids/);
  assert.doesNotMatch(push,/acceptedUsers=new Set|currentLegalVersion=securityConfig/);
  assert.ok(push.indexOf('suspendedUsers.has(n.user_id)')<push.indexOf('!productAccessUsers.has(n.user_id)'));
  assert.ok(push.indexOf('pausedUsers.has(n.user_id)')<push.indexOf('!productAccessUsers.has(n.user_id)'));
});

check('queued social pushes fail closed when the owner relationship is incomplete',()=>{
  const push=read('supabase/functions/push-dispatch/index.ts');
  assert.match(push,/\(owners\?\?\[\]\)\.length!==2[\s\S]*paused_at[\s\S]*suspended_at[\s\S]*return true/);
  assert.match(push,/if \(!a\.length \|\| !b\.length\) return true/);
});


check('auth-state sign-out reconciles RevenueCat against the authoritative current session',()=>{
  const authContext=read('src/contexts/AuthContext.tsx');
  assert.match(authContext,/reconcilePurchasesIdentity/);
  assert.match(authContext,/reconcilePurchasesIdentity\(verifiedSession\?\.user\.id\?\?null\)/);
  assert.doesNotMatch(authContext,/else\{void logOutPurchases\(/);
  assert.doesNotMatch(authContext,/onAuthStateChange[\s\S]{0,1200}logOutPurchases\(/);
});


check('post-deletion local finalization clears device push state without a deleted-user server call',()=>{
  const auth=read('src/services/auth.ts');
  const notifications=read('src/services/notifications.ts');
  assert.match(notifications,/clearLocalPushState[\s\S]*removeItem\(PUSH_TOKEN_STORAGE_KEY\)[\s\S]*clearLastNotificationResponseAsync/);
  const finalize=auth.match(/export async function finalizeDeletedAccountSession\(\)[\s\S]*?\n\}/)?.[0]??'';
  assert.match(finalize,/clearLocalPushState/);
  assert.doesNotMatch(finalize,/push-token-lifecycle|disableAllPushTokens|unregisterCurrentPushToken/);
});


check('web deletion admin secret is a mandatory production server release dependency',()=>{
  const release=read('scripts/server-release-config-check.mjs');
  const serverEnvExample=read('supabase/.env.example');
  assert.match(release,/ACCOUNT_DELETION_ADMIN_SECRET/);
  assert.match(serverEnvExample,/ACCOUNT_DELETION_ADMIN_SECRET=/);
});


check('account export includes scoped consent moderation upload fingerprint and push-delivery records',()=>{
  const exp=read('supabase/functions/export-download/index.ts');
  assert.match(exp,/legal_acceptances[\s\S]*\.eq\('user_id',userId\)/);
  assert.match(exp,/upload_intents[\s\S]*\.eq\('user_id',userId\)/);
  assert.match(exp,/pet_photo_fingerprints[\s\S]*\.in\('pet_id',petIds\)/);
  assert.match(exp,/push_receipts[\s\S]*\.in\('notification_id',chunk\)/);
  assert.match(exp,/moderation_items[\s\S]*\.eq\('target_type',targetType\)[\s\S]*\.in\('target_id',chunk\)/);
  assert.match(exp,/\['moderation_decisions',[\s\S]*from\('moderation_decisions'\)[\s\S]*affected_user_id\.eq/);
  assert.match(exp,/\['privacy_notice_acknowledgements',[\s\S]*from\('privacy_notice_acknowledgements'\)[\s\S]*notice_version/);
  assert.match(exp,/\['marketing_consent_history',[\s\S]*from\('marketing_consent_events'\)[\s\S]*channel,purpose,consent_version,granted/);
  assert.match(exp,/\['moderation_appeals',[\s\S]*from\('moderation_appeals'\)[\s\S]*outcome_explanation/);
  assert.doesNotMatch(exp,/provider_reference(?!_sha256)/);
  assert.doesNotMatch(exp,/expo_ticket_id/);
});

check('account export uses one-time hashed short-lived download capabilities',()=>{
  const issuer=read('supabase/functions/export-data/index.ts');
  const download=read('supabase/functions/export-download/index.ts');
  const sql=read('supabase/migrations/044_streaming_account_export.sql');
  const api=read('src/services/api.ts');
  assert.match(issuer,/crypto\.getRandomValues\(new Uint8Array\(32\)\)/);
  assert.match(issuer,/sha256Hex\(token\)/);
  assert.match(issuer,/TOKEN_TTL_MS=5\*60\*1000/);
  assert.match(sql,/token_hash text not null unique[\s\S]*expires_at timestamptz[\s\S]*claimed_at timestamptz/);
  assert.match(sql,/account_export_download_tokens_one_per_user[\s\S]*account_export_download_tokens\(user_id\)/);
  assert.match(sql,/claim_account_export_download_token/); assert.match(sql,/set claimed_at=now\(\)/); assert.match(sql,/claimed_at is null[\s\S]*expires_at>now\(\)/);
  assert.match(download,/TOKEN_RE=\/\^\[A-Za-z0-9_-\]\{43\}\$\//);
  assert.match(download,/claim_account_export_download_token/);
  assert.match(download,/Content-Type':'application\/x-ndjson/);
  assert.match(download,/Cache-Control':'no-store/);
  assert.match(download,/Referrer-Policy':'no-referrer/);
  assert.match(api,/getAccountExportDownloadUrl[\s\S]*throwIfEdgeFunctionFailed\(data,error\)[\s\S]*export-download\?token=/);
});

// TUR 2: mobile upload preflight / intent allowlists and Storage buckets must not contradict each other.
check('mobile upload preflight and Storage bucket contracts stay aligned',()=>{
  const migration035=read('supabase/migrations/035_upload_bucket_contract_alignment.sql');
  const uploads=read('src/services/uploads.ts');
  const intentMigration=read('supabase/migrations/010_final_hardening.sql');
  assert.match(migration035,/where id='pet-photos'/);
  assert.match(migration035,/where id='social-media'/);
  assert.match(migration035,/where id='health-documents'/);
  assert.match(migration035,/where id='pet-verification'/);
  assert.ok((migration035.match(/image\/heic/g)||[]).length>=4);
  assert.ok((migration035.match(/image\/heif/g)||[]).length>=4);
  assert.match(migration035,/file_size_limit=15728640[\s\S]*where id='health-documents'/);
  assert.match(uploads,/const HEALTH_MAX_BYTES = 15 \* 1024 \* 1024/);
  assert.match(intentMigration,/'image\/heic','image\/heif'/);
  assert.match(uploads,/'image\/heic','image\/heif'/);
});

check('large export uses bounded page/chunk streaming instead of inline JSON',()=>{
  const exp=read('supabase/functions/export-download/index.ts');
  assert.match(exp,/PAGE_SIZE=500/);
  assert.match(exp,/ID_CHUNK_SIZE=100/);
  assert.match(exp,/ReadableStream<Uint8Array>/);
  assert.match(exp,/forPages<any>[\s\S]*messages_export_failed/);
  assert.doesNotMatch(exp,/MAX_INLINE_EXPORT_ROWS_PER_DATASET|export_too_large_for_inline_delivery/);
});

check('streaming export includes owner-scoped short-lived media downloads and an explicit completion marker',()=>{
  const exp=read('supabase/functions/export-download/index.ts');
  assert.match(exp,/MEDIA_URL_TTL_SECONDS=3600/);
  assert.match(exp,/createSignedUrls\(paths,MEDIA_URL_TTL_SECONDS\)/);
  assert.match(exp,/storage_download_url/);
  assert.match(exp,/storage_download_expires_at/);
  assert.match(exp,/pet_verification_requests'[\s\S]*storage_path/);
  assert.match(exp,/withSignedStorageUrls\(supabase,'pet-photos'/);
  assert.match(exp,/withSignedStorageUrls\(supabase,'health-documents'/);
  assert.match(exp,/withSignedStorageUrls\(supabase,'pet-verification'/);
  assert.match(exp,/withSignedStorageUrls\(supabase,'social-media'/);
  assert.match(exp,/emit\('complete',\{complete:true/);
  assert.match(exp,/moderation_status\.eq\.approved,sender_pet_id\.in/);
  assert.match(exp,/legal_acceptances/);
});

check('owner verification provider starts are rate-limited and serialized server-side',()=>{
  const edge=read('supabase/functions/start-owner-verification/index.ts');
  const sql=read('supabase/migrations/037_owner_verification_abuse_control.sql');
  assert.match(edge,/service_rate_limit_user[\s\S]*owner_verification_start[\s\S]*p_limit:5[\s\S]*p_window_seconds:86400/);
  assert.match(edge,/verification_rate_limited/);
  assert.match(edge,/\.eq\('user_id',user\.id\)\.eq\('status','pending'\)\.maybeSingle\(\)/);
  assert.match(edge,/verification_already_in_progress/);
  assert.match(sql,/owner_verification_one_pending_per_user_idx[\s\S]*where status='pending'/i);
  assert.match(sql,/status='expired'[\s\S]*expires_at is not null and expires_at<=now\(\)/i);
});


check('Edge Function HTTP error codes survive the client transport layer',()=>{
  const helper=read('src/services/edgeErrors.ts');
  const api=read('src/services/api.ts');
  const purchases=read('src/services/purchases.ts');
  assert.match(helper,/context[\s\S]*clone[\s\S]*json[\s\S]*remoteCode/);
  assert.match(api,/getAccountExportDownloadUrl[\s\S]*throwIfEdgeFunctionFailed\(data,error\)/);
  assert.match(api,/startOwnerVerification[\s\S]*throwIfEdgeFunctionFailed\(data,error\)/);
  assert.match(purchases,/syncPremiumEntitlement[\s\S]*throwIfEdgeFunctionFailed\(data,error\)/);
});

check('web deletion account lookup uses a private email-hash index and exact Auth recheck',()=>{
  const sql=read('supabase/migrations/046_account_email_hash_lookup.sql');
  const processor=read('supabase/functions/process-account-deletion-request/index.ts');
  assert.match(sql,/account_email_lookup[\s\S]*references auth\.users\(id\) on delete cascade[\s\S]*revoke all on table public\.account_email_lookup from public,anon,authenticated/);
  assert.match(sql,/extensions\.digest\(lower\(trim\(new\.email\)\),'sha256'\)/);
  assert.match(sql,/after insert or update of email or delete on auth\.users/);
  assert.match(sql,/lookup_auth_user_by_email_hash[\s\S]*limit 2[\s\S]*cardinality\(v_ids\)<>1/);
  assert.match(processor,/lookup_auth_user_by_email_hash/);
  assert.match(processor,/normalizeEmail\(authData\.user\.email\)!==expectedEmail/);
  assert.doesNotMatch(processor,/lookup_auth_user_by_email'|lookup_auth_user_by_email"/);
  assert.match(sql,/drop function if exists public\.lookup_auth_user_by_email\(text\)/);
});

check('transient operational retention is cutoff-driven and service-role only',()=>{
  const sql=read('supabase/migrations/045_operational_retention_controls.sql');
  assert.match(sql,/purge_operational_records/);
  assert.match(sql,/auth\.role\(\)<>'service_role'/);
  assert.match(sql,/delete from public\.rate_limits[\s\S]*window_start<now\(\)-interval '24 hours'/);
  assert.match(sql,/delete from public\.push_receipts pr[\s\S]*using public\.notifications n[\s\S]*n\.push_status in \('sent','failed','skipped'\)/);
  assert.match(sql,/delete from public\.client_error_events/);
  assert.match(sql,/delete from public\.upload_intents[\s\S]*consumed_at is not null[\s\S]*cancelled_at is not null/);
  assert.match(sql,/delete from public\.account_export_download_tokens where expires_at<p_export_tokens_before/);
  assert.doesNotMatch(sql,/delete from public\.(audit_events|moderation_items|billing_webhook_events|owner_verification_sessions)/);
  assert.match(sql,/revoke all on function public\.purge_operational_records[\s\S]*from public,anon,authenticated/);
});

check('authenticated upload objects are immutable after their first insert',()=>{
  const sql=read('supabase/migrations/038_storage_immutable_upload_paths.sql');
  const uploads=read('src/services/uploads.ts');
  assert.match(sql,/drop policy if exists tailmance_storage_update on storage\.objects/i);
  assert.match(uploads,/\.upload\(path, blob, \{ contentType, upsert: false \}\)/);
});


check('long-running account deletion renews its token-bound destructive claim',()=>{
  const sql=read('supabase/migrations/039_account_deletion_claim_heartbeat.sql');
  const deletion=read('supabase/functions/_shared/accountDeletion.ts');
  assert.match(sql,/renew_account_deletion_claim/i);
  assert.match(sql,/set claimed_at=now\(\)/i);
  assert.match(sql,/where user_id=p_user_id and claim_token=p_claim_token/i);
  assert.match(sql,/auth\.role\(\)<>'service_role'/i);
  assert.match(deletion,/renewDeletionClaim[\s\S]*renew_account_deletion_claim/);
  assert.match(deletion,/listAllStoragePaths\(supabase,bucket,petId,keepClaimAlive\)/);
  assert.match(deletion,/purgeResidualOperationalData[\s\S]*await keepClaimAlive\(\)[\s\S]*auth\.admin\.deleteUser/);
});


check('product access and pet creation require a confirmed authentication identity without weakening legal evidence',()=>{
  const base=read('supabase/migrations/040_confirmed_identity_product_access.sql');
  const parity=read('supabase/migrations/092_verified_identity_parity_strict_legal_gate.sql');
  const auth=read('src/services/auth.ts');
  const authContext=read('src/contexts/AuthContext.tsx');
  const legal=read('supabase/functions/accept-legal/index.ts');
  assert.match(base,/before insert on public\.pets[\s\S]*enforce_pet_insert_product_access/i);
  assert.match(base,/not public\.current_user_has_product_access\(\)/i);
  assert.match(parity,/current_session_satisfies_mfa_if_enrolled[\s\S]*email_confirmed_at is not null or au\.phone_confirmed_at is not null[\s\S]*privacy_notice_acknowledgements[\s\S]*legal_overlay_document_actions_complete[\s\S]*legal_acceptance_presentation_complete/i);
  assert.match(auth,/signInWithPassword[\s\S]*email_confirmed_at[\s\S]*email_verification_required/);
  assert.match(auth,/signInWithOtp\(\{phone:[\s\S]*verifyOtp\(\{phone:[\s\S]*type:'sms'/);
  assert.match(authContext,/isVerifiedIdentity=[\s\S]*email_confirmed_at\|\|user\?\.phone_confirmed_at/);
  assert.match(authContext,/getSession\(\)[\s\S]*isVerifiedIdentity\(session\.user\)[\s\S]*signOut/);
  assert.match(authContext,/onAuthStateChange[\s\S]*isVerifiedIdentity\(session\?\.user\)/);
  assert.match(legal,/email_confirmed_at[\s\S]*phone_confirmed_at[\s\S]*identity_verification_required/);
});


check('jurisdiction runtime approval requires complete canonical topic-level legal control reviews',()=>{
  const introduction=read('supabase/migrations/058_v19_full_jurisdiction_control_reviews.sql');
  const canonical=read('supabase/migrations/061_v19_canonical_22_legal_control_families.sql');
  for(const family of ['privacy','consumer','age','ugc_moderation','subscription_iap','international_transfer','data_localization','representative_requirement','store_platform_obligations','animal_welfare','breeding_mating','pet_commerce','subnational_requirements','applicability_effective_dates','electronic_marketing_push','legal_document_language','digital_accessibility','operator_identity_tax_invoicing','ip_notice_takedown','cybersecurity_breach_notification','regulatory_recordkeeping','sanctions_payments_distribution'])assert.match(canonical,new RegExp(`'${family}'`));
  assert.doesNotMatch(canonical,/'data_localization_or_representative'/);
  assert.match(introduction,/control_reviews jsonb not null default '\{\}'::jsonb/i);
  assert.match(introduction,/release_status='approved'[\s\S]*legal_control_reviews_complete\(new\.control_reviews\)[\s\S]*jurisdiction_topic_control_reviews_incomplete/i);
  assert.match(canonical,/official_source_reference[\s\S]*evidence_reference[\s\S]*reviewer[\s\S]*reviewed_at[\s\S]*applicability_checked_at/i);
  assert.match(introduction,/enforce_legal_bundle_route_release_evidence[\s\S]*legal_control_reviews_complete\(v_policy\.control_reviews\)/i);
  assert.match(introduction,/v_bundle\.document_locale=any\(v_policy\.approved_document_locales\)/i);
  assert.match(canonical,/where release_status='approved' and not public\.legal_control_reviews_complete\(control_reviews\)/i);
  assert.doesNotMatch(introduction,/required_legal_locales/);
});


check('streaming export redacts operational internals while preserving user billing activity',()=>{
  const exp=read('supabase/functions/export-download/index.ts');
  assert.match(exp,/notifications'\)\.select\('id,type,title,body,entity_id,actor_pet_id,read_at,created_at'\)/);
  assert.doesNotMatch(exp,/notifications'\)\.select\('\*'\)/);
  assert.match(exp,/subscriptions'\)\.select\('id,platform,product_id,entitlement_id,store_transaction_id,status,current_period_end,will_renew,created_at,updated_at'\)/);
  assert.doesNotMatch(exp,/subscriptions'\)\.select\('\*'\)/);
  assert.doesNotMatch(exp,/subscriptions[\s\S]{0,180}raw_event_id/);
  assert.match(exp,/moderation_items'\)[\s\S]*manual_review_required[\s\S]*reviewed_at/);
  assert.doesNotMatch(exp,/moderation_items'\)[\s\S]{0,180}(provider_reference|last_error_code|reviewed_by|score)/);
  assert.match(exp,/push_receipts'\)[\s\S]*notification_id,receipt_status,checked_at,created_at/);
  assert.doesNotMatch(exp,/push_receipts'\)[\s\S]{0,180}(expo_ticket_id|push_token_id|error_code)/);
  assert.match(exp,/photo_fingerprint_records[\s\S]*select\('photo_id,pet_id,created_at'\)/);
  assert.doesNotMatch(exp,/pet_photo_fingerprints'\)\.select\([^)]*sha256/);
  assert.match(exp,/billing_webhook_events'\)[\s\S]*select\('event_type,status,received_at,processed_at'\)[\s\S]*contains\('user_ids',\[userId\]\)/);
  assert.doesNotMatch(exp,/billing_webhook_events'\)[\s\S]{0,220}(event_id|last_error|claim_token|claimed_at)/);
  assert.match(exp,/billing_state_versions'\)[\s\S]*select\('last_observed_at,updated_at'\)[\s\S]*eq\('user_id',userId\)/);
  assert.match(exp,/legal_country_runtime'\)[\s\S]*legal_country_code[\s\S]*resolution_status[\s\S]*storefront_country_code[\s\S]*operational_country_code/);
  assert.match(exp,/legal_age_assurance_events'\)[\s\S]*legal_country_code[\s\S]*age_threshold[\s\S]*verification_method[\s\S]*provider_code[\s\S]*result[\s\S]*verified_at[\s\S]*expires_at/);
  assert.match(exp,/prelegal_age_attestations'\)[\s\S]*age_threshold[\s\S]*statement_version[\s\S]*ui_locale[\s\S]*source[\s\S]*attested_at/);
  assert.match(exp,/subscription_precontract_presentations'\)[\s\S]*bundle_id[\s\S]*applicability_matrix_id[\s\S]*document_set_sha256[\s\S]*store_platform[\s\S]*store_product_id[\s\S]*acknowledged_at/);
  assert.doesNotMatch(exp,/legal_age_assurance_events'\)[\s\S]{0,220}(provider_reference_sha256|evidence_reference|created_by)/);
  assert.match(exp,/legal_acceptances'\)[\s\S]*bundle_id[\s\S]*accepted_country_code[\s\S]*accepted_ui_locale[\s\S]*document_locale[\s\S]*terms_sha256/);
  assert.match(exp,/privacy_notice_acknowledgements'\)[\s\S]*bundle_id[\s\S]*notice_sha256/);
  assert.match(exp,/marketing_consent_events'\)[\s\S]*bundle_id[\s\S]*consent_text_sha256/);
});



check('social OAuth cannot bypass 18+ and exact pre-registration legal binding',()=>{
  const oauth=read('supabase/migrations/089_oauth_existing_account_only_guard.sql');
  const binding=read('supabase/migrations/084_v19_pre_registration_route_revision_evidence.sql');
  const base=read('supabase/migrations/002_security_and_rpcs.sql');
  assert.match(oauth,/create trigger guard_oauth_first_account_creation[\s\S]*before insert on auth\.users[\s\S]*guard_oauth_first_account_creation/i);
  assert.match(oauth,/v_provider in \('google','apple'\)[\s\S]*not v_prelegal[\s\S]*oauth_new_account_requires_pre_registration/i);
  assert.match(base,/create trigger on_auth_user_created after insert on auth\.users[\s\S]*handle_new_auth_user/i);
  assert.match(binding,/prelegal_age_attestation_required/);
  assert.match(binding,/pre_registration_declared_country_required/);
  assert.match(binding,/pre_registration_bundle_required/);
  assert.match(binding,/pre_registration_route_revision_required/);
  assert.match(binding,/pre_registration_presentation_hash_required/);
  assert.match(binding,/pre_registration_subnational_scope_evidence_hash_required/);
  assert.match(binding,/pre_registration_route_changed/);
  assert.match(binding,/pre_registration_route_revision_changed/);
  assert.match(binding,/pre_registration_legal_presentation_changed/);
  assert.match(binding,/pre_registration_subnational_scope_changed/);
});

check('retention trust monetization and pet-first architecture stays server-authoritative',()=>{
  const retention=read('supabase/migrations/088_retention_trust_and_local_network_architecture.sql');
  const oauth=read('supabase/migrations/089_oauth_existing_account_only_guard.sql');
  const growth=read('supabase/migrations/090_plus_growth_b2b_and_pet_first_product_enforcement.sql');
  const finalization=read('supabase/migrations/093_pet_first_discovery_mating_and_local_feed_finalization.sql');
  const parity=read('supabase/migrations/092_verified_identity_parity_strict_legal_gate.sql');
  assert.match(retention,/community_launch_zones[\s\S]*Moda[\s\S]*Fenerbahçe[\s\S]*Caddebostan/);
  assert.match(retention,/create or replace function public\.get_local_network_status/);
  assert.match(retention,/species<>'dog'[\s\S]*feed_only|feed_only[\s\S]*species<>'dog'/i);
  assert.match(retention,/create or replace function public\.create_lost_pet_alert[\s\S]*pet_private[\s\S]*notifications/i);
  assert.match(retention,/create table if not exists public\.pet_friendly_places/);
  assert.match(retention,/premium_event_organizer_required|premium_required/i);
  assert.match(retention,/premium_reply_entitlement|courtesy/i);
  assert.match(retention,/pet_sale|commercial_breeding/i);
  assert.match(oauth,/prelegal_age_attested[\s\S]*(google|apple)/i);
  assert.match(growth,/premium_required_advanced_filters/);
  assert.match(growth,/premium_required_multiple_pets/);
  assert.match(finalization,/premiumUnlimitedLikes[\s\S]*consumableBoosts[\s\S]*consumableSuperLikes/);
  assert.match(finalization,/mating_pair_profile_signals_eligible[\s\S]*vaccination_status='complete'[\s\S]*veterinarian_verified=true/);
  assert.match(finalization,/petSalesEnabled',false[\s\S]*commercialBreedingEnabled',false[\s\S]*dataSaleEnabled',false[\s\S]*aggressiveAdsEnabled',false/);
  assert.match(growth,/grant_consumable_credit[\s\S]*auth\.role\(\)<>'service_role'[\s\S]*consumable_credit_ledger/);
  assert.match(read('supabase/migrations/091_pet_first_no_human_dating_enforcement.sql'),/human_dating_prohibited[\s\S]*human_dating_misuse/);
  assert.match(parity,/current_session_satisfies_mfa_if_enrolled[\s\S]*phone_confirmed_at[\s\S]*privacy_notice_acknowledgements[\s\S]*legal_acceptance_presentation_complete/);
});

check('every persisted public application table has explicit or canonical RLS coverage',()=>{
  const migrationSql=globSync('supabase/migrations/*.sql').sort().map(read).join('\n');
  const createdTables=new Set(
    [...migrationSql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-zA-Z0-9_]+)/gi)].map(m=>m[1])
  );
  const rlsCovered=new Set(
    [...migrationSql.matchAll(/alter\s+table\s+public\.([a-zA-Z0-9_]+)\s+enable\s+row\s+level\s+security/gi)].map(m=>m[1])
  );
  for(const block of migrationSql.matchAll(/tablename\s+in\s*\(([^)]*)\)[\s\S]{0,250}?alter table public\.%I enable row level security/gi)){
    for(const q of block[1].matchAll(/'([a-zA-Z0-9_]+)'/g)) rlsCovered.add(q[1]);
  }
  const missing=[...createdTables].filter(t=>!rlsCovered.has(t)).sort();
  assert.deepEqual(missing,[],`Persisted public tables missing RLS coverage: ${missing.join(', ')}`);
  assert.ok(rlsCovered.has('legal_age_assurance_events'),'legal_age_assurance_events must remain in persisted-table RLS coverage');
  assert.ok(rlsCovered.has('prelegal_age_attestations'),'prelegal_age_attestations must remain in persisted-table RLS coverage');
  assert.ok(rlsCovered.has('pre_registration_legal_bundles'),'pre_registration_legal_bundles must remain in persisted-table RLS coverage');
  assert.ok(rlsCovered.has('pre_registration_legal_presentations'),'pre_registration_legal_presentations must remain in persisted-table RLS coverage');
  assert.ok(rlsCovered.has('pre_registration_legal_bundle_routes'),'pre_registration_legal_bundle_routes must remain in persisted-table RLS coverage');
  assert.ok(rlsCovered.has('pre_registration_legal_route_events'),'pre_registration_legal_route_events must remain in persisted-table RLS coverage');
  assert.ok(rlsCovered.has('legal_jurisdiction_policies'),'legal_jurisdiction_policies must remain in persisted-table RLS coverage');
  assert.ok(rlsCovered.has('legal_bundle_comprehension_documents'),'legal_bundle_comprehension_documents must remain in persisted-table RLS coverage');
  assert.ok(rlsCovered.has('legal_overlay_comprehension_documents'),'legal_overlay_comprehension_documents must remain in persisted-table RLS coverage');
});

check('dual-language legal comprehension mirrors are immutable service-only records bound to source hashes',()=>{
  const dual=read('supabase/migrations/085_v19_dual_language_legal_presentation.sql');
  const exactOverlay=read('supabase/migrations/086_v19_exact_overlay_document_classification.sql');
  for(const table of ['legal_bundle_comprehension_documents','legal_overlay_comprehension_documents']){
    assert.match(dual,new RegExp(`alter table public\.${table} enable row level security`,'i'));
    assert.match(dual,new RegExp(`revoke all on table public\.${table} from public,anon,authenticated`,'i'));
    assert.match(dual,new RegExp(`grant select,insert on table public\.${table} to service_role`,'i'));
    assert.match(dual,new RegExp(`revoke update,delete on table public\.${table} from service_role`,'i'));
  }
  assert.match(dual,/source_document_sha256 text not null check \(source_document_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/i);
  assert.match(dual,/document_sha256 text not null check \(document_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/i);
  assert.match(dual,/source_document_version=v_source\.document_version[\s\S]*source_document_sha256=v_source\.document_sha256/i);
  assert.match(dual,/reviewed_at<=now\(\)[\s\S]*valid_until>now\(\)/i);
  assert.match(dual,/prevent_immutable_legal_bundle_document_mutation/i);
  assert.match(exactOverlay,/before insert on public\.legal_bundle_overlay_documents/i);
  assert.match(exactOverlay,/legal_overlay_document_type_not_required/i);
  assert.match(exactOverlay,/legal_overlay_document_locale_not_required/i);
  assert.match(exactOverlay,/legal_overlay_matrix_mismatch/i);
  assert.match(exactOverlay,/legal_overlay_document_for_non_applicable_overlay/i);
  assert.match(exactOverlay,/legal_document_url_allowed\(new\.document_url\)/i);
});

check('LiveKit terminal-call teardown outbox is RLS-protected and service-only',()=>{
  const sql=read('supabase/migrations/177_livekit_room_teardown_outbox.sql');
  assert.match(sql,/alter table public\.livekit_room_teardown_queue enable row level security/i);
  assert.match(sql,/revoke all on public\.livekit_room_teardown_queue from public,anon,authenticated/i);
  assert.match(sql,/revoke all on function public\.service_claim_livekit_room_teardowns\(integer\) from public,anon,authenticated/i);
  assert.match(sql,/grant execute on function public\.service_claim_livekit_room_teardowns\(integer\) to service_role/i);
  assert.match(sql,/for update skip locked/i);
  const deletion=read('supabase/migrations/178_livekit_teardown_survives_account_deletion.sql');
  assert.match(deletion,/before delete on public\.pet_call_sessions/i);
  assert.match(deletion,/delete from public\.livekit_room_teardown_queue where call_id=p_call_id/i);
});

check('every persisted application table is explicitly classified for account export',()=>{
  const migrationSql=globSync('supabase/migrations/*.sql').sort().map(read).join('\n');
  const exportSource=read('supabase/functions/export-download/index.ts');
  const createdTables=new Set(
    [...migrationSql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-zA-Z0-9_]+)/gi)].map(m=>m[1])
  );
  const exportedTables=new Set([...exportSource.matchAll(/from\('([a-zA-Z0-9_]+)'\)/g)].map(m=>m[1]));
  const internalOnly=new Set([
    'account_deletion_claims',        // ephemeral destructive-operation mutex
    'account_email_lookup',           // private derived hash index; cascades with auth user
    'account_export_download_tokens', // one-time capability hashes, never user content
    'app_runtime_config',             // global product configuration
    'app_security_config',            // global security/legal configuration
    'legal_document_bundles',          // immutable global legal document payloads; user export carries accepted bundle IDs/hashes
    'legal_bundle_documents',           // immutable per-bundle document manifest; global compliance configuration, not user-owned content
    'legal_bundle_document_alternates', // immutable/controlled jurisdiction-language alternate document map; global compliance configuration
    'legal_bundle_comprehension_documents', // immutable UI-language comprehension mirrors bound to governing legal document hashes
    'legal_overlay_comprehension_documents', // immutable UI-language comprehension mirrors for applicable overlay documents
    'legal_document_bundle_routes',     // global current-bundle routing configuration
    'legal_jurisdiction_policies',      // service-only global jurisdiction release policy; user export carries their runtime context
    'legal_country_source_document_supplements', // service-only source legal/language approval manifest; not user-owned data
    'legal_age_assurance_sessions',    // ephemeral service-only provider sessions; durable threshold evidence is exported separately
    'legal_document_origins',           // service-only approved HTTPS origin registry for binding legal content
    'pre_registration_legal_bundles', // immutable service-only pre-registration document payload; user export carries presentation evidence
    'pre_registration_legal_bundle_routes', // service-only current publication pointers; not user-owned content
    'pre_registration_legal_route_events', // service-only publication audit log; not user-owned content
    'legal_subnational_language_requirements', // service-only subnational legal-language release matrix
    'client_error_events',            // deliberately anonymous; user_id is dropped in migration 023
    'external_deletion_queue',        // service-only provider cleanup queue
    'oauth_revocation_credentials',   // service-only encrypted provider secrets; never export raw revocation credentials
    'rate_limits',                    // anti-abuse counters; exposing them weakens controls
    'security_attestation_challenges', // ephemeral one-time anti-replay challenges
    'security_integrity_policy',        // global service security policy
    'security_app_attest_keys',         // service-only hashed key/replay state; redacted assessments are exported
    'security_incidents',                // internal incident-response case ledger
    'security_incident_jurisdictions',   // internal regulator/applicability decision ledger
    'storage_gc_queue',               // service-only orphan-object cleanup queue
    'worker_heartbeats',              // global worker health state
    'livekit_room_teardown_queue',   // service-only SFU privacy teardown outbox; no user-authored content
    'business_partner_profiles',     // service-owned B2B directory configuration
    'commercial_referral_events',    // anonymous aggregate referral events; no user identifier stored
    'commercial_conversion_events',  // service-only partner settlement evidence; no user identifier stored
    'community_launch_zones',        // global rollout/density configuration
    'client_mutation_receipts',      // private bounded idempotency receipts; request hashes/result IDs only, no user-authored payload
    'contextual_brand_campaigns',    // service-owned contextual campaign configuration; personalized targeting is prohibited
    'event_commercial_offers',       // service-owned disclosed external ticket/sponsorship configuration
    'jurisdiction_product_features', // service-owned counsel/welfare product-policy matrix
    'jurisdiction_paid_promotion_compliance', // service-only country paid-promotion legal/operational readiness policy
    'jurisdiction_billing_programs', // service-only evidence-bound regional store/billing program configuration
    'pet_friendly_places',           // global public place directory; not user-owned content
    'place_referral_events'          // anonymous aggregate place referral events; no user identifier stored
    ,'pet_match_embeddings'          // private derived ranking vectors; cascade with pet deletion and are not user-authored records
    ,'ai_provider_cost_budgets'      // service-only provider cost circuit-breaker configuration; no user-authored data
    ,'ai_provider_cost_windows'      // service-only aggregate provider-call counters; no user identifiers or content
    ,'health_ai_jobs'                // ephemeral service-only OCR work queue; cascades with health-document deletion
    ,'health_ai_monthly_units'       // service-only aggregate monthly page counter for the OCR provider's free tier; no user identifiers or content
    ,'client_performance_events'     // deliberately anonymous aggregate frame telemetry; no account/pet identifier stored
    ,'security_integrity_policy'      // global service-owned app-integrity enforcement policy
    ,'security_attestation_challenges' // ephemeral one-time server challenges; security-only anti-replay state
    ,'security_device_assessments'      // security-only integrity verdict evidence; deliberately excluded from user export
    ,'security_incidents'               // internal security operations; not user-profile data
    ,'security_incident_jurisdictions'  // internal legal/security incident routing decisions
    ,'security_revoked_sessions'        // service-only immediate access-token revocation state
    ,'security_user_revocation_state'  // service-only per-user revocation watermark
  ]);
  const unclassified=[...createdTables].filter(t=>!exportedTables.has(t)&&!internalOnly.has(t)).sort();
  assert.deepEqual(unclassified,[],`Unclassified persisted tables: ${unclassified.join(', ')}`);
});



check('country paid-promotion compliance policy is service-only, RLS-protected and fail-closed',()=>{
  const sql=read('supabase/migrations/141_br_paid_promotion_transparency_fail_closed.sql');
  assert.match(sql,/create table if not exists public\.jurisdiction_paid_promotion_compliance/i);
  assert.match(sql,/alter table public\.jurisdiction_paid_promotion_compliance enable row level security/i);
  assert.match(sql,/revoke all on public\.jurisdiction_paid_promotion_compliance from public,anon,authenticated/i);
  assert.match(sql,/grant all on public\.jurisdiction_paid_promotion_compliance to service_role/i);
  assert.match(sql,/paid_promotion_visibility_enabled boolean not null default false/i);
  assert.match(sql,/minimum_record_retention_days integer not null default 365 check \(minimum_record_retention_days>=365\)/i);
  assert.match(sql,/create or replace function public\.current_paid_promotion_visibility_enabled\(\)/i);
  assert.match(sql,/perform public\.require_active_authenticated_session\(\)/i);
  assert.match(sql,/if not public\.legal_source_approval_current\(r\.legal_country_code\) then return false; end if;/i);
  assert.match(sql,/revoke all on function public\.current_paid_promotion_visibility_enabled\(\) from public,anon,authenticated/i);
  assert.match(sql,/grant execute on function public\.current_paid_promotion_visibility_enabled\(\) to service_role/i);
  assert.match(sql,/commercial_promotion_not_available/i);
});


check('Brazil paid-promotion compliance state is service-only, fail-closed and current-law gated',()=>{
  const sql=read('supabase/migrations/141_br_paid_promotion_transparency_fail_closed.sql');
  assert.match(sql,/create table if not exists public\.jurisdiction_paid_promotion_compliance/i);
  assert.match(sql,/alter table public\.jurisdiction_paid_promotion_compliance enable row level security/i);
  assert.match(sql,/revoke all on public\.jurisdiction_paid_promotion_compliance from public,anon,authenticated/i);
  assert.match(sql,/grant all on public\.jurisdiction_paid_promotion_compliance to service_role/i);
  assert.match(sql,/paid_promotion_visibility_enabled boolean not null default false/i);
  assert.match(sql,/not paid_promotion_visibility_enabled or \([\s\S]*advertiser_recordkeeping_ready[\s\S]*material_relationship_disclosure_ready[\s\S]*public_repository_ready[\s\S]*financial_advertiser_verification_ready/i);
  assert.match(sql,/create or replace function public\.current_paid_promotion_visibility_enabled\(\)/i);
  assert.match(sql,/if r\.legal_country_code<>'BR' then return true; end if;/i);
  assert.match(sql,/and c\.effective_at<=now\(\)[\s\S]*and c\.expires_at>now\(\)/i);
  assert.match(sql,/revoke all on function public\.current_paid_promotion_visibility_enabled\(\) from public,anon,authenticated/i);
  assert.match(sql,/grant execute on function public\.current_paid_promotion_visibility_enabled\(\) to service_role/i);
});

check('configured-27 internal legal/language source approval is service-only and cannot bypass production runtime gates',()=>{
  const sql=read('supabase/migrations/133_configured_27_internal_legal_language_source_approval.sql');
  assert.match(sql,/source_legal_review_status text not null default 'pending_internal_official_source_review'/i);
  assert.match(sql,/source_language_review_status text not null default 'pending_internal_legal_language_qa'/i);
  assert.match(sql,/approved_internal_official_source_review/i);
  assert.match(sql,/approved_internal_legal_language_qa/i);
  assert.match(sql,/create table if not exists public\.legal_country_source_document_supplements/i);
  assert.match(sql,/alter table public\.legal_country_source_document_supplements enable row level security/i);
  assert.match(sql,/revoke all on table public\.legal_country_source_document_supplements from public,anon,authenticated/i);
  assert.match(sql,/grant select,insert,update on table public\.legal_country_source_document_supplements to service_role/i);
  assert.match(sql,/create or replace function public\.legal_source_approval_current\(p_country_code text\)/i);
  assert.match(sql,/source_review_valid_until<=now\(\)/i);
  assert.match(sql,/source_approved_document_locales/i);
  assert.match(sql,/Source approval is not a production-activation bypass/i);
  assert.doesNotMatch(sql,/set\s+release_status\s*=\s*'approved'/i,'source approval migration must not auto-activate production runtime');
});


check('device integrity tables are service-only, replay-safe and bounded',()=>{
  const integrity=read('supabase/migrations/097_device_integrity_challenge_and_risk_gate.sql');
  for(const table of ['security_integrity_policy','security_attestation_challenges','security_device_assessments']){
    assert.match(integrity,new RegExp(`alter table public\.${table} enable row level security`,'i'));
    assert.match(integrity,new RegExp(`revoke all on table public\.${table} from public,anon,authenticated`,'i'));
  }
  assert.match(integrity,/nonce text not null unique/);
  assert.match(integrity,/expires_at>now\(\)/);
  assert.match(integrity,/attempts<3/);
  assert.match(integrity,/claimed_at<now\(\)-interval '45 seconds'/);
  assert.match(integrity,/consumed_at=now\(\)/);
  assert.match(integrity,/verdict in \('verified','limited','rejected'\)/);
  assert.match(integrity,/max_assessment_age_seconds/);
});

check('mobile app-integrity bridges bind platform verdicts to server challenge data',()=>{
  const client=read('src/services/deviceIntegrity.ts');
  const edge=read('supabase/functions/verify-device-integrity/index.ts');
  const ios=read('modules/tailmance-device-integrity/ios/TailmanceDeviceIntegrityModule.swift');
  const android=read('modules/tailmance-device-integrity/android/src/main/java/expo/modules/tailmancedeviceintegrity/TailmanceDeviceIntegrityModule.kt');
  assert.match(client,/requestPlayIntegrityTokenAsync\(c\.clientData\)/);
  assert.match(client,/generateAppAttestAssertionAsync\(keyId,c\.clientData\)/);
  assert.match(edge,/requestPackageOk=request\.requestPackageName===packageName/);
  assert.match(edge,/request\.requestHash===expectedHash/);
  assert.match(edge,/service_claim_device_integrity_challenge/);
  assert.match(edge,/service_finish_device_integrity_challenge/);
  assert.match(edge,/readRequestJsonBounded<any>\(req,64_000\)/);
  assert.match(edge,/normalizeSha256Digest/);
  assert.match(ios,/attestKey\(keyId, clientDataHash: self\.hash\(clientDataUtf8\)\)/);
  assert.match(ios,/generateAssertion\(keyId, clientDataHash: self\.hash\(clientDataUtf8\)\)/);
  assert.match(android,/MessageDigest\.getInstance\("SHA-256"\)/);
  assert.match(android,/setRequestHash\(requestHash\(clientDataUtf8\)\)/);
  assert.match(android,/prepareIntegrityToken\(request\)/);
});


check('security incident operations are service-only and integrity evidence retention is legal-hold aware',()=>{
  const ops=read('supabase/migrations/100_security_incident_operations_and_integrity_retention.sql');
  for(const table of ['security_incidents','security_incident_jurisdictions']){
    assert.match(ops,new RegExp(`alter table public\\.${table} enable row level security`,'i'));
    assert.match(ops,new RegExp(`revoke all on table[\\s\\S]*${table}[\\s\\S]*from public,anon,authenticated`,'i'));
  }
  assert.match(ops,/incident_owner text not null default 'Yekta Özel'/);
  assert.match(ops,/country_code text not null check\(country_code ~ '\^\[A-Z\]\{2\}\$'\)/);
  assert.match(ops,/evidence_hold=true and status<>'resolved'/);
  assert.match(ops,/service_cleanup_security_integrity_evidence/);
  const config=JSON.parse(read('release/security-incident-response-config.json'));
  assert.equal(config.operating_policy.never_assume_a_universal_72_hour_rule,true);
  assert.equal(config.operating_policy.country_notification_deadlines_are_matrix_driven,true);
});

check('App Attest replay state is service-only and assertion counters are strictly monotonic',()=>{
  const replay=read('supabase/migrations/098_device_integrity_action_binding_and_app_attest_replay.sql');
  assert.match(replay,/create table if not exists public\.security_app_attest_keys/i);
  assert.match(replay,/revoke all on table public\.security_app_attest_keys from public,anon,authenticated/i);
  assert.match(replay,/p_assertion_counter<=v_key\.last_assertion_counter/i);
  assert.match(replay,/app_attest_counter_replay/i);
  assert.match(replay,/a\.action=p_action/i);
});

check('high-risk product writes are action-bound to current verified device assessments',()=>{
  const enforcement=read('supabase/migrations/099_device_integrity_high_risk_write_enforcement.sql');
  const failClosed=read('supabase/migrations/104_device_integrity_fail_closed_policy.sql');
  const api=read('src/services/api.ts');
  for(const action of ['lost_pet_alert','event_create','meetup_create','boost_activate','travel_mode','super_like']){
    assert.match(enforcement,new RegExp(action));
    assert.match(api,new RegExp(`bestEffortDeviceIntegrity\\('${action}'\\)`),`${action} client attestation preflight missing`);
  }
  assert.match(enforcement,/require_current_device_integrity\(p_action text\)/i);
  assert.match(failClosed,/set enforcement_mode='enforce'/i);
  assert.match(failClosed,/service_set_device_integrity_policy/i);
  assert.match(failClosed,/observe_requires_short_relaxation_window/i);
  assert.match(failClosed,/v_stored_mode='observe'[\s\S]*v_relax_until>now\(\)[\s\S]*else 'enforce'/i);
  assert.match(failClosed,/a\.action=p_action[\s\S]*a\.verdict='verified'/i);
  assert.match(failClosed,/revoke update on table public\.security_integrity_policy from service_role/i);
});

check('device integrity policy is fail-closed by default and temporary observe mode is bounded',()=>{
  const sql=read('supabase/migrations/104_device_integrity_fail_closed_policy.sql');
  assert.match(sql,/update public\.security_integrity_policy[\s\S]*enforcement_mode='enforce'/i);
  assert.match(sql,/p_mode='observe'[\s\S]*v_until>now\(\)\+interval '24 hours'[\s\S]*observe_requires_short_relaxation_window/i);
  assert.match(sql,/p_max_assessment_age_seconds not between 60 and 3600/i);
  assert.match(sql,/char_length\(v_reason\) not between 8 and 240/i);
  assert.match(sql,/effective_mode:=case[\s\S]*else 'enforce'/i);
});

check('password recovery changes the password then revokes all sessions and fails locally closed if revocation cannot be confirmed',()=>{
  const auth=read('src/services/auth.ts');
  const reset=read('src/screens/ResetPasswordScreen.tsx');
  assert.match(auth,/updatePasswordAndRevokeSessions[\s\S]*updateUser\(\{password\}\)[\s\S]*signOut\('global'\)/);
  assert.match(auth,/password_changed_session_revocation_unverified/);
  assert.match(auth,/clearLocalPushState\(\)[\s\S]*logOutPurchases\(\)[\s\S]*signOut\(\{scope:'local'\}\)/);
  assert.match(reset,/updatePasswordAndRevokeSessions\(password\)/);
  assert.match(reset,/reset\.revocationWarningTitle/);
});

check('pre-registration legal routing is service-owned, presentation-bound and non-authoritative for final jurisdiction',()=>{
  const pre=read('supabase/migrations/081_v19_pre_registration_legal_presentation_binding.sql');
  assert.match(pre,/pre_registration_legal_bundles[\s\S]*enable row level security/);
  assert.match(pre,/revoke all on table public\.pre_registration_legal_bundles from public,anon,authenticated/);
  assert.match(pre,/get_pre_registration_legal_presentation[\s\S]*grant execute[\s\S]*to anon,authenticated/);
  assert.match(pre,/legal_document_url_allowed\(b\.privacy_notice_url\)/);
  assert.match(pre,/pre_registration_legal_presentation_changed/);
  assert.doesNotMatch(pre,/insert into public\.legal_country_runtime/);
  assert.match(exportDownload,/pre_registration_legal_presentations/);
});

check('pre-registration subnational scope evidence is service-controlled, hashed into the presentation, and exported without raw counsel evidence',()=>{
  const preSub=read('supabase/migrations/082_v19_pre_registration_subnational_scope_binding.sql');
  assert.match(preSub,/pre_registration_subnational_scope_evidence_sha256/);
  assert.match(preSub,/subnationalScopeEvidenceSha256/);
  assert.match(preSub,/pre_registration_subnational_scope_changed/);
  assert.match(exportDownload,/declared_subnational_code,subnational_scope_mode,subnational_scope_evidence_sha256/);
  assert.doesNotMatch(exportDownload,/pre_registration_legal_bundles'\)\.select\([^\n]*subnational_scope_evidence_reference/i);
});


check('pre-registration legal bundles are immutable while publication changes use an audited service-only route pointer',()=>{
  const route=read('supabase/migrations/083_v19_pre_registration_route_lifecycle_and_subnational_options.sql');
  assert.match(route,/trg_pre_registration_legal_bundles_immutable[\s\S]*prevent_immutable_legal_bundle_mutation/i);
  assert.match(route,/create table if not exists public\.pre_registration_legal_bundle_routes/i);
  assert.match(route,/create table if not exists public\.pre_registration_legal_route_events/i);
  assert.match(route,/revoke all on table public\.pre_registration_legal_bundle_routes from public,anon,authenticated,service_role/i);
  assert.match(route,/service_set_pre_registration_legal_route/i);
  assert.match(route,/route_revision uuid not null/i);
  assert.match(route,/pre_registration_legal_presentation_sha256[\s\S]*routeRevision/i);
  assert.match(route,/pre_registration_legal_bundle_current[\s\S]*current_bundle_id=b\.pre_registration_bundle_id/i);
  assert.match(route,/get_pre_registration_subnational_options/i);
});

check('pre-registration signup persists and exports the exact publication route revision shown to the user',()=>{
  const forensic=read('supabase/migrations/084_v19_pre_registration_route_revision_evidence.sql');const auth=read('src/services/auth.ts');
  assert.match(forensic,/add column if not exists route_revision uuid/i);
  assert.match(forensic,/pre_registration_route_revision_required/i);
  assert.match(forensic,/v_route\.route_revision is distinct from v_presented_route_revision/i);
  assert.match(forensic,/insert into public\.pre_registration_legal_presentations\([\s\S]*route_revision/i);
  assert.match(auth,/current\.routeRevision!==presented\.routeRevision/i);
  assert.match(auth,/pre_registration_route_revision:presented\.routeRevision/i);
  assert.match(exportDownload,/pre_registration_legal_presentations'[\s\S]*route_revision/i);
});

check('account export capability issuance is server-rate-limited and bounded per user',()=>{
  const issuer=read('supabase/functions/export-data/index.ts');
  assert.match(issuer,/service_rate_limit_user[\s\S]*account_export_issue[\s\S]*p_limit:10[\s\S]*p_window_seconds:3600/);
  assert.match(issuer,/rate_limit_exceeded[\s\S]*429/);
  assert.match(issuer,/account_export_download_tokens'\)[\s\S]*delete\(\)\.eq\('user_id',user\.id\)/);
  assert.match(issuer,/crypto\.getRandomValues\(new Uint8Array\(32\)\)/);
  assert.match(issuer,/sha256Hex\(token\)/);
});


check('push token rotation restores only the exact previous rows when replacement registration fails',()=>{
  const notifications=read('src/services/notifications.ts');
  assert.match(notifications,/let rotationRollback:PushTokenRollback\|null=null/);
  assert.match(notifications,/mode:'current',token:previousToken[\s\S]*rotationRollback=\{disabledIds:normalizeIds\(data\?\.disabledIds\),localToken:previousToken\}/);
  assert.match(notifications,/register_push_token[\s\S]*if\(error\)\{[\s\S]*restorePushTokensUnlocked\(rotationRollback\)\.catch\(\(\)=>undefined\)[\s\S]*throw error/);
  assert.match(notifications,/let pushLifecycleEpoch=0[\s\S]*invalidatePendingPushRegistrations[\s\S]*epoch!==pushLifecycleEpoch/);
  assert.match(notifications,/queuePushMutation[\s\S]*disableAllPushTokens[\s\S]*invalidatePendingPushRegistrations\(\)/);
});

check('notification response handlers become inert after account or navigation-effect replacement',()=>{
  const navigator=read('src/navigation/AppNavigator.tsx');
  assert.match(navigator,/currentNotificationUserId=useRef<string\|undefined>\(user\?\.id\)/);
  assert.match(navigator,/currentNotificationUserId\.current=user\?\.id/);
  assert.match(navigator,/inFlightNotificationResponses=useRef\(new Map<string,number>\(\)\)/);
  assert.match(navigator,/notificationEffectGeneration=useRef\(0\)/);
  assert.match(navigator,/let cancelled=false;const generation=\+\+notificationEffectGeneration\.current;const effectUserId=user\?\.id/);
  assert.match(navigator,/cancelled\|\|effectUserId!==currentNotificationUserId\.current/);
  assert.match(navigator,/inFlightNotificationResponses\.current\.set\(id,generation\)/);
  assert.match(navigator,/inFlightNotificationResponses\.current\.get\(id\)===generation\)inFlightNotificationResponses\.current\.delete\(id\)/);
  assert.match(navigator,/getLastNotificationResponseAsync\(\)\.then\(r=>\{if\(r&&!cancelled\)read\(r\)\}/);
  assert.match(navigator,/return\(\)=>\{cancelled=true;sub\.remove\(\)\}/);
  assert.match(navigator,/routeNotification\([\s\S]*shouldRoute:[\s\S]*getMatchByConversation[\s\S]*!shouldRoute\(\)[\s\S]*navigate/);
  assert.match(navigator,/pendingNotification\.current[\s\S]*pendingRoutingPetId[\s\S]*routeNotification\(matches,pendingRoutingPetId,pending\.type,pending\.entityId,\(\)=>!cancelled&&effectUserId===currentNotificationUserId\.current\)/);
});

check('auth-state RevenueCat reconciliation ignores stale sign-in and sign-out events',()=>{
  const purchases=read('src/services/purchases.ts');
  const authContext=read('src/contexts/AuthContext.tsx');
  assert.match(purchases,/reconcilePurchasesIdentity\(expectedUserId:string\|null\)[\s\S]*withIdentityLock[\s\S]*supabase\.auth\.getSession\(\)[\s\S]*currentUserId!==expectedUserId[\s\S]*return/);
  assert.match(purchases,/currentUserId[\s\S]*ensurePurchasesIdentityLocked[\s\S]*getSession\(\)[\s\S]*after\.session\?\.user\.id!==currentUserId/);
  assert.match(purchases,/await clearPurchasesIdentityLocked\(\)/);
  assert.match(authContext,/reconcilePurchasesIdentity\(verifiedSession\?\.user\.id\?\?null\)/);
  assert.doesNotMatch(authContext,/else\{void logOutPurchases\(\)/);
});




check('global session revocation closes the access-token grace window and preserves evidence safely',()=>{
  const revocation=read('supabase/migrations/101_session_revocation_and_auth_security.sql');
  const auth=read('src/services/auth.ts');
  const edgeClient=read('supabase/functions/_shared/client.ts');
  for(const table of ['security_revoked_sessions','security_user_revocation_state']){
    assert.match(revocation,new RegExp(`alter table public\.${table} enable row level security`,'i'));
  }
  assert.match(revocation,/revoke all on table public\.security_revoked_sessions,public\.security_user_revocation_state from public,anon,authenticated/i);
  assert.match(revocation,/grant select,insert,update,delete on table public\.security_revoked_sessions,public\.security_user_revocation_state to service_role/i);
  assert.match(revocation,/mark_all_sessions_revoked[\s\S]*insert into public\.security_user_revocation_state[\s\S]*insert into public\.security_revoked_sessions/i);
  assert.match(revocation,/service_session_token_allowed[\s\S]*security_revoked_sessions[\s\S]*security_user_revocation_state/i);
  assert.match(revocation,/grant execute on function public\.current_session_satisfies_mfa_if_enrolled\(\) to authenticated,service_role/i);
  assert.match(revocation,/service_cleanup_revoked_sessions[\s\S]*evidence_hold=true[\s\S]*return 0/i);
  assert.match(auth,/scope==='global'[\s\S]*mark_all_sessions_revoked[\s\S]*revocationCommitted=true[\s\S]*supabase\.auth\.signOut\(\{scope\}\)/);
  assert.match(auth,/scope==='global'&&revocationCommitted[\s\S]*signOut\(\{scope:'local'\}\)[\s\S]*throw error/);
  assert.match(edgeClient,/service_session_token_allowed[\s\S]*session_id[\s\S]*issuedAt/);
});

check('active auth session binding and same-second revocation ambiguity fail closed',()=>{
  const hardening=read('supabase/migrations/103_active_auth_session_and_revocation_second_hardening.sql');
  assert.match(hardening,/join auth\.sessions s on s\.id=t\.session_id_text::uuid[\s\S]*s\.user_id=auth\.uid\(\)/i);
  assert.match(hardening,/service_session_token_allowed[\s\S]*from auth\.sessions s[\s\S]*s\.id=p_session_id and s\.user_id=p_user_id/i);
  assert.match(hardening,/p_iat <= floor\(extract\(epoch from s\.revoked_before\)\)::bigint/i);
  assert.match(hardening,/issued_at <= floor\(extract\(epoch from s\.revoked_before\)\)::bigint/i);
  assert.match(hardening,/when auth\.role\(\)<>'authenticated' or auth\.uid\(\) is null then false/i);
});

check('Auth configuration is source-controlled with short JWTs, rotation, confirmation, MFA and throttling',()=>{
  const authConfig=read('supabase/config.toml');
  assert.match(authConfig,/\[auth\][\s\S]*jwt_expiry\s*=\s*900[\s\S]*enable_refresh_token_rotation\s*=\s*true[\s\S]*refresh_token_reuse_interval\s*=\s*10[\s\S]*enable_anonymous_sign_ins\s*=\s*false/);
  assert.match(authConfig,/\[auth\.rate_limit\][\s\S]*sign_in_sign_ups\s*=\s*20[\s\S]*token_verifications\s*=\s*30[\s\S]*token_refresh\s*=\s*150/);
  assert.match(authConfig,/\[auth\.email\][\s\S]*enable_confirmations\s*=\s*true[\s\S]*double_confirm_changes\s*=\s*true[\s\S]*secure_password_change\s*=\s*true/);
  const section=(name)=>authConfig.match(new RegExp(`\\[${name.replaceAll('.', '\\.')}\\]([\\s\\S]*?)(?=\\n\\[|$)`))?.[1]??'';
  const totpSection=section('auth.mfa.totp');
  const phoneSection=section('auth.mfa.phone');
  const webAuthnSection=section('auth.mfa.web_authn');
  const passkeySection=section('auth.passkey');
  assert.match(totpSection,/enroll_enabled\s*=\s*true[\s\S]*verify_enabled\s*=\s*true/);
  assert.match(phoneSection,/enroll_enabled\s*=\s*true[\s\S]*verify_enabled\s*=\s*true/);
  assert.match(webAuthnSection,/enroll_enabled\s*=\s*false[\s\S]*verify_enabled\s*=\s*false/);
  assert.match(passkeySection,/enabled\s*=\s*false/);
});

check('Android production targets API 36 and enables R8 plus resource shrinking',()=>{
  const pkg=JSON.parse(read('package.json'));
  assert.match(pkg.dependencies['expo-build-properties']??'',/^~57\.0\.22$/);
  assert.match(appConfig,/expo-build-properties[\s\S]*compileSdkVersion:\s*36[\s\S]*targetSdkVersion:\s*36[\s\S]*enableMinifyInReleaseBuilds:\s*true[\s\S]*enableShrinkResourcesInReleaseBuilds:\s*true/);
  assert.match(pkg.dependencies['react-native-purchases']??'',/^\^10\.9\.1$/);
});

check('mobile transport security denies cleartext and ATS exceptions',()=>{
  const networkPlugin=read('plugins/withNetworkSecurity.cjs');
  assert.match(appConfig,/NSAppTransportSecurity:[\s\S]*NSAllowsArbitraryLoads:\s*false[\s\S]*NSAllowsArbitraryLoadsForMedia:\s*false[\s\S]*NSAllowsArbitraryLoadsInWebContent:\s*false[\s\S]*NSAllowsLocalNetworking:\s*false/);
  assert.match(appConfig,/withNetworkSecurity\.cjs/);
  assert.match(networkPlugin,/usesCleartextTraffic['"]?\]\s*=\s*['"]false['"]/);
  assert.match(networkPlugin,/cleartextTrafficPermitted="false"/);
  assert.match(networkPlugin,/certificateTransparency enabled="true"/);
  assert.match(networkPlugin,/src="system"/);
  assert.doesNotMatch(networkPlugin,/src="user"/);
  assert.match(networkPlugin,/android:allowBackup'\]=['"]false['"]/);
  assert.match(networkPlugin,/android:fullBackupContent'\]=['"]@xml\/tailmance_backup_rules['"]/);
  assert.match(networkPlugin,/android:dataExtractionRules'\]=['"]@xml\/tailmance_data_extraction_rules['"]/);
  assert.match(networkPlugin,/tailmance_backup_rules\.xml[\s\S]*exclude domain="sharedpref" path="\."/);
  assert.match(networkPlugin,/tailmance_data_extraction_rules\.xml[\s\S]*<device-transfer>[\s\S]*exclude domain="sharedpref" path="\."/);
  assert.match(appConfig,/expo-secure-store[\s\S]*configureAndroidBackup:\s*false/);
  const transportDecision=read('docs/SECURITY_TRANSPORT_DECISION.md');
  assert.match(transportDecision,/does \*\*not\*\* hard-code brittle certificate or SPKI pins for managed third-party endpoints/i);
  assert.match(transportDecision,/backup SPKI pin/i);
  assert.match(transportDecision,/external production TLS\/header scan/i);
});

check('Edge CORS is HTTPS exact-origin, fail-closed and never wildcard',()=>{
  const cors=read('supabase/functions/_shared/cors.ts');
  assert.match(cors,/CORS_ALLOWED_ORIGIN/);
  assert.match(cors,/raw==='\*'/);
  assert.match(cors,/parsed\.protocol!==['"]https:['"]/);
  assert.match(cors,/parsed\.username\|\|parsed\.password\|\|parsed\.search\|\|parsed\.hash/);
  assert.match(cors,/return parsed\.origin/);
  assert.doesNotMatch(cors,/Access-Control-Allow-Origin['"]?\s*:\s*['"]\*['"]/);
  assert.match(cors,/allowedOrigin\?\{['"]Access-Control-Allow-Origin['"]:allowedOrigin\}:\{\}/);
  assert.match(cors,/['"]Vary['"]\s*:\s*['"]Origin['"]/);
});

check('public web deployment headers enforce clickjacking, MIME, referrer and CSP policy at HTTP level',()=>{
  const headers=read('web/_headers');
  assert.match(headers,/Content-Security-Policy:[^\n]*frame-ancestors 'none'/);
  assert.match(headers,/X-Frame-Options:\s*DENY/);
  assert.match(headers,/X-Content-Type-Options:\s*nosniff/);
  assert.match(headers,/Referrer-Policy:\s*no-referrer/);
  assert.match(headers,/Strict-Transport-Security:\s*max-age=31536000/);
  assert.match(headers,/Permissions-Policy:[^\n]*camera=\(\)[^\n]*microphone=\(\)[^\n]*geolocation=\(\)/);
  assert.match(headers,/\/auth-challenge\.html[\s\S]*Cache-Control:\s*no-store/);
  assert.match(headers,/\/auth-challenge\.html[\s\S]*Content-Security-Policy:[^\n]*frame-ancestors 'none'/);
  assert.match(headers,/\/config\.js[\s\S]*Cache-Control:\s*no-store/);
});

check('all verify_jwt Edge functions use the revocation-aware authenticatedUser boundary',()=>{
  const cfg=read('supabase/config.toml');
  const matches=[...cfg.matchAll(/\[functions\.([a-z0-9-]+)\][\s\S]*?verify_jwt\s*=\s*(true|false)/g)];
  const jwtFunctions=matches.filter(([,name,value])=>value==='true').map(([,name])=>name);
  assert.ok(jwtFunctions.length>0,'Expected authenticated Edge functions');
  for(const name of jwtFunctions){
    const src=read(`supabase/functions/${name}/index.ts`);
    assert.match(src,/authenticatedUser/ ,`${name} must use revocation-aware authenticatedUser`);
    assert.match(src,/await\s+authenticatedUser\(req\)/,`${name} must execute authenticatedUser(req)`);
  }
});

check('documented session lifetime matches source Auth configuration',()=>{
  const authConfig=read('supabase/config.toml');
  const securityDoc=read('docs/SECURITY.md');
  const hostedChecklist=read('docs/PRODUCTION_SUPABASE_AUTH_CHECKLIST.md');
  assert.match(authConfig,/jwt_expiry\s*=\s*900/);
  assert.match(securityDoc,/15-minute JWT/);
  assert.match(hostedChecklist,/15-minute JWT expiry/);
  assert.doesNotMatch(securityDoc,/30-minute JWT/);
  assert.doesNotMatch(hostedChecklist,/30-minute JWT/);
});

check('TOTP MFA is gated at authenticated app entry and protects setup screens',()=>{
  const mfa=read('src/services/mfa.ts');
  const authContext=read('src/contexts/AuthContext.tsx');
  const app=read('App.tsx');
  const challenge=read('src/screens/MfaChallengeScreen.tsx');
  const settingsMfa=read('src/screens/MfaSettingsScreen.tsx');
  assert.match(mfa,/getAuthenticatorAssuranceLevel\(\)/);
  assert.match(mfa,/factorType:'totp'/);
  assert.match(mfa,/challengeAndVerify/);
  assert.match(authContext,/mfaStatus:state\.required\?'required':'satisfied'/);
  assert.match(app,/mfaStatus==='required'[\s\S]*MfaChallengeScreen/);
  assert.match(challenge,/usePreventScreenCapture\('tailmance-mfa-challenge'\)/);
  assert.match(settingsMfa,/usePreventScreenCapture\('tailmance-mfa-settings'\)/);
  assert.doesNotMatch(settingsMfa,/Clipboard|setStringAsync|setString\(/);
  assert.doesNotMatch(settingsMfa,/<Text\s+selectable\s+style=\{styles\.secret\}/,'TOTP secret must not be selectable/copy-friendly');
});

check('MFA-enrolled accounts require AAL2 for account deletion and export',()=>{
  const shared=read('supabase/functions/_shared/client.ts');
  const mfaMigration=read('supabase/migrations/047_mfa_sensitive_action_enforcement.sql');
  const deleteFn=read('supabase/functions/delete-account/index.ts');
  const exportFn=read('supabase/functions/export-data/index.ts');
  assert.match(shared,/requireAal2IfEnrolled[\s\S]*service_user_has_verified_mfa[\s\S]*jwtAal\(token\)!==['"]aal2['"][\s\S]*mfa_required/);
  assert.match(mfaMigration,/auth\.mfa_factors[\s\S]*status::text\s*=\s*'verified'/);
  assert.match(mfaMigration,/revoke all on function public\.service_user_has_verified_mfa\(uuid\) from public, anon, authenticated/);
  assert.match(mfaMigration,/grant execute on function public\.service_user_has_verified_mfa\(uuid\) to service_role/);
  for(const fn of [deleteFn,exportFn]){assert.match(fn,/requireAal2IfEnrolled\(/);assert.match(fn,/mfa_required/)}
});



check('clear local push state is serialized behind in-flight token mutations',()=>{
  const src=read('src/services/notifications.ts');
  assert.match(src,/clearLocalPushState\(\)[\s\S]*invalidatePendingPushRegistrations\(\)[\s\S]*queuePushMutation/);
  assert.match(src,/queuePushMutation\(async\(\)=>\{[\s\S]*removeItem\(PUSH_TOKEN_STORAGE_KEY\)[\s\S]*clearLastNotificationResponseAsync/);
});

check('MFA is enforced at the database product-access boundary',()=>{
  const sql=read('supabase/migrations/048_mfa_product_access_enforcement.sql');
  assert.match(sql,/current_session_satisfies_mfa_if_enrolled[\s\S]*auth\.mfa_factors[\s\S]*auth\.jwt\(\)->>'aal'[\s\S]*'aal2'/);
  assert.match(sql,/current_user_has_product_access[\s\S]*current_session_satisfies_mfa_if_enrolled/);
  assert.match(sql,/trg_users_require_mfa_for_authenticated_update[\s\S]*before update on public\.users/);
  for(const fn of ['get_my_pets','get_account_settings','get_verification_status','get_notifications_page','get_unread_notification_count','mark_notification_read','mark_all_notifications_read','register_push_token']){
    assert.ok(sql.includes(`public.${fn}`),`${fn} must be redefined by the MFA boundary migration`);
  }
  assert.match(sql,/register_push_token[\s\S]*current_user_has_product_access\(\)/);
});

check('Supabase client networking has bounded timeouts and idempotent-read-only exponential retry',()=>{
  const src=read('src/services/supabase.ts');
  assert.match(src,/CLIENT_HTTP_TIMEOUT_MS\s*=\s*45_000/);
  assert.match(src,/AbortController\(\)[\s\S]*setTimeout\([\s\S]*controller\.abort/);
  assert.match(src,/global:\s*\{\s*fetch:\s*supabaseFetch\s*\}/);
  assert.match(src,/upstreamSignal\?\.addEventListener\('abort'/);
  assert.match(src,/idempotentRead=method==='GET'\|\|method==='HEAD'/);
  assert.match(src,/maxAttempts=idempotentRead\?3:1/);
  assert.match(src,/\[429,502,503,504\]\.includes\(response\.status\)/);
  assert.match(src,/250\*\(2\*\*attempt\)/);
  assert.match(src,/retryAfterSeconds[\s\S]*Math\.min\(retryAfterSeconds\*1000,2_000\)/);
});

check('TOTP enrollment cleanup and factor removal preserve authoritative outcome on refresh failure',()=>{
  const service=read('src/services/mfa.ts');
  const screen=read('src/screens/MfaSettingsScreen.tsx');
  assert.match(service,/cancelMfaEnrollment[\s\S]*mfa\.unenroll/);
  assert.match(service,/refreshSession\(\)[\s\S]*return \{refreshError\}/);
  assert.match(screen,/ownedEnrollmentRef[\s\S]*cancelMfaEnrollment\(id\)\.catch/);
  assert.match(screen,/const \{refreshError\}=await unenrollMfaFactor[\s\S]*await load\(\)[\s\S]*mfa\.refreshWarningTitle/);
  assert.match(screen,/mfa\.cancelSetup/);
});

check('password policy is aligned client-to-server and production SDK logging is minimized',()=>{
  const authConfig=read('supabase/config.toml');
  const authService=read('src/services/auth.ts');
  const authScreen=read('src/screens/AuthScreen.tsx');
  const reset=read('src/screens/ResetPasswordScreen.tsx');
  const purchases=read('src/services/purchases.ts');
  assert.match(authConfig,/minimum_password_length\s*=\s*12/);
  assert.match(authConfig,/password_requirements\s*=\s*"lower_upper_letters_digits_symbols"/);
  const passwordPolicy=read('src/domain/passwordPolicy.ts');
  assert.match(passwordPolicy,/password\.length>=12/);
  assert.match(passwordPolicy,/\/\[a-z\]\//);
  assert.match(passwordPolicy,/\/\[A-Z\]\//);
  assert.match(passwordPolicy,/\\d/);
  assert.match(passwordPolicy,/SUPABASE_ALLOWED_SYMBOL/);
  assert.match(authService,/passwordMeetsPolicy\(password\)/);
  assert.match(authScreen,/passwordMeetsPolicy\(password\)/);
  assert.match(reset,/passwordMeetsPolicy\(password\)/);
  assert.match(purchases,/appEnv\s*===\s*'production'\s*\?\s*LOG_LEVEL\.ERROR/);
});

check('identity verification status screen is protected from screen capture',()=>{
  const src=read('src/screens/VerificationCenterScreen.tsx');
  assert.match(src,/usePreventScreenCapture\('tailmance-verification'\)/);
});

check('public web surfaces use a restrictive CSP and deletion logic is externalized',()=>{
  for(const file of ['web/privacy.html','web/terms.html','web/community-guidelines.html','web/support.html','web/delete-account.html']){
    const html=read(file);
    assert.match(html,/Content-Security-Policy/);
    assert.match(html,/object-src 'none'/);
    assert.match(html,/base-uri 'none'/);
  }
  assert.doesNotMatch(deletePage,/<script>(?!<)/);
  assert.match(deletePage,/delete-account\.js/);
  assert.match(deletePageJs,/https:\/\/challenges\.cloudflare\.com\/turnstile/);
  assert.match(deletePageJs,/fetch\(endpoint/);
});



check('residual authenticated RPCs cannot bypass MFA/product gate',()=>{
  const sql=read('supabase/migrations/049_close_residual_mfa_rpc_bypasses.sql');
  assert.match(sql,/can_upload_storage_object[\s\S]*current_user_has_product_access\(\)/);
  assert.match(sql,/cancel_upload_intent[\s\S]*current_session_satisfies_mfa_if_enrolled\(\)[\s\S]*mfa_required/);
  assert.match(sql,/get_conversation_messages\([\s\S]*current_user_has_product_access\(\)/);
  assert.match(sql,/get_conversation_messages_page\([\s\S]*current_user_has_product_access\(\)/);
  assert.match(sql,/get_my_reports\([\s\S]*current_session_satisfies_mfa_if_enrolled\(\)/);
  assert.match(sql,/get_my_reports_page\([\s\S]*current_session_satisfies_mfa_if_enrolled\(\)/);
  assert.match(sql,/get_notifications\([\s\S]*current_user_has_product_access\(\)/);
});



check('media permissions follow least privilege and RTC permissions are call-stack scoped',()=>{
  const uploads=read('src/services/uploads.ts');
  const callScreen=read('src/screens/CallScreen.native.tsx');
  const chat=read('src/screens/ChatScreen.tsx');
  assert.doesNotMatch(uploads,/requestMediaLibraryPermissionsAsync\(/);
  assert.match(uploads,/requestCameraPermissionsAsync\(/);
  assert.match(appConfig,/microphonePermission:\s*'Tailmance uses the microphone only when you start or accept a matched-pet audio or video call\.'/,'image-picker config must preserve the microphone permission needed by matched-pet calls');
  for(const permission of ['android.permission.READ_MEDIA_IMAGES','android.permission.READ_MEDIA_VIDEO','android.permission.READ_EXTERNAL_STORAGE','android.permission.ACCESS_FINE_LOCATION']){
    assert.ok(appConfig.includes(`'${permission}'`),`${permission} must remain blocked`);
  }
  assert.match(appConfig,/permissions:\s*\[[^\]]*'CAMERA'[^\]]*'RECORD_AUDIO'/s,'matched-pet native calls require camera/microphone permissions');
  assert.match(appConfig,/NSMicrophoneUsageDescription:[\s\S]*matched-pet audio or video call/);
  assert.match(appConfig,/NSCameraUsageDescription:[\s\S]*matched-pet video calls/);
  assert.match(chat,/confirmPrePermission\('calls'\)/,'calls must show Tailmance pre-permission UX before native prompts');
  assert.match(callScreen,/LiveKitRoom[\s\S]*audio=\{true\}[\s\S]*video=\{callType==='video'\}/,'RTC permissions must be exercised only by the matched-pet call screen');
});


check('user image uploads strip source metadata and use bounded purpose-appropriate re-encoding',()=>{
  const pkg=JSON.parse(read('package.json'));
  const uploads=read('src/services/uploads.ts');
  assert.equal(pkg.dependencies['expo-image-manipulator'],'~57.0.20');
  assert.match(uploads,/MAX_UPLOAD_IMAGE_EDGE\s*=\s*2400/);
  assert.match(uploads,/MAX_SOCIAL_IMAGE_EDGE\s*=\s*2048/);
  assert.match(uploads,/privacyNormalizeImage[\s\S]*SaveFormat\.WEBP[\s\S]*SaveFormat\.JPEG/);
  assert.match(uploads,/ImageManipulator\.manipulateAsync\(uri,actions,\{compress:[\s\S]*format:saveFormat\}\)/);
  assert.match(uploads,/mimeType:'image\/webp'[\s\S]*extension:'webp'/);
  assert.match(uploads,/mimeType:'image\/jpeg'[\s\S]*extension:'jpg'/);
  assert.ok((uploads.match(/privacyNormalizeImage\(/g)??[]).length>=6,'all image upload paths must use the common privacy normalization boundary');
  assert.ok((uploads.match(/privacyNormalizeImage\(asset\.uri,asset\.width,asset\.height,'webp'\)/g)??[]).length>=4,'pet/social media upload paths must use WebP normalization');
  assert.match(uploads,/health-documents[\s\S]*privacyNormalizeImage\(asset\.uri\)/,'health-document images must retain provider-compatible JPEG normalization');
  assert.match(uploads,/pet-verification[\s\S]*privacyNormalizeImage\(asset\.uri,asset\.width,asset\.height\)/,'verification images must retain provider-compatible JPEG normalization');
});

check('configured-country source legal/language gate is current, exact-route bound and separated from live external production evidence',()=>{
  const pkg=JSON.parse(read('package.json'));
  const gate=read('scripts/country-release-check.mjs');
  const matrix=JSON.parse(read('release/country-release-gates.json'));
  const releaseRunner=read('scripts/release-check-all.mjs');
  assert.match(pkg.scripts['release:check'],/release-check-all\.mjs/);
  assert.match(releaseRunner,/release:country/);
  assert.equal(matrix.default_policy.unknown_or_unlisted_iso_country,'BLOCK');
  assert.equal(matrix.default_policy.release_status,'blocked_unlisted_or_unapproved');
  assert.match(gate,/TAILMANCE_TARGET_COUNTRIES is required/);
  assert.match(releaseRunner,/configuredSourceTargets/);
  assert.match(releaseRunner,/TAILMANCE_TARGET_COUNTRIES:\(process\.env\.TAILMANCE_TARGET_COUNTRIES/);
  assert.match(gate,/PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW/);
  assert.match(gate,/PASS_INTERNAL_LEGAL_LANGUAGE_QA/);
  assert.match(gate,/exact country×document-locale/i);
  assert.doesNotMatch(gate,/approved_by_external_counsel/);
  assert.match(releaseRunner,/external legal/);
});

check('unverifiable dashboard and device controls are isolated behind a fail-closed evidence gate',()=>{
  const pkg=JSON.parse(read('package.json'));
  const evidence=JSON.parse(read('release/external-security-evidence.json'));
  const gate=read('scripts/external-security-release-check.mjs');
  assert.equal(evidence.policy,'fail_closed');
  for(const required of ['apple_app_attest_server_verification','google_play_integrity_server_verification','sentry_native_crash_symbolication','revenuecat_apple_server_notifications','revenuecat_google_rtdn','revenuecat_tailmance_webhook','iap_sandbox_lifecycle','native_auth_anti_bot_challenge','physical_device_security_smoke','production_push_credentials_and_delivery','production_livekit_terminal_room_teardown','production_tls_endpoint_scan','production_mobile_transport_pinning_decision','production_data_at_rest_encryption_and_key_management','google_maps_android_api_key_restrictions','ios_merged_privacy_manifest_required_reason_audit','release_binary_hardening_audit','production_moderation_provider_quality_and_sla','moderation_provider_and_response_sla','hosted_supabase_auth_effective_config','security_incident_response_tabletop_27_markets']){
    assert.equal(evidence.items?.[required]?.required,true,`${required} must remain release-blocking`);
  }
  const releaseRunner=read('scripts/release-check-all.mjs');
  assert.match(pkg.scripts['release:check'],/release-check-all\.mjs/);
  assert.match(releaseRunner,/release:external-security/);
  assert.match(gate,/Do not change a status to verified until/);
});

check('native crash reporting is source-wired with privacy-minimal defaults and release-only credentials',()=>{
  const pkg=JSON.parse(read('package.json'));
  const crash=read('src/services/crashReporting.ts');
  const cfg=read('src/services/config.ts');
  const metro=read('metro.config.cjs');
  assert.equal(pkg.dependencies['@sentry/react-native'],'8.28.0');
  assert.match(crash,/sendDefaultPii:\s*false/);
  assert.match(crash,/attachScreenshot:\s*false/);
  assert.match(crash,/attachViewHierarchy:\s*false/);
  assert.match(crash,/delete event\.user/);
  assert.match(cfg,/sentryDsn: value\(process\.env\.EXPO_PUBLIC_SENTRY_DSN\)/);
  assert.match(appConfig,/@sentry\/react-native\/expo/);
  assert.match(appConfig,/GOOGLE_SERVICES_JSON[\s\S]*googleServicesFile/,'Android production push config must bind google-services.json through a build-time file env');
  assert.match(metro,/getSentryExpoConfig/);
});


check('LeakCanary is development-only and cannot enter Android release implementation',()=>{
  const plugin=read('plugins/withLeakCanary.cjs');
  assert.match(appConfig,/withLeakCanary\.cjs/);
  assert.match(plugin,/debugImplementation 'com\.squareup\.leakcanary:leakcanary-android:2\.14'/);
  assert.doesNotMatch(plugin,/^[ \t]*releaseImplementation/m);
});


check('production runtime refuses a non-HTTPS Supabase endpoint even before release config validation',()=>{
  const cfg=read('src/services/config.ts');
  assert.match(cfg,/env\.appEnv==='production' \? \/\^https:\\\/\\\//);
  assert.match(cfg,/backendUrlIsAllowed/);
});


check('CI enforces reproducible installs, high-severity dependency audit and least GitHub token privilege',()=>{
  const ci=read('.github/workflows/ci.yml');
  const dependabot=read('.github/dependabot.yml');
  assert.match(ci,/permissions:\s*\n\s*contents: read/);
  assert.match(ci,/npm ci --ignore-scripts/);
  assert.match(ci,/npm audit --omit=dev --audit-level=high/);
  assert.doesNotMatch(ci,/npm install --ignore-scripts/);
  assert.match(dependabot,/package-ecosystem: npm/);
  assert.match(dependabot,/package-ecosystem: github-actions/);
});



check('App Attest and Play Integrity native bridge is production-bound but server authoritative',()=>{
  const gradle=read('modules/tailmance-device-integrity/android/build.gradle');
  const ios=read('modules/tailmance-device-integrity/ios/TailmanceDeviceIntegrityModule.swift');
  const android=read('modules/tailmance-device-integrity/android/src/main/java/expo/modules/tailmancedeviceintegrity/TailmanceDeviceIntegrityModule.kt');
  const client=read('src/services/deviceIntegrity.ts');
  assert.match(gradle,/com\.google\.android\.play:integrity:1\.6\.0/);
  assert.match(appConfig,/com\.apple\.developer\.devicecheck\.appattest-environment/);
  assert.match(ios,/DCAppAttestService/);
  assert.match(ios,/attestKey/);
  assert.match(ios,/generateAssertion/);
  assert.match(android,/StandardIntegrityManager/);
  assert.match(android,/setRequestHash/);
  assert.match(client,/secureStorage\.setItem\(storageKey,candidate\)/);
  assert.match(client,/verify-device-integrity/);
  assert.doesNotMatch(client,/verdict\s*=\s*['"]verified['"]|trusted\s*=\s*true/);
});

check('device integrity Edge verifier binds challenge, app identity, signing certificate, version and freshness',()=>{
  const fn=read('supabase/functions/verify-device-integrity/index.ts');
  assert.match(fn,/readRequestJsonBounded<.*>\(req,64_000\)/);
  assert.match(fn,/CHALLENGE_TTL_MS=5\*60\*1000/);
  assert.match(fn,/service_rate_limit_user/);
  assert.match(fn,/service_claim_device_integrity_challenge/);
  assert.match(fn,/requestHash===expectedHash/);
  assert.match(fn,/PLAY_INTEGRITY_ALLOWED_CERT_SHA256/);
  assert.match(fn,/PLAY_INTEGRITY_ALLOWED_VERSION_CODES/);
  assert.match(fn,/PLAY_RECOGNIZED/);
  assert.match(fn,/MEETS_DEVICE_INTEGRITY/);
  assert.match(fn,/appLicensingVerdict==='LICENSED'/);
  assert.match(fn,/Math\.abs\(Date\.now\(\)-timestamp\)<=5\*60\*1000/);
  assert.match(fn,/APPLE_APP_ATTEST_VERIFIER_URL/);
  assert.match(fn,/requireAllowlistedHttpsUrl/);
  assert.match(fn,/APPLE_APP_ATTEST_VERIFIER_ALLOWED_HOSTS_JSON/);
  assert.match(fn,/expectedAppId/);
  assert.match(fn,/service_finish_device_integrity_challenge/);
});

check('negative device-integrity verdicts are retained as bounded security evidence while provider outages remain fail-closed transient errors',()=>{
  const fn=read('supabase/functions/verify-device-integrity/index.ts');
  assert.match(fn,/p_verdict:'rejected'/);
  assert.match(fn,/return json\(\{error:'device_integrity_rejected'\},403\)/);
  assert.match(fn,/play_integrity_decode_unavailable/);
  assert.match(fn,/play_integrity_token_rejected/);
  assert.match(fn,/app_attest_verifier_unavailable/);
  assert.match(fn,/device_integrity_temporarily_unavailable'\},503/);
  assert.match(fn,/untrustedClientRiskSignals/);
});

check('service-role security response can revoke every known session without trusting client risk heuristics',()=>{
  const sql=read('supabase/migrations/105_security_risk_evidence_and_operator_session_revocation.sql');
  assert.match(sql,/service_revoke_user_sessions/);
  assert.match(sql,/auth\.role\(\)<>'service_role'/);
  assert.match(sql,/insert into public\.security_user_revocation_state/);
  assert.match(sql,/from auth\.sessions s[\s\S]*where s\.user_id=p_user_id/);
  assert.match(sql,/insert into public\.security_revoked_sessions/);
  assert.match(sql,/revoke all on function public\.service_revoke_user_sessions\(uuid,text\) from public,anon,authenticated/);
  assert.match(sql,/never revoke accounts by themselves|does not trust client-side root\/debug heuristics/i);
});

check('device integrity challenges are one-time service-only records with bounded attempts and claim lock',()=>{
  const sql=read('supabase/migrations/097_device_integrity_challenge_and_risk_gate.sql');
  assert.match(sql,/security_attestation_challenges[\s\S]*expires_at timestamptz not null[\s\S]*attempts integer not null default 0 check\(attempts between 0 and 3\)/);
  assert.match(sql,/consumed_at is null and expires_at>now\(\) and attempts<3/);
  assert.match(sql,/claimed_at is null or claimed_at<now\(\)-interval '45 seconds'/);
  assert.match(sql,/revoke all on table public\.security_attestation_challenges from public,anon,authenticated/);
  assert.match(sql,/grant select,insert,update,delete on table public\.security_attestation_challenges to service_role/);
  assert.match(sql,/get diagnostics changed=row_count[\s\S]*if changed<>1 then return false/);
});

check('App Attest assertions are key-bound, monotonic and device integrity gates are action-bound',()=>{
  const sql=read('supabase/migrations/098_device_integrity_action_binding_and_app_attest_replay.sql');
  assert.match(sql,/security_app_attest_keys/);
  assert.match(sql,/last_assertion_counter bigint not null default 0/);
  assert.match(sql,/p_assertion_counter<=v_key\.last_assertion_counter[\s\S]*app_attest_counter_replay/);
  assert.match(sql,/where a\.user_id=p_user_id and a\.action=p_action and a\.verdict='verified'/);
  assert.match(sql,/revoke all on table public\.security_app_attest_keys from public,anon,authenticated/);
});

check('abuse-prone authenticated writes have action-specific integrity enforcement and client preflight',()=>{
  const sql=read('supabase/migrations/099_device_integrity_high_risk_write_enforcement.sql');
  const api=read('src/services/api.ts');
  for(const [table,action] of [['lost_pet_alerts','lost_pet_alert'],['pet_events','event_create'],['meetup_requests','meetup_create'],['pet_boosts','boost_activate'],['user_travel_mode','travel_mode']]){
    assert.ok(sql.includes(`when '${table}' then '${action}'`),`${table} integrity action missing`);
    assert.ok(api.includes(`bestEffortDeviceIntegrity('${action}')`),`${action} client preflight missing`);
  }
  assert.match(sql,/new\.kind='super_like'[\s\S]*'super_like'/);
  assert.match(api,/kind==='super_like'[\s\S]*bestEffortDeviceIntegrity\('super_like'\)/);
  for(const trigger of ['trg_integrity_lost_pet_alert','trg_integrity_pet_event','trg_integrity_meetup','trg_integrity_pet_boost','trg_integrity_travel_mode','trg_integrity_super_like'])assert.ok(sql.includes(trigger),`${trigger} missing`);
});

check('production release config requires exact app-integrity server identities and secrets',()=>{
  const server=read('scripts/server-release-config-check.mjs');
  const client=read('scripts/release-config-check.mjs');
  for(const key of ['GOOGLE_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON','PLAY_INTEGRITY_PACKAGE_NAME','PLAY_INTEGRITY_ALLOWED_CERT_SHA256','PLAY_INTEGRITY_ALLOWED_VERSION_CODES','APPLE_APP_ATTEST_VERIFIER_URL','APPLE_APP_ATTEST_VERIFIER_SECRET','APPLE_APP_ATTEST_APP_ID']) assert.ok(server.includes(`'${key}'`),`${key} server release requirement missing`);
  assert.match(server,/APPLE_APP_ATTEST_VERIFIER_URL[\s\S]*must use HTTPS/);
  assert.match(server,/PLAY_INTEGRITY_ALLOWED_VERSION_CODES/);
  assert.match(client,/EXPO_PUBLIC_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER/);
  assert.match(client,/numeric Google Cloud project number/);
});


check('client auth/session secrets stay in SecureStore and the only local database is SQLCipher encrypted',()=>{
  const storage=read('src/services/secureStorage.ts');
  const supabase=read('src/services/supabase.ts');
  const pkg=JSON.parse(read('package.json'));
  const queue=read('src/services/offlineMutationQueue.ts');
  const config=read('app.config.ts');
  assert.match(storage,/expo-secure-store/);
  assert.match(storage,/WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
  assert.match(supabase,/storage:\s*Platform\.OS === 'web' \? undefined : secureStorage/);
  assert.match(supabase,/persistSession:\s*Platform\.OS !== 'web'/);
  assert.match(supabase,/autoRefreshToken:\s*Platform\.OS !== 'web'/);
  assert.doesNotMatch(supabase,/localStorage|sessionStorage/);
  assert.equal(pkg.dependencies['expo-sqlite'],'~57.0.3');
  assert.match(config,/expo-sqlite[\s\S]*useSQLCipher:\s*true/);
  assert.match(queue,/PRAGMA key = '\$\{key\}'/);
  assert.match(queue,/PRAGMA cipher_version/);
  assert.match(queue,/generateSecureRandomBase64UrlAsync\(32\)/);
  assert.match(queue,/owner_user_id/);
  const otherClientFiles=globSync('src/**/*.{ts,tsx}').filter(path=>path!=='src/services/offlineMutationQueue.ts').map(read).join('\n');
  assert.doesNotMatch(otherClientFiles,/AsyncStorage|SharedPreferences|UserDefaults|expo-sqlite|SQLite\.openDatabase|Realm\b|MMKV\b/);
});

check('client production logging and clipboard hygiene do not expose sensitive values',()=>{
  const clientFiles=globSync('src/**/*.{ts,tsx}').map(p=>({p,s:read(p)}));
  const clipboardHits=clientFiles.filter(({s})=>/Clipboard|setStringAsync\(|setString\(/.test(s));
  assert.equal(clipboardHits.length,0,`sensitive clipboard API present in: ${clipboardHits.map(x=>x.p).join(', ')}`);
  for(const {p,s} of clientFiles){
    const lines=s.split(/\r?\n/);
    for(let i=0;i<lines.length;i++){
      if(!/console\.(?:log|warn|error|debug|info)\s*\(/.test(lines[i]))continue;
      const nearby=lines.slice(Math.max(0,i-1),i+1).join(' ');
      assert.match(nearby,/__DEV__/,`${p}:${i+1} client console call must be dev-gated`);
    }
  }
});

check('all Tailmance high-sensitivity screens are screen-capture protected',()=>{
  const required={
    'src/screens/MfaSettingsScreen.tsx':'tailmance-mfa-settings',
    'src/screens/MfaChallengeScreen.tsx':'tailmance-mfa-challenge',
    'src/screens/ResetPasswordScreen.tsx':'tailmance-password-reset',
    'src/screens/VerificationCenterScreen.tsx':'tailmance-verification',
    'src/screens/HealthScreen.tsx':'tailmance-health',
    'src/screens/ChatScreen.tsx':'tailmance-chat'
  };
  for(const [path,key] of Object.entries(required)){
    const src=read(path);
    assert.match(src,/expo-screen-capture/,`${path} must use expo-screen-capture`);
    assert.ok(src.includes(`usePreventScreenCapture('${key}')`),`${path} capture-protection key drift`);
  }
});

check('native auth anti-bot source flow is CSPRNG/state-bound and deployment remains fail-closed external evidence',()=>{
  const evidence=JSON.parse(read('release/external-security-evidence.json'));
  const authConfig=read('supabase/config.toml');
  const authChallenge=read('src/services/authChallenge.ts');
  const auth=read('src/services/auth.ts');
  const android=read('modules/tailmance-device-integrity/android/src/main/java/expo/modules/tailmancedeviceintegrity/TailmanceDeviceIntegrityModule.kt');
  const ios=read('modules/tailmance-device-integrity/ios/TailmanceDeviceIntegrityModule.swift');
  const challengePage=read('web/auth-challenge.html');
  const challengeJs=read('web/auth-challenge.js');
  const clientRelease=read('scripts/release-config-check.mjs');
  const webConfigGenerator=read('scripts/generate-web-runtime-config.mjs');
  assert.match(authConfig,/\[auth\.rate_limit\][\s\S]*sign_in_sign_ups\s*=\s*20/);
  assert.match(authConfig,/email_sent\s*=\s*6[\s\S]*sms_sent\s*=\s*6/);
  assert.match(authConfig,/\[auth\.captcha\][\s\S]*enabled\s*=\s*true[\s\S]*provider\s*=\s*["']turnstile["']/);
  assert.match(authConfig,/\[auth\.sessions\][\s\S]*timebox\s*=\s*["']30d["'][\s\S]*inactivity_timeout\s*=\s*["']14d["']/);
  assert.match(android,/SecureRandom\(\)\.nextBytes/);
  assert.match(ios,/SecRandomCopyBytes/);
  assert.match(authChallenge,/generateSecureRandomBase64UrlAsync\(24\)/);
  assert.match(authChallenge,/requireSafeExternalHttpsUrl\(raw\)/);
  assert.match(authChallenge,/!CALLBACK_SCHEMES\.has\(parsed\.protocol\)\|\|parsed\.hostname\.toLowerCase\(\)!==CALLBACK_HOST/);
  assert.match(authChallenge,/searchParams\.get\('action'\)!==action\|\|parsed\.searchParams\.get\('state'\)!==state/);
  assert.match(authChallenge,/auth_challenge_timeout/);
  for(const action of ['sign_up','sign_in','password_reset','phone_otp'])assert.ok(auth.includes(`requestNativeAuthCaptcha('${action}')`),`${action} CAPTCHA hook missing`);
  assert.ok((auth.match(/captchaToken/g)??[]).length>=4,'captchaToken must reach Supabase Auth flows');
  assert.match(challengePage,/Content-Security-Policy/);
  assert.match(challengePage,/frame-ancestors 'none'/);
  assert.match(challengeJs,/authTurnstileSiteKey/);
  assert.match(challengeJs,/new URL\('tailmance:\/\/auth-challenge'\)/);assert.match(authChallenge,/CALLBACK_SCHEMES=new Set\(\['tailmance:'\]\)/);
  assert.match(clientRelease,/EXPO_PUBLIC_AUTH_CHALLENGE_URL/);
  assert.match(webConfigGenerator,/TAILMANCE_WEB_AUTH_TURNSTILE_SITE_KEY/);
  assert.match(webConfigGenerator,/JSON\.stringify/);
  assert.match(webConfigGenerator,/--check-file/);
  assert.equal(evidence.items?.native_auth_anti_bot_challenge?.required,true);
  assert.equal(evidence.items?.native_auth_anti_bot_challenge?.status,'not_verified');
  assert.match(evidence.items?.native_auth_anti_bot_challenge?.notes??'',/hosted Supabase Auth CAPTCHA|physical-device/i);
});


check('auth bootstrap rejects revoked or deleted GoTrue sessions before exposing the app shell',()=>{
  const authContext=read('src/contexts/AuthContext.tsx');
  assert.match(authContext,/supabase\.auth\.getSession\(\)/);
  assert.match(authContext,/supabase\.rpc\('current_session_not_revoked'\)/);
  assert.match(authContext,/active!==true[\s\S]*signOut\(\{scope:'local'\}\)/);
});

check('Edge request bodies and outbound network calls are bounded by shared helpers',()=>{
  const edgeFiles=globSync('supabase/functions/**/*.ts');
  for(const p of edgeFiles){
    if(p.endsWith('/_shared/http.ts'))continue;
    const src=read(p);
    assert.doesNotMatch(src,/\breq\.(?:json|text|arrayBuffer|formData)\s*\(/,`${p} must use bounded request-body readers`);
    assert.doesNotMatch(src,/\bfetch\s*\(/,`${p} must use fetchWithTimeout for outbound network I/O`);
  }
  const http=read('supabase/functions/_shared/http.ts');
  assert.match(http,/readRequestJsonBounded/);
  assert.match(http,/readRequestTextBounded/);
  assert.match(http,/AbortController/);
  assert.match(http,/total > maxBytes/);
});

check('internal worker/admin bearer secrets use a shared constant-time verifier',()=>{
  const helper=read('supabase/functions/_shared/secretAuth.ts');
  assert.match(helper,/constantTimeEqualText/);
  assert.match(helper,/minSecretLength=20/);
  assert.match(helper,/diff\|=/);
  const protectedFiles=[
    'vaccination-reminders','ops-health','moderation-admin','reports-admin','moderate-media','push-dispatch',
    'storage-gc','external-deletion-worker','process-account-deletion-request','moderation-appeals-admin','push-receipts'
  ];
  for(const name of protectedFiles){
    const src=read(`supabase/functions/${name}/index.ts`);
    assert.match(src,/verifyBearerSecret\(req\.headers\.get\('Authorization'\),secret\)/,`${name} must use constant-time bearer verification`);
    assert.doesNotMatch(src,/req\.headers\.get\('Authorization'\)\s*!==\s*`Bearer/,`${name} must not use direct secret equality`);
  }
});

check('security admin exposes only bounded constant-time emergency session revocation',()=>{
  const src=read('supabase/functions/security-admin/index.ts');
  assert.match(src,/SECURITY_ADMIN_SECRET/);
  assert.match(src,/verifyBearerSecret\(req\.headers\.get\('Authorization'\),secret,32\)/);
  assert.match(src,/readRequestJsonBounded<any>\(req,8_192\)/);
  assert.match(src,/action!=='revoke_user_sessions'/);
  assert.match(src,/REASONS=new Set\(\['suspected_account_compromise','security_incident_response','credential_recovery','operator_emergency'\]\)/);
  assert.match(src,/service_revoke_user_sessions/);
  assert.doesNotMatch(src,/rootOrJailbreakHeuristic|debuggerAttached|emulatorOrSimulator/,'local device heuristics must never auto-trigger global account revocation');
});

check('Edge functions do not shadow the shared hardened JSON response helper',()=>{
  const edgeFiles=globSync('supabase/functions/*/index.ts');
  const offenders=edgeFiles.filter(p=>/function\s+json\s*\(/.test(read(p)));
  assert.deepEqual(offenders,[],`local Edge json helper bypasses shared hardening: ${offenders.join(', ')}`);
});

check('Edge JSON responses are non-cacheable and carry baseline anti-sniff/referrer headers',()=>{
  const cors=read('supabase/functions/_shared/cors.ts');
  assert.match(cors,/Cache-Control': 'no-store, max-age=0'/);
  assert.match(cors,/X-Content-Type-Options': 'nosniff'/);
  assert.match(cors,/Referrer-Policy': 'no-referrer'/);
  assert.match(cors,/application\/json; charset=utf-8/);
});


check('outbound provider URLs are exact-host allowlisted and SSRF-resistant',()=>{
  const helper=read('supabase/functions/_shared/outboundUrl.ts');
  const moderation=read('supabase/functions/moderate-media/index.ts');
  const verification=read('supabase/functions/start-owner-verification/index.ts');
  const integrity=read('supabase/functions/verify-device-integrity/index.ts');
  const serverRelease=read('scripts/server-release-config-check.mjs');
  assert.match(helper,/parseExactHostAllowlist/);
  assert.match(helper,/parsed\.protocol!==['"]https:/);
  assert.match(helper,/parsed\.username\|\|parsed\.password/);
  assert.match(helper,/parsed\.port&&parsed\.port!==['"]443['"]/);
  assert.match(helper,/localhost/);
  assert.match(helper,/literal IPs|literal IP/i);
  assert.match(moderation,/MODERATION_ALLOWED_HOSTS_JSON/);
  assert.match(verification,/IDENTITY_PROVIDER_ALLOWED_HOSTS_JSON/);
  assert.match(verification,/returnUrl!=='tailmance:\/\/verification-complete'/);
  assert.match(integrity,/APPLE_APP_ATTEST_VERIFIER_ALLOWED_HOSTS_JSON/);
  for(const key of ['MODERATION_ALLOWED_HOSTS_JSON','IDENTITY_PROVIDER_ALLOWED_HOSTS_JSON','APPLE_APP_ATTEST_VERIFIER_ALLOWED_HOSTS_JSON'])assert.ok(serverRelease.includes(`'${key}'`),`${key} release requirement missing`);
  assert.match(serverRelease,/validateHttpsEndpointAgainstAllowlist\('MODERATION_API_URL','MODERATION_ALLOWED_HOSTS_JSON'\)/);
  assert.match(serverRelease,/IDENTITY_PROVIDER_RETURN_URL[\s\S]*tailmance[\s\S]*verification-complete/);
});

check('public web security headers request HSTS and legacy plugin isolation',()=>{
  const headers=read('web/_headers');
  assert.match(headers,/Strict-Transport-Security: max-age=31536000/);
  assert.match(headers,/X-Permitted-Cross-Domain-Policies: none/);
  assert.match(headers,/frame-ancestors 'none'/);
  assert.match(headers,/Permissions-Policy: camera=\(\), microphone=\(\), geolocation=\(\), payment=\(\)/);
});


check('user-facing partner URLs are HTTPS/DNS constrained at DB and client boundaries',()=>{
  const sql=read('supabase/migrations/106_safe_external_url_and_outbound_host_hardening.sql');
  const helper=read('src/services/externalLinks.ts');
  const places=read('src/screens/PlacesScreen.tsx');
  const events=read('src/screens/EventsScreen.tsx');
  assert.match(sql,/is_safe_public_https_url/);
  assert.match(sql,/unsafe_external_url/);
  for(const trigger of ['trg_safe_external_urls_places','trg_safe_external_urls_partners','trg_safe_external_urls_offers'])assert.ok(sql.includes(trigger),`${trigger} missing`);
  assert.match(sql,/not in \('localhost','localhost\.'\)/);
  assert.match(sql,/!~ '@'/);
  assert.match(helper,/parsed\.protocol!==['"]https:['"]/);
  assert.match(helper,/parsed\.username\|\|parsed\.password\|\|parsed\.port/);
  assert.match(helper,/unsafeHost\(parsed\.hostname\)/);
  assert.match(places,/openSafeExternalHttpsUrl\(url\)/);
  assert.match(events,/openSafeExternalHttpsUrl\(offer\.bookingUrl\)/);
});


check('Edge production logs never serialize request, auth, user or provider payload data',()=>{
  const files=globSync('supabase/functions/**/*.ts').filter(p=>!p.includes('/_shared/'));
  for(const p of files){
    const src=read(p);
    const lines=src.split(/\r?\n/);
    for(let i=0;i<lines.length;i++){
      if(!/console\.(?:log|warn|error|debug|info)\s*\(/.test(lines[i]))continue;
      const line=lines[i];
      const call=line.slice(line.indexOf('console.'));
      assert.match(call,/^console\.(?:log|warn|error|debug|info)\s*\(\s*['"][A-Za-z0-9_.:-]+['"]\s*\);?$/,`${p}:${i+1} Edge log must be a fixed non-PII event code`);
      assert.doesNotMatch(call,/req|request|token|email|phone|userId|payload|body|JSON\.stringify/i,`${p}:${i+1} Edge log references sensitive/runtime data`);
    }
  }
});


check('store rating and subscription-management links use the common safe HTTPS opener',()=>{
  const rating=read('src/services/storeRating.ts');
  const purchases=read('src/services/purchases.ts');
  assert.match(rating,/openSafeExternalHttpsUrl\(url\)/);
  assert.doesNotMatch(rating,/Linking\.openURL/);
  assert.match(purchases,/openSafeExternalHttpsUrl\(url\)/);
  assert.match(purchases,/https:\/\/apps\.apple\.com\/account\/subscriptions/);
  assert.match(purchases,/https:\/\/play\.google\.com\/store\/account\/subscriptions/);
});

check('Expo SDK 57 status-bar dependency is pinned to the published compatible line',()=>{
  const pkg=JSON.parse(read('package.json'));
  assert.equal(pkg.dependencies?.['expo-status-bar'],'~57.0.1');
});

check('Expo xcode uuid advisory is mitigated with a narrow patched transitive override',()=>{
  const pkg=JSON.parse(read('package.json'));
  assert.equal(pkg.overrides?.xcode?.uuid,'11.1.1');
});


check('TOTP enrollment opening revalidates the custom URI at the final Linking boundary',()=>{
  const mfa=read('src/services/mfa.ts');
  const screen=read('src/screens/MfaSettingsScreen.tsx');
  assert.match(mfa,/openTotpEnrollmentUri[\s\S]*requireSafeTotpEnrollmentUri\(input\)[\s\S]*Linking\.canOpenURL\(url\)[\s\S]*Linking\.openURL\(url\)/);
  assert.match(screen,/openTotpEnrollmentUri\(totpEnrollment\.uri\)/);
  assert.doesNotMatch(screen,/Linking\.openURL/);
});

check('auth challenge launch uses the shared public HTTPS boundary instead of raw Linking.openURL',()=>{
  const src=read('src/services/authChallenge.ts');
  assert.match(src,/requireSafeExternalHttpsUrl\(raw\)/);
  assert.match(src,/openSafeExternalHttpsUrl\(base\.toString\(\)\)/);
  assert.doesNotMatch(src,/Linking\.openURL/);
});

check('legal and support links reuse the shared public HTTPS opener',()=>{
  const src=read('src/services/legalLinks.ts');
  assert.match(src,/requireSafeExternalHttpsUrl\(input\)/);
  assert.match(src,/openSafeExternalHttpsUrl\(requireSafeLegalHttpsUrl\(input\)\)/);
  assert.doesNotMatch(src,/Linking\.openURL/);
});

check('owner verification provider identifiers are privacy-minimized to SHA-256 only',()=>{
  const migration=read('supabase/migrations/110_owner_verification_reference_privacy_and_retry_hardening.sql');
  const edge=read('supabase/functions/start-owner-verification/index.ts');
  assert.match(migration,/provider_reference_sha256[\s\S]*extensions\.digest/);
  assert.match(migration,/provider_reference=null/);
  assert.match(migration,/owner_verification_sessions_raw_provider_reference_forbidden/);
  assert.match(edge,/provider_reference_sha256:providerReference\?await sha256Hex\(providerReference\):null/);
  assert.match(edge,/provider_reference:null/);
  assert.doesNotMatch(edge,/provider_reference:providerReference/);
});

check('age and owner verification provider setup failures cannot strand a pending session',()=>{
  const age=read('supabase/functions/start-age-assurance/index.ts');
  const owner=read('supabase/functions/start-owner-verification/index.ts');
  assert.match(age,/markAgeAssuranceFailed[\s\S]*status:'failed'/);
  assert.match(age,/reference\.length>200\)[\s\S]*markAgeAssuranceFailed\(admin,session\.id\)/);
  assert.match(age,/expireError[\s\S]*age_assurance_state_write_failed/);
  assert.match(age,/requireAllowlistedHttpsUrl\(String\(payload\.url\)[\s\S]*catch\{await markAgeAssuranceFailed\(admin,session\.id\)/);
  assert.match(age,/referenceUpdateError[\s\S]*markAgeAssuranceFailed\(admin,session\.id\)/);
  assert.match(owner,/referenceUpdateError[\s\S]*markVerificationFailed\(supabase,session\.id\)/);
});

check('account export includes verification lifecycle status without opaque provider correlation hashes',()=>{
  const src=read('supabase/functions/export-download/index.ts');
  assert.match(src,/owner_verification_sessions[\s\S]*status[\s\S]*expires_at/);
  assert.match(src,/legal_age_assurance_sessions[\s\S]*status[\s\S]*expires_at/);
  const owner=/owner_verification_sessions[^\n]*select\('([^']+)'\)/.exec(src)?.[1]??'';
  const age=/legal_age_assurance_sessions[^\n]*select\('([^']+)'\)/.exec(src)?.[1]??'';
  assert.ok(owner&&!owner.includes('provider_reference_sha256'));assert.ok(age&&!age.includes('provider_reference_sha256'));
});


check('privacy data map reflects verified-external age assurance and hashed verification references',()=>{
  const map=read('docs/PRIVACY_DATA_MAP.md');
  assert.match(map,/verified_external/);
  assert.match(map,/Age-assurance session\/result metadata/);
  assert.match(map,/provider\/evidence references are SHA-256 minimized/);
  assert.match(map,/raw provider identifiers are forbidden/);
  assert.doesNotMatch(map,/age verification remains DOĞRULANAMADI/);
});

check('MFA enrollment rolls back orphan factors when enrollment material or phone challenge creation fails',()=>{const mfa=read('src/services/mfa.ts');assert.match(mfa,/enrollTotp[\s\S]*mfa\.unenroll\(\{factorId:data\.id\}\)/);assert.match(mfa,/enrollPhone[\s\S]*mfa\.challenge\(\{factorId:data\.id\}\)[\s\S]*mfa\.unenroll\(\{factorId:data\.id\}\)/)});
check('push transports are independently last-intent-wins across active-pet changes',()=>{const notifications=read('src/services/notifications.ts');assert.match(notifications,/expoPushRegistrationIntent=0[\s\S]*voipPushRegistrationIntent=0/);assert.match(notifications,/const intent=\+\+expoPushRegistrationIntent[\s\S]*intent!==expoPushRegistrationIntent[\s\S]*p_transport: 'expo'/);assert.match(notifications,/const intent=\+\+voipPushRegistrationIntent[\s\S]*intent!==voipPushRegistrationIntent[\s\S]*p_transport:'apns_voip'/);assert.match(notifications,/invalidatePendingPushRegistrations=\(\)=>\{pushLifecycleEpoch\+=1;expoPushRegistrationIntent\+=1;voipPushRegistrationIntent\+=1/)});
check('account deletion deterministically erases append-only user legal evidence before Auth deletion',()=>{const migration=read('supabase/migrations/111_account_deletion_legal_evidence_erasure.sql');for(const table of ['legal_overlay_document_actions','legal_age_assurance_events','legal_acceptance_presentations','subscription_precontract_presentations','prelegal_age_attestations','pre_registration_legal_presentations','marketing_consent_events','privacy_notice_acknowledgements','legal_acceptances'])assert.match(migration,new RegExp(`delete from public\\.${table} where user_id=p_user_id`));assert.match(migration,/auth\.role\(\)<>'service_role'/);assert.doesNotMatch(migration,/grant execute[\s\S]*authenticated/);const prep=del.indexOf("prepare_account_legal_evidence_erasure");const authDelete=del.indexOf('auth.admin.deleteUser(userId,false)');assert.ok(prep>=0&&authDelete>prep)});
check('moderation statement remains immutable except FK-safe affected-user de-identification',()=>{const migration=read('supabase/migrations/111_account_deletion_legal_evidence_erasure.sql');assert.match(migration,/old\.affected_user_id is not null[\s\S]*new\.affected_user_id is null[\s\S]*to_jsonb\(new\)-'affected_user_id'[\s\S]*to_jsonb\(old\)-'affected_user_id'/);assert.match(migration,/raise exception 'moderation_statement_of_reasons_is_append_only'/)});
check('owner verification trust badge is revocation-aware',()=>{const migration=read('supabase/migrations/112_owner_verification_revocation_lifecycle.sql');const webhook=read('supabase/functions/identity-verification-webhook/index.ts');assert.match(migration,/v_session\.status='verified' and p_status in \('revoked','expired'\)[\s\S]*status='verified'[\s\S]*identity_verified=v_still_verified/);assert.match(migration,/revoke all on function public\.apply_owner_verification_result\(uuid,text\) from public,anon,authenticated/);assert.match(webhook,/\['verified','failed','expired','cancelled','revoked'\]/)});

check('legal gate rejects stale locale or auth-subject completions',()=>{const nav=read('src/navigation/AppNavigator.tsx');assert.match(nav,/legalCheckRequestRef=useRef\(0\)/);assert.match(nav,/currentLegalUserIdRef/);assert.match(nav,/requestId!==legalCheckRequestRef\.current\|\|currentLegalUserIdRef\.current!==legalUserId/)});
check('account refresh preserves a newer active-pet selection',()=>{const app=read('src/contexts/AppDataContext.tsx');assert.match(app,/const selectedPetId=activePetIdRef\.current/);assert.match(app,/pets\.find\(p=>p\.id===selectedPetId\)/)});
check('full hydration is invalidated by newer filter or feed-mode intent',()=>{const app=read('src/contexts/AppDataContext.tsx');assert.match(app,/const filterSnapshot=filtersRef\.current/);assert.match(app,/const feedModeSnapshot=feedModeRef\.current/);assert.match(app,/filtersRef\.current!==filterSnapshot\|\|feedModeRef\.current!==feedModeSnapshot/)});
check('ordinary and super likes use receipt-backed idempotent mutation surface',()=>{
  const api=read('src/services/api.ts');
  const appData=read('src/contexts/AppDataContext.tsx');
  const migration=read('supabase/migrations/161_offline_swipe_like_response_loss_idempotency.sql');
  assert.match(api,/rpc\('like_pet_idempotent',[\s\S]*p_client_operation_id: operationId/);
  assert.doesNotMatch(api,/rpc\('like_pet',/);
  assert.match(appData,/getOrCreateDurableClientOperation\('like',\[petId,pet\.id,kind\]\)/);
  assert.match(appData,/type:'like'[\s\S]*durableKey:operation\.key[\s\S]*operationId:operation\.id/);
  assert.match(migration,/revoke all on function public\.like_pet\(uuid,uuid,public\.like_kind\) from public,anon,authenticated/);
});

check('super-like credit mutation is serialized behind the authenticated user row lock',()=>{const m=read('supabase/migrations/113_like_pet_idempotency_and_match_side_effect_hardening.sql');const lock=m.indexOf('select tier into v_tier from public.users where id=auth.uid() for update');const debit=m.indexOf('super_like_credits=super_like_credits-1');assert.ok(lock>=0&&debit>lock)});
check('super-like retry does not debit again and cannot downgrade an existing super-like',()=>{const m=read('supabase/migrations/113_like_pet_idempotency_and_match_side_effect_hardening.sql');assert.match(m,/v_like_changed:=not v_had_like or \(v_existing_kind='like' and p_kind='super_like'\)/);assert.match(m,/case when public\.pet_likes\.kind='super_like' then public\.pet_likes\.kind else excluded\.kind end/)});
check('existing active match retries do not re-emit match side effects',()=>{const m=read('supabase/migrations/113_like_pet_idempotency_and_match_side_effect_hardening.sql');assert.match(m,/v_emit_match boolean:=false/);assert.match(m,/if v_existing_unmatched_at is not null then[\s\S]*v_emit_match:=true/);assert.match(m,/if v_emit_match then[\s\S]*insert into public\.notifications/)});
check('notification recipient pet is owner-bound at the database boundary',()=>{const m=read('supabase/migrations/114_notification_recipient_pet_context.sql');assert.match(m,/notification_recipient_pet_owner_mismatch/);assert.match(m,/before insert or update of user_id,type,entity_id,actor_pet_id,recipient_pet_id/)});
check('push payload carries server-derived recipient pet context',()=>{const m=read('supabase/migrations/114_notification_recipient_pet_context.sql');const push=read('supabase/functions/push-dispatch/index.ts');assert.match(m,/recipient_pet_id uuid/);assert.match(push,/recipientPetId: n\.recipient_pet_id/)});


check('pet-scoped detail routes require explicit owned-pet context and mutations consume it',()=>{
  const routes=read('src/navigation/types.ts');
  const chat=read('src/screens/ChatScreen.tsx');
  const profile=read('src/screens/PetProfileScreen.tsx');
  const meetups=read('src/screens/MeetupsScreen.tsx');
  assert.match(routes,/PetProfile: \{ pet: Pet; ownPetId: string \}/);
  assert.match(routes,/Chat: \{ conversationId: string; otherPet: Pet; matchId\?: string; ownPetId: string; storyReply\?: \{ storyId:string; petName:string \} \}/);
  assert.doesNotMatch(routes,/storyReply\?: \{[^}]*owner|storyReply\?: \{[^}]*user/i);
  assert.match(routes,/Meetups: \{ matchId: string; otherPet: Pet; ownPetId: string \}/);
  assert.match(chat,/const ownPet=myPets\.find\(p=>p\.id===ownPetId\)\?\?null/);
  assert.match(chat,/sendMessage\(targetConversationId,senderPetId,body,operation\.id\)/);
  assert.match(chat,/sendStoryReply\(targetConversationId,senderPetId,replyContext\.storyId,body,operation\.id\)/);
  assert.match(chat,/finally\{if\(epoch===conversationEpochRef\.current\)reportBusyRef\.current=false\}/);
  assert.match(chat,/finally\s*\{[\s\S]*?if\(epoch===conversationEpochRef\.current\)\{sendBusyRef\.current=false/);
  assert.match(chat,/const senderPetId=ownPet\.id/);
  assert.match(profile,/const desired=!following/);
  assert.match(profile,/setFollowPet\(ownId,targetId,desired\)/);
  assert.match(profile,/reportPet\(ownId,targetId,'other'\)/);
  assert.match(profile,/blockPet\(ownId,targetId\)/);
  assert.match(meetups,/getMeetupRequestsPage\(petId,matchId/);
});

check('notification async routing is latest-intent-wins and preserves owned-pet context',()=>{
  const screen=read('src/screens/NotificationsScreen.tsx');
  const nav=read('src/navigation/AppNavigator.tsx');
  assert.match(screen,/routeRequestRef=useRef\(0\)/);
  assert.match(screen,/routeRequestId!==routeRequestRef\.current/);
  assert.match(screen,/navigate\('Chat',\{conversationId:n\.entityId,otherPet:match\.otherPet,matchId:match\.id,ownPetId:petId\}\)/);
  assert.match(screen,/navigate\('LikesYou',\{petId\}\)/);
  assert.match(nav,/navigate\('Chat',\{conversationId:entityId,otherPet:match\.otherPet,matchId:match\.id,ownPetId:activePetId\}\)/);
});

check('queued account pause mutations cannot execute after provider unmount or auth-subject change',()=>{
  const account=read('src/contexts/AccountStateContext.tsx');
  assert.match(account,/mountedRef=useRef\(true\)/);
  assert.match(account,/userIdRef=useRef<string\|null>/);
  assert.match(account,/if\(!mountedRef\.current\|\|userIdRef\.current!==subject\)return;result=await updateAccountPaused/);
  assert.match(account,/mountedRef\.current=false[\s\S]*mutationEpoch\.current\+\+/);
});

check('runtime configuration rejects stale locale/request completions',()=>{
  const app=read('App.tsx');
  assert.match(app,/runtimeRequestRef=useRef\(0\)/);
  assert.match(app,/const requestId=\+\+runtimeRequestRef\.current;const requestedLocale=locale/);
  assert.match(app,/requestId===runtimeRequestRef\.current\)setState\(gateState\(c,requestedLocale\)\)/);
  assert.match(app,/return\(\)=>\{runtimeRequestRef\.current\+=1\}/);
});

check('settings queued writes and destructive actions are lifecycle guarded',()=>{
  const settings=read('src/screens/SettingsScreen.tsx');
  assert.match(settings,/mountedRef=useRef\(true\)/);
  assert.match(settings,/privacyWriteQueue\.current[\s\S]*if\(!mountedRef\.current\)return;[\s\S]*updatePrivacySettings/);
  assert.match(settings,/notificationWriteQueue\.current[\s\S]*if\(!mountedRef\.current\)return;[\s\S]*updateNotificationPreferences/);
  assert.match(settings,/deleteActionRef\.current/);
  assert.match(settings,/measurementActionRef\.current/);
});


check('event mutations are same-frame single-flight and pet-epoch guarded',()=>{
  const events=read('src/screens/EventsScreen.tsx');
  assert.match(events,/submitRef=useRef\(false\)/);
  assert.match(events,/actionRef=useRef\(false\)/);
  assert.match(events,/petEpochRef=useRef\(0\)/);
  assert.match(events,/if\(!ownPet\|\|!contextReady\|\|demoMode\|\|submitRef\.current\)return/);
  assert.match(events,/if\(!ownPet\|\|!contextReady\|\|demoMode\|\|actionRef\.current\)return/);
  assert.match(events,/isCurrentPet\(petId,epoch\)/);
  assert.match(events,/deleteEvent\(event\.id,petId\)/);
  assert.match(events,/reportEvent\(event\.id,petId\)/);
});

check('lost-pet create resolve and location writes are pet-epoch and single-flight guarded',()=>{
  const lost=read('src/screens/LostPetAlertsScreen.tsx');
  assert.match(lost,/actionRef=useRef\(false\)/);
  assert.match(lost,/locationActionRef=useRef\(false\)/);
  assert.match(lost,/petEpochRef=useRef\(0\)/);
  assert.match(lost,/const radiusSnapshot=radius/);
  assert.match(lost,/if\(!isCurrentPet\(petId,epoch\)\|\|actionRef\.current\)return/);
  assert.match(lost,/if\(!activePet\|\|locationActionRef\.current\)return/);
  assert.match(lost,/activePetIdRef\.current===petId/);
});


check('boost activation serializes entitlement and credit decisions before active-state checks',()=>{
  const migration=read('supabase/migrations/115_boost_activation_concurrency_hardening.sql');
  const lock=migration.indexOf("select tier into v_tier from public.users where id=auth.uid() for update");
  const active=migration.indexOf("if exists(select 1 from public.pet_boosts where pet_id=p_pet_id and ends_at>now())");
  const credit=migration.indexOf('update public.consumable_balances set boost_credits=boost_credits-1');
  assert.ok(lock>=0&&active>lock&&credit>active,'user-row lock must precede active boost check and credit mutation');
  assert.match(migration,/revoke all on function public\.activate_pet_boost\(uuid\) from public,anon/);
  assert.match(migration,/grant execute on function public\.activate_pet_boost\(uuid\) to authenticated/);
});

check('discover high-impact actions are synchronous single-flight and pet-epoch guarded',()=>{
  const discover=read('src/screens/DiscoverScreen.tsx');
  for(const ref of ['undoRef','waitlistRef','boostRef','travelRef'])assert.match(discover,new RegExp(`${ref}=useRef\\(false\\)`));
  assert.match(discover,/petEpochRef=useRef\(0\)/);
  assert.match(discover,/isCurrentPet=\(petId:string,epoch:number\)/);
  assert.match(discover,/if\(!activePet\|\|boostRef\.current\)return/);
  assert.match(discover,/if\(!activePet\|\|travelRef\.current\)return/);
  assert.match(discover,/if\(!activePet\|\|waitlistRef\.current\)return/);
});


check('migration sequence has exactly one SQL file per numeric prefix',()=>{
  const files=globSync('supabase/migrations/*.sql').map(path=>path.split('/').pop()).sort();
  const byPrefix=new Map();
  for(const file of files){const prefix=file.split('_',1)[0];const list=byPrefix.get(prefix)??[];list.push(file);byPrefix.set(prefix,list)}
  const duplicates=[...byPrefix.entries()].filter(([,list])=>list.length!==1);
  assert.deepEqual(duplicates,[],'Duplicate migration prefixes make deployment order ambiguous');
});

check('social mutations use retry-safe desired-state RPCs and legacy toggle entry points are revoked',()=>{
  const mutationPath=globSync('supabase/migrations/*_retry_safe_social_state_mutations.sql')[0];
  const grantPath=globSync('supabase/migrations/*_retry_safe_rpc_surface_enforcement.sql')[0];
  assert.ok(mutationPath&&grantPath);
  const migration=read(mutationPath);
  const grants=read(grantPath);
  const api=read('src/services/api.ts');
  for(const fn of ['set_post_like','set_saved_post','set_follow_pet','set_favorite_pet'])assert.match(migration,new RegExp(`create or replace function public\\.${fn}`));
  for(const legacy of ['toggle_favorite_pet','toggle_post_like','toggle_save_post','toggle_follow_pet']){
    assert.match(grants,new RegExp(`revoke execute on function public\\.${legacy}\\(uuid,uuid\\) from authenticated`));
    assert.doesNotMatch(api,new RegExp(`rpc\\('${legacy}'`));
  }
  assert.match(api,/rpc\('set_post_like',[\s\S]*p_liked: enabled/);
  assert.match(api,/rpc\('set_saved_post',[\s\S]*p_saved: enabled/);
  assert.match(api,/rpc\('set_follow_pet',[\s\S]*p_following: enabled/);
  assert.match(api,/rpc\('set_favorite_pet',[\s\S]*p_favorite: enabled/);
});

check('likes-you and meetups stale completions cannot release a newer route action lock',()=>{
  const likes=read('src/screens/LikesYouScreen.tsx');
  const meetups=read('src/screens/MeetupsScreen.tsx');
  assert.match(likes,/routeEpochRef=useRef\(0\)/);
  assert.match(likes,/if\(epoch===routeEpochRef\.current\)actionRef\.current=false/);
  assert.match(meetups,/routeEpochRef=useRef\(0\)/);
  assert.match(meetups,/if\(epoch===routeEpochRef\.current\)[\s\S]*actionRef\.current=false/);
});

check('lost-pet notifications bind a deterministic recipient pet and respect blocks',()=>{
  const lostPath=globSync('supabase/migrations/*_lost_pet_recipient_context_and_block_hardening.sql')[0];assert.ok(lostPath);const lost=read(lostPath);
  assert.match(lost,/recipient_pet_id/);
  assert.match(lost,/distinct on \(u\.id\)/);
  assert.match(lost,/not public\.is_blocked\(p\.id,rp\.id\)/);
  assert.match(lost,/not public\.is_blocked\(p_pet_id,a\.pet_id\)/);
  assert.match(lost,/select \* into p from public\.pets where id=p_pet_id for update/);
});


check('client mutation receipts are exact-request bound, private and retention bounded',()=>{
  const receipts=read('supabase/migrations/121_client_mutation_idempotency_receipts.sql');
  const retention=read('supabase/migrations/125_client_mutation_receipt_retention.sql');
  assert.match(receipts,/primary key\(user_id,action,operation_id\)/);
  assert.match(receipts,/client_operation_id_reused/);
  assert.match(receipts,/pg_advisory_xact_lock/);
  assert.match(receipts,/revoke all on public\.client_mutation_receipts from anon,authenticated/);
  assert.match(retention,/created_at < now\(\)-interval '30 days'/);
  assert.match(retention,/offset 1000/);
  assert.match(retention,/auth\.role\(\)<>'service_role'/);
  assert.match(retention,/grant execute on function public\.purge_client_mutation_receipts\(timestamptz\) to service_role/);
});

check('post and story creation are retry-safe and legacy direct client entry points are revoked',()=>{
  const migration=read('supabase/migrations/124_post_story_create_idempotency.sql');
  const api=read('src/services/api.ts');
  for(const fn of ['create_post_idempotent','create_story_idempotent']){
    assert.match(migration,new RegExp(`create or replace function public\\.${fn}`));
  }
  assert.match(migration,/client_operation_id_reused/);
  assert.match(migration,/pg_advisory_xact_lock/);
  assert.match(migration,/revoke all on function public\.create_post\(uuid,text,text\[\]\) from public,anon,authenticated/);
  assert.match(migration,/revoke all on function public\.create_story\(uuid,text\) from public,anon,authenticated/);
  assert.match(api,/rpc\('create_post_idempotent',[\s\S]*p_client_operation_id:operationId/);
  assert.match(api,/rpc\('create_story_idempotent',[\s\S]*p_client_operation_id:operationId/);
  assert.doesNotMatch(api,/rpc\('create_post'/);
  assert.doesNotMatch(api,/rpc\('create_story'/);
});

check('durable client operation storage fails closed before mutation when platform persistence is unavailable',()=>{
  const helper=read('src/services/clientOperation.ts');
  assert.match(helper,/DURABLE_STORAGE_ERROR='durable_operation_storage_unavailable'/);
  assert.match(helper,/if\(durableUnavailable\)throw new Error\(DURABLE_STORAGE_ERROR\)/);
  assert.match(helper,/catch\{durableUnavailable=true;throw new Error\(DURABLE_STORAGE_ERROR\);\}/);
  assert.match(helper,/getOrCreateDurableClientOperation[\s\S]*await persistEntries\(/);
  assert.match(helper,/TailmanceDeviceIntegrity/);
  assert.match(helper,/generateSecureRandomBase64UrlAsync\(18\)/);
  assert.match(helper,/getRandomValues\(new Uint8Array\(18\)\)/);
  assert.match(helper,/localStorage\?\.getItem\(STORE_KEY\)/);
  assert.match(helper,/storage\.setItem\(STORE_KEY,JSON\.stringify\(memoryEntries\)\)/);
  assert.doesNotMatch(helper,/Platform\.OS===['"]web['"]\)\{memoryEntries=\[\];return memoryEntries;/);
  assert.doesNotMatch(helper,/Math\.random\(/);
  assert.match(helper,/server mutation may already be committed/);
});

check('server mutation receipts outlive the client durable retry window with safety margin',()=>{
  const helper=read('src/services/clientOperation.ts');
  const retention=read('supabase/migrations/153_client_mutation_receipt_retry_window_margin.sql');
  assert.match(helper,/STORE_TTL_MS=24\*60\*60\*1000/);
  assert.match(retention,/p_before>now\(\)-interval '48 hours'/i);
  assert.match(retention,/security definer[\s\S]*set search_path=''/i);
  assert.match(retention,/revoke all on function public\.purge_client_mutation_receipts\(timestamptz\) from public,anon,authenticated/i);
  assert.match(retention,/grant execute on function public\.purge_client_mutation_receipts\(timestamptz\) to service_role/i);
});

check('durable client operation failures remain fail closed without silent live-id eviction and surface a recoverable UX message',()=>{
  const helper=read('src/services/clientOperation.ts');
  const errors=read('src/services/errors.ts');
  assert.match(helper,/DURABLE_STORAGE_CAPACITY_ERROR='durable_operation_storage_capacity_exceeded'/);
  assert.match(helper,/if\(entries\.length>=STORE_MAX_ENTRIES\)throw new Error\(DURABLE_STORAGE_CAPACITY_ERROR\)/);
  assert.doesNotMatch(helper,/\.slice\(0,STORE_MAX_ENTRIES\)/);
  assert.match(errors,/durable_operation_storage_/);
  assert.match(errors,/error\.temporarilyUnavailable/);
});

check('durable retry state is cleared on account/session teardown to prevent cross-account residue',()=>{
  const helper=read('src/services/clientOperation.ts');
  const auth=read('src/services/auth.ts');
  const context=read('src/contexts/AuthContext.tsx');
  assert.match(helper,/clearAllDurableClientOperations[\s\S]*removeStoredOperations\(\)/);
  assert.match(auth,/supabase\.auth\.signOut\(\{scope\}\)[\s\S]*clearAllDurableClientOperations/);
  assert.match(auth,/revocationCommitted[\s\S]*signOut\(\{scope:['"]local['"]\}\)[\s\S]*clearAllDurableClientOperations/);
  assert.match(auth,/password_changed_session_revocation_unverified/);
  const passwordFallback=auth.slice(auth.indexOf('password_changed_session_revocation_unverified')-500,auth.indexOf('password_changed_session_revocation_unverified')+100);
  assert.match(passwordFallback,/clearAllDurableClientOperations/);
  assert.match(auth,/finalizeDeletedAccountSession[\s\S]*clearAllDurableClientOperations/);
  assert.match(context,/event===['"]SIGNED_OUT['"][\s\S]*clearAllDurableClientOperations/);
  assert.match(helper,/STORE_OWNER_KEY='tailmance_client_operations_owner_v1'/);
  assert.match(helper,/bindDurableClientOperationsToUser[\s\S]*owner!==next[\s\S]*removeStoredOperations/);
  assert.match(context,/bindDurableClientOperationsToUser\(session\?\.user\.id\?\?null\)/,'bootstrap must bind durable retries to the verified account');
  assert.match(context,/onAuthStateChange[\s\S]*bindDurableClientOperationsToUser\(verifiedSession\?\.user\.id\?\?null\)/,'auth account changes must rebind or clear durable retry state');
});

check('all client idempotent create surfaces carry durable operation ids across ambiguous retries',()=>{
  const helper=read('src/services/clientOperation.ts');
  const feed=read('src/screens/FeedScreen.tsx');
  const discover=read('src/screens/DiscoverScreen.tsx');
  const events=read('src/screens/EventsScreen.tsx');
  const meetups=read('src/screens/MeetupsScreen.tsx');
  const lost=read('src/screens/LostPetAlertsScreen.tsx');
  const chat=read('src/screens/ChatScreen.tsx');
  const health=read('src/screens/HealthScreen.tsx');
  assert.match(helper,/secureStorage/);
  assert.match(helper,/STORE_TTL_MS=24\*60\*60\*1000/);
  assert.match(helper,/STORE_MAX_ENTRIES=12/);
  assert.match(helper,/DURABLE_STORAGE_CAPACITY_ERROR='durable_operation_storage_capacity_exceeded'/);
  assert.match(helper,/if\(entries\.length>=STORE_MAX_ENTRIES\)throw new Error\(DURABLE_STORAGE_CAPACITY_ERROR\)/);
  assert.doesNotMatch(helper,/\.slice\(0,STORE_MAX_ENTRIES\)/);
  assert.match(helper,/Only this fixed-length fingerprint is persisted/);
  assert.doesNotMatch(helper,/JSON\.stringify\(parts\)/);
  assert.match(feed,/getOrCreateDurableClientOperation\('post',\[petId,captionSnapshot,\.\.\.mediaPaths\]\)/);
  assert.match(feed,/createPost\(petId,captionSnapshot,mediaPaths,operation\.id\)/);
  assert.match(feed,/getOrCreateDurableClientOperation\('story',\[petId,upload\.path\]\)/);
  assert.match(feed,/createStory\(petId,attempt\.path,attempt\.operationId\)/);
  assert.match(feed,/getOrCreateDurableClientOperation\('comment',\[petId,postId,body\]\)/);
  assert.match(feed,/createComment\(petId,postId,body,operation\.id\)/);
  assert.match(discover,/getOrCreateDurableClientOperation\('undo-pass',\[petId\]\)/);
  assert.match(discover,/undoLastPass\(petId,operation\.id\)/);
  assert.match(events,/getOrCreateDurableClientOperation\('event'/);
  assert.match(events,/createEvent\(input,operation\.id\)/);
  assert.match(meetups,/getOrCreateDurableClientOperation\('meetup'/);
  assert.match(meetups,/createMeetupRequest\(input,operation\.id\)/);
  assert.match(lost,/getOrCreateDurableClientOperation\('lost-pet-alert',\[petId,radiusSnapshot\]\)/);
  assert.match(lost,/new Date\(operation\.createdAt\)\.toISOString\(\)/);
  assert.match(lost,/createLostPetAlert\(petId,lastSeenAt,radiusSnapshot,operation\.id\)/);
  assert.match(chat,/getOrCreateDurableClientOperation\(replyContext\?'story-reply':'message',replyContext\?\[targetConversationId,senderPetId,replyContext\.storyId,body\]:\[targetConversationId,senderPetId,body\]\)/);
  assert.match(chat,/sendMessage\(targetConversationId,senderPetId,body,operation\.id\)/);
  assert.match(chat,/sendStoryReply\(targetConversationId,senderPetId,replyContext\.storyId,body,operation\.id\)/);
  assert.match(chat,/executeWithOfflineQueue\([\s\S]*type:'message'[\s\S]*sendMessage\(targetConversationId,senderPetId,body,operation\.id\)/);
  assert.match(read('src/services/offlineMutationQueue.ts'),/clearDurableForMutation/);
  assert.match(health,/getOrCreateDurableClientOperation\('vaccination',\[petId,vaccinationId,vaccineName,doseDate,nextDueDate\]\)/);
  assert.match(health,/clearDurableClientOperation\(operation\.key,operation\.id\)/);
});

check('chat message retry identity survives route and app lifecycle boundaries',()=>{
  const chat=read('src/screens/ChatScreen.tsx');
  const migration=read('supabase/migrations/116_message_send_idempotency.sql');
  const replayContract=read('supabase/migrations/148_message_idempotent_replay_contract.sql');
  assert.doesNotMatch(chat,/pendingSendOperationRef|createMessageOperationId/);
  assert.match(chat,/getOrCreateDurableClientOperation\(replyContext\?'story-reply':'message',replyContext\?\[targetConversationId,senderPetId,replyContext\.storyId,body\]:\[targetConversationId,senderPetId,body\]\)/);
  assert.match(chat,/executeWithOfflineQueue\([\s\S]*dedupeKey:`message:\$\{operation\.id\}`[\s\S]*sendMessage\(targetConversationId,senderPetId,body,operation\.id\)/);
  assert.match(migration,/unique index[^;]*messages[^;]*sender_pet_id[^;]*client_operation_id/i);
  assert.match(migration,/client_operation_id_reused/);
  assert.match(replayContract,/require_active_authenticated_session\(\)/);
  assert.match(replayContract,/client_operation_id_reused/);
  assert.match(replayContract,/'moderationStatus',v_existing\.moderation_status/);
  assert.match(replayContract,/v_result:=public\.send_message\([\s\S]*set client_operation_id=v_operation/);
});

check('response-loss semantic retries are success-idempotent without weakening different-intent checks',()=>{
  const m=read('supabase/migrations/126_response_loss_semantic_idempotency.sql');
  assert.match(m,/status in \('open','reviewing'\)/);
  assert.match(m,/details is not distinct from v_details/);
  assert.match(m,/if v_appeal\.statement<>v_statement then raise exception 'appeal_already_submitted'/);
  assert.match(m,/if r\.status=p_status then return; end if/);
  assert.match(m,/if v_alert\.status='resolved' then return; end if/);
  assert.match(m,/if v_existing\.id is not null then[\s\S]*return jsonb_build_object\('id',v_existing\.id/);
  assert.match(m,/where pet_id=p_pet_id and owner_id=auth\.uid\(\) and storage_path=v_path/);
});

check('retry-safe social desired-state functions serialize per relationship before rate limits',()=>{
  const migration=read('supabase/migrations/123_retry_safe_social_concurrency_serialization.sql');
  for(const scope of ['post_like','post_save','follow','favorite']){
    assert.match(migration,new RegExp(`pg_advisory_xact_lock\\([\\s\\S]*'${scope}:`));
  }
  assert.match(migration,/create or replace function public\.set_post_like/);
  assert.match(migration,/create or replace function public\.set_saved_post/);
  assert.match(migration,/create or replace function public\.set_follow_pet/);
  assert.match(migration,/create or replace function public\.set_favorite_pet/);
});

check('feed does not misreport a committed comment as failed when only comment refresh fails',()=>{
  const feed=read('src/screens/FeedScreen.tsx');
  const send=feed.match(/const submitComment=async\(\)=>\{[\s\S]*?\};\n  const openStory/)?.[0]??'';
  assert.match(send,/executeWithOfflineQueue\([\s\S]*?createComment\([\s\S]*?catch\(e\)[\s\S]*?feed\.commentSendFailed[\s\S]*?finally/);
  assert.match(send,/if\(requestId!==commentRequestRef\.current[\s\S]*?try\{const page=await getPostComments/);
  assert.match(send,/feed\.commentsLoadFailed/);
  const createPos=send.indexOf('()=>createComment');
  const refreshPos=send.indexOf('await getPostComments');
  assert.ok(createPos>=0&&refreshPos>createPos,'comment refresh must happen only after a separately handled create result');
});


check('verification and blocked-pet actions stay bound to the routed owned pet',()=>{
  const routes=read('src/navigation/types.ts');
  const verification=read('src/screens/VerificationCenterScreen.tsx');
  const blocked=read('src/screens/BlockedPetsScreen.tsx');
  const profile=read('src/screens/ProfileScreen.tsx');
  const settings=read('src/screens/SettingsScreen.tsx');
  assert.match(routes,/VerificationCenter: \{ petId: string \}/);
  assert.match(routes,/BlockedPets: \{ petId: string \}/);
  assert.match(profile,/navigate\('VerificationCenter',\{petId:activePet\.id\}\)/);
  assert.match(settings,/navigate\('BlockedPets',\{petId:activePet\.id\}\)/);
  assert.match(verification,/const petId=route\.params\.petId/);
  assert.match(verification,/targetPet=useMemo\(\(\)=>myPets\.find/);
  assert.match(verification,/captureAndSubmitPetVerification\(requestedPetId\)/);
  assert.match(verification,/routeEpochRef=useRef\(0\)/);
  assert.match(blocked,/const petId=route\.params\.petId/);
  assert.match(blocked,/await unblockPet\(petId,item\.id\)/);
  assert.match(blocked,/routeEpochRef=useRef\(0\)/);
});

check('settings high-impact account and device actions use synchronous lifecycle guards',()=>{
  const settings=read('src/screens/SettingsScreen.tsx');
  for(const ref of ['pushActionRef','signOutActionRef','locationActionRef','exportActionRef'])assert.match(settings,new RegExp(`${ref}=useRef\\(false\\)`));
  assert.match(settings,/if\(pushActionRef\.current\|\|!mountedRef\.current\)return/);
  assert.match(settings,/if\(signOutActionRef\.current\|\|!mountedRef\.current\)return/);
  assert.match(settings,/if\(!activePet\|\|locationActionRef\.current\|\|!mountedRef\.current\)return/);
  assert.match(settings,/if\(exportActionRef\.current\|\|!mountedRef\.current\)return/);
  assert.match(settings,/onPress=\{\(\)=>void updateLocation\(\)\}/);
});

check('feed durable-create transition has no stale in-memory operation symbols and separates commit from refresh',()=>{
  const feed=read('src/screens/FeedScreen.tsx');
  for(const stale of ['stableOperationKey','createClientOperationId','pendingPostOperationRef','pendingCommentOperationRef'])assert.doesNotMatch(feed,new RegExp(stale));
  assert.match(feed,/getOrCreateDurableClientOperation\('post',\[petId,captionSnapshot,\.\.\.mediaPaths\]\)/);
  assert.match(feed,/setPostRetryPending\(true\)/);
  assert.match(feed,/editable=\{!postRetryPending\}/);
  assert.match(feed,/committed=true/);
  assert.match(feed,/if\(committed&&isCurrentPet\(petId,epoch\)\)void Promise\.allSettled\(\[refreshAll\(\),refreshFeed\(\)\]\)/);
});


check('health writes reconcile response loss before consuming quota or one-shot upload intents',()=>{
  const m=read('supabase/migrations/127_health_write_response_loss_idempotency.sql');
  assert.match(m,/create or replace function public\.upsert_vaccination_idempotent/);
  assert.match(m,/client_mutation_receipts[\s\S]*action='vaccination_upsert'/);
  assert.match(m,/client_operation_id_reused/);
  assert.match(m,/revoke all on function public\.upsert_vaccination\(uuid,uuid,text,date,date\) from public,anon,authenticated/);
  const deleteRetry=m.indexOf('if not v_exists then return; end if;');
  const deleteLimit=m.indexOf("rate_limit('vaccination_delete'");
  assert.ok(deleteRetry>=0&&deleteLimit>deleteRetry,'vaccination delete retry must no-op before rate limiting');
  const claimNoop=m.indexOf('v_current is not distinct from p_neutered');
  const claimLimit=m.indexOf("rate_limit('pet_health_claim_update'");
  assert.ok(claimNoop>=0&&claimLimit>claimNoop,'same health claim must no-op before rate limiting');
  assert.match(m,/health_documents[\s\S]*storage_path=v_path[\s\S]*if v_id is not null then[\s\S]*return v_id/);
  assert.match(m,/pet_photos where pet_id=p_pet_id and sort_order=p_sort_order[\s\S]*v_existing_path=v_path then return v_id/);
});

check('vaccination upsert retry identity survives route and app lifecycle boundaries',()=>{
  const api=read('src/services/api.ts');
  const health=read('src/screens/HealthScreen.tsx');
  assert.match(api,/rpc\('upsert_vaccination_idempotent',[\s\S]*p_client_operation_id: input\.operationId/);
  assert.doesNotMatch(api,/rpc\('upsert_vaccination'/);
  assert.match(health,/getOrCreateDurableClientOperation\('vaccination',\[petId,vaccinationId,vaccineName,doseDate,nextDueDate\]\)/);
  assert.match(health,/upsertVaccination\(\{petId,vaccinationId,vaccineName,doseDate,nextDueDate,operationId:operation\.id\}\)/);
  assert.match(health,/clearDurableClientOperation\(operation\.key,operation\.id\)/);
  assert.doesNotMatch(health,/pendingVaccinationOperationRef|createClientOperationId|stableOperationKey/);
});


check('events remain bound to the routed owned pet across notification and active-pet races',()=>{
  const routes=read('src/navigation/types.ts');
  const events=read('src/screens/EventsScreen.tsx');
  const feed=read('src/screens/FeedScreen.tsx');
  const profile=read('src/screens/ProfileScreen.tsx');
  const notifications=read('src/screens/NotificationsScreen.tsx');
  const navigator=read('src/navigation/AppNavigator.tsx');
  assert.match(routes,/Events: \{ petId: string \}/);
  assert.match(feed,/navigate\('Events',\{petId:activePet\.id\}\)/);
  assert.match(profile,/navigate\('Events',\{petId:activePet\.id\}\)/);
  assert.match(notifications,/n\.type==='event'&&petId\)navigation\.navigate\('Events',\{petId\}\)/);
  assert.match(navigator,/type==='event'&&activePetId\)navigationRef\.navigate\('Events',\{petId:activePetId\}\)/);
  assert.match(events,/const routePetId=route\.params\.petId/);
  assert.match(events,/ownPet=useMemo\(\(\)=>myPets\.find/);
  assert.match(events,/contextReady=Boolean\(ownPet&&activePet\?\.id===routePetId\)/);
  assert.match(events,/if\(ownPet&&activePet\?\.id!==routePetId\)setActivePet\(ownPet\)/);
  assert.match(events,/data=\{contextReady\?events:\[\]\}/);
  assert.match(events,/const petId=routePetId/);
});

check('legacy retry-unsafe social and message RPCs are explicitly closed to PUBLIC anon and authenticated',()=>{
  const m=read('supabase/migrations/128_legacy_retry_unsafe_public_execute_enforcement.sql');
  for(const signature of [
    'send_message\\(uuid,uuid,text\\)',
    'toggle_favorite_pet\\(uuid,uuid\\)',
    'toggle_post_like\\(uuid,uuid\\)',
    'toggle_save_post\\(uuid,uuid\\)',
    'toggle_follow_pet\\(uuid,uuid\\)'
  ])assert.match(m,new RegExp(`revoke all on function public\\.${signature} from public,anon,authenticated`));
});


check('owner-level safety lock serializes block with pet relationship writers',()=>{
  const m=read('supabase/migrations/129_owner_safety_serialization_and_relationship_retry.sql');
  assert.match(m,/create or replace function public\.lock_owner_safety_relation/);
  assert.match(m,/owner_safety:/);
  for(const fn of ['like_pet','set_follow_pet','set_favorite_pet','pass_pet_idempotent','block_pet','unblock_pet']){
    const start=m.indexOf(`create or replace function public.${fn}`);
    assert.ok(start>=0,`missing ${fn}`);
    const next=m.indexOf('create or replace function public.',start+30);
    const body=m.slice(start,next<0?m.length:next);
    assert.match(body,/lock_owner_safety_relation/);
  }
  assert.match(m,/revoke all on function public\.pass_pet\(uuid,uuid\) from public,anon,authenticated/);
  assert.match(m,/client_mutation_receipts[\s\S]*action='pass_pet'/);
  const api=read('src/services/api.ts');const appData=read('src/contexts/AppDataContext.tsx');
  assert.match(api,/rpc\('pass_pet_idempotent',[\s\S]*p_client_operation_id: operationId/);
  assert.doesNotMatch(api,/rpc\('pass_pet'/);
  assert.match(appData,/getOrCreateDurableClientOperation\('pass',\[petId,pet\.id\]\)/);
  assert.match(appData,/api\.passPet\(petId,pet\.id,operation\.id\)/);
  assert.match(appData,/executeWithOfflineQueue\(\{type:'pass'[\s\S]*api\.passPet\(petId,pet\.id,operation\.id\)/);
  assert.match(appData,/clearDurableClientOperationForIntent\('undo-pass',\[petId\]\)/);
});

check('relationship destructive retries and Matches stale confirmations are end-state safe',()=>{
  const m=read('supabase/migrations/129_owner_safety_serialization_and_relationship_retry.sql');
  assert.match(m,/select \* into v_match from public\.pet_matches where id=p_match_id for update[\s\S]*if v_match\.unmatched_at is not null then return/);
  assert.match(m,/v_already_blocked boolean[\s\S]*if v_already_blocked then return/);
  assert.match(m,/select exists\([\s\S]*\) into v_exists;[\s\S]*if not v_exists then return; end if;[\s\S]*rate_limit\('unblock_pet'/);
  const matches=read('src/screens/MatchesScreen.tsx');
  assert.match(matches,/activePetIdRef=useRef\(activePet\?\.id\)/);
  assert.match(matches,/unmatchRef=useRef<string\|null>\(null\)/);
  assert.match(matches,/if\(activePetIdRef\.current!==petId\|\|unmatchRef\.current\)return/);
  assert.match(matches,/if\(activePetIdRef\.current===petId&&unmatchRef\.current===actionKey\)unmatchRef\.current=null/);
});


check('destructive content and pet deletion use exact retry receipts and separate commit from refresh',()=>{
  const m=read('supabase/migrations/130_retry_safe_destructive_content_and_pet_deletion.sql');
  const api=read('src/services/api.ts');const feed=read('src/screens/FeedScreen.tsx');const events=read('src/screens/EventsScreen.tsx');const editor=read('src/screens/PetEditorScreen.tsx');
  for(const fn of ['delete_owned_content_idempotent','delete_pet_profile_idempotent'])assert.match(m,new RegExp(`create or replace function public\\.${fn}`));
  assert.match(m,/client_operation_id_reused/);
  assert.match(m,/revoke all on function public\.delete_owned_content\(uuid,text,uuid\) from public,anon,authenticated/);
  assert.match(m,/revoke all on function public\.delete_pet_profile\(uuid\) from public,anon,authenticated/);
  assert.match(api,/rpc\('delete_owned_content_idempotent',[\s\S]*p_client_operation_id:operationId/);
  assert.match(api,/rpc\('delete_pet_profile_idempotent',[\s\S]*p_client_operation_id:operationId/);
  assert.doesNotMatch(api,/rpc\('delete_owned_content'/);assert.doesNotMatch(api,/rpc\('delete_pet_profile'/);
  assert.match(feed,/getOrCreateDurableClientOperation\('delete-content',\[petId,'post',postId\]\)/);
  assert.match(feed,/committed=true[\s\S]*Promise\.allSettled\(\[refreshAll\(\),refreshFeed\(\)\]\)/);
  assert.match(events,/getOrCreateDurableClientOperation\('delete-content',\[petId,'event',eventId\]\)/);
  assert.match(editor,/getOrCreateDurableClientOperation\('delete-pet',\[savedPetId\]\)/);
});


check('places queries stay bound to the routed owned pet instead of ambient active-pet state',()=>{
  const routes=read('src/navigation/types.ts');
  const places=read('src/screens/PlacesScreen.tsx');
  const feed=read('src/screens/FeedScreen.tsx');
  const discover=read('src/screens/DiscoverScreen.tsx');
  const profile=read('src/screens/ProfileScreen.tsx');
  assert.match(routes,/Places: \{ petId: string \}/);
  for(const source of [feed,discover,profile])assert.match(source,/navigate\('Places',\{petId:activePet\.id\}\)/);
  assert.match(places,/const petId=route\.params\.petId/);
  assert.match(places,/ownPet=useMemo\(\(\)=>myPets\.find/);
  assert.match(places,/getPetFriendlyPlaces\(petId,category==='all'\?null:category\)/);
  assert.doesNotMatch(places,/getPetFriendlyPlaces\(activePet\.id/);
});

check('likes-you profile navigation and like-back action are sibling interactions',()=>{
  const likes=read('src/screens/LikesYouScreen.tsx');
  assert.match(likes,/renderItem=\{\(\{item:pet\}\)=>\<View style=\{styles\.card\}\>\<Pressable[\s\S]*?\<\/Pressable\>\<IconButton icon="heart"/);
  assert.match(likes,/profileAction:\{flex:1,flexDirection:'row'/);
  assert.doesNotMatch(likes,/style=\{styles\.card\}[\s\S]{0,1500}<IconButton icon="heart"[\s\S]{0,400}<\/Pressable>/);
});

check('offline source semantic gate catches high-signal stale ref and call-signature errors',()=>{
  const script=read('scripts/source-semantic-local-check.mjs');
  const pkg=JSON.parse(read('package.json'));
  assert.match(script,/highSignalCodes=new Set/);
  for(const code of ['2304','2554','2345','2538','18048','2783'])assert.ok(script.includes(code),`semantic diagnostic ${code} missing`);
  assert.equal(pkg.scripts['test:source-semantics'],'node scripts/source-semantic-local-check.mjs');
  assert.match(pkg.scripts.test,/test:source-semantics/);
});


check('health verification provenance is evidence-bound and no veterinarian state exists',()=>{
  const m=read('supabase/migrations/205_health_document_check_without_veterinarian_signals.sql');
  assert.match(m,/health_attestation_method_check check \(method in \('manual_document_review','ai_document_check'\)\)/);
  assert.match(m,/health_attestation_method_evidence_check check \([\s\S]*method='manual_document_review' and provider_code is null and provider_reference_sha256 is null[\s\S]*method='ai_document_check' and provider_code is not null and provider_reference_sha256 is not null/);
  assert.match(m,/delete from public\.health_verification_attestations where signal='veterinarian_verified'/);
  assert.match(m,/alter table public\.pet_health_summary drop column veterinarian_verified/);
  const admin=read('supabase/functions/moderation-admin/index.ts');
  assert.doesNotMatch(admin,/veterinar/i);
  assert.match(m,/create or replace function public\.service_review_health_document/);
  assert.match(m,/select pet_id into v_pet_id from public\.health_documents where id=p_health_document_id for update/);
  assert.match(admin,/service_review_health_document/);
  assert.doesNotMatch(admin,/from\('health_documents'\)\.update\(\{verification_status/);
});

check('health document check hashes its provider reference and only the AI worker may write AI attestations',()=>{
  const worker=read('supabase/functions/health-ai-worker/index.ts');
  const m=read('supabase/migrations/205_health_document_check_without_veterinarian_signals.sql');
  assert.match(worker,/referenceHash\s*=\s*await sha256Hex\(/);
  assert.match(worker,/p_provider_reference_sha256:\s*referenceHash/);
  assert.match(m,/revoke all on function public\.service_apply_health_verification_attestation\(uuid,text,text,text,text,timestamptz,timestamptz\) from public,anon,authenticated/);
  assert.match(m,/grant execute on function public\.service_apply_health_verification_attestation\(uuid,text,text,text,text,timestamptz,timestamptz\) to service_role/);
});

check('health attestation evidence is service-only, redacted in export and safe on public pet JSON',()=>{
  const m=read('supabase/migrations/131_health_verification_provenance_and_trust.sql');
  const m201=read('supabase/migrations/205_health_document_check_without_veterinarian_signals.sql');
  const exp=read('supabase/functions/export-download/index.ts');
  assert.match(m,/alter table public\.health_verification_attestations enable row level security/);
  assert.match(m,/revoke all on table public\.health_verification_attestations from public,anon,authenticated/);
  assert.match(exp,/from\('health_verification_attestations'\)\.select\('id,pet_id,health_document_id,signal,method,provider_code,verified_at,expires_at,revoked_at,created_at'\)/);
  assert.doesNotMatch(exp,/health_verification_attestations'\)\.select\([^\n]*provider_reference_sha256/);
  const petJson=m201.slice(m201.indexOf('create or replace function public.pet_json'),m201.indexOf('revoke all on function public.pet_json'));
  assert.doesNotMatch(petJson,/trust|clinic|providerReferenceSha256|veterinar/i);
});

check('store price and health provider production evidence remain explicit fail-closed release gates',()=>{
  const evidence=JSON.parse(read('release/external-security-evidence.json'));
  for(const id of ['storefront_subscription_price_tax_parity','production_health_document_check_provider']){
    assert.equal(evidence.items[id]?.required,true);assert.equal(evidence.items[id]?.status,'not_verified');assert.equal(evidence.items[id]?.evidence_ref,null);
  }
  assert.match(evidence.items.storefront_subscription_price_tax_parity.notes,/store-provided localized price string/);
  assert.match(evidence.items.production_health_document_check_provider.notes,/Google Cloud Vision/);
});


check('expired vaccination checks fail closed across public JSON discovery and mating eligibility',()=>{
  const m=read('supabase/migrations/205_health_document_check_without_veterinarian_signals.sql');
  assert.match(m,/create or replace function public\.effective_vaccination_complete/);
  assert.match(m,/create or replace function public\.has_current_vaccination_check/);
  assert.match(m,/'vaccinationStatus',case when public\.effective_vaccination_complete\(p\.id\)/);
  assert.match(m,/vaccinatedOnly'\)::boolean,false\)=false or public\.effective_vaccination_complete\(p\.id\)/);
  assert.match(m,/public\.effective_vaccination_complete\(a\.id\) and public\.effective_vaccination_complete\(b\.id\)/);
  assert.doesNotMatch(m.slice(m.indexOf('-- 6. Everything'),m.indexOf('-- 7. Remove the flag')).replace(/--.*$/gm,''),/veterinarian|has_current_veterinarian/);
});



check('marketing consent response-loss retries are serialized and notification settings derive marketing authority from exact current consent',()=>{
  const m=read('supabase/migrations/142_retry_safe_desired_state_and_consent_mutations.sql');
  assert.match(m,/legal_country_runtime where user_id=v_user_id for update/i);
  assert.match(m,/if found and v_last\.granted=true[\s\S]*v_last\.consent_document_set_sha256 is not distinct from v_current_consent_document_set_sha256[\s\S]*v_last\.document_locale is not distinct from v_bundle\.document_locale then/i);
  assert.match(m,/v_last\.consent_document_set_sha256 is not distinct from v_current_consent_document_set_sha256[\s\S]*then[\s\S]*'idempotent',true[\s\S]*end if;[\s\S]*perform public\.rate_limit\('marketing_push_consent',20,3600\)/i);
  assert.match(m,/update_notification_preferences[\s\S]*current_marketing_push_consent_granted\(auth\.uid\(\)\)/i);
  assert.match(m,/revoke all on function public\.update_notification_preferences\(jsonb\) from public,anon/i);
  assert.match(m,/grant execute on function public\.update_notification_preferences\(jsonb\) to authenticated/i);
});

check('desired-state RPC retries no-op before rate limits or duplicate audit evidence',()=>{
  const m=read('supabase/migrations/142_retry_safe_desired_state_and_consent_mutations.sql');
  for(const fn of ['submit_meetup_feedback','set_account_paused','update_privacy_settings','update_measurement_system','update_preferred_locale','update_notification_preferences','set_event_attendance','join_local_waitlist','set_travel_mode','update_pet_private_location']){
    assert.match(m,new RegExp(`create or replace function public\\.${fn}\\(`,'i'),`${fn} must be rebound in retry closure`);
  }
  assert.match(m,/submit_meetup_feedback[\s\S]*v_existing\.private_note is not distinct from v_note then[\s\S]*return;[\s\S]*perform public\.rate_limit\('meetup_feedback'/i);
  assert.match(m,/set_account_paused[\s\S]*return jsonb_build_object\('paused',true\)[\s\S]*perform public\.rate_limit\('account_pause'/i);
  assert.match(m,/update_privacy_settings[\s\S]*v_discoverable is not distinct from p_discoverable[\s\S]*return;[\s\S]*update public\.users/i);
  assert.match(m,/update_measurement_system[\s\S]*v_current is not distinct from p_system then return; end if;[\s\S]*rate_limit\('measurement_system'/i);
  assert.match(m,/update_preferred_locale[\s\S]*v_old is not distinct from p_locale then return; end if;[\s\S]*rate_limit\('preferred_locale'/i);
  assert.match(m,/update_notification_preferences[\s\S]*if v_existing=v_allowed then return v_allowed; end if;[\s\S]*rate_limit\('notification_preferences'/i);
  assert.match(m,/set_event_attendance[\s\S]*v_existing::text=p_status then return; end if;[\s\S]*rate_limit\('event_attendance'/i);
  assert.match(m,/join_local_waitlist[\s\S]*if not v_exists then[\s\S]*rate_limit\('community_waitlist'/i);
  assert.match(m,/set_travel_mode[\s\S]*v_current_enabled=true and v_current_zone=z\.id then[\s\S]*return jsonb_build_object[\s\S]*rate_limit\('travel_mode_change'/i);
  assert.match(m,/update_pet_private_location[\s\S]*v_current_lat is not distinct from v_lat[\s\S]*return;[\s\S]*rate_limit\('private_location_update'/i);
});

check('hydrated media never preserves cleartext remote URLs',()=>{
  const api=read('src/services/api.ts');
  assert.match(api,/function isRemoteUrl[\s\S]*\/\^https:\\\/\\\//i);
  assert.doesNotMatch(api,/\^https\?:\\\/\\\//i);
});

check('pet profile and prompts save atomically with durable response-loss idempotency and legacy create surface closed',()=>{
  const m=read('supabase/migrations/145_pet_profile_atomic_idempotency_and_legacy_surface_closure.sql');
  const api=read('src/services/api.ts');
  const screen=read('src/screens/PetEditorScreen.tsx');
  assert.match(m,/create or replace function public\.upsert_pet_profile_idempotent\([\s\S]*p_client_operation_id text[\s\S]*require_active_authenticated_session\(\)/i);
  assert.match(m,/client_mutation_hash\([\s\S]*'petId'[\s\S]*'payload'[\s\S]*'prompts'/i);
  assert.match(m,/pg_advisory_xact_lock[\s\S]*:upsert_pet_profile:/i);
  assert.match(m,/client_mutation_receipts[\s\S]*action='upsert_pet_profile'[\s\S]*client_operation_id_reused/i);
  const profileCall=m.indexOf('v_id:=public.upsert_pet_profile');
  const promptCall=m.indexOf('perform public.upsert_pet_prompts');
  const receiptInsert=m.indexOf("values(auth.uid(),'upsert_pet_profile'");
  assert.ok(profileCall>=0&&promptCall>profileCall&&receiptInsert>promptCall,'profile + prompts must commit before the receipt in one transaction');
  assert.match(m,/revoke all on function public\.upsert_pet_profile\(uuid,jsonb\) from public,anon,authenticated/i);
  assert.match(m,/revoke all on function public\.upsert_pet_prompts\(uuid,jsonb\) from public,anon,authenticated/i);
  assert.match(m,/revoke all on function public\.create_pet_event\([\s\S]*from public,anon,authenticated/i);
  assert.match(m,/grant execute on function public\.upsert_pet_profile_idempotent\(uuid,jsonb,jsonb,text\) to authenticated/i);
  assert.match(api,/rpc\('upsert_pet_profile_idempotent',[\s\S]*p_client_operation_id:input\.operationId/);
  assert.doesNotMatch(api,/rpc\('upsert_pet_prompts'/);
  assert.match(screen,/getOrCreateDurableClientOperation\('pet-profile'/);
  assert.match(screen,/upsertPetProfile\(\{petId:savedPetId,payload,prompts:promptPayload,operationId:operation\.id\}\)/);
  assert.match(screen,/clearDurableClientOperation\(operation\.key,operation\.id\)/);
  assert.doesNotMatch(screen,/rpc\('upsert_pet_profile'/);
});

check('effective authenticated mutating RPC surface has no stale unused client entry points',()=>{
  const migrations=globSync('supabase/migrations/[0-9]*.sql').sort();
  const effective=new Map();
  const arity=(args)=>{const t=args.trim();return t? t.split(',').length:0};
  for(const file of migrations){
    const sql=read(file);
    const re=/(grant\s+execute|revoke\s+(?:all|execute))\s+on\s+function\s+public\.([A-Za-z0-9_]+)\s*\(([^;]*)\)\s+(?:to|from)\s+([^;]+);/gi;
    for(const match of sql.matchAll(re)){
      const key=`${match[2]}/${arity(match[3])}`;
      const roles=new Set(effective.get(key)??[]);
      const listed=match[4].toLowerCase().split(',').map(x=>x.trim());
      if(/^grant/i.test(match[1]))for(const role of listed)roles.add(role); else for(const role of listed)roles.delete(role);
      effective.set(key,roles);
    }
  }
  const source=globSync('src/**/*.{ts,tsx}').map(read).join('\n');
  const used=new Set([...source.matchAll(/\.rpc\(\s*['\"]([A-Za-z0-9_]+)['\"]/g)].map(m=>m[1]));
  const mutating=/^(?:create|upsert|update|set|delete|remove|send|respond|submit|join|leave|activate|cancel|report|track|record|pass|like|block|unblock|undo|accept|mark|resolve|start|finish|attach|claim|apply|review|dismiss|archive|purge|revoke)/i;
  const stale=[];
  for(const [key,roles] of effective){
    const name=key.split('/')[0];
    if(roles.has('authenticated')&&!roles.has('anon')&&mutating.test(name)&&!used.has(name))stale.push(key);
  }
  assert.deepEqual(stale,[],`stale authenticated mutating RPC surface: ${stale.join(', ')}`);
});

check('pet prompts and privacy settings are response-loss safe without unbounded state churn',()=>{
  const m=read('supabase/migrations/144_prompt_and_privacy_retry_closure.sql');
  assert.match(m,/update_privacy_settings[\s\S]*v_discoverable is not distinct from p_discoverable[\s\S]*return;[\s\S]*rate_limit\('privacy_settings',30,3600\)[\s\S]*privacy_settings_update/i);
  assert.match(m,/upsert_pet_prompts[\s\S]*require_active_authenticated_session\(\)[\s\S]*owns_pet\(p_pet_id\)/i);
  assert.match(m,/v_requested:=v_requested\|\|jsonb_build_array[\s\S]*from public\.pets[\s\S]*for update/i);
  assert.match(m,/if v_existing=v_requested then return; end if;[\s\S]*rate_limit\('pet_prompts',30,3600\)[\s\S]*delete from public\.pet_prompts/i);
  assert.match(m,/moderation_status='pending'[\s\S]*moderation_items/i);
});

check('effective service-only MFA verifier uses empty SECURITY DEFINER search_path',()=>{
  const m=read('supabase/migrations/146_mfa_service_search_path_hardening.sql');
  assert.match(m,/service_user_has_verified_mfa[\s\S]*security definer[\s\S]*set search_path=''[\s\S]*from auth\.mfa_factors/i);
  assert.match(m,/revoke all on function public\.service_user_has_verified_mfa\(uuid\) from public,anon,authenticated/i);
  assert.match(m,/grant execute on function public\.service_user_has_verified_mfa\(uuid\) to service_role/i);
});


check('notification, push registration, and upload intent residual retries are bounded and takeover-safe',()=>{
  const m=read('supabase/migrations/149_notification_push_upload_retry_finalization.sql');
  const tokenRace=read('supabase/migrations/150_upload_intent_expiry_and_push_serialization.sql');
  const api=read('src/services/api.ts');
  const uploads=read('src/services/uploads.ts');
  assert.match(m,/mark_notification_read[\s\S]*read_at is null/i);
  assert.match(m,/register_push_token[\s\S]*v_existing\.user_id<>auth\.uid\(\)[\s\S]*v_existing\.enabled[\s\S]*push_token_in_use/i);
  assert.match(m,/v_existing\.active_pet_id is not distinct from p_active_pet_id[\s\S]*last_seen_at<now\(\)-interval '6 hours'[\s\S]*return;[\s\S]*rate_limit\('push_token_register'/i);
  assert.match(m,/create_upload_intent_idempotent\([\s\S]*require_active_authenticated_session\(\)[\s\S]*pg_advisory_xact_lock/i);
  assert.match(m,/client_mutation_receipts[\s\S]*action='upload_intent'[\s\S]*client_operation_id_reused/i);
  assert.match(m,/v_result:=public\.create_upload_intent\([\s\S]*insert into public\.client_mutation_receipts/i);
  assert.match(m,/revoke all on function public\.create_upload_intent\(uuid,text,text,text,text\) from public,anon,authenticated/i);
  assert.match(m,/grant execute on function public\.create_upload_intent_idempotent\(uuid,text,text,text,text,text\) to authenticated/i);
  assert.match(tokenRace,/pg_advisory_xact_lock[\s\S]*'push-token:'\|\|v_token/i);
  assert.match(tokenRace,/where token=v_token[\s\S]*for update/i);
  assert.match(tokenRace,/v_existing\.user_id<>auth\.uid\(\)[\s\S]*v_existing\.enabled[\s\S]*push_token_in_use/i);
  assert.match(api,/rpc\('create_upload_intent_idempotent',[\s\S]*p_client_operation_id:input\.operationId/);
  assert.doesNotMatch(api,/rpc\('create_upload_intent',/);
  assert.match(uploads,/getOrCreateDurableClientOperation\('upload-intent',[\s\S]*input\.uri/);
  assert.match(uploads,/createUploadIntent\([\s\S]*operationId:operation\.id/);
  assert.match(uploads,/clearDurableClientOperation\(operation\.key,operation\.id\)/);
});


check('push-token ownership is race-serialized and expired upload intents cannot poison retries or grow forever',()=>{
  const m=read('supabase/migrations/150_upload_intent_expiry_and_push_serialization.sql');
  assert.match(m,/register_push_token[\s\S]*pg_advisory_xact_lock\([\s\S]*'push-token:'\|\|v_token[\s\S]*select \* into v_existing[\s\S]*for update/i);
  assert.match(m,/v_existing\.user_id<>auth\.uid\(\)[\s\S]*v_existing\.enabled[\s\S]*push_token_in_use/i);
  assert.match(m,/create_upload_intent_idempotent[\s\S]*current_user_has_product_access\(\)/i);
  assert.match(m,/v_intent\.consumed_at is not null[\s\S]*v_intent\.expires_at>now\(\)[\s\S]*return v_receipt\.result/i);
  assert.match(m,/delete from public\.client_mutation_receipts[\s\S]*action='upload_intent'/i);
  assert.match(m,/storage_gc_queue[\s\S]*upload_intents[\s\S]*expires_at<=now\(\)[\s\S]*delete from public\.upload_intents/i);
  assert.match(m,/purge_operational_records[\s\S]*storage_gc_queue[\s\S]*expires_at<p_upload_intents_before[\s\S]*delete from public\.upload_intents/i);
  assert.match(m,/revoke all on function public\.purge_operational_records\([\s\S]*from public,anon,authenticated/i);
  assert.match(m,/grant execute on function public\.purge_operational_records\([\s\S]*to service_role/i);
});


check('favorites rate-limit only real new rows while removals and retries remain free',()=>{
  const m=read('supabase/migrations/151_favorite_write_abuse_guard.sql');
  const remove=m.indexOf('if not coalesce(p_favorite,false)');
  const retry=m.indexOf('if exists(select 1 from public.pet_favorites');
  const rate=m.indexOf("rate_limit('favorite',300,86400)");
  const insert=m.indexOf('insert into public.pet_favorites');
  assert.ok(remove>=0&&retry>remove&&rate>retry&&insert>rate,'favorite no-op/removal must happen before rate-limited insertion');
  assert.match(m,/lock_owner_safety_relation[\s\S]*pg_advisory_xact_lock/);
  assert.match(m,/target_user\.suspended_at is null[\s\S]*target_user\.paused_at is null[\s\S]*target_user\.discoverable/i);
});

check('tracking and cookie consent remains truthful no-tracking by default and fail-closed on future tracking',()=>{
  const config=read('app.config.ts');
  const privacy=read('docs/PRIVACY_DATA_MAP.md');
  const pkg=read('package.json');
  assert.match(config,/NSPrivacyTracking:\s*false/);
  assert.match(privacy,/do not set application-owned browser cookies/);
  assert.match(privacy,/future advertising identifier[\s\S]*release-blocking privacy change/i);
  assert.doesNotMatch(pkg,/appsflyer|adjust|mixpanel|amplitude|facebook.*sdk|segment.*analytics/i);
});


check('RevenueCat reads and store mutations bind to the authoritative current Supabase user inside the identity mutex',()=>{
  assert.match(purchasesClient,/withCurrentPurchasesIdentity[\s\S]*withIdentityLock[\s\S]*supabase\.auth\.getSession\(\)[\s\S]*ensurePurchasesIdentityLocked\(userId\)[\s\S]*after\.session\?\.user\.id!==userId/);
  assert.match(purchasesClient,/getPremiumPackage[\s\S]*withCurrentPurchasesIdentity[\s\S]*Purchases\.getOfferings/);
  assert.match(purchasesClient,/getConsumableProducts[\s\S]*withCurrentPurchasesIdentity[\s\S]*Purchases\.getProducts/);
  assert.match(purchasesClient,/purchaseConsumable[\s\S]*withCurrentPurchasesIdentity[\s\S]*Purchases\.purchaseStoreProduct/);
  assert.match(purchasesClient,/purchasePremium[\s\S]*runBillingSingleFlight\('purchase'[\s\S]*withCurrentPurchasesIdentity[\s\S]*Purchases\.purchasePackage/);
  assert.match(purchasesClient,/restorePurchases[\s\S]*runBillingSingleFlight\('restore'[\s\S]*withCurrentPurchasesIdentity[\s\S]*Purchases\.restorePurchases/);
  assert.match(purchasesClient,/hasPremium\(customerInfo\?[\s\S]*withCurrentPurchasesIdentity[\s\S]*Purchases\.getCustomerInfo/);
});


check('social OAuth launch URLs are pinned to the configured Supabase auth origin and authorize routes',()=>{
  const auth=read('src/services/auth.ts');
  assert.match(auth,/requireExpectedSupabaseOAuthStartUrl/);
  assert.match(auth,/candidate\.origin!==backend\.origin/);
  assert.match(auth,/auth\/v1[\s\S]*authorize/);
  assert.match(auth,/startLinkedSocialSignIn[\s\S]*requireExpectedSupabaseOAuthStartUrl\(data\.url\)/);
  assert.match(auth,/linkSocialIdentity[\s\S]*requireExpectedSupabaseOAuthStartUrl\(data\.url\)/);
});

check('age assurance concurrent start race preserves already-in-progress semantics',()=>{
  const edge=read('supabase/functions/start-age-assurance/index.ts');
  assert.match(edge,/legal_age_assurance_one_pending_per_user_idx/);
  assert.match(edge,/23505/);
  assert.match(edge,/age_assurance_already_in_progress[\s\S]*409/);
  assert.match(edge,/\.eq\('user_id',user\.id\)\.eq\('status','pending'\)\.maybeSingle\(\)/);
});


check('every effective SECURITY DEFINER function pins an empty search_path',()=>{
  const latest=new Map();
  for(const file of globSync('supabase/migrations/*.sql').sort()){
    const sql=read(file);
    const re=/create\s+or\s+replace\s+function\s+(?:public\.)?([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)\s*returns([\s\S]*?)\$\$\s*;/gi;
    for(const match of sql.matchAll(re)){
      const args=match[2].split(',').map(part=>part.trim().replace(/^([a-zA-Z_][\w]*)\s+/,'').replace(/\s+default[\s\S]*$/i,'').replace(/\s+/g,' ')).join(',');
      latest.set(`${match[1]}(${args})`,{file,definition:match[0]});
    }
  }
  const unsafe=[];
  for(const [signature,{file,definition}] of latest){
    if(!/\bsecurity\s+definer\b/i.test(definition))continue;
    if(!/set\s+search_path\s*=\s*''/i.test(definition))unsafe.push(`${signature} @ ${file}`);
  }
  assert.deepEqual(unsafe,[],`Effective SECURITY DEFINER search_path is not empty:\n${unsafe.join('\n')}`);
});


check('RevenueCat consumable lifecycle resolves an existing store transaction to its bound owner',()=>{
  const ownerSql=read('supabase/migrations/156_consumable_transaction_authoritative_owner_resolution.sql');
  assert.match(ownerSql,/resolve_consumable_transaction_owner[\s\S]*security definer[\s\S]*set search_path=''/i);
  assert.match(ownerSql,/consumable_store_transaction_state[\s\S]*provider_app_id=v_app_id[\s\S]*provider_environment=v_environment[\s\S]*store_transaction_id=v_transaction_id/);
  assert.match(ownerSql,/store_product_id<>v_product_id[\s\S]*credit_kind<>p_credit_kind[\s\S]*quantity<>p_quantity[\s\S]*consumable_transaction_metadata_mismatch/);
  assert.match(ownerSql,/revoke all on function public\.resolve_consumable_transaction_owner\(text,text,text,text,text,integer\) from public,anon,authenticated/);
  assert.match(ownerSql,/grant execute on function public\.resolve_consumable_transaction_owner\(text,text,text,text,text,integer\) to service_role/);
  assert.match(webhook,/resolve_consumable_transaction_owner[\s\S]*storedOwner[\s\S]*purchaseUser=storedOwner/);
  assert.match(webhook,/!purchaseUser&&allUsers\.length===1[\s\S]*consumable_user_ambiguous/);
});



check('CI includes a fail-closed Trivy vulnerability secret and misconfiguration gate',()=>{
  const workflow=read('.github/workflows/security-scan.yml');
  assert.match(workflow,/permissions:\s*\n\s*contents:\s*read/i);
  assert.match(workflow,/aquasecurity\/trivy-action@v0\.36\.0/);
  assert.match(workflow,/scan-type:\s*fs/);
  assert.match(workflow,/scanners:\s*vuln,secret,misconfig/);
  assert.match(workflow,/severity:\s*HIGH,CRITICAL/);
  assert.match(workflow,/exit-code:\s*['"]1['"]/);
  assert.match(workflow,/persist-credentials:\s*false/);
  assert.doesNotMatch(workflow,/pull-requests:\s*write|contents:\s*write|actions:\s*write/i);
});

check('PostGIS proximity queries use private geography columns, GIST indexes and rounded client distances',()=>{
  const m=read('supabase/migrations/157_postgis_private_spatial_index_and_proximity_queries.sql');
  assert.match(m,/create extension postgis with schema extensions/i);
  assert.match(m,/postgis_must_be_installed_in_extensions_schema/i);
  assert.match(m,/pet_private[\s\S]*location extensions\.geography\(Point,4326\)/i);
  assert.match(m,/lost_pet_alerts[\s\S]*location extensions\.geography\(Point,4326\)/i);
  assert.match(m,/pet_friendly_places[\s\S]*location extensions\.geography\(Point,4326\)/i);
  for(const index of ['idx_pet_private_location_gist','idx_lost_pet_alerts_location_gist','idx_pet_friendly_places_location_gist'])assert.match(m,new RegExp(`${index}[\\s\\S]*using gist\\(location\\)`,'i'));
  assert.match(m,/discover_pets_v86[\s\S]*extensions\.ST_DWithin\(v_private\.location,pp\.location,v_max_distance\*1000\.0\)[\s\S]*extensions\.ST_Distance\(v_private\.location,r\.candidate_location\)\/1000\.0/i);
  assert.match(m,/create_lost_pet_alert[\s\S]*extensions\.ST_DWithin\(priv\.location,pp\.location,v_radius\*1000\.0\)/i);
  assert.match(m,/get_nearby_lost_pet_alerts[\s\S]*extensions\.ST_DWithin\(mine\.location,a\.location,a\.alert_radius_km\*1000\.0\)/i);
  assert.match(m,/get_pet_friendly_places[\s\S]*extensions\.ST_DWithin\(mine\.location,place\.location,50000\.0\)/i);
  assert.match(m,/approximateDistanceKm[\s\S]*round\(/i);
  assert.match(m,/Never expose through public pet JSON/i);
});


check('pet, Reel and Story universal links are strict, auth-gated and server-authorized before navigation',()=>{
  const parser=read('src/services/deepLinks.ts');
  const petMigration=read('supabase/migrations/158_shareable_pet_profile_deep_link_authorization.sql');
  const contentMigration=read('supabase/migrations/174_reel_story_universal_link_authorization.sql');
  const routes=read('src/navigation/types.ts');
  const reels=read('src/screens/ReelsScreen.tsx');
  const feed=read('src/screens/FeedScreen.tsx');
  assert.match(parser,/CUSTOM_SCHEMES=new Set\(\['tailmance:'\]\)/);
  assert.match(parser,/const APP_LINK_HOST=/);
  assert.match(parser,/parsed\.username\|\|parsed\.password\|\|parsed\.port\|\|parsed\.hash\|\|parsed\.search/);
  assert.match(parser,/\(pet\|reel\|story\)/);
  assert.match(parser,/targetFromParts\(kind\.toLowerCase\(\),id\)/);
  for(const kind of ['pet','reel','story'])assert.ok(parser.includes(`universalUrl('${kind}'`),`missing ${kind} universal URL helper`);
  assert.match(petMigration,/get_shareable_pet_profile[\s\S]*require_active_authenticated_session\(\)/i);
  assert.match(petMigration,/current_user_has_product_access\(\)/i);
  assert.match(petMigration,/owns_pet\(p_viewer_pet_id\)/i);
  assert.match(petMigration,/moderation_status<>'approved'/i);
  assert.match(petMigration,/pet_photos[\s\S]*moderation_status='approved'\)<>3/i);
  assert.match(petMigration,/is_blocked\(p_viewer_pet_id,v_target\.id\)/i);
  assert.match(petMigration,/v_owner\.incognito[\s\S]*pet_likes[\s\S]*follows[\s\S]*pet_matches/i);
  assert.match(contentMigration,/get_shareable_reel[\s\S]*require_active_authenticated_session\(\)[\s\S]*current_user_has_product_access\(\)[\s\S]*owns_pet\(p_viewer_pet_id\)/i);
  assert.match(contentMigration,/get_shareable_reel[\s\S]*v_owner\.discoverable[\s\S]*v_owner\.incognito[\s\S]*pet_likes[\s\S]*follows[\s\S]*pet_matches/i);
  assert.match(contentMigration,/get_reels_page[\s\S]*au\.discoverable[\s\S]*not au\.incognito/i);
  assert.match(contentMigration,/get_shareable_story[\s\S]*expires_at>now\(\)[\s\S]*moderation_status='approved'/i);
  assert.match(contentMigration,/get_shareable_story[\s\S]*follows f where f\.from_pet_id=p_viewer_pet_id and f\.to_pet_id=v_story\.pet_id/i);
  assert.match(contentMigration,/revoke all on function public\.get_shareable_reel\(uuid,uuid\) from public,anon/i);
  assert.match(contentMigration,/revoke all on function public\.get_shareable_story\(uuid,uuid\) from public,anon/i);
  assert.match(navigator,/Linking\.getInitialURL\(\)/);
  assert.match(navigator,/Linking\.addEventListener\('url'/);
  assert.match(navigator,/legalState!=='accepted'/);
  assert.match(navigator,/getShareablePetProfile\(viewerPetId,targetPetId\)/);
  assert.match(navigator,/getShareableReel\(viewerPetId,pending\.targetId\)/);
  assert.match(navigator,/getShareableStory\(viewerPetId,pending\.targetId\)/);
  assert.match(navigator,/pendingContentDeepLinkRef\.current\?\.sequence===sequence/);
  assert.match(routes,/Reels: \{ reelId\?: string; linkNonce\?: number \} \| undefined/);
  assert.match(routes,/storyId\?: string; linkNonce\?: number/);
  assert.match(reels,/requestedLinkNonce=route\.params\?\.linkNonce/);
  assert.match(feed,/route\.params\?\.linkNonce[\s\S]*deepLinkStoryHandledRef\.current=key[\s\S]*openStory\(shared\)/);
  assert.match(navigator,/navigate\('Reels',\{reelId:pending\.targetId,linkNonce:sequence\}\)/);
  assert.match(navigator,/params:\{storyId:pending\.targetId,linkNonce:sequence\}/);
});

check('native universal/app-link configuration and association generation fail closed on real production identity',()=>{
  const config=read('app.config.ts');
  const generator=read('scripts/generate-app-link-associations.mjs');
  const clientRelease=read('scripts/release-config-check.mjs');
  const releaseAll=read('scripts/release-check-all.mjs');
  assert.match(config,/EXPO_PUBLIC_APP_LINK_HOST/);
  assert.match(config,/associatedDomains:\s*\[`applinks:\$\{appLinkHost\}`\]/);
  for(const path of ['pet','reel','story'])assert.ok(config.includes(`pathPrefix: '/${path}/'`),`Android intent filter missing /${path}/`);
  assert.match(config,/intentFilters:[\s\S]*autoVerify:\s*true/);
  assert.match(generator,/APPLE_TEAM_ID/);
  assert.match(generator,/ANDROID_APP_LINK_CERT_SHA256/);
  assert.match(generator,/apple-app-site-association/);
  assert.match(generator,/assetlinks\.json/);
  assert.match(generator,/com\.tailmance\.app/);
  for(const path of ['pet','reel','story'])assert.ok(generator.includes(`/${path}/*`),`AASA missing ${path} path`);
  assert.match(generator,/delegate_permission\/common\.handle_all_urls/);
  assert.match(generator,/--check/);
  assert.doesNotMatch(generator,/REPLACE_|YOUR_|example\.com/i);
  assert.match(clientRelease,/['"]EXPO_PUBLIC_APP_LINK_HOST['"]/);
  assert.match(releaseAll,/universal\/app link associations[\s\S]*release:app-links/);
});


check('pet rehoming and adoption are blocked client-side, server-side and in moderation policy',()=>{
  const migration=read('supabase/migrations/159_pet_rehoming_zero_tolerance_enforcement.sql');
  const contentSafety=read('src/domain/contentSafety.ts');
  assert.match(migration,/contains_prohibited_pet_rehoming_intent/);
  assert.match(migration,/pet_rehoming_prohibited/);
  for(const table of ['messages','posts','comments','pet_events','meetup_requests','pets','pet_prompts']) assert.match(migration,new RegExp(`tg_table_name='${table}'`));
  assert.match(migration,/array\['messages','posts','comments','pet_events','meetup_requests','pets','pet_prompts'\]/);
  assert.match(migration,/trg_no_pet_rehoming_%I/);
  assert.match(migration,/before insert or update[\s\S]*reject_pet_rehoming_ugc/);
  assert.match(migration,/set_report_sla[\s\S]*pet_rehoming[\s\S]*'high'/i);
  assert.match(contentSafety,/PROHIBITED_PET_REHOMING_PATTERNS/);
  assert.match(contentSafety,/pet_rehoming/);
  for(const marker of ['sahiplendir','里親募集','입양','领养','領養','adopsi','adopcji','รับเลี้ยง','nhận\\s+nuôi']) assert.ok(contentSafety.includes(marker),`missing rehoming marker: ${marker}`);
  assert.match(moderation,/MODERATION_POLICY[\s\S]*pet_rehoming_or_adoption/);
  assert.match(moderation,/requestBody\s*=\s*\{\.\.\.requestBody, moderation_policy: MODERATION_POLICY\}/);
});

check('media moderation provider contract is policy-versioned and OCR is deterministically rechecked server-side',()=>{
  const authority=read('supabase/migrations/162_pet_first_media_ocr_policy_authority.sql');
  assert.match(authority,/create or replace function public\.contains_prohibited_pet_commerce_intent\(p_text text\)/i);
  assert.match(authority,/revoke all on function public\.contains_prohibited_pet_commerce_intent\(text\) from public,anon,authenticated/i);
  assert.match(authority,/grant execute on function public\.contains_prohibited_pet_commerce_intent\(text\) to service_role/i);
  assert.match(authority,/grant execute on function public\.contains_prohibited_pet_rehoming_intent\(text\) to service_role/i);
  assert.match(authority,/grant execute on function public\.contains_prohibited_human_dating_intent\(text\) to service_role/i);
  assert.match(moderation,/policy_version:\s*'tailmance-pet-first-v3'/);
  for(const category of ['pet_sale','pet_rehoming_or_adoption','commercial_breeding_marketplace','human_dating_misuse']) assert.match(moderation,new RegExp(category));
  assert.match(moderation,/require_media_ocr_text:\s*true/);
  assert.match(moderation,/require_video_audio_transcript:\s*true/);
  assert.match(moderation,/typeof verdict\.audio_transcript===['"]string['"][\s\S]*verdict\.audio_transcript\.length<=20_000/);
  assert.match(moderation,/require_audio_transcript:mediaKind===['"]video['"]/);
  assert.match(moderation,/verdict\.policy_version!==MODERATION_POLICY\.policy_version/);
  assert.match(moderation,/allowedTopKeys=new Set/,'moderation provider verdict must reject unknown top-level fields');
  assert.match(moderation,/Object\.keys\(raw\)\.length!==MODERATION_POLICY\.prohibited_categories\.length/,'moderation category object must be exact, not merely contain required keys');
  assert.match(moderation,/typeof metadataRecord\.duration_ms!==['"]number['"]/,'video duration evidence must be strict numeric JSON, not coerced');
  assert.match(moderation,/MODERATION_POLICY\.prohibited_categories\.every\(key=>typeof raw\[key\]===['"]boolean['"]\)/);
  assert.match(moderation,/typeof verdict\.ocr_text===['"]string['"][\s\S]*verdict\.ocr_text\.length<=20_000/);
  for(const rpc of ['contains_prohibited_pet_commerce_intent','contains_prohibited_pet_rehoming_intent','contains_prohibited_human_dating_intent']) assert.match(moderation,new RegExp(`supabase\\.rpc\\(['"]${rpc}['"]`));
  assert.match(moderation,/provider_policy_contract_missing/);
  assert.match(moderation,/deterministicOcrBlockedCategory\?\?deterministicAudioBlockedCategory\?\?providerBlockedCategory/);
  assert.match(moderation,/verdict\.approved&&!blockedCategory&&petFirstContext\s*\?\s*['"]approved['"]\s*:\s*['"]rejected['"]/);
});


check('pet-first public model never exposes owner identity as a social persona',()=>{
  const types=read('src/types/domain.ts');
  const petJson=read('supabase/migrations/132_live_health_verification_expiry_enforcement.sql');
  assert.doesNotMatch(types,/ownerId\??:/);
  const definition=/create or replace function public\.pet_json\([\s\S]*?revoke all on function public\.pet_json\(uuid,uuid\)/i.exec(petJson)?.[0]??'';
  assert.ok(definition,'effective pet_json definition is required');
  assert.doesNotMatch(definition,/'ownerId'|'ownerName'|'ownerAvatar'|'ownerBio'/i);
  assert.match(definition,/'ownerVerified',u\.identity_verified/);
});


check('all user reports have a strict under-24-hour moderation review target',()=>{
  const sla=read('supabase/migrations/160_moderation_review_sla_under_24h.sql');
  assert.match(sla,/urgent[\s\S]*interval '15 minutes'/i);
  assert.match(sla,/high[\s\S]*interval '4 hours'/i);
  assert.match(sla,/else interval '12 hours'/i);
  assert.match(sla,/resolution_target_at[\s\S]*high[\s\S]*interval '12 hours'[\s\S]*else interval '23 hours'/i);
  assert.match(sla,/pet_sale','pet_rehoming','commercial_breeding/);
  assert.match(sla,/revoke all on function public\.set_report_sla\(\) from public,anon,authenticated/i);
});

console.log(`security-checks: ${checks.length}/${checks.length} passed`);
