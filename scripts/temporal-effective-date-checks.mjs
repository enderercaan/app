import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const registry=JSON.parse(readFileSync('release/country-release-gates.json','utf8'));
const source=JSON.parse(readFileSync('release/official-source-review-v19.json','utf8'));
const store=JSON.parse(readFileSync('release/store-compliance-v19.json','utf8'));
const watch=JSON.parse(readFileSync('release/temporal-watchlist-v19.json','utf8'));
const expected=Object.keys(registry.markets).sort();
const initial=new Set(['BR','ID','SG','TH']);

function ymd(y,m,d){ return Date.UTC(Number(y),Number(m)-1,Number(d)); }
function parseDate(s){ const m=String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/); assert.ok(m,`invalid YYYY-MM-DD date: ${s}`); return ymd(m[1],m[2],m[3]); }
const todayIso=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const today=parseDate(todayIso);
assert.equal(source.reviewed_at,registry.reviewed_at,'country/source review date drift');
assert.equal(watch.as_of,source.reviewed_at,'temporal watchlist must share canonical review date');
assert.ok(today>=parseDate(source.reviewed_at),`runtime date ${todayIso} predates canonical review date ${source.reviewed_at}`);
assert.ok(today<=parseDate(source.source_freshness_policy.refresh_due_at),`official-source screening expired on ${source.source_freshness_policy.refresh_due_at}; refresh required`);
let futureStructured=0;
for(const code of expected){
  const notes=registry.markets[code].applicability_effective_date_review?.known_timing_notes??[];
  for(const item of notes){
    const s=String(item.status??'');
    const m=s.match(/future_effective_(\d{4})_(\d{2})_(\d{2})_as_of_(\d{4})_(\d{2})_(\d{2})/);
    if(!m) continue;
    futureStructured++;
    const effective=ymd(m[1],m[2],m[3]);
    const asOf=ymd(m[4],m[5],m[6]);
    assert.ok(effective>asOf,`${code}/${item.instrument}: future-effective status is stale or internally impossible: ${s}`);
    assert.ok(effective>today,`${code}/${item.instrument}: effective date ${m[1]}-${m[2]}-${m[3]} has been reached; future-effective label must be refreshed`);
  }
  assert.ok(notes.some(x=>x.instrument==='Google Play package-name registration'&&x.status==='current_effective_2026_09_30_global_Play_external_console_verification_required'),`${code}: global Play deadline timing state missing`);
  const hasRegional=notes.some(x=>x.instrument==='Android Developer Verification certified-device enforcement'&&x.status==='current_effective_2026_09_30_initial_market_external_verification_required');
  assert.equal(hasRegional,initial.has(code),`${code}: regional Android enforcement scope drift`);
}
assert.ok(futureStructured>=3,'expected non-Play structured future-effective timing notes were not all scanned');
assert.equal(store.android_developer_verification.play_package_registration_deadline,'2026-09-30');
assert.equal(store.android_developer_verification.play_package_registration_status_as_of_2026_09_30,'current_effective_global_Play_external_console_verification_required');
assert.equal(store.android_developer_verification.regional_certified_device_enforcement_status_as_of_2026_09_30,'current_effective_initial_markets_external_verification_required');
assert.deepEqual([...store.android_developer_verification.regional_certified_device_enforcement_initial_markets].sort(),[...initial].sort());
assert.match(source.markets.CN.timing_notes.join('\n'),/consultation draft[\s\S]*2026-10-17[\s\S]*not current obligations/i,'China Sep 2026 consultation draft must remain explicitly non-current');
for(const code of ['AU','BR','SG']) assert.ok(registry.markets[code].applicability_effective_date_review.known_timing_notes.some(x=>x.instrument==='Apple AU/BR/SG App Store 18+ download adult-confirmation behavior'&&/current_platform_behavior_from_2026_02_24/.test(x.status)),`${code}: current Apple regional 18+ behavior timing missing`);
assert.ok(registry.markets.BR.applicability_effective_date_review.known_timing_notes.some(x=>x.instrument==='Brazil Portaria Conjunta SENACON/SEDIGI/SPDIGI nº 3/2026 — general paid-ad/boosting duties'&&x.status==='future_effective_2026_10_23_as_of_2026_10_01'),'BR: paid-promotion general future-effective timing missing');
assert.ok(registry.markets.BR.applicability_effective_date_review.known_timing_notes.some(x=>x.instrument==='Brazil Portaria Conjunta SENACON/SEDIGI/SPDIGI nº 3/2026 — Article 3 material-relationship transparency tools'&&x.status==='future_effective_2026_12_22_as_of_2026_10_01'),'BR: Article 3 transparency-tool future-effective timing missing');
assert.ok(registry.markets.AU.applicability_effective_date_review.known_timing_notes.some(x=>x.instrument==='Apple Australia region-specific age-rating update'&&/current_platform_rating_scheme_from_2026_06_18/.test(x.status)),'AU: current Apple regional rating timing missing');
assert.ok(registry.markets.VN.applicability_effective_date_review.known_timing_notes.some(x=>x.instrument==='Apple Vietnam region-specific age-rating update'&&/current_platform_rating_scheme_from_2026_06_18/.test(x.status)),'VN: current Apple regional rating timing missing');

