import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const manifest=JSON.parse(fs.readFileSync('release/country-legal-supplement-manifest-v20.json','utf8'));
const applicability=JSON.parse(fs.readFileSync('release/legal-language-applicability-r8.json','utf8'));
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
assert.equal(manifest.schema_version,2);assert.equal(manifest.as_of,'2026-10-01');
assert.equal(manifest.summary.markets,27);assert.equal(manifest.summary.routes,594);assert.equal(manifest.summary.binding_routes,34);assert.equal(manifest.summary.accessibility_translation_routes,560);
const allLegalLocales=['ar','ca','de','en','es','eu','fr','gl','hi','id','it','ja','ko','nl','pl','pt-BR','ru','th','tr','vi','zh-Hans','zh-Hant'];
let routes=0;
for(const [cc,m] of Object.entries(applicability.markets)){
  const expected=[...new Set([...(m.configured_document_locales??[]),...(m.minimum_document_locales_for_current_product_configuration??[])])].sort();
  const mm=manifest.markets[cc];assert.ok(mm,`${cc}: exact country supplement missing`);
  assert.deepEqual(mm.required_route_locales.sort(),expected,`${cc}: binding document-locale supplement routes drift`);
  assert.deepEqual(mm.available_route_locales.sort(),[...allLegalLocales].sort(),`${cc}: all-language country supplement route set drift`);
  assert.deepEqual(Object.keys(mm.routes).sort(),[...allLegalLocales].sort(),`${cc}: all-language supplement routes drift`);
  for(const [locale,r] of Object.entries(mm.routes)){
    const isBinding=expected.includes(locale);
    assert.equal(r.required_binding_locale,isBinding,`${cc}/${locale}: binding-role drift`);
    assert.equal(r.route_role,isBinding?'required_binding_document_locale':'accessibility_translation_non_controlling',`${cc}/${locale}: route role drift`);
    const src=fs.readFileSync(r.source_file,'utf8'), html=fs.readFileSync(r.public_file,'utf8');
    assert.equal(sha(src),r.source_sha256,`${cc}/${locale}: source hash drift`);assert.equal(sha(html),r.public_sha256,`${cc}/${locale}: public hash drift`);
    const d=JSON.parse(src);assert.equal(d.legal_country_code,cc);assert.equal(d.document_locale,locale);assert.equal(d.document_type,'jurisdiction_country_supplement');
    assert.ok(String(d.country_display_name??'').trim(),`${cc}/${locale}: localized country display name missing`);
    assert.notEqual(d.country_display_name,cc,`${cc}/${locale}: raw ISO country code leaked as the user-facing country name`);
    assert.ok(String(d.document_language_display_names??'').trim(),`${cc}/${locale}: localized document-language display names missing`);
    assert.ok((d.sections?.[0]?.paragraphs??[]).some(x=>String(x).includes(d.country_display_name)),`${cc}/${locale}: localized country name missing from legal lead`);
    assert.ok((d.sections?.[1]?.paragraphs??[]).some(x=>String(x).includes(d.document_language_display_names)),`${cc}/${locale}: localized document-language names missing from language section`);
    if(!isBinding)assert.ok((d.sections?.[1]?.paragraphs??[]).length>=2,`${cc}/${locale}: accessibility translation must disclose non-controlling status`);
    assert.ok(html.includes(`<strong>${d.country_display_name}</strong>`),`${cc}/${locale}: public route does not render localized country name`);
    assert.ok(!html.includes(`<strong>${cc}</strong>`),`${cc}/${locale}: raw ISO country code rendered as visible country label`);
    assert.equal(d.official_topic_families,22);assert.ok(d.official_source_count>0);assert.equal(d.no_silent_fallback,true);
    assert.ok(!/[{}](?:CC|LOCALES)[{}]/.test(src),`${cc}/${locale}: unresolved template token`);
    if(cc!=='TR')assert.ok(!/Türkiye KVKK|6698 sayılı|KVKK Privacy Notice/i.test(src),`${cc}/${locale}: Türkiye-specific supplement leaked into non-TR route`);
    assert.match(html,new RegExp(`<html lang="${locale.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}"`));
    routes++;
  }
}
assert.equal(routes,594);
console.log(`country-legal-supplement-checks: PASS 27/27 markets; 594/594 legal-country×supported-language supplements (34 binding + 560 accessibility); no cross-country KVKK fallback`);
