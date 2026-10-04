import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const shared=readFileSync('supabase/functions/_shared/redisCache.ts','utf8');
const edge=readFileSync('supabase/functions/social-read-cache/index.ts','utf8');
const api=readFileSync('src/services/api.ts','utf8');
const sharedClient=readFileSync('supabase/functions/_shared/client.ts','utf8');
const baseMigration=readFileSync('supabase/migrations/169_redis_social_read_cache_rehydration.sql','utf8');
const privacyMigration=readFileSync('supabase/migrations/175_social_content_visibility_and_redis_privacy_parity.sql','utf8');
const vectorParityMigration=readFileSync('supabase/migrations/192_redis_discovery_pgvector_rerank_parity.sql','utf8');
const migration=`${baseMigration}\n${privacyMigration}\n${vectorParityMigration}`;
const config=readFileSync('supabase/config.toml','utf8');
const env=readFileSync('supabase/.env.example','utf8');

assert.match(shared,/UPSTASH_REDIS_REST_URL/);
assert.match(shared,/UPSTASH_REDIS_REST_TOKEN/);
assert.match(shared,/protocol!==['"]https:['"]/);
assert.match(shared,/redirect:['"]error['"]/);
assert.match(shared,/REDIS_TIMEOUT_MS=1_500/);
assert.match(shared,/redis_cache_config_invalid/);
assert.match(shared,/96_000/);
assert.match(shared,/SHA-256/);

assert.match(edge,/authenticatedUser\(req\)/);
assert.match(edge,/userClientForToken\(token\)/,'social-read-cache must execute cache rehydration through the authenticated user client');
assert.match(sharedClient,/SUPABASE_ANON_KEY/,'user-scoped Edge client must use the public anon key rather than service-role for user reads');
assert.match(sharedClient,/Authorization:`Bearer \$\{token\}`/,'user-scoped Edge client must forward the original user JWT so Postgres RLS/RPC auth context is preserved');
assert.match(sharedClient,/service_session_token_allowed/,'Edge authentication must reject revoked/stale session JWTs before constructing the user-scoped read client');
assert.match(edge,/rehydrate_cached_feed_page/);
assert.match(edge,/rehydrate_cached_reels_page/);
assert.match(edge,/rehydrate_cached_default_discovery/);
assert.match(edge,/discover-default/);
assert.match(edge,/FEED_TTL_SECONDS=12/);
assert.match(edge,/DISCOVERY_TTL_SECONDS=6/);
assert.doesNotMatch(edge,/service_role/i,'social-read-cache must not use service-role authorization for user reads');
assert.match(edge,/Cache acceleration is deliberately fail-open/);

for(const fn of ['rehydrate_cached_feed_page','rehydrate_cached_reels_page','rehydrate_cached_default_discovery']){
  assert.match(migration,new RegExp(`create or replace function public\\.${fn}\\(`));
  assert.match(migration,new RegExp(`grant execute on function public\\.${fn}[^;]+to authenticated`,'i'));
}
assert.match(migration,/not public\.is_blocked\(p_pet_id,p\.pet_id\)/);
assert.match(migration,/author\.moderation_status='approved'/);
assert.match(migration,/p_mode<>'following'/);
assert.match(migration,/community_zone_waitlisted/);
assert.match(migration,/user_travel_mode/);
assert.match(migration,/ST_Distance/);
assert.match(privacyMigration,/create or replace function public\.social_content_visible_to_viewer\(/,'social-content visibility must have one canonical privacy decision helper');
assert.match(privacyMigration,/owner\.discoverable/,'canonical social-content visibility must enforce discoverability');
assert.match(privacyMigration,/not owner\.incognito/,'canonical social-content visibility must enforce incognito mode');
assert.match(privacyMigration,/prior\.from_pet_id=p_target_pet_id and prior\.to_pet_id=p_viewer_pet_id/,'incognito content visibility must require target-to-viewer interest when no established relationship applies');
assert.match(privacyMigration,/f\.from_pet_id=p_target_pet_id and f\.to_pet_id=p_viewer_pet_id/,'incognito content visibility may recognize target-to-viewer follow relationship');
assert.match(privacyMigration,/m\.unmatched_at is null/,'incognito content visibility may recognize an active match');
for(const fn of ['get_feed_page','get_reels_page','rehydrate_cached_feed_page','rehydrate_cached_reels_page','rehydrate_cached_default_discovery']){
  const start=privacyMigration.indexOf(`create or replace function public.${fn}(`);
  assert.ok(start>=0,`${fn} must be overridden by privacy-parity migration`);
  const tail=privacyMigration.slice(start,start+7000);
  assert.match(tail,/perform public\.require_active_authenticated_session\(\)/,`${fn} must reject revoked/stale sessions at the Postgres boundary`);
  assert.match(tail,/current_user_has_product_access\(\)/,`${fn} must enforce current legal/product access`);
}
for(const fn of ['get_feed_page','get_reels_page','rehydrate_cached_feed_page','rehydrate_cached_reels_page']){
  const start=privacyMigration.indexOf(`create or replace function public.${fn}(`);
  const tail=privacyMigration.slice(start,start+9000);
  assert.match(tail,/social_content_visible_to_viewer\(p_pet_id,p\.pet_id\)/,`${fn} must use the same discoverable/incognito privacy helper`);
}
assert.match(privacyMigration,/get_shareable_reel[\s\S]*?social_content_visible_to_viewer\(p_viewer_pet_id,v_author\.id\)/,'shareable Reel links must use the same canonical privacy helper as direct/cached feeds');

assert.match(api,/functions\.invoke\('social-read-cache'/);
assert.match(api,/surface:'feed'/);
assert.match(api,/surface:'reels'/);
assert.match(api,/surface:'discover'/);
assert.match(api,/if\(cached\)return \{\.\.\.cached,items:await hydratePosts/);
assert.match(api,/if\(cached\)return \{\.\.\.cached,items:await hydrateReels/);
assert.match(api,/if\(cached\)return hydratePets\(cached\)/);
assert.match(api,/const \{data,error\}=await supabase\.rpc\('get_feed_page'/,'direct RPC fallback must remain for availability');
assert.match(config,/\[functions\.social-read-cache\][\s\S]*?verify_jwt\s*=\s*true/);
assert.match(env,/^SUPABASE_ANON_KEY=$/m);
assert.match(env,/^UPSTASH_REDIS_REST_URL=$/m);
assert.match(env,/^UPSTASH_REDIS_REST_TOKEN=$/m);

console.log('redis-cache-checks: user-scoped Redis social-read acceleration + Postgres rehydration safety PASS');

assert.match(vectorParityMigration,/return public\.rerank_discovery_with_match_vectors\(p_active_pet_id,v_result\)/,'Redis discovery hit must use current pgvector hybrid ranking');