const indexedOfficialSources=new Set([
  ...Object.values(source.global_official_sources||{}).flatMap(v=>Array.isArray(v)?v:[]),
  ...Object.values(source.markets||{}).flatMap(m=>Array.isArray(m.official_sources)?m.official_sources:[]),
]);
let watchCount=0;
for(const item of watch.items||[]){
  watchCount++;
  assert.ok(item.id&&item.event_kind&&item.trigger_date&&item.status_as_of&&item.official_source,`temporal watch item missing required fields: ${JSON.stringify(item)}`);
  assert.ok(indexedOfficialSources.has(item.official_source),`${item.id}: official source is not pinned in canonical source index`);
  const trigger=parseDate(item.trigger_date);
  if(item.status_as_of.startsWith('future_effective')){
    assert.ok(trigger>parseDate(watch.as_of),`${item.id}: future-effective trigger must be after watchlist as_of`);
    assert.ok(trigger>today,`${item.id}: ${item.trigger_date} has been reached; recheck official source and replace future-effective status`);
  } else if(/draft|consultation|pending_final|proposal|announced_future_policy/.test(item.status_as_of)) {
    assert.ok(trigger>parseDate(watch.as_of),`${item.id}: draft/watch trigger must be after watchlist as_of`);
    assert.ok(trigger>today,`${item.id}: watch date ${item.trigger_date} has been reached; recheck official source without auto-promoting the draft`);
  }
}
assert.ok(watchCount>=17,'temporal watchlist unexpectedly incomplete');

const brPaidPromotionGeneral=(watch.items||[]).find(x=>x.id==='br_paid_promotion_portaria_general_2026_10_23');
assert.ok(brPaidPromotionGeneral,'BR paid-promotion 30-day effective-date watch missing');
assert.equal(brPaidPromotionGeneral.trigger_date,'2026-10-23');
const brPaidPromotionDisclosure=(watch.items||[]).find(x=>x.id==='br_paid_promotion_material_relationship_tools_2026_12_22');
assert.ok(brPaidPromotionDisclosure,'BR paid-promotion Article 3 90-day watch missing');
assert.equal(brPaidPromotionDisclosure.trigger_date,'2026-12-22');

const plAnimalFuture=(watch.items||[]).find(x=>x.id==='pl_animal_protection_amendment_2027_07_28');
assert.ok(plAnimalFuture,'Poland 2027 animal-protection amendment watch missing');
assert.equal(plAnimalFuture.trigger_date,'2027-07-28');
assert.ok(parseDate(plAnimalFuture.trigger_date)>today,'Poland 2027 animal-protection amendment future label is stale');
const plRegisterFuture=(watch.items||[]).find(x=>x.id==='pl_dog_cat_register_main_commencement_2028_06_11');
assert.ok(plRegisterFuture,'Poland dog/cat register future watch missing');
assert.equal(plRegisterFuture.trigger_date,'2028-06-11');


const us=JSON.parse(readFileSync('release/us-subnational-digital-age-review-v19.json','utf8'));
assert.equal(us.as_of,watch.as_of,'U.S. subnational age/store review date must match temporal watchlist');
assert.equal(us.matrix_complete,false,'U.S. 50-state/DC/territory/local matrix must not be claimed complete');
const usByJurisdiction=Object.fromEntries(us.instruments.map(x=>[x.jurisdiction,x]));
assert.equal(usByJurisdiction.TX.state,'current');
assert.equal(usByJurisdiction.TX.effective_or_operative_date,'2026-01-01');
for(const [code,date] of [['CA','2027-01-01'],['AL','2027-01-01'],['UT','2027-05-06'],['LA','2027-07-01']]){
  assert.equal(usByJurisdiction[code]?.state,'future_effective_prelaunch_watch',`US-${code}: future-state classification drift`);
  assert.equal(usByJurisdiction[code]?.effective_or_operative_date,date,`US-${code}: effective/operative date drift`);
  assert.ok(parseDate(date)>today,`US-${code}: future effective/operative date has been reached; official-source/counsel recheck required`);
}
const usNotes=registry.markets.US.applicability_effective_date_review?.known_timing_notes??[];
assert.ok(usNotes.some(x=>/Texas App Store Accountability Act/.test(x.instrument)&&/current_effective_2026_01_01/.test(x.status)), 'US: current Texas app-store law timing missing');
for(const [label,date] of [['California Digital Age Assurance Act / AB 1043 as amended by AB 1856','2027_01_01'],['Alabama HB161 App Store Accountability Act','2027_01_01'],['Utah App Store Accountability Act developer requirements','2027_05_06'],['Louisiana Act 185 app-store/developer requirements','2027_07_01']]){
  assert.ok(usNotes.some(x=>x.instrument===label&&new RegExp(`future_(?:effective|operative)_${date}`).test(x.status)),`US: ${label} future timing missing`);
}


console.log(`temporal-effective-date-checks: ${futureStructured} structured future-effective states + ${watchCount} high-volatility watch items consistent as of ${todayIso}; global Play vs BR/ID/SG/TH regional scope separated`);
