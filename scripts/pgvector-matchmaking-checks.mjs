import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql=readFileSync('supabase/migrations/181_pgvector_pet_matchmaking_hybrid_ranking.sql','utf8');
const boost=readFileSync('supabase/migrations/190_pgvector_preserve_boost_priority.sql','utf8');
const redisParity=readFileSync('supabase/migrations/192_redis_discovery_pgvector_rerank_parity.sql','utf8');
const executableSql=sql.replace(/--[^\n]*/g,'');
const cache=readFileSync('supabase/functions/social-read-cache/index.ts','utf8');
assert.match(sql,/create extension vector with schema extensions/i,'pgvector must be installed in the non-Data-API extensions schema');
assert.match(sql,/embedding extensions\.vector\(40\) not null/i,'match embeddings require an explicit bounded dimension');
assert.match(sql,/using hnsw \(embedding extensions\.vector_cosine_ops\)/i,'HNSW cosine index required');
assert.match(sql,/1-\(e\.embedding <=> v_query\)/i,'ranking must use pgvector cosine distance');
for(const term of ['energy_level','birth_date','weight_kg','size','temperament_tags','pet_purposes','vaccination_status','microchip_verified','genetic_screening_available','pedigree_available','breed'])assert.ok(sql.includes(term),`match vector missing ${term} feature source`);
assert.doesNotMatch(executableSql,/\bbio\b|latitude|longitude|exact_address|microchip_number/i,'match embeddings must not include free-form bio, exact location or raw microchip PII');
assert.match(sql,/public\.discover_pets_v86\(p_active_pet_id,v_filters\)/,'vector ranking must remain downstream of mature discovery safety/filter gates');
assert.match(sql,/public\.rerank_discovery_with_match_vectors\(p_active_pet_id,v_result\)/,'hybrid vector reranking must be explicit');
assert.match(sql,/base_score\*0\.70/,'rules engine must retain majority ranking weight');
assert.match(cache,/surface==='discover'/,'default discovery Redis cache must remain available after vector ranking');
console.log('pgvector-matchmaking-checks: private 40D structured embeddings + HNSW cosine + rules-first hybrid ranking PASS');

assert.match(boost,/coalesce\(\(x\.item->>'boosted'\)::boolean,false\) as boosted/,'vector reranker must preserve established boost state');
assert.match(boost,/order by b\.boosted desc,b\.hybrid_score desc,b\.ord/,'Boost priority must remain ahead of vector compatibility ordering');

assert.match(redisParity,/rerank_discovery_with_match_vectors\(p_active_pet_id,v_result\)/,'Redis discovery rehydration must preserve pgvector ranking parity');
