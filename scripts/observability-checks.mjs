import assert from 'node:assert/strict';
import { globSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const pkg=JSON.parse(readFileSync('package.json','utf8'));
const deps={...(pkg.dependencies??{}),...(pkg.devDependencies??{})};
const crashProvider=Object.keys(deps).find(name=>/sentry|crashlytics|bugsnag|appcenter/i.test(name))??null;
const analyticsProvider=Object.keys(deps).find(name=>/analytics|amplitude|mixpanel|posthog|segment|firebase-analytics/i.test(name))??null;
const boundary=readFileSync('src/components/AppErrorBoundary.tsx','utf8');
const errorTelemetry=readFileSync('src/services/errorTelemetry.ts','utf8');
const hardeningSql=globSync('supabase/migrations/{011,012,013,014,015,016,017,018,019,020,021,022,023,024}_*.sql').sort().map(p=>readFileSync(p,'utf8')).join('\n');
const performanceSql=readFileSync('supabase/migrations/183_privacy_minimal_client_frame_performance_telemetry.sql','utf8');
const performanceTelemetry=readFileSync('src/services/performanceTelemetry.ts','utf8');
const performanceSqlExecutable=performanceSql.replace(/--[^\n]*/g,'');
const navigator=readFileSync('src/navigation/AppNavigator.tsx','utf8');
const runbook=readFileSync('docs/OPERATIONS_RUNBOOK.md','utf8');
const heartbeatHelper=readFileSync('supabase/functions/_shared/workerHeartbeat.ts','utf8');
const opsHealth=readFileSync('supabase/functions/ops-health/index.ts','utf8');
const heartbeatParity=readFileSync('supabase/migrations/189_worker_heartbeat_allowlist_and_ops_snapshot_parity.sql','utf8');

const releaseGate=readFileSync('scripts/observability-release-check.mjs','utf8');

const crashReporting=readFileSync('src/services/crashReporting.ts','utf8');
const metro=readFileSync('metro.config.cjs','utf8');
assert.equal(pkg.dependencies?.['@sentry/react-native'],'8.28.0','Pinned Sentry React Native SDK is required for native crash/ANR reporting');
assert.match(crashReporting,/sendDefaultPii:\s*false/,'Sentry must not opt into default PII');
assert.match(crashReporting,/attachScreenshot:\s*false/,'Sentry screenshots must remain disabled');
assert.match(crashReporting,/attachViewHierarchy:\s*false/,'Sentry view hierarchy attachments must remain disabled');
assert.match(crashReporting,/enableNetworkBreadcrumbs:\s*false/,'Native iOS network breadcrumbs must remain disabled for privacy-minimal telemetry');
assert.match(crashReporting,/enableNetworkEventBreadcrumbs:\s*false/,'Native Android network breadcrumbs must remain disabled for privacy-minimal telemetry');
assert.match(crashReporting,/beforeBreadcrumb:\s*scrubBreadcrumb/,'Breadcrumbs must be scrubbed before telemetry');
assert.match(crashReporting,/tracesSampleRate:\s*configured\?0\.05:0/,'Sentry tracing must be low-sampled and production-config gated');
assert.match(crashReporting,/enableNativeFramesTracking:\s*configured/,'Sentry native slow/frozen frame tracking must be enabled only for configured production telemetry');
assert.match(crashReporting,/beforeSendTransaction:\s*scrubTransactionEvent/,'Performance transactions require the privacy scrubber');
assert.match(crashReporting,/delete span\.data/,'Performance spans must drop arbitrary span data');
assert.match(crashReporting,/reactNavigationIntegration/,'Sentry navigation performance integration is required');
assert.match(navigator,/registerCrashNavigationContainer\(navigationRef\)/,'Navigation container must register with Sentry after readiness');
assert.match(crashReporting,/delete event\.user/,'Sentry event scrubber must remove user identity');
assert.match(metro,/getSentryExpoConfig/,'Sentry-aware Metro source-map configuration is required');
assert.match(releaseGate,/Native crash\/ANR monitoring provider dependency is not configured/,'Release must fail closed without native crash/ANR monitoring');
assert.match(releaseGate,/Product analytics is deliberately not a mandatory dependency/,'Product analytics must remain optional in privacy-minimal mode');
const releaseStructure=readFileSync('package.json','utf8');
assert.match(releaseStructure,/release:observability/,'Release scripts must expose an observability gate');
const scheduledWorkers=['push-dispatch','push-receipts','storage-gc','external-deletion-worker','vaccination-reminders','moderate-media','health-ai-worker','livekit-room-reaper'];
for(const worker of scheduledWorkers){
  assert.ok(heartbeatParity.includes(`'${worker}'`),`heartbeat storage CHECK must allow ${worker}`);
}
assert.match(heartbeatParity,/worker_heartbeats_worker_check/,'worker heartbeat allowlist constraint must be source-controlled');
assert.match(heartbeatParity,/healthAiManualReviewOverdue/,'ops snapshot must expose health-AI review SLA breaches');
assert.match(heartbeatParity,/livekitTeardownStuckProcessing/,'ops snapshot must expose stuck LiveKit teardown work');
assert.match(boundary,/if \(__DEV__\) console\.error\(['"]Tailmance UI boundary caught an error['"], error\)/,'Client error boundary must not emit production error payloads to console');
assert.match(boundary,/reportReactBoundaryError\(error\)/,'React ErrorBoundary must feed privacy-minimized first-party telemetry');
assert.match(errorTelemetry,/supabase\.rpc\('record_client_error'/,'React telemetry must use the bounded backend RPC');
assert.doesNotMatch(errorTelemetry,/p_(?:message|stack)|message:\s*error|stack:\s*error/i,'React telemetry must never transmit raw error message or stack fields');
assert.match(errorTelemetry,/fingerprint\(error\)/,'React telemetry must fingerprint locally before transmission');
assert.match(hardeningSql,/client_error_events[\s\S]*revoke all on table public\.client_error_events from public,anon,authenticated/,'Telemetry table must be private');
assert.match(hardeningSql,/rate_limit\('client_error_telemetry',20,3600\)/,'Telemetry RPC must be rate limited');
assert.match(performanceSql,/client_performance_events[\s\S]*revoke all on table public\.client_performance_events from public,anon,authenticated/,'Performance telemetry storage must be private');
assert.match(performanceSql,/record_client_performance[\s\S]*require_active_authenticated_session\(\)/,'Performance telemetry must enforce active authenticated sessions');
assert.match(performanceSql,/rate_limit\('client_performance_telemetry',12,3600\)/,'Performance telemetry must be rate limited');
assert.doesNotMatch(performanceSqlExecutable,/user_id|pet_id|latitude|longitude|message_body|storage_path/i,'Performance event schema must not persist identity/content/location fields');
assert.match(performanceTelemetry,/SAMPLE_WINDOW_MS=8_000/,'Client frame sampling must use a bounded window');
assert.match(performanceTelemetry,/MIN_SAMPLE_INTERVAL_MS=15\*60_000/,'Client frame sampling must be power/network bounded');
assert.match(performanceTelemetry,/FROZEN_FRAME_MS=700/,'Client sampler must classify long JS-frame stalls');
assert.match(performanceTelemetry,/supabase\.rpc\('record_client_performance'/,'Client sampler must submit only through bounded first-party RPC');
assert.doesNotMatch(performanceTelemetry,/user\.id|petId|message|latitude|longitude|storagePath/i,'Client performance payload must not include identity/content/location data');


assert.match(runbook,/Production client\/server logs must not contain message bodies/);
for(const term of ['billing','moderation','deletion','push','backup/restore'])assert.ok(runbook.includes(term),`Operations alert policy must include ${term}`);
assert.match(runbook,/App Store phased release \/ Google Play staged rollout/);
assert.match(runbook,/Apple does not provide a direct App Store revert/);
assert.match(runbook,/Google Play can halt staged rollouts/);
assert.match(runbook,/does not currently source-control an EAS Update \/ OTA rollback runtime/);
assert.match(runbook,/OPS_HEALTH_SECRET/);
assert.match(heartbeatHelper,/worker_heartbeats/);
assert.doesNotMatch(heartbeatHelper,/email|body|message|latitude|longitude|token|storage_path/i,'Worker heartbeat must remain metadata-only');
assert.match(opsHealth,/OPS_HEALTH_SECRET/);
assert.match(opsHealth,/get_ops_health_snapshot/);
for(const worker of scheduledWorkers){
  const source=readFileSync(`supabase/functions/${worker}/index.ts`,'utf8');
  assert.match(source,/markWorkerHeartbeat/);
  assert.ok(source.includes(`markWorkerHeartbeat(${worker==='storage-gc'?'s':'supabase'},'${worker}','started')`)||source.includes(`markWorkerHeartbeat(supabase,'${worker}','started')`),`${worker} must record a start heartbeat`);
  assert.ok(source.includes(`'${worker}','completed'`),`${worker} must record a completion heartbeat`);
}

const roots=['src','supabase/functions'];
const files=[];
for(const root of roots){
  const walk=d=>{for(const n of readdirSync(d)){const p=join(d,n);const st=statSync(p);if(st.isDirectory())walk(p);else if(/\.(ts|tsx)$/.test(p))files.push(p)}};
  walk(root);
}
const consoleUses=[];
for(const f of files){const text=readFileSync(f,'utf8');for(const m of text.matchAll(/console\.(?:log|info|warn|error|debug)\(([^\n]*)\)/g))consoleUses.push({file:f,arg:m[1]});}
for(const use of consoleUses){
  if(use.file==='src/components/AppErrorBoundary.tsx')continue;
  assert.match(use.arg,/^['"][A-Za-z0-9_ -]+['"]$/i,`Production server console output must be a constant non-PII code: ${use.file}`);
}
console.log(`observability-checks: static privacy/logging/rollout + ${scheduledWorkers.length} worker heartbeat controls passed; crash_provider=${crashProvider??'NOT_CONFIGURED'}; analytics_provider=${analyticsProvider??'NOT_CONFIGURED'}`);
