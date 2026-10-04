import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Every catalog must carry a message for each CLDR plural category that Intl.PluralRules
// can select for that locale, for every pluralised key (keys that have a ".one" variant).
const locales=['ar','de','en','es','fr','hi','id','it','ja','ko','nl','pl','pt-BR','ru','th','tr','vi','zh-Hans','zh-Hant'];
function load(locale){
  const text=readFileSync(`src/i18n/locales/${locale}.ts`,'utf8');
  const body=/const messages:\s*Messages\s*=\s*\{([\s\S]*?)\n\};/.exec(text)?.[1];
  assert.ok(body!=null,`${locale} catalog boundaries missing`);
  return Function(`"use strict"; return ({${body}});`)();
}
const catalogs=Object.fromEntries(locales.map(l=>[l,load(l)]));
const bases=Object.keys(catalogs.en).filter(k=>k.endsWith('.one')).map(k=>k.slice(0,-4)).filter(b=>/\{(count|age)\}/.test(catalogs.en[b]));
assert.ok(bases.length>=14,'expected pluralised keys were not found');
const select=(locale,count)=>new Intl.PluralRules(locale).select(count);
for(const locale of locales){
  const categories=new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
  for(const base of bases)for(const category of categories){
    if(category==='zero')continue;
    const text=catalogs[locale][`${base}.${category}`]??catalogs[locale][base];
    assert.ok(typeof text==='string'&&text.trim(),`${locale}: no message for ${base} (${category})`);
    if(category!=='one')assert.ok(`${base}.${category}` in catalogs[locale],`${locale}: explicit ${base}.${category} is required`);
  }
}
// Spot checks of the grammar that previously fell back to the wrong form.
const t=(locale,key,count)=>{const c=catalogs[locale];const cat=select(locale,count);return (c[`${key}.${cat}`]??c[key]).replaceAll('{count}',String(count)).replaceAll('{age}',String(count))};
assert.equal(t('pl','petCard.age',3),'3 lata');
assert.equal(t('pl','petCard.age',5),'5 lat');
assert.equal(t('pl','petCard.age',22),'22 lata');
assert.equal(t('pl','petCard.age',12),'12 lat');
assert.equal(t('pl','feed.comments',4),'4 komentarze');
assert.equal(t('pl','feed.comments',1),'1 komentarz');
assert.equal(t('ru','petCard.age',3),'3 года');
assert.equal(t('ru','petCard.age',5),'5 лет');
assert.equal(t('ru','petCard.age',21),'21 год');
assert.equal(t('ru','petCard.age',11),'11 лет');
assert.equal(t('ar','petCard.age',2),'سنتان');
assert.equal(t('ar','petCard.age',11),'11 سنة');
assert.equal(t('ar','petCard.age',5),'5 سنوات');
assert.equal(t('ar','feed.likes',2),'إعجابان');
assert.equal(t('en','feed.likes',2),'2 likes');
console.log(`plural-category-checks: ${locales.length} locales, ${bases.length} pluralised keys; PASS`);
