import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

const read=p=>readFileSync(p,'utf8');
const brand=JSON.parse(read('brand.json'));
assert.match(read('brand.ts'),/Object\.freeze\(brand\)/);
const appConfig=read('app.config.ts');
const settings=read('src/screens/SettingsScreen.tsx');
const chrome=JSON.parse(read('web/legal-chrome-copy.json'));
const locales=['en','es','pt-BR','fr','de','it','ru','tr','ar','hi','id','ja','ko','zh-Hans','zh-Hant','nl','pl','th','vi'];
const legalLocales=[...locales,'ca','eu','gl'];

assert.equal(brand.owner,'Yekta Özel');
assert.equal(brand.copyrightNotice,'© 2026 Yekta Özel. All rights reserved.');
assert.equal(brand.trademark,'Tailmance™');
assert.doesNotMatch(JSON.stringify(brand),/®/);
assert.match(appConfig,/name:\s*TAILMANCE_BRAND\.appName/);
assert.match(appConfig,/owner:\s*TAILMANCE_BRAND\.owner/);
assert.match(appConfig,/copyright:\s*TAILMANCE_BRAND\.copyrightNotice/);
assert.match(appConfig,/trademark:\s*TAILMANCE_BRAND\.trademark/);
assert.match(settings,/settings\.sectionAbout/);
assert.match(settings,/TAILMANCE_BRAND\.owner/);
assert.match(settings,/settings\.rightsNotice/);
assert.match(settings,/settings\.trademarkNotice/);

for(const locale of locales){
  const text=read(`src/i18n/locales/${locale}.ts`);
  for(const key of ['settings.sectionAbout','settings.ownerTitle','settings.ownerBody','settings.rightsNotice','settings.trademarkNotice']){
    assert.ok(text.includes(`\"${key}\"`),`${locale}: missing ${key}`);
  }
  assert.match(text,/settings\.ownerBody[^\n]*\{owner\}/,`${locale}: owner placeholder missing`);
  assert.match(text,/settings\.rightsNotice[^\n]*\{year\}[^\n]*\{owner\}/,`${locale}: rights placeholders missing`);
  assert.match(text,/settings\.trademarkNotice[^\n]*\{mark\}[^\n]*\{owner\}/,`${locale}: trademark placeholders missing`);
}
for(const locale of legalLocales){
  const notice=String(chrome[locale]?.ownership_notice??'');
  assert.ok(notice.includes('Yekta Özel'),`${locale}: legal ownership owner missing`);
  assert.ok(notice.includes('Tailmance™'),`${locale}: legal trademark missing`);
  assert.ok(notice.includes('2026'),`${locale}: copyright year missing`);
  assert.ok(!notice.includes('®'),`${locale}: unverified registered mark symbol forbidden`);
}

const generated=globSync('web/localized/*/*.html');
for(const file of generated){
  const locale=file.split('/')[2];
  if(!legalLocales.includes(locale))continue;
  const text=read(file);
  assert.match(text,/class="legal-owner"/i,`${file}: ownership footer missing`);
  assert.ok(text.includes('Yekta Özel'),`${file}: owner missing`);
}
console.log(`ownership-metadata-checks: ${locales.length}/19 runtime locales + ${legalLocales.length}/22 legal locales PASS`);
