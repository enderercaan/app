import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');
const enumMigration=read('supabase/migrations/170_matched_pet_livekit_call_sessions.sql');
const migration=read('supabase/migrations/171_matched_pet_livekit_call_sessions.sql');
const accessGateMigration=read('supabase/migrations/176_pet_call_current_access_gate_parity.sql');
const teardownMigration=read('supabase/migrations/177_livekit_room_teardown_outbox.sql');
const teardownDeletionMigration=read('supabase/migrations/178_livekit_teardown_survives_account_deletion.sql');
const roomReaper=read('supabase/functions/livekit-room-reaper/index.ts');
const edge=read('supabase/functions/livekit-call-token/index.ts');
const screen=read('src/screens/CallScreen.native.tsx');
const web=read('src/screens/CallScreen.web.tsx');
const chat=read('src/screens/ChatScreen.tsx');
const nav=read('src/navigation/AppNavigator.tsx');
const api=read('src/services/api.ts');
const app=read('app.config.ts');
const push=read('supabase/functions/push-dispatch/index.ts');
const pkg=JSON.parse(read('package.json'));

assert.match(enumMigration,/alter type public\.notification_type add value if not exists 'call'/,'call notification enum must be committed before call-session use');
assert.match(migration,/create table if not exists public\.pet_call_sessions/);
assert.match(migration,/alter table public\.pet_call_sessions enable row level security/);
assert.match(migration,/revoke all on public\.pet_call_sessions from anon,authenticated/,'call rows must not be client-table-readable');
assert.match(migration,/create_pet_call_idempotent[\s\S]*require_active_authenticated_session\(\)[\s\S]*owns_pet\(p_caller_pet_id\)[\s\S]*unmatched_at is null[\s\S]*is_blocked/,'call creation must be active-session, owned-pet, active-match and block-state bound');
for(const fn of ['create_pet_call_idempotent','respond_pet_call','end_pet_call','get_incoming_pet_call','get_pet_call_token_context','get_pet_call_state']){
  const re=new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\([\\s\\S]*?require_active_authenticated_session\\(\\)[\\s\\S]*?current_user_has_product_access\\(\\)`,'i');
  assert.match(accessGateMigration,re,`${fn} must enforce revoked-session and current legal/product access before reaching the v171 core`);
}
for(const core of ['create_pet_call_idempotent_core_v171','respond_pet_call_core_v171','end_pet_call_core_v171','get_incoming_pet_call_core_v171','get_pet_call_token_context_core_v171','get_pet_call_state_core_v171']){
  assert.match(accessGateMigration,new RegExp(`revoke all on function public\\.${core.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}[\\s\\S]*?from public,anon,authenticated`,'i'),`${core} must not remain directly callable by app roles`);
}

assert.match(migration,/client_mutation_receipts[\s\S]*action='create_pet_call'[\s\S]*client_operation_id_reused/,'call creation must be response-loss idempotent');
assert.match(migration,/call_already_active/,'a match must not create overlapping active calls');
assert.match(migration,/rate_limit\('pet_call_start',12,3600\)/,'call starts need abuse throttling');
assert.match(migration,/respond_pet_call[\s\S]*callee_pet_id<>p_pet_id[\s\S]*call_unavailable/,'only the callee may accept/decline a ringing call');
assert.match(migration,/get_pet_call_token_context[\s\S]*p_pet_id=v_call\.callee_pet_id and v_call\.status<>'active'/,'callee token must not mint before acceptance');
assert.match(migration,/hard_expires_at[\s\S]*interval '2 hours'/,'call sessions need a hard server expiry');

assert.match(edge,/authenticatedUser\(req\)/);
assert.match(edge,/requireDeviceIntegrityIfEnforced\(supabase,user\.id,'pet_call'\)/);
assert.match(edge,/service_rate_limit_user[\s\S]*livekit_call_token/);
assert.match(edge,/get_pet_call_token_context/,'Edge token minting must re-read the server-authoritative call context');
assert.match(edge,/new AccessToken\(apiKey,apiSecret/,'LiveKit secret must stay server-side');
assert.match(edge,/ttl:'5m'/,'participant JWTs must be short lived');
assert.match(edge,/roomJoin:true,room:roomName,canPublish:true,canSubscribe:true,canPublishData:false/,'participant grants must be single-room scoped with arbitrary data publishing disabled');
assert.match(edge,/\['wss:','https:'\]/,'LiveKit endpoint must reject cleartext schemes');

assert.equal(pkg.dependencies?.['@livekit/react-native'],'3.0.0');
assert.equal(pkg.dependencies?.['@livekit/react-native-webrtc'],'144.2.0');
assert.match(app,/permissions:\s*\[[^\]]*CAMERA[^\]]*RECORD_AUDIO/s);
assert.match(app,/NSMicrophoneUsageDescription:[\s\S]*matched-pet audio or video call/);
assert.match(chat,/confirmPrePermission\('calls'\)/,'Tailmance explanation must precede system media prompts');
assert.match(chat,/getOrCreateDurableClientOperation\('pet-call'/,'call creation must keep durable operation identity');
assert.match(screen,/LiveKitRoom[\s\S]*audio=\{true\}[\s\S]*video=\{callType==='video'\}/);
assert.match(screen,/AudioSession\.startAudioSession\(\)/);
assert.match(screen,/AudioSession\.stopAudioSession\(\)/);
assert.match(screen,/return\(\)=>[\s\S]*endPetCall\(callId,ownPetId\)/,'unmount must best-effort close server call state');
assert.match(web,/call\.nativeRequiredTitle/,'web must fail closed instead of pretending to provide native RTC');

for(const name of ['create_pet_call_idempotent','respond_pet_call','end_pet_call','get_incoming_pet_call','get_pet_call_state'])assert.match(api,new RegExp(name),`client API missing ${name}`);
assert.match(api,/functions\.invoke\('livekit-call-token'/);
assert.match(api,/^\s*if\(!data\|\|typeof data\.serverUrl/m,'client must validate token response shape');
assert.match(nav,/type==='call'[\s\S]*getIncomingPetCall[\s\S]*navigate\('Call'/,'notification routing must revalidate server call state before navigation');
assert.match(nav,/legalState!=='accepted'/,'foreground incoming-call polling must remain behind legal/setup gating');
assert.match(push,/template_key==='incoming_pet_call'/,'push dispatcher must use the localized incoming-call template');

const roadmap=JSON.parse(read('release/roadmap-implementation-v21.json')).phases['11_webrtc_calls'];
assert.match(roadmap.status,/^PARTIAL_/,'system calling/provider verification must not be falsely marked complete');
assert.match(String(roadmap.note??''),/CallKit|ConnectionService/);


assert.match(teardownMigration,/after update of status[\s\S]*enqueue_livekit_room_teardown/,'terminal DB call states must transactionally enqueue room teardown');
assert.match(teardownMigration,/status in \('declined','ended','expired'\)/,'decline/end/expiry must all enter room teardown');
assert.match(teardownMigration,/for update skip locked[\s\S]*lease_until/,'room teardown worker claims must be concurrency safe and lease recoverable');
assert.match(teardownMigration,/service_retry_livekit_room_teardown[\s\S]*v_delay integer:=least\(greatest\(coalesce\(p_delay_seconds,30\),30\),21600\)/,'room teardown retry delay must be bounded to 30s..6h');
assert.match(teardownMigration,/service_retry_livekit_room_teardown[\s\S]*attempts=attempts\+1/,'room teardown retries must increment durable attempt count');
assert.match(teardownMigration,/grant execute on function public\.expire_stale_pet_calls\(\) to service_role/,'room reaper must expire abandoned calls server-side');
assert.match(roomReaper,/LIVEKIT_ROOM_REAPER_SECRET[\s\S]*verifyBearerSecret/,'room reaper must be secret protected');
assert.match(roomReaper,/markWorkerHeartbeat\(supabase,'livekit-room-reaper','started'\)[\s\S]*markWorkerHeartbeat\(supabase,'livekit-room-reaper','completed'\)/,'room reaper must expose scheduled-worker health telemetry');
assert.match(roomReaper,/RoomServiceClient[\s\S]*listRooms[\s\S]*deleteRoom/,'room reaper must verify room existence and forcibly delete terminal rooms');
assert.match(roomReaper,/service_claim_livekit_room_teardowns[\s\S]*service_complete_livekit_room_teardown[\s\S]*service_retry_livekit_room_teardown/,'room reaper must use the transactional outbox lifecycle');

assert.match(teardownDeletionMigration,/drop constraint if exists livekit_room_teardown_queue_call_id_fkey/,'teardown outbox must survive deletion of the relational call row');
assert.match(teardownDeletionMigration,/before delete on public\.pet_call_sessions[\s\S]*enqueue_livekit_room_teardown_before_call_delete/,'call deletion must enqueue SFU cleanup before relational data disappears');
assert.match(teardownDeletionMigration,/service_complete_livekit_room_teardown[\s\S]*delete from public\.livekit_room_teardown_queue/,'successful room cleanup must remove the operational outbox row for data minimization');
console.log('livekit-call-checks: matched-pet RTC source boundary PASS');
