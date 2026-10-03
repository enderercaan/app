// Regression lock for defects found by executing the migration chain on a real PostgreSQL server and for the
// location-privacy, input and spoofing fixes made in the same review (2026-10-03). Runs without a database.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const read=(p)=>readFileSync(p,'utf8');
const m=(n)=>read(`supabase/migrations/${readdirSync('supabase/migrations').find(f=>f.startsWith(`${n}_`))}`);
const code=(n)=>m(n).split('\n').filter(line=>!/^\s*--/.test(line)).join('\n');
const checks=[];const check=(name,fn)=>{fn();checks.push(name);};

check('014 removes the ambiguous owns_pet(uuid,uuid) overload before one-argument SQL bodies compile',()=>{
  const s=m('014');assert.ok(s.indexOf('drop function if exists public.owns_pet(uuid,uuid);')<s.indexOf('create or replace function public.owns_pet(p_pet_id uuid)'));
});
check('021 version pattern uses a single escaped dot under standard_conforming_strings',()=>{
  const s=m('021');assert.ok(!s.includes('(\\\\.[0-9]+)'));assert.equal((s.match(/\(\\\.\[0-9\]\+\)\{0,3\}/g)??[]).length,4);
});
check('025 legacy overload cleanup is idempotent',()=>assert.match(m('025'),/to_regprocedure\('public\.owns_pet\(uuid,uuid\)'\)/));
for(const [n,fn] of [['026','claim_pending_notifications(integer)'],['114','claim_pending_notifications(integer)'],['055','accept_current_legal_bundle(uuid,text,text,text,boolean,text,text)']]){
  check(`${n} drops ${fn} before changing its signature`,()=>assert.ok(m(n).includes(`drop function if exists public.${fn};`)));
}
for(const n of ['055','071','092']){
  check(`${n} parenthesizes CASE inside PL/pgSQL IF conditions`,()=>{
    const s=m(n);assert.ok(!s.includes("coalesce(v_bundle.legal_subnational_code,'')<>case when"));
    assert.ok(s.includes("coalesce(v_bundle.legal_subnational_code,'')<>(case when public.legal_country_requires_subnational_review"));
  });
}
check('136 derives public_route_path for generated supplement upserts',()=>{
  const s=m('136');assert.match(s,/create trigger legal_supplement_public_route_path_derive\s+before insert or update/);
  assert.match(s,/new\.public_route_path:='\/'\|\|regexp_replace\(new\.public_relative_path,'\^web\/',''\)/);
});
check('199 repairs every runtime defect found by plpgsql_check',()=>{
  const s=code('199');
  for(const act of ['consumable_credit_granted','consumable_credit_refunded','consumable_refund_reversed'])
    assert.ok(s.includes(`'${act}','billing_webhook',null,\n      jsonb_build_object('billingEventId',p_event_id,`),act);
  assert.ok(s.includes("'marketing_push_consent_withdrawn','marketing_consent_event',null,"));
  assert.ok(!s.includes('jsonb_object_length('));
  assert.ok(s.includes('(select count(*) from jsonb_object_keys(p_control_reviews))'));
  assert.ok(s.includes('operator(extensions.<=>)')&&!/[^(]<=>/.test(s.replace(/operator\(extensions\.<=>\)/g,'')));
  assert.equal((s.match(/return v_item\.status::text=p_status;/g)??[]).length,2);
  const policy=s.slice(s.indexOf('FUNCTION public.get_product_feature_policy()'));
  const firstObject=policy.slice(policy.indexOf('jsonb_build_object('),policy.indexOf(') ||'));
  assert.ok((firstObject.match(/,/g)??[]).length<100,'each jsonb_build_object must stay below 100 arguments');
  assert.match(s,/grant execute on function public\.rerank_discovery_with_match_vectors\(uuid,jsonb\) to service_role;/);
  assert.ok(!/grant execute on function public\.rerank_discovery_with_match_vectors\(uuid,jsonb\) to authenticated/.test(s));
});
check('200 serves only neighbourhood-scale distances and whole-km distance filters',()=>{
  const s=code('200');
  for(const f of ['privacy_snap_location','privacy_coarse_distance_km','privacy_display_distance_km'])assert.ok(s.includes(`create or replace function public.${f}(`),f);
  assert.match(s,/ST_SnapToGrid\(p_location::extensions\.geometry,0\.01\)/);
  assert.match(s,/when p_km < 1\.5 then 1::numeric/);
  assert.ok(!/round\(\(extensions\.ST_Distance\([^)]*\)\/1000\.0\)::numeric,1\)/.test(s),'0.1 km precision must not return');
  assert.ok(!s.includes('round(x.distance_km::numeric,1)'));
  assert.equal((s.match(/public\.privacy_display_distance_km\(v_private\.location,/g)??[]).length,2);
  assert.ok(s.includes('public.privacy_display_distance_km(mine.location,x.location)'));
  assert.ok(s.includes("greatest(1::double precision,ceil(nullif(p_filters->>'maxDistanceKm','')::double precision))"));
  for(const f of ['privacy_snap_location(extensions.geography)','privacy_coarse_distance_km(double precision)','privacy_display_distance_km(extensions.geography,extensions.geography)'])
    assert.ok(s.includes(`revoke all on function public.${f} from public,anon,authenticated;`),f);
});
check('client rejects Android mock-location fixes with localized copy',()=>{
  assert.match(read('src/services/location.ts'),/if \(current\.mocked === true\) throw new Error\('location_mocked'\);/);
  assert.match(read('src/services/errors.ts'),/location_mocked'\)\) return t\('error\.locationMocked'\)/);
});
check('discovery number fields keep typed text so localized decimals can be entered',()=>{
  const s=read('src/screens/DiscoverScreen.tsx');assert.ok(s.includes('onChange(parseLocalizedDecimal(cleaned))'));assert.ok(!s.includes("value={value?.toString()??''}"));
});
check('primary buttons ignore ghost double taps',()=>{
  const s=read('src/components/PrimaryButton.tsx');assert.match(s,/export const PRESS_GUARD_MS=700;/);assert.match(s,/if\(now-lastPressAt\.current<PRESS_GUARD_MS\)return;/);
});
check('health documents disclose AI-assisted pre-check and human review in every runtime locale',()=>{
  assert.ok(read('src/screens/HealthScreen.tsx').includes("t('health.automatedReviewNotice')"));
  for(const f of readdirSync('src/i18n/locales').filter(f=>f.endsWith('.ts'))){
    const s=read(`src/i18n/locales/${f}`);assert.match(s,/"health\.automatedReviewNotice":\s*"[^"]{40,}"/,f);assert.match(s,/"error\.locationMocked":\s*"[^"]{20,}"/,f);
  }
});
check('verify:database gate is fail-closed and covers plpgsql_check plus runtime smoke',()=>{
  const s=read('scripts/postgres-migration-chain-check.mjs');assert.match(s,/PostgreSQL is not reachable/);assert.match(s,/plpgsql_check extension is required/);assert.match(s,/runtime smoke/);
});
check('native config: themed icon, no force-dark, background call audio',()=>{
  const cfg=read('app.config.ts');assert.match(cfg,/monochromeImage: '\.\/assets\/adaptive-monochrome\.png'/);assert.match(cfg,/withAndroidForceDarkDisabled\.cjs/);
  assert.match(read('plugins/withAndroidForceDarkDisabled.cjs'),/name: 'android:forceDarkAllowed',\s*value: 'false'/);
  assert.match(read('plugins/withSystemCalls.cjs'),/'remote-notification','voip','audio'/);
});
console.log(`executed-postgres-regression-checks: ${checks.length}/${checks.length} PASS`);
