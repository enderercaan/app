import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {globSync} from 'node:fs';

function catalog(locale){
  const src=readFileSync(`src/i18n/locales/${locale}.ts`,'utf8');
  const body=/const messages:\s*Messages\s*=\s*\{([\s\S]*?)\n\};/.exec(src)?.[1];
  assert.ok(body,`${locale} catalog boundaries missing`);
  return Function(`"use strict"; return ({${body}});`)();
}
const en=catalog('en');
const files=[...globSync('src/**/*.ts'),...globSync('src/**/*.tsx')].filter(f=>!f.includes('/i18n/locales/'));
const literal=new Set();
for(const file of files){
  const src=readFileSync(file,'utf8');
  for(const m of src.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g))literal.add(m[1]);
}
// Dynamic keys returned by typed safety and Premium feature registries cannot be discovered by the literal scan.
for(const key of [
  'contentSafety.petCommerceBlockedTitle','contentSafety.petCommerceBlockedBody',
  'contentSafety.humanDatingBlockedTitle','contentSafety.humanDatingBlockedBody',
  'premium.feature.unlimitedLikesTitle','premium.feature.unlimitedLikesBody',
  'premium.feature.boostTitle','premium.feature.boostBody',
  'premium.feature.travelTitle','premium.feature.travelBody',
  'premium.feature.multiPetTitle','premium.feature.multiPetBody',
]) literal.add(key);
const missing=[...literal].filter(k=>!(k in en)).sort();
assert.deepEqual(missing,[],`Source references unknown i18n keys: ${missing.join(', ')}`);
console.log(`i18n-source-usage-checks: ${literal.size} source-used/dynamic keys covered by canonical catalog; PASS`);
