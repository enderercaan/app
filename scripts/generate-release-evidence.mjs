import { spawnSync } from 'node:child_process';
import { globSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { readTypecheckEvidenceStatus } from './local-typecheck-evidence.mjs';

const root = process.cwd();
function localIsoDate(timeZone='Europe/Istanbul'){const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const get=t=>parts.find(p=>p.type===t)?.value??'';return `${get('year')}-${get('month')}-${get('day')}`;}
const reportDate=localIsoDate();
function run(command,args){
  const r=spawnSync(command,args,{cwd:root,encoding:'utf8'});
  if(r.status!==0){
    process.stderr.write(r.stdout??'');
    process.stderr.write(r.stderr??'');
    throw new Error(`${command} ${args.join(' ')} failed with ${r.status}`);
  }
  return `${r.stdout??''}${r.stderr??''}`.trim();
}
function one(re,text,label){const m=text.match(re);if(!m)throw new Error(`Could not parse ${label}: ${text}`);return m.slice(1)}

const outputs={
  domain:run('node',['scripts/domain-tests.mjs']),
  security:run('node',['scripts/security-checks.mjs']),
  pending:run('node',['scripts/pending-hardening-checks.mjs']),
  accessibility:run('node',['scripts/accessibility-checks.mjs']),
  contracts:run('node',['scripts/backend-contract-checks.mjs']),
  ux:run('node',['scripts/ux-checks.mjs']),
  lint:run('node',['scripts/project-lint.mjs']),
  i18n:run('node',['scripts/i18n-checks.mjs']),
  i18nRelease:run('node',['scripts/i18n-release-check.mjs']),
  i18nSourceUsage:run('node',['scripts/i18n-source-usage-checks.mjs']),
  runtimeLanguageQuality:run('node',['scripts/runtime-language-quality-checks.mjs']),
  legal:run('node',['scripts/legal-policy-checks.mjs']),
  legalContext:run('node',['scripts/legal-context-matrix-tests.mjs']),
  localizedLegalLanguage:run('node',['scripts/localized-legal-language-checks.mjs']),
  legalWebLocalization:run('node',['scripts/legal-web-localization-checks.mjs']),
  legalSourceSummary:run('node',['scripts/sync-official-source-summary.mjs','--check']),
  legalControlEvidence:run('node',['scripts/sync-country-control-evidence.mjs','--check']),
  legalSubdimensions:run('node',['scripts/legal-critical-subdimension-checks.mjs']),
  operatorTaxRegistrationSubdimensions:run('node',['scripts/generate-operator-tax-registration-subdimension-review.mjs','--check']),
  legalCompleteness:run('node',['scripts/generate-legal-completeness-truth.mjs','--check']),
  externalLegalBoundary:run('node',['scripts/external-legal-evidence-boundary-checks.mjs']),
  releaseBlockerInventory:run('node',['scripts/generate-release-blocker-inventory.mjs','--check']),
  subdivisionUniverse:run('node',['scripts/configured-market-subdivision-universe-checks.mjs']),
  legalTemporal:run('node',['scripts/temporal-effective-date-checks.mjs']),
  migrationRelease:run('node',['scripts/migration-release-check.mjs']),
  storeMetadataRelease:run('node',['scripts/store-metadata-release-check.mjs']),
  storeLanguageQuality:run('node',['scripts/store-language-quality-checks.mjs']),
  country:run('node',['scripts/country-registry-tests.mjs']),
  euNationalImplementation:run('node',['scripts/eu-national-implementation-checks.mjs']),
  storeCompliance:run('node',['scripts/store-compliance-checks.mjs']),
  observability:run('node',['scripts/observability-checks.mjs']),
  securityIncidents:run('node',['scripts/security-incident-obligation-checks.mjs'])
};
const [domainPassed,domainTotal]=one(/domain-tests:\s*(\d+)\/(\d+)\s+passed/,outputs.domain,'domain');
const [securityPassed,securityTotal]=one(/security-checks:\s*(\d+)\/(\d+)\s+passed/,outputs.security,'security');
const [pendingPassed,pendingTotal]=one(/pending-hardening-checks:\s*(\d+)\/(\d+)\s+passed/,outputs.pending,'pending hardening');
const [pressables,textInputs,switches,modals]=one(/accessibility-checks:\s*(\d+) Pressables \+ (\d+) TextInputs \+ (\d+) Switches \+ (\d+) Modals checked; passed/,outputs.accessibility,'accessibility');
const [rpcs,pendingOnlyRpcs,edgeInvocations,functionDirs]=one(/backend-contract-checks:\s*(\d+) RPCs(?: \((\d+) pending-patch only\))?, (\d+) invoked Edge Functions, (\d+) function directories checked/,outputs.contracts,'contracts');
const [tsx]=one(/ux-checks:\s*(\d+) TSX files/,outputs.ux,'ux');
const [lintFiles]=one(/project-lint:\s*scanned (\d+) text files; passed/,outputs.lint,'lint');
const [localeCount,readyLocales,productionTurkishMarkers,visibleLiteralTextMarkers,demoTurkishMarkers,nativeLocaleCount,historicalNotificationMarkers,pendingNotificationMarkers,runtimeEdgeNotificationMarkers]=one(/i18n-checks:\s*(\d+) locales declared; release-ready=([^;]+); production hardcoded Turkish-character markers=(\d+); visible literal Text markers=(\d+); demo-only markers=(\d+); native locale metadata=(\d+)\/19; historical SQL notification Turkish-character markers=(\d+); pending SQL notification Turkish-character markers=(\d+); runtime Edge notification Turkish-character markers=(\d+)/,outputs.i18n,'i18n');
const [runtimeKeyCount]=one(/i18n-release-check:\s*19\/19 complete runtime catalogs \+ push copy \+ native metadata; (\d+) source keys with placeholder parity/,outputs.i18nRelease,'runtime i18n catalog size');
const [sourceUsedI18nKeyCount]=one(/i18n-source-usage-checks:\s*(\d+) source-used\/dynamic keys covered by canonical catalog; PASS/,outputs.i18nSourceUsage,'runtime i18n source-used key count');
const [criticalKeyCount,runtimeLocaleCount]=one(/runtime-language-quality-checks:\s*PASS \((\d+) fixed critical keys; placeholder\/key parity across (\d+) locales;/,outputs.runtimeLanguageQuality,'runtime language quality');
const [legalDocLocales,legalDocFamilies]=one(/localized-legal-language-checks:\s*PASS (\d+) legal document locales × (\d+) required documents each;/,outputs.localizedLegalLanguage,'localized legal language');
const [legalWebLocales,legalWebDocuments]=one(/legal-web-localization-checks:\s*PASS (\d+) locales \/ (\d+) documents;/,outputs.legalWebLocalization,'legal web localization');
const [sourceTopicCells,sourceEmptyCells,sourcePresenceGaps]=one(/official-source-summary:\s*(\d+) topic cells; (\d+) empty-evidence source-review cells; (\d+) canonical topic source-presence gaps;/,outputs.legalSourceSummary,'official source summary');
const [controlEvidenceCells]=one(/country-control-evidence-sync:\s*(\d+) country×control cells exactly synchronized PASS/,outputs.legalControlEvidence,'country control evidence');
const [criticalSubdimensionsPassed,criticalSubdimensionsTotal]=one(/legal-critical-subdimensions:\s*(\d+)\/(\d+) derived evidence cells/,outputs.legalSubdimensions,'critical legal subdimensions');
const [operatorTaxCells,operatorTaxCellsTotal,operatorTaxBlockers]=one(/operator-tax-registration-subdimensions:\s*(\d+)\/(\d+) internal official-source subdimension reviews PASS; source blockers=(\d+)/,outputs.operatorTaxRegistrationSubdimensions,'operator/tax/registration subdimensions');
const operatorTaxApproved=String(Number(operatorTaxCellsTotal)-Number(operatorTaxBlockers));
const [configuredSourceApprovedCount,exactCountryLanguageRoutes,sourceLegalLanguageBlockers,externalLegalPendingCount]=one(/legal-completeness-truth:\s*configured-27 source legal\/language=(\d+)\/27 PASS; exact routes=(\d+)\/594; source blockers=(\d+); production external pending=(\d+)/,outputs.legalCompleteness,'legal completeness truth');
const fullLegalComplete='false';
const countryLegalApprovals=`${configuredSourceApprovedCount}/27`;
const languageLegalApprovals=`${configuredSourceApprovedCount}/27`;
const subnationalLegalApprovals='SOURCE_REVIEWED_RUNTIME_CONTEXT_SEPARATE';
const [externalLegalItemsTotal,externalLegalVerified,externalLegalGenuinePending,externalLegalOutOfScope,externalLegalSourceRemediablePending]=one(/external-legal-evidence-boundary-checks:\s*(\d+)\/80 classified; source\/internal verified=(\d+), genuine-external-pending=(\d+), out-of-scope=(\d+), source-remediable-pending=(\d+)/,outputs.externalLegalBoundary,'external legal evidence boundary');
const [futureStates,temporalWatchItems,temporalAsOf]=one(/temporal-effective-date-checks:\s*(\d+) structured future-effective states \+ (\d+) high-volatility watch items consistent as of (\d{4}-\d{2}-\d{2})/,outputs.legalTemporal,'legal temporal watch');
const [migrationFirst,migrationLast]=one(/migration-release-check:\s*canonical migrations (\d+)-(\d+) contiguous;/,outputs.migrationRelease,'migration release');
const [storeMetadataValidated,storeMetadataExpected]=one(/store-metadata-release-check:\s*(\d+)\/(\d+) localized store metadata sets validated/,outputs.storeMetadataRelease,'store metadata release');
const [storeLanguageLocales,storeLanguageFields]=one(/store-language-quality-checks:\s*(\d+)\/19 locale sets; (\d+) localized text fields checked;/,outputs.storeLanguageQuality,'store language quality');
const [legalPassed,legalTotal]=one(/legal-policy-checks:\s*(\d+)\/(\d+)[^\n]*PASS/,outputs.legal,'legal');
const [legalContextPassed,legalContextTotal]=one(/legal-context-matrix-tests:\s*(\d+)\/(\d+)[^\n]*PASS/,outputs.legalContext,'legal context');
const [countryConfigured,countryTotal,countrySourceTopics,countryReleaseControls]=one(/country-registry-tests:\s*PASS (\d+)\/(\d+) markets; (\d+)\/594 official-source legal topic cells; (\d+)\/594 runtime source controls;/,outputs.country,'country registry');
const [euNationalMarkets]=one(/eu-national-implementation-checks:\s*(\d+)\/\d+ configured EU markets/,outputs.euNationalImplementation,'EU national implementation');
const [crashProvider,analyticsProvider]=one(/observability-checks:[^;]+; crash_provider=([^;]+); analytics_provider=([^\s]+)/,outputs.observability,'observability');
const [incidentMarketsPassed,incidentMarketsTotal]=one(/security-incident-obligation-checks:\s*(\d+)\/(\d+) configured markets source-legal incident matrix PASS;/,outputs.securityIncidents,'security incident obligations');
const migrations=readdirSync('supabase/migrations').filter(x=>x.endsWith('.sql')).sort();
const functions=readdirSync('supabase/functions',{withFileTypes:true}).filter(x=>x.isDirectory()&&!x.name.startsWith('_')).map(x=>x.name).sort();
const appConfig=readFileSync('app.config.ts','utf8');
const packageJson=JSON.parse(readFileSync('package.json','utf8'));
const easJson=JSON.parse(readFileSync('eas.json','utf8'));
const dependencies={...(packageJson.dependencies??{}),...(packageJson.devDependencies??{})};
const dependencyNames=Object.keys(dependencies);
const privacyManifestSourcePresent=/privacyManifests\s*:/.test(appConfig)||existsSync('PrivacyInfo.xcprivacy')||existsSync('ios/PrivacyInfo.xcprivacy');
const crashMonitoringDependencyPresent=dependencyNames.some(name=>/sentry|crashlytics|bugsnag|appcenter/i.test(name));
const reactErrorTelemetrySourcePresent=existsSync('src/services/errorTelemetry.ts') && readFileSync('src/services/errorTelemetry.ts','utf8').includes("record_client_error");
const analyticsDependencyPresent=dependencyNames.some(name=>/analytics|amplitude|mixpanel|posthog|segment|firebase-analytics/i.test(name));
const workerHeartbeatSourcePresent=existsSync('supabase/functions/_shared/workerHeartbeat.ts');
const opsHealthEndpointPresent=existsSync('supabase/functions/ops-health/index.ts');
const pendingPatch=globSync('supabase/migrations/{011,012,013,014,015,016,017,018,019,020,021,022,023,024}_*.sql').sort().map(p=>readFileSync(p,'utf8')).join('\n');
const pushDispatch=readFileSync('supabase/functions/push-dispatch/index.ts','utf8');
const moderationWorker=readFileSync('supabase/functions/moderate-media/index.ts','utf8');
const localePersistenceSourcePresent=/update_preferred_locale[\s\S]*preferredLocale/.test(pendingPatch);
const accountPauseSourcePresent=/set_account_paused[\s\S]*paused_at/.test(pendingPatch)&&/AccountStateProvider/.test(readFileSync('App.tsx','utf8'));
const suspensionGateSourcePresent=/SuspendedAccountScreen/.test(readFileSync('App.tsx','utf8'))&&/suspended_at/.test(pushDispatch);
const duplicatePhotoFingerprintSourcePresent=/pet_photo_fingerprints/.test(pendingPatch)&&/duplicate_photo_hash/.test(moderationWorker);
const remoteBuildVersioning=easJson?.cli?.appVersionSource==='remote'&&easJson?.build?.production?.autoIncrement===true;
const portraitLocked=/orientation:\s*'portrait'/.test(appConfig);
const lightOnly=/userInterfaceStyle:\s*'light'/.test(appConfig);
const automaticAppearance=/userInterfaceStyle:\s*'automatic'/.test(appConfig);
const systemUiDependency=dependencies['expo-system-ui']==='~57.0.4';
const systemUiPlugin=/['\"]expo-system-ui['\"]/.test(appConfig);
const themeSource=readFileSync('src/theme.ts','utf8');
const darkThemeBackground=themeSource.match(/const darkColors[\s\S]*?background:\s*'([^']+)'/)?.[1]??'';
const darkSplashBackground=appConfig.match(/expo-splash-screen[\s\S]*?dark:\s*\{[\s\S]*?backgroundColor:\s*'([^']+)'/)?.[1]??'';
const darkSplash=Boolean(darkThemeBackground&&darkSplashBackground===darkThemeBackground);
const reactiveThemeSource=/useColorScheme\(\)/.test(themeSource)&&/darkTheme/.test(themeSource)&&/lightTheme/.test(themeSource);
const darkModeSourceImplemented=automaticAppearance&&systemUiDependency&&systemUiPlugin&&darkSplash&&reactiveThemeSource;
const supportsTablet=/supportsTablet:\s*true/.test(appConfig);
const legalFiles=['web/privacy.html','web/terms.html','web/support.html'];
const legalPlaceholderPattern=/YAYIN ÖNCESİ|TASLAĞI|\[İŞLETMECİ|\[YAYIN|GERÇEK DESTEK|GERÇEK VERİ SORUMLUSU/i;
const legalPlaceholderFiles=legalFiles.filter(file=>existsSync(file)&&legalPlaceholderPattern.test(readFileSync(file,'utf8')));
const storeMetadataLocales=existsSync('store/metadata')?readdirSync('store/metadata').filter(x=>x.endsWith('.json')).map(x=>x.replace(/\.json$/,'')).sort():[];
const storeScreenshotFiles=existsSync('store/screenshots')?readdirSync('store/screenshots',{recursive:true}).filter(x=>/\.(png|jpe?g|webp)$/i.test(String(x))):[];
const notificationPreferenceSource=readFileSync('src/types/domain.ts','utf8')+readFileSync('src/screens/SettingsScreen.tsx','utf8')+pendingPatch;
const quietHoursSourcePresent=/quiet[_A-Z -]?hours|doNotDisturb|do_not_disturb|quietStart|quietEnd/i.test(notificationPreferenceSource);
const sourceCorpus=readFileSync('src/types/domain.ts','utf8')+readFileSync('src/services/locale.ts','utf8')+readFileSync('src/i18n/index.tsx','utf8');
const measurementPreferenceSourcePresent=/unitSystem|measurementSystem|distanceUnit|weightUnit|useMiles|usePounds/i.test(sourceCorpus);
const exportIssuerSource=existsSync('supabase/functions/export-data/index.ts')?readFileSync('supabase/functions/export-data/index.ts','utf8'):'';
const exportDownloadSource=existsSync('supabase/functions/export-download/index.ts')?readFileSync('supabase/functions/export-download/index.ts','utf8'):'';
const streamingExportSourcePresent=existsSync('supabase/migrations/044_streaming_account_export.sql')
  &&/crypto\.getRandomValues\(new Uint8Array\(32\)\)/.test(exportIssuerSource)
  &&/claim_account_export_download_token/.test(exportDownloadSource)
  &&/ReadableStream<Uint8Array>/.test(exportDownloadSource)
  &&/application\/x-ndjson/.test(exportDownloadSource);
const featurePolicySource=existsSync('src/domain/featurePolicy.ts')?readFileSync('src/domain/featurePolicy.ts','utf8'):'';
const profileHardeningSource=existsSync('supabase/migrations/013_profile_discovery_location_and_preferences_hardening.sql')?readFileSync('supabase/migrations/013_profile_discovery_location_and_preferences_hardening.sql','utf8'):'';
const matingPolicyCorpus=[
  'supabase/migrations/088_retention_trust_and_local_network_architecture.sql',
  'supabase/migrations/090_plus_growth_b2b_and_pet_first_product_enforcement.sql',
  'supabase/migrations/093_pet_first_discovery_mating_and_local_feed_finalization.sql',
  'supabase/migrations/134_configured_27_runtime_legal_source_authority.sql'
].filter(existsSync).map(file=>readFileSync(file,'utf8')).join('\n');
const latestMatingAuthority=existsSync('supabase/migrations/134_configured_27_runtime_legal_source_authority.sql')?readFileSync('supabase/migrations/134_configured_27_runtime_legal_source_authority.sql','utf8'):'';
const matingFailClosed=/mating_owner_arranged_enabled boolean not null default false/.test(matingPolicyCorpus)
  &&/legal_source_approval_current\(r\.legal_country_code\)/.test(latestMatingAuthority)
  &&/animal_welfare_review_complete/.test(latestMatingAuthority)
  &&/kinship_control_complete/.test(latestMatingAuthority)
  &&/evidence_reference/.test(latestMatingAuthority)
  &&/current_mating_feature_enabled/.test(latestMatingAuthority)
  &&/mating_feature_disabled|mating_not_available/.test(matingPolicyCorpus);
const placesSourcePresent=existsSync('src/screens/PlacesScreen.tsx')
  &&/getPetFriendlyPlaces|listPetFriendlyPlaces|pet.?friendly/i.test(readFileSync('src/screens/PlacesScreen.tsx','utf8'))
  && globSync('supabase/migrations/*.sql').some(file=>/pet_friendly|places|partner_venues/i.test(readFileSync(file,'utf8')));
const offlineReplaySourcePresent=existsSync('src/services/offlineMutationQueue.ts')&&existsSync('src/services/offlineSyncTask.ts')&&/useSQLCipher:\s*true/.test(appConfig)&&packageJson.dependencies?.['expo-sqlite']==='~57.0.3'&&packageJson.dependencies?.['expo-background-task']==='~57.0.16'&&packageJson.dependencies?.['expo-task-manager']==='~57.0.21'&&packageJson.dependencies?.['expo-network']==='~57.0.2';
const appIntegritySourcePresent=existsSync('src/services/deviceIntegrity.ts')
  &&existsSync('supabase/functions/verify-device-integrity/index.ts')
  &&existsSync('modules/tailmance-device-integrity/ios/TailmanceDeviceIntegrityModule.swift')
  &&existsSync('modules/tailmance-device-integrity/android/src/main/java/expo/modules/tailmancedeviceintegrity/TailmanceDeviceIntegrityModule.kt')
  &&existsSync('supabase/migrations/098_device_integrity_action_binding_and_app_attest_replay.sql')
  &&existsSync('supabase/migrations/099_device_integrity_high_risk_write_enforcement.sql');
const incidentOpsSourcePresent=existsSync('supabase/migrations/100_security_incident_operations_and_integrity_retention.sql')
  &&existsSync('release/security-incident-obligations-v19.json')
  &&existsSync('docs/SECURITY_INCIDENT_RESPONSE.md');

const authSource=readFileSync('src/services/auth.ts','utf8');
const phoneVerificationSourcePresent=/signInWithOtp\([\s\S]*phone\s*:|verifyOtp\([\s\S]*type\s*:\s*['"]sms['"]/.test(authSource);
const swipeAbuseLimitsSourcePresent=/rate_limit\(case when p_kind='super_like' then 'super_like' else 'like' end,case when p_kind='super_like' then 20 else 200 end,86400\)/.test(pendingPatch+readFileSync('supabase/migrations/014_account_state_reporting_and_match_serialization.sql','utf8'))
  &&/rate_limit\('pass',400,86400\)/.test(pendingPatch);
const countryRegistry=JSON.parse(readFileSync('release/country-release-gates.json','utf8'));
const storeCompliance=JSON.parse(readFileSync('release/store-compliance-v19.json','utf8'));
const externalLegal=JSON.parse(readFileSync('release/external-legal-evidence.json','utf8'));
const sourceLegalApproval=JSON.parse(readFileSync('release/configured-market-legal-language-source-approval-v20.json','utf8'));
const countryLegalSupplements=JSON.parse(readFileSync('release/country-legal-supplement-manifest-v20.json','utf8'));
const externalSecurity=JSON.parse(readFileSync('release/external-security-evidence.json','utf8'));
const officialSourceReview=JSON.parse(readFileSync('release/official-source-review-v19.json','utf8'));
const worldwideCountryCoverage=JSON.parse(readFileSync('release/worldwide-country-coverage-v19.json','utf8'));
const languageCoverageBoundary=JSON.parse(readFileSync('release/language-coverage-boundary-v19.json','utf8'));
const releaseBlockerInventory=JSON.parse(readFileSync('release/release-blocker-inventory-v19.json','utf8'));
const externalLegalOpen=Object.entries(externalLegal.items??{}).filter(([,item])=>item?.status==='not_verified').map(([name])=>name);
const externalSecurityOpen=Object.entries(externalSecurity.items??{}).filter(([,item])=>item?.status==='not_verified').map(([name])=>name);
const countryApproved=Object.entries(sourceLegalApproval.markets??{}).filter(([,m])=>m?.legal_source_status==='PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW'&&m?.language_source_status==='PASS_INTERNAL_LEGAL_LANGUAGE_QA').map(([code])=>code);

const evidence={
  schema_version:3,
  product:'Tailmance',
  attribution:{owner:'Yekta Ozel',creator:'Yekta Ozel',concept:'Yekta Ozel',product_design:'Yekta Ozel',development:'Yekta Ozel',implementation:'Yekta Ozel',overall_project:'Yekta Ozel'},
  generated_at:new Date().toISOString(),
  automated:{
    domain:{passed:Number(domainPassed),total:Number(domainTotal),status:'PASS'},
    security:{passed:Number(securityPassed),total:Number(securityTotal),status:'PASS'},
    pending_hardening:{passed:Number(pendingPassed),total:Number(pendingTotal),status:'PASS'},
    accessibility:{pressables:Number(pressables),text_inputs:Number(textInputs),switches:Number(switches),modals:Number(modals),status:'PASS'},
    backend_contracts:{rpcs:Number(rpcs),pending_patch_only_rpcs:Number(pendingOnlyRpcs??0),client_edge_invocations:Number(edgeInvocations),function_directories:Number(functionDirs),status:'PASS'},
    ux:{tsx_files:Number(tsx),status:'PASS'},
    project_lint:{text_files:Number(lintFiles),status:'PASS'},
    i18n:{declared_locales:Number(localeCount),release_ready_locales:String(readyLocales).split(',').filter(Boolean),runtime_catalog_key_count:Number(runtimeKeyCount),source_used_dynamic_key_count:Number(sourceUsedI18nKeyCount),production_hardcoded_turkish_markers:Number(productionTurkishMarkers),visible_literal_text_markers:Number(visibleLiteralTextMarkers),demo_only_turkish_markers:Number(demoTurkishMarkers),native_locale_metadata_count:Number(nativeLocaleCount),historical_sql_notification_turkish_markers:Number(historicalNotificationMarkers),pending_sql_notification_turkish_markers:Number(pendingNotificationMarkers),runtime_edge_notification_turkish_markers:Number(runtimeEdgeNotificationMarkers),critical_key_manifest_count:Number(criticalKeyCount),runtime_language_quality_locale_count:Number(runtimeLocaleCount),normalized_english_copy_guard:'PASS',status:Number(productionTurkishMarkers)===0&&Number(visibleLiteralTextMarkers)===0&&Number(nativeLocaleCount)===19&&Number(pendingNotificationMarkers)===0&&Number(runtimeEdgeNotificationMarkers)===0&&String(readyLocales).split(',').length===19&&Number(runtimeLocaleCount)===19?'PASS':'PARTIAL'},
    legal_localization:{runtime_locales:Number(runtimeLocaleCount),document_locales:Number(legalDocLocales),legal_document_only_locales:languageCoverageBoundary.legal_document_only_locales??[],required_document_families_per_locale:Number(legalDocFamilies),generated_localized_documents:Number(legalWebDocuments),generated_localized_document_locales:Number(legalWebLocales),configured_language_scope_only:true,all_world_languages_covered:languageCoverageBoundary.summary?.worldwide_language_coverage_complete===true,configured_runtime_locales_source_complete:languageCoverageBoundary.policy?.configured_runtime_locales_source_complete===true,configured_legal_document_locales_source_complete:languageCoverageBoundary.policy?.configured_legal_document_locales_source_complete===true,unsupported_or_unconfigured_language_localization_claim:'NOT_SUPPORTED_NOT_COUNTED_AS_LOCALIZED',required_legal_document_language_missing:'BLOCK',status:'PASS_CONFIGURED_27_SOURCE_LEGAL_LANGUAGE_INTERNAL_QA'},
    legal_source_matrix:{topic_cells:Number(sourceTopicCells),empty_evidence_cells:Number(sourceEmptyCells),canonical_topic_source_presence_gaps:Number(sourcePresenceGaps),legacy_true_topic_specific_source_scope_gaps:Number(sourcePresenceGaps),scope_applicability_resolution_status:'PASS_CONFIGURED_27_SOURCE_APPROVAL_RUNTIME_CONTEXT_SEPARATE',runtime_control_evidence_cells:Number(controlEvidenceCells),critical_subdimensions_passed:Number(criticalSubdimensionsPassed),critical_subdimensions_total:Number(criticalSubdimensionsTotal),operator_tax_registration_subdimension_cells:Number(operatorTaxCells),operator_tax_registration_subdimension_cells_total:Number(operatorTaxCellsTotal),operator_tax_registration_independently_approved:Number(operatorTaxApproved),status:'PASS_CONFIGURED_27_SOURCE_LEGAL_LANGUAGE'},
    legal_completeness_truth:{configured_market_source_legal_approvals:countryLegalApprovals,configured_market_source_language_approvals:languageLegalApprovals,exact_country_language_routes:`${exactCountryLanguageRoutes}/594`,all_supported_country_language_routes:`${exactCountryLanguageRoutes}/594`,binding_country_language_routes:`${sourceLegalApproval.summary.binding_country_language_routes}/34`,accessibility_translation_routes:`${sourceLegalApproval.summary.accessibility_translation_routes}/560`,source_legal_language_blockers:Number(sourceLegalLanguageBlockers),subnational_source_review:subnationalLegalApprovals,external_counsel_required_for_source_approval:false,full_production_legal_operational_completion:false,external_legal_evidence_total:Number(externalLegalItemsTotal),external_legal_evidence_verified:Number(externalLegalVerified),external_legal_evidence_pending:Number(externalLegalPendingCount),genuine_external_pending:Number(externalLegalGenuinePending),out_of_scope_unconfigured_evidence:Number(externalLegalOutOfScope),source_remediable_items_hidden_as_external:Number(externalLegalSourceRemediablePending),status:'PASS_CONFIGURED_27_SOURCE_LEGAL_LANGUAGE_PRODUCTION_EXTERNAL_PENDING'},
    release_blocker_inventory:{configured_scope_source_integrity_blocker_count:Number(releaseBlockerInventory.counts?.configured_scope_source_integrity_blockers??-1),source_legal_language_markets_pending:Number(releaseBlockerInventory.counts?.source_legal_language_markets_pending??-1),external_inventory_source_misclassification_count:Number(releaseBlockerInventory.counts?.external_inventory_source_misclassifications??-1),external_legal_operational_pending:Number(releaseBlockerInventory.counts?.external_legal_operational_pending??-1),store_console_distribution_unresolved:Number(releaseBlockerInventory.counts?.store_compliance_pending??-1),external_security_operations_unresolved:Number(releaseBlockerInventory.counts?.external_security_pending??-1),store_asset_paths_missing:Number(releaseBlockerInventory.counts?.production_store_asset_paths_missing??-1),reproducible_lockfile_missing:Number(releaseBlockerInventory.counts?.reproducible_lockfile_missing??-1),source_legal_language_decision:releaseBlockerInventory.source_legal_language_decision,production_release_posture:releaseBlockerInventory.production_release_decision,status:'PASS_CONFIGURED_27_SOURCE_TRUTH_PRODUCTION_FAIL_CLOSED'},
    eu_national_implementation:{configured_markets:Number(euNationalMarkets),official_source_screened_markets:Number(euNationalMarkets),configured_source_approval:'PASS_V20',legacy_production_runtime_mapping_separate:true,status:'PASS_SOURCE_SCREENING_RUNTIME_CONTEXT_SEPARATE'},
    legal_temporal:{structured_future_effective_states:Number(futureStates),high_volatility_watch_items:Number(temporalWatchItems),as_of:String(temporalAsOf),status:'PASS_CURRENT_AS_OF_DATE'},
    migration_release:{first:Number(migrationFirst),last:Number(migrationLast),contiguous:true,status:'PASS'},
    store_metadata_quality:{localized_sets:Number(storeMetadataValidated),expected_sets:Number(storeMetadataExpected),language_quality_locales:Number(storeLanguageLocales),localized_text_fields:Number(storeLanguageFields),status:'PASS'},
    legal:{passed:Number(legalPassed),total:Number(legalTotal),status:'PASS_STATIC_EXTERNAL_GATES_REMAIN'},
    legal_context_matrix:{passed:Number(legalContextPassed),total:Number(legalContextTotal),status:'PASS_FAIL_CLOSED_CONTEXT_MATRIX'},
    country_registry:{configured:Number(countryConfigured),total:Number(countryTotal),configured_market_scope:'EXPLICIT_LAUNCH_MARKETS_ONLY_NOT_WORLDWIDE_COUNTRY_COVERAGE',worldwide_iso_alpha2_entries:Number(worldwideCountryCoverage.summary?.iso_alpha2_entries??0),worldwide_configured_markets:Number(worldwideCountryCoverage.summary?.configured_markets??0),worldwide_unconfigured_blocked_markets:Number(worldwideCountryCoverage.summary?.unconfigured_blocked_markets??0),worldwide_country_coverage_complete:worldwideCountryCoverage.summary?.worldwide_country_specific_legal_screening_complete===true,worldwide_unconfigured_release_status:worldwideCountryCoverage.policy?.unconfigured_country_release_status??'BLOCK',release_controls:Number(countryReleaseControls),source_topics:Number(countrySourceTopics),dedicated_language_matrix:true,unknown_or_unlisted_iso:'BLOCK',approved_markets:countryApproved,status:'PASS_STATIC_RELEASE_BLOCKED_WITHOUT_EVIDENCE'},
    store_compliance:{
      status:'PASS_STATIC_EXTERNAL_CONSOLE_AND_PRODUCTION_EVIDENCE_REMAIN',
      apple_age_rating_result:storeCompliance.apple_age_rating?.questionnaire_result??null,
      google_iarc_result:storeCompliance.google_iarc?.questionnaire_result??null,
      google_play_package_registration_scope:storeCompliance.android_developer_verification?.play_package_registration_scope??null,
      google_play_package_registration_deadline:storeCompliance.android_developer_verification?.play_package_registration_deadline??null,
      google_play_package_registration_evidence_status:storeCompliance.android_developer_verification?.global_play_package_registration_evidence_status??null,
      android_regional_certified_device_enforcement_initial_markets:storeCompliance.android_developer_verification?.regional_certified_device_enforcement_initial_markets??[],
      android_regional_certified_device_enforcement_effective_date:storeCompliance.android_developer_verification?.regional_certified_device_enforcement_effective_date??null,
      android_regional_certified_device_enforcement_evidence_status:storeCompliance.android_developer_verification?.regional_certified_device_enforcement_evidence_status??null
    },
    observability:{static_controls:'PASS',crash_provider:String(crashProvider),analytics_provider:String(analyticsProvider),react_error_telemetry_source_present:reactErrorTelemetrySourcePresent,status:String(crashProvider)==='NOT_CONFIGURED'?(reactErrorTelemetrySourcePresent?'PARTIAL_REACT_BOUNDARY_ONLY':'BLOCKED_CRASH_PROVIDER'):'PARTIAL_PROVIDER_REVIEW_REQUIRED'},
    app_integrity:{source_implementation_present:appIntegritySourcePresent,policy_default:'enforce',production_platform_verification_status:(externalSecurity.items?.apple_app_attest_server_verification?.status==='verified'&&externalSecurity.items?.google_play_integrity_server_verification?.status==='verified')?'PASS':'BLOCK_EXTERNAL_EVIDENCE',status:appIntegritySourcePresent?'PASS_SOURCE_FAIL_CLOSED_EXTERNAL_EVIDENCE_REMAINS':'BLOCK_SOURCE_IMPLEMENTATION'},
    security_incident_response:{configured_markets:Number(incidentMarketsPassed),expected_markets:Number(incidentMarketsTotal),service_ledger_source_present:incidentOpsSourcePresent,tabletop_status:externalSecurity.items?.security_incident_response_tabletop_27_markets?.status==='verified'?'PASS':'BLOCK_EXTERNAL_TABLETOP',status:Number(incidentMarketsPassed)===Number(incidentMarketsTotal)&&incidentOpsSourcePresent?'PASS_SOURCE_LEGAL_COMPLETE_EXTERNAL_TABLETOP_REMAINS':'BLOCK_SOURCE_INCOMPLETE'}
  },
  structure:{migration_count:migrations.length,migrations,edge_functions:functions,country_registry_market_count:Object.keys(countryRegistry.markets??{}).length,official_source_review_market_count:Object.keys(officialSourceReview.markets??{}).length,worldwide_country_manifest_count:Object.keys(worldwideCountryCoverage.markets??{}).length,worldwide_unconfigured_blocked_markets:Number(worldwideCountryCoverage.summary?.unconfigured_blocked_markets??0),runtime_language_boundary_count:Number(languageCoverageBoundary.summary?.runtime_ui_locale_count??0),legal_document_language_boundary_count:Number(languageCoverageBoundary.summary?.legal_document_locale_count??0),country_default_policy:countryRegistry.default_policy?.unknown_or_unlisted_iso_country,external_legal_open_items:externalLegalOpen,external_security_open_items:externalSecurityOpen,package_lock_present:existsSync('package-lock.json'),ios_privacy_manifest_source_present:privacyManifestSourcePresent,crash_monitoring_dependency_present:crashMonitoringDependencyPresent,react_error_telemetry_source_present:reactErrorTelemetrySourcePresent,product_analytics_dependency_present:analyticsDependencyPresent,eas_remote_build_versioning:remoteBuildVersioning,worker_heartbeat_source_present:workerHeartbeatSourcePresent,ops_health_endpoint_present:opsHealthEndpointPresent,backend_locale_persistence_source_present:localePersistenceSourcePresent,account_pause_source_present:accountPauseSourcePresent,admin_suspension_gate_source_present:suspensionGateSourcePresent,exact_duplicate_photo_fingerprint_source_present:duplicatePhotoFingerprintSourcePresent,portrait_locked:portraitLocked,light_only_ui:lightOnly,automatic_appearance_configured:automaticAppearance,expo_system_ui_dependency_declared:systemUiDependency,expo_system_ui_plugin_configured:systemUiPlugin,dark_splash_configured:darkSplash,reactive_theme_source_present:reactiveThemeSource,dark_mode_source_implemented:darkModeSourceImplemented,supports_tablet:supportsTablet,legal_placeholder_files:legalPlaceholderFiles,store_metadata_locales:storeMetadataLocales,store_screenshot_count:storeScreenshotFiles.length,quiet_hours_source_present:quietHoursSourcePresent,measurement_preference_source_present:measurementPreferenceSourcePresent,offline_replay_source_present:offlineReplaySourcePresent},
  limitations:{
    reproducible_dependency_lock:existsSync('package-lock.json')?'PRESENT':'BLOCKED_PACKAGE_LOCK_ABSENT',
    runtime_locale_catalogs:String(readyLocales).split(',').filter(Boolean).length===19?'PASS':`BLOCKED_${String(readyLocales).split(',').filter(Boolean).length}_OF_19`,
    native_locale_metadata:Number(nativeLocaleCount)===19?'PASS':`BLOCKED_${nativeLocaleCount}_OF_19`,
    dependency_resolved_typecheck:readTypecheckEvidenceStatus(),
    native_ios_build:'DOĞRULANAMADI',
    native_android_build:'DOĞRULANAMADI',
    physical_device:'DOĞRULANAMADI',
    staging_migrations:'DOĞRULANAMADI',
    supabase_hosted_auth_effective_config:'DOĞRULANAMADI_HOSTED_AUTH_SETTINGS',
    supabase_auth_confirm_email:'DOĞRULANAMADI_HOSTED_AUTH_SETTINGS',
    supabase_auth_password_policy:'DOĞRULANAMADI_HOSTED_AUTH_SETTINGS',
    supabase_auth_abuse_protection:'DOĞRULANAMADI_HOSTED_AUTH_SETTINGS',
    supabase_auth_redirect_and_smtp:'DOĞRULANAMADI_HOSTED_AUTH_SETTINGS',
    supabase_auth_session_controls:'DOĞRULANAMADI_HOSTED_AUTH_SETTINGS',
    phone_verification_flow:phoneVerificationSourcePresent?'SOURCE_PRESENT_PROVIDER_AND_DEVICE_QA_DOĞRULANAMADI':'NOT_IMPLEMENTED_EMAIL_ONLY',
    backend_user_locale_persistence:localePersistenceSourcePresent?'SOURCE_IMPLEMENTED_DEPLOYMENT_DOĞRULANAMADI':'BLOCKED_SOURCE_NOT_IMPLEMENTED',
    ios_required_reason_api_audit:privacyManifestSourcePresent?'DOĞRULANAMADI_NATIVE_MERGE':'BLOCKED_SOURCE_MANIFEST_ABSENT',
    production_crash_monitoring:crashMonitoringDependencyPresent?'DOĞRULANAMADI_PROVIDER_CONFIG':reactErrorTelemetrySourcePresent?'SOURCE_REACT_BOUNDARY_TELEMETRY_NATIVE_CRASH_PROVIDER_NOT_CONFIGURED':'BLOCKED_NOT_CONFIGURED',
    product_analytics:analyticsDependencyPresent?'DOĞRULANAMADI_PRIVACY_AND_PROVIDER_CONFIG':'DELIBERATELY_DISABLED_PRIVACY_MINIMAL_NO_BEHAVIORAL_TRACKING_SDK',
    staged_store_rollout:'DOĞRULANAMADI_STORE_CONSOLES',
    production_alert_routing:opsHealthEndpointPresent&&workerHeartbeatSourcePresent?'SOURCE_SIGNALS_PRESENT_EXTERNAL_ALERT_CHANNEL_DOĞRULANAMADI':'BLOCKED_SOURCE_HEALTH_SIGNALS_ABSENT',
    worker_scheduler_configuration:workerHeartbeatSourcePresent?'DOĞRULANAMADI_DEPLOYED_SCHEDULER':'BLOCKED_HEARTBEAT_SOURCE_ABSENT',
    eas_remote_build_versioning:remoteBuildVersioning?'SOURCE_CONFIGURED_REMOTE_STATE_DOĞRULANAMADI':'BLOCKED_SOURCE_CONFIGURATION',
    native_build_numbers:'DOĞRULANAMADI_EAS_REMOTE_STATE',
    ota_update_rollback:'NOT_CONFIGURED_STORE_BINARY_ROLLBACK_ONLY',
    backup_restore_drill:'DOĞRULANAMADI',
    verified_age_enforcement:'SOURCE_POLICY_BOUND_SELF_ATTESTATION_OR_PRIVACY_MINIMIZED_VERIFIED_EXTERNAL',
    country_mating_policy_matrix:matingFailClosed?'SAFE_FAIL_CLOSED_OWNER_ARRANGED_ONLY_INTERNAL_LEGAL_SOURCE_APPROVED_WELFARE_KINSHIP_OPERATOR_GATES':'BLOCKED_NOT_IMPLEMENTED',
    true_kinship_inbreeding_prevention:'DELIBERATE_NO_FALSE_KINSHIP_CLAIM_PEDIGREE_SIGNAL_IS_NOT_VERIFIED_KINSHIP_PROOF',
    commercial_breeder_puppy_mill_graph_detection:'NOT_APPLICABLE_AS_MARKETPLACE_FEATURE_COMMERCIAL_BREEDER_AND_PET_SALE_CONTENT_PROHIBITED_MODERATION_REMAINS_ACTIVE',
    daily_swipe_abuse_limits:swipeAbuseLimitsSourcePresent?'SOURCE_IMPLEMENTED_200_LIKES_20_SUPERLIKES_400_PASSES_PER_DAY':'BLOCKED_SOURCE_LIMITS_INCOMPLETE',
    map_feature:placesSourcePresent&&existsSync('src/screens/PlacesScreen.tsx')&&readFileSync('src/screens/PlacesScreen.tsx','utf8').includes('react-native-maps')?'SOURCE_IMPLEMENTED_NATIVE_IN_APP_MAP_WITH_EXTERNAL_DIRECTIONS':'NOT_IMPLEMENTED',
    robust_offline_mode:offlineReplaySourcePresent?'SOURCE_IMPLEMENTED_SQLCIPHER_REPLAY_SAFE_SOCIAL_MUTATION_QUEUE_NATIVE_DEVICE_QA_REMAINS':'BLOCKED_OFFLINE_REPLAY_SOURCE_INCOMPLETE',
    large_account_export_delivery:streamingExportSourcePresent?'SOURCE_STREAMING_ONE_TIME_DOWNLOAD_IMPLEMENTED_LOAD_DEVICE_QA_DOĞRULANAMADI':'BLOCKED_ROBUST_ASYNC_FILE_DELIVERY_NOT_IMPLEMENTED',
    liveness_fake_photo_detection:duplicatePhotoFingerprintSourcePresent?'DELIBERATE_NO_FALSE_LIVENESS_CLAIM_CAMERA_CAPTURE_DUPLICATE_SIGNAL_AND_MANUAL_REVIEW_ONLY':'BLOCKED_DUPLICATE_SIGNAL_SOURCE_ABSENT',
    dark_mode:darkModeSourceImplemented?'SOURCE_IMPLEMENTED_NATIVE_QA_DOĞRULANAMADI':lightOnly?'BLOCKED_SOURCE_LIGHT_ONLY':'BLOCKED_SOURCE_INCOMPLETE',
    landscape_support:portraitLocked?'BLOCKED_SOURCE_PORTRAIT_LOCK':'DOĞRULANAMADI_NATIVE_QA',
    tablet_split_view_quality:supportsTablet?'DOĞRULANAMADI_PHYSICAL_DEVICE_QA':'NOT_DECLARED',
    voiceover_talkback_dynamic_type_rtl_device_qa:'DOĞRULANAMADI_PHYSICAL_DEVICE_QA',
    legal_policy_finalization:legalPlaceholderFiles.length?`BLOCKED_PLACEHOLDERS:${legalPlaceholderFiles.join(',')}`:'PASS_CONFIGURED_27_INTERNAL_OFFICIAL_SOURCE_AND_LANGUAGE_REVIEW',
    external_legal_evidence:externalLegalOpen.length===0?'PASS':`BLOCKED_${externalLegalOpen.length}_ITEMS_NOT_VERIFIED`,
    external_security_evidence:externalSecurityOpen.length===0?'PASS':`BLOCKED_${externalSecurityOpen.length}_ITEMS_NOT_VERIFIED`,
    country_legal_approval:countryApproved.length===Object.keys(countryRegistry.markets??{}).length?'PASS':`BLOCKED_${countryApproved.length}_OF_${Object.keys(countryRegistry.markets??{}).length}_COUNTRIES_APPROVED`,
    source_22_legal_document_locale_localization_internal_qa:externalLegal.items?.final_22_legal_document_locale_source_localization_internal_qa?.status==='verified'?'PASS':'BLOCKED_SOURCE_LOCALIZATION_EVIDENCE',
    source_legal_document_localization:externalLegal.items?.final_22_legal_document_locale_source_localization_internal_qa?.status==='verified'?'PASS':'BLOCKED_SOURCE_LEGAL_LOCALIZATION_EVIDENCE',
    professional_or_certified_legal_localization_external_evidence:'NOT_REQUIRED_FOR_CONFIGURED_SOURCE_APPROVAL_NO_CERTIFICATION_CLAIM',
    jurisdiction_specific_legal_language_adequacy:sourceLegalApproval.summary?.language_source_approved_markets===27&&countryLegalSupplements.summary?.routes===594&&countryLegalSupplements.summary?.binding_routes===34?'PASS_CONFIGURED_27_SOURCE':'BLOCKED_CONFIGURED_SOURCE_LANGUAGE_GAP',
    real_web_delete_account_flow:externalLegal.items?.real_web_delete_account_flow?.status==='verified'?'PASS':'BLOCKED_EXTERNAL_EVIDENCE',
    real_support_business_identity_details:externalLegal.items?.real_support_business_identity_details?.status==='verified'?'PASS':'BLOCKED_EXTERNAL_EVIDENCE',
    consumer_operator_address_tax_details_by_market:externalLegal.items?.consumer_operator_address_tax_details_by_market?.status==='verified'?'PASS':'BLOCKED_EXTERNAL_EVIDENCE',
    apple_age_rating_console_questionnaire:externalLegal.items?.apple_age_rating_console_questionnaire?.status==='verified'?'PASS':'BLOCKED_EXTERNAL_EVIDENCE',
    google_iarc_console_questionnaire:externalLegal.items?.google_iarc_console_questionnaire?.status==='verified'?'PASS':'BLOCKED_EXTERNAL_EVIDENCE',
    apple_app_privacy_console_declaration:externalLegal.items?.apple_app_privacy_console_declaration?.status==='verified'?'PASS':'BLOCKED_EXTERNAL_EVIDENCE',
    google_data_safety_console_declaration:externalLegal.items?.google_data_safety_console_declaration?.status==='verified'?'PASS':'BLOCKED_EXTERNAL_EVIDENCE',
    international_transfer_evidence:externalLegal.items?.international_transfer_mechanisms_and_required_local_notifications?.status==='verified'?'PASS':'BLOCKED_EXTERNAL_EVIDENCE',
    live_moderation_human_review_sla:externalLegal.items?.live_moderation_provider_and_human_review_sla?.status==='verified'?'PASS':'BLOCKED_EXTERNAL_EVIDENCE',
    production_support_contact:legalPlaceholderFiles.includes('web/support.html')?'BLOCKED_PLACEHOLDER':'DOĞRULANAMADI_DEPLOYED_CONTACT',
    store_metadata_localization:storeMetadataLocales.length===19?'DOĞRULANAMADI_STORE_CONSOLE_IMPORT':`BLOCKED_${storeMetadataLocales.length}_OF_19`,
    store_screenshots:storeScreenshotFiles.length?'DOĞRULANAMADI_DEVICE_AND_STORE_VALIDATION':'BLOCKED_NOT_PRODUCED',
    notification_quiet_hours:quietHoursSourcePresent?'SOURCE_PRESENT_DEPLOYMENT_DOĞRULANAMADI':'NOT_IMPLEMENTED',
    localized_measurement_preferences:measurementPreferenceSourcePresent?'SOURCE_PRESENT_DEVICE_QA_DOĞRULANAMADI':'NOT_IMPLEMENTED_KM_KG_ONLY',
    account_pause:accountPauseSourcePresent?'SOURCE_IMPLEMENTED_DEPLOYMENT_DOĞRULANAMADI':'NOT_IMPLEMENTED',
    administrative_suspension_gate:suspensionGateSourcePresent?'SOURCE_IMPLEMENTED_DEPLOYMENT_DOĞRULANAMADI':'NOT_IMPLEMENTED',
    revenuecat_dashboard_and_store_sandbox:'DOĞRULANAMADI_EXTERNAL_BILLING_CONFIGURATION',
    moderation_provider_multilingual_quality_and_sla:'DOĞRULANAMADI_PROVIDER_STAGING_AND_OPERATIONS',
    mobile_app_integrity:appIntegritySourcePresent?'SOURCE_IMPLEMENTED_APP_ATTEST_PLAY_INTEGRITY_PRODUCTION_EVIDENCE_BLOCKED':'BLOCKED_SOURCE_IMPLEMENTATION',
    security_incident_response:incidentOpsSourcePresent&&Number(incidentMarketsPassed)===Number(incidentMarketsTotal)?'SOURCE_IMPLEMENTED_27_OF_27_EXTERNAL_TABLETOP_REMAINS':'BLOCKED_SOURCE_IMPLEMENTATION'
  }
};
const manifest={
  product:'Tailmance',
  attribution:evidence.attribution,
  version:String(packageJson.version),
  release_candidate_date:reportDate,
  platforms:['iOS','Android'],
  automated_verification:{
    domain_rules:`${domainPassed}/${domainTotal} PASS`,
    security_regressions:`${securityPassed}/${securityTotal} PASS`,
    pending_hardening:`${pendingPassed}/${pendingTotal} PASS`,
    accessibility:`${pressables} Pressables + ${textInputs} TextInputs + ${switches} Switches + ${modals} Modals PASS`,
    backend_contracts:`${rpcs} RPCs (${pendingOnlyRpcs??0} pending-patch only) + ${edgeInvocations} client Edge Functions + ${functionDirs} Edge Function directories PASS`,
    ux_static_gate:`${tsx} TSX files + contrast/assets/journeys PASS`,
    legal_static:`${legalPassed}/${legalTotal} PASS; production store/provider/native evidence remains separate`,
    legal_context_matrix:`${legalContextPassed}/${legalContextTotal} fail-closed context cases PASS`,
    country_registry:`${countryConfigured}/${countryTotal} configured launch markets; worldwide manifest ${worldwideCountryCoverage.summary?.iso_alpha2_entries??0} ISO entries = ${worldwideCountryCoverage.summary?.configured_markets??0} configured + ${worldwideCountryCoverage.summary?.unconfigured_blocked_markets??0} explicitly BLOCK; ${countryReleaseControls} release controls + ${countrySourceTopics} source topics; source-approved=${countryApproved.length}`,
    language_coverage:`${languageCoverageBoundary.summary?.runtime_ui_locale_count??0} runtime + ${languageCoverageBoundary.summary?.legal_document_locale_count??0} legal-document locales source-complete for configured scope; worldwide language coverage=false`,  
    store_compliance:`PASS_STATIC; Apple age result=${String(storeCompliance.apple_age_rating?.questionnaire_result??'UNVERIFIED')}; Google IARC=${String(storeCompliance.google_iarc?.questionnaire_result??'UNVERIFIED')}`,
    observability_static:`PASS; crash provider=${crashProvider}; analytics provider=${analyticsProvider}; worker heartbeat=${workerHeartbeatSourcePresent?'present':'missing'}; ops-health=${opsHealthEndpointPresent?'present':'missing'}`,
    release_versioning:`EAS appVersionSource=${easJson?.cli?.appVersionSource??'unset'}; production autoIncrement=${String(easJson?.build?.production?.autoIncrement===true)}`,
    project_lint:`${lintFiles} text files PASS`,
    i18n:`${readyLocales} ready; native metadata ${nativeLocaleCount}/19; status ${evidence.automated.i18n.status}`
  },
  technical_identifiers:{canonical_scheme:'tailmance',legacy_callback_scheme:'pawlink',bundle_identifier:'com.pawlink.app',android_package:'com.pawlink.app',note:'Tailmance is the canonical user-facing scheme. Legacy pawlink:// remains callback-migration-only; bundle/package identifiers are preserved until store/provisioning ownership is migrated.'},
  release_blockers:evidence.limitations,
  dependency_baseline:{expo:dependencies.expo,react_native:dependencies['react-native'],react_native_gesture_handler:dependencies['react-native-gesture-handler'],expo_notifications:dependencies['expo-notifications'],expo_ui:dependencies['@expo/ui'],node:packageJson.engines?.node},
  auth_hardening:'Mobile auth callbacks use PKCE code exchange and canonical allowlisted tailmance:// callback routes; legacy pawlink:// is accepted only for callback migration; raw access/refresh-token deep-link session injection is removed.'
};

const verificationReport=`# Tailmance Verification Report

Date: ${reportDate}
Release candidate: ${String(packageJson.version)}
Owner / Creator / Concept / Product Design / Development / Implementation / Overall Project: Yekta Ozel

## Current automated source verification

The machine-readable source of truth is \`RELEASE_EVIDENCE.json\`, generated by \`npm run evidence:generate\`.

- Domain rules: ${domainPassed}/${domainTotal} PASS
- Security regressions: ${securityPassed}/${securityTotal} PASS
- Security/privacy incident obligations: ${incidentMarketsPassed}/${incidentMarketsTotal} configured markets structurally covered; live incident operations/tabletop evidence remains fail-closed
- Pending canonical hardening checks: ${pendingPassed}/${pendingTotal} PASS
- Accessibility static checks: ${pressables} Pressables + ${textInputs} TextInputs + ${switches} Switches + ${modals} Modals PASS
- Frontend/backend contracts: ${rpcs} RPCs (${pendingOnlyRpcs??0} pending-patch only), ${edgeInvocations} client-invoked Edge Functions, ${functionDirs} Edge Function directories PASS
- UX static gate: ${tsx} TSX files PASS
- Legal static controls: ${legalPassed}/${legalTotal} PASS; external legal/store/native gates remain
- Legal context matrix: ${legalContextPassed}/${legalContextTotal} fail-closed cases PASS
- Country registry: ${countryConfigured}/${countryTotal} configured launch markets; worldwide manifest explicitly accounts for ${worldwideCountryCoverage.summary?.iso_alpha2_entries??0} ISO alpha-2 entries = ${worldwideCountryCoverage.summary?.configured_markets??0} configured + ${worldwideCountryCoverage.summary?.unconfigured_blocked_markets??0} unconfigured BLOCK; ${countryReleaseControls} release controls + ${countrySourceTopics} source topics; source legal/language approved markets=${countryApproved.length}
- Language coverage boundary: ${languageCoverageBoundary.summary?.runtime_ui_locale_count??0} runtime UI locales + ${languageCoverageBoundary.summary?.legal_document_locale_count??0} legal-document locales are source-complete for configured scope; this is explicitly not all-world-language coverage
- Store compliance source mapping: PASS; App Store age-rating/social-media answers, Google/IARC, Google Play 18+ target-audience/Restrict Minor Access, Google Data Safety deletion URL/questions and Apple subscription multiseat configuration remain real-console evidence, not source-inferred outputs
- Observability source controls: PASS; production crash provider=${crashProvider}; product analytics provider=${analyticsProvider}
- Project lint: ${lintFiles} text files PASS
- Runtime i18n: ${readyLocales} ready; native locale metadata ${nativeLocaleCount}/19; ${criticalKeyCount} fixed critical keys; normalized-English-copy guard PASS; status ${evidence.automated.i18n.status}
- Legal-document source localization: ${legalDocLocales} locales × ${legalDocFamilies} required families; ${legalWebDocuments} generated localized documents PASS.
- Canonical legal source/runtime evidence: ${sourceTopicCells} source topic cells, ${controlEvidenceCells} runtime control-evidence cells, ${criticalSubdimensionsPassed}/${criticalSubdimensionsTotal} critical subdimensions; empty source cells=${sourceEmptyCells}; canonical topic cells missing attributable source evidence=${sourcePresenceGaps}; this does not measure unresolved scope/applicability.
- Operator/tax/registration source subdimensions: ${operatorTaxCells}/${operatorTaxCellsTotal} internal official-source reviews PASS; source blockers=${operatorTaxBlockers}; live account/registration facts remain separate.
- Configured-27 legal/language source truth: legal approvals=${countryLegalApprovals}; language approvals=${languageLegalApprovals}; binding country×language routes=${sourceLegalApproval.summary.binding_country_language_routes}/34; all supported country×language routes=${exactCountryLanguageRoutes}/594; source blockers=${sourceLegalLanguageBlockers}; external operational legal evidence pending=${externalLegalPendingCount}. Production operational release remains fail-closed independently.
- Temporal legal/platform QA: ${futureStates} structured future-effective states + ${temporalWatchItems} high-volatility watch items PASS as of ${temporalAsOf}.
- Migration release continuity: ${migrationFirst}-${migrationLast} contiguous PASS. Store metadata QA: ${storeMetadataValidated}/${storeMetadataExpected} locale sets / ${storeLanguageFields} localized fields PASS.
- Evidence freshness is enforced by \`npm run evidence:check\`.

## Release gates that are intentionally NOT green

- **Reproducible dependency build:** ${evidence.limitations.reproducible_dependency_lock}.
- **Runtime locale catalogs:** ${evidence.limitations.runtime_locale_catalogs}; native locale metadata: ${evidence.limitations.native_locale_metadata}; store metadata: ${evidence.limitations.store_metadata_localization}.
- **Dependency-resolved/native validation:** typecheck=${evidence.limitations.dependency_resolved_typecheck}; iOS=${evidence.limitations.native_ios_build}; Android=${evidence.limitations.native_android_build}; physical device=${evidence.limitations.physical_device}.
- **Staging database behavior:** ${evidence.limitations.staging_migrations}; canonical migrations 001–${String(migrations.length).padStart(3,'0')} must be applied and integration-tested on staging before release.
- **Production Supabase Auth effective settings:** ${evidence.limitations.supabase_hosted_auth_effective_config}; Confirm Email=${evidence.limitations.supabase_auth_confirm_email}; password policy=${evidence.limitations.supabase_auth_password_policy}; abuse protection=${evidence.limitations.supabase_auth_abuse_protection}; redirects/SMTP=${evidence.limitations.supabase_auth_redirect_and_smtp}; sessions=${evidence.limitations.supabase_auth_session_controls}.
- **Phone/SMS verification:** ${evidence.limitations.phone_verification_flow}.
- **Production crash monitoring:** ${evidence.limitations.production_crash_monitoring}; product analytics=${evidence.limitations.product_analytics}.
- **Mobile app integrity:** ${evidence.limitations.mobile_app_integrity}; incident response=${evidence.limitations.security_incident_response}.
- **Privacy/legal:** required-reason API audit=${evidence.limitations.ios_required_reason_api_audit}; legal finalization=${evidence.limitations.legal_policy_finalization}; external legal evidence=${evidence.limitations.external_legal_evidence}; external security evidence=${evidence.limitations.external_security_evidence}; configured-27 source legal/language approvals=${evidence.limitations.country_legal_approval}; 22-locale source legal-document localization/internal QA=${evidence.limitations.source_22_legal_document_locale_localization_internal_qa}; jurisdiction-specific legal-language adequacy=${evidence.limitations.jurisdiction_specific_legal_language_adequacy}; web deletion=${evidence.limitations.real_web_delete_account_flow}; support/business identity=${evidence.limitations.real_support_business_identity_details}; international transfers=${evidence.limitations.international_transfer_evidence}.
- **Store console:** Apple age questionnaire=${evidence.limitations.apple_age_rating_console_questionnaire}; Apple social-media capability answer=${storeCompliance.apple_age_rating.social_media_capability_console_answer_status}; Google/IARC=${evidence.limitations.google_iarc_console_questionnaire}; Google Play target audience=${storeCompliance.google_target_audience_and_minor_access.target_audience_console_status}; Restrict Minor Access=${storeCompliance.google_target_audience_and_minor_access.restrict_minor_access_configuration_status}; Apple App Privacy=${evidence.limitations.apple_app_privacy_console_declaration}; Google Data Safety=${evidence.limitations.google_data_safety_console_declaration}; Google deletion URL=${storeCompliance.google_account_deletion.data_safety_deletion_url_console_status}; Google deletion questions=${storeCompliance.google_account_deletion.data_safety_deletion_questions_console_status}; Apple subscription multiseat=${storeCompliance.subscription.apple_multiseat_purchase_option.console_configuration_status}.
- **UI/device:** dark mode=${evidence.limitations.dark_mode}; landscape=${evidence.limitations.landscape_support}; tablet/split-view=${evidence.limitations.tablet_split_view_quality}; accessibility/RTL device QA=${evidence.limitations.voiceover_talkback_dynamic_type_rtl_device_qa}.
- **Product completeness:** map=${evidence.limitations.map_feature}; offline=${evidence.limitations.robust_offline_mode}; large-account export=${evidence.limitations.large_account_export_delivery}; verified age=${evidence.limitations.verified_age_enforcement}; liveness/fake-photo=${evidence.limitations.liveness_fake_photo_detection}; mating policy=${evidence.limitations.country_mating_policy_matrix}; kinship=${evidence.limitations.true_kinship_inbreeding_prevention}; breeder graph=${evidence.limitations.commercial_breeder_puppy_mill_graph_detection}; swipe abuse limits=${evidence.limitations.daily_swipe_abuse_limits}.
- **Retention/store:** quiet hours=${evidence.limitations.notification_quiet_hours}; localized measurement preferences=${evidence.limitations.localized_measurement_preferences}; screenshots=${evidence.limitations.store_screenshots}.
- **Operations:** alert routing=${evidence.limitations.production_alert_routing}; scheduler=${evidence.limitations.worker_scheduler_configuration}; backup/restore=${evidence.limitations.backup_restore_drill}; staged rollout=${evidence.limitations.staged_store_rollout}; RevenueCat/store sandbox=${evidence.limitations.revenuecat_dashboard_and_store_sandbox}; moderation multilingual/SLA=${evidence.limitations.moderation_provider_multilingual_quality_and_sla}.

## Security and trust controls pinned by source regression checks

The source-side suites cover default-deny/RLS assumptions, active-match-only chat, message quota enforcement, blocking/unmatch/report flows, rate limiting, private health data, platform-specific location declaration controls, private Storage, upload intents, moderation/admin authorization, verification isolation, pagination, RevenueCat reconciliation, account deletion, notification preferences, account pause/admin suspension separation, legacy pause compatibility and explicit \`SECURITY DEFINER\` privilege decisions.

Exact byte-duplicate pet-photo fingerprints route reused files to manual review. This is intentionally **not** represented as liveness, deepfake detection or duplicate-animal identity proof.

## Native/typecheck limitation

Offline/static checks do not replace dependency-resolved TypeScript, Metro, native compiler, EAS, staging integration or physical-device release gates. Any item marked DOĞRULANAMADI remains open until executed in the required environment.

## Required external release sequence

Before store submission, the operating entity must validate real Apple Developer/App Store Connect, Google Play Console, EAS, production Supabase, RevenueCat, moderation-provider, legal and support configurations. Required gates include staging migration apply, native builds, physical-device camera/location/push/accessibility/RTL testing, store sandbox purchase lifecycle, account deletion/export, moderation operations, push receipt processing, backup/restore drill, alert-routing drill and an independent penetration/security review.

See \`docs/STORE_RELEASE_CHECKLIST.md\`, \`docs/TEST_PLAN.md\`, \`docs/OPERATIONS_RUNBOOK.md\` and \`RELEASE_EVIDENCE.json\`.
`;

const serialized=JSON.stringify(evidence,null,2)+'\n';
const manifestSerialized=JSON.stringify(manifest,null,2)+'\n';
if(process.argv.includes('--check')){
  if(!existsSync('RELEASE_EVIDENCE.json'))throw new Error('RELEASE_EVIDENCE.json is missing; run npm run evidence:generate');
  if(!existsSync('RELEASE_MANIFEST.json'))throw new Error('RELEASE_MANIFEST.json is missing; run npm run evidence:generate');
  if(!existsSync('docs/VERIFICATION_REPORT.md'))throw new Error('docs/VERIFICATION_REPORT.md is missing; run npm run evidence:generate');
  const current=JSON.parse(readFileSync('RELEASE_EVIDENCE.json','utf8'));
  const currentManifest=JSON.parse(readFileSync('RELEASE_MANIFEST.json','utf8'));
  const currentVerificationReport=readFileSync('docs/VERIFICATION_REPORT.md','utf8');
  const normalize=x=>{const c=structuredClone(x);delete c.generated_at;return c};
  if(JSON.stringify(normalize(current))!==JSON.stringify(normalize(evidence)))throw new Error('RELEASE_EVIDENCE.json is stale; run npm run evidence:generate');
  if(JSON.stringify(currentManifest)!==JSON.stringify(manifest))throw new Error('RELEASE_MANIFEST.json is stale; run npm run evidence:generate');
  if(currentVerificationReport!==verificationReport)throw new Error('docs/VERIFICATION_REPORT.md is stale; run npm run evidence:generate');
  console.log('release-evidence-check: evidence + manifest + verification report current; passed');
}else{
  writeFileSync('RELEASE_EVIDENCE.json',serialized);
  writeFileSync('RELEASE_MANIFEST.json',manifestSerialized);
  writeFileSync('docs/VERIFICATION_REPORT.md',verificationReport);
  console.log('release-evidence: evidence + Tailmance manifest + verification report generated from current automated checks');
}
