import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';

// The health-AI disclaimer ("AI-assisted document checks are may verify only complete, consistent records, can make mistakes
// decision, and can make mistakes") must appear, in the document's own language, in every legal surface.
const locales=['ar','ca','de','en','es','eu','fr','gl','hi','id','it','ja','ko','nl','pl','pt-BR','ru','th','tr','vi','zh-Hans','zh-Hant'];
const sectionIndex={ // [doc, default section index, Turkish-specific index]
  terms:[7,7],privacy_notice:[6,7],community_guidelines:[2,4],support:[5,5],
};
const lastText=(section)=>{const blocks=section.blocks.filter(b=>b.kind==='p'&&typeof b.text==='string');return blocks.at(-1)?.text??''};
let checkedDocs=0;
const longText={},shortText={};
for(const locale of locales){
  const docs=JSON.parse(readFileSync(`web/legal-source/${locale}.json`,'utf8')).documents;
  const pick=(doc)=>lastText(docs[doc].sections[locale==='tr'?sectionIndex[doc][1]:sectionIndex[doc][0]]);
  const [terms,privacy,community,support]=['terms','privacy_notice','community_guidelines','support'].map(pick);
  assert.ok(terms.length>60,`${locale}: terms health-AI paragraph missing`);
  assert.equal(privacy,terms,`${locale}: privacy notice must carry the same health-AI paragraph as the terms`);
  assert.ok(support.length>30,`${locale}: support health-AI warning missing`);
  assert.equal(community,support,`${locale}: community guidelines and support must carry the same short warning`);
  assert.ok(terms.length>support.length,`${locale}: long paragraph must be longer than the short warning`);
  longText[locale]=terms;shortText[locale]=support;checkedDocs+=4;
}
// Every country x language supplement must contain the long paragraph of its own language.
let countryDocs=0;
for(const file of globSync('web/legal-country-source/*/*.json')){
  const locale=file.split('/').at(-1).replace('.json','');
  const doc=JSON.parse(readFileSync(file,'utf8'));
  const paragraphs=doc.sections.flatMap(s=>s.paragraphs??[]);
  assert.ok(paragraphs.includes(longText[locale]),`${file}: health-AI paragraph missing or in the wrong language`);
  countryDocs++;
}
assert.match(longText.en,/AI can make mistakes/);assert.match(longText.en,/microchip/);assert.match(longText.en,/internal and external parasite/);assert.match(longText.en,/does not identify a pet’s breed/);
assert.match(shortText.en,/AI can make mistakes/);assert.match(shortText.en,/never identify a breed or diagnose/);
assert.equal(countryDocs,594,'expected 594 country x language supplements');
// Static Turkish pages.
const html=(f)=>readFileSync(f,'utf8');
const trLong=longText.tr.replace(/^([^.]+\.) /,'$1</strong> ').replace(/^/,'<p><strong>');
for(const f of ['web/terms.html','web/privacy.html','web/kvkk.html'])assert.ok(html(f).includes(trLong),`${f}: Turkish health-AI paragraph missing`);
for(const f of ['web/support.html','web/community-guidelines.html'])assert.ok(html(f).includes(`<p>${shortText.tr}</p>`),`${f}: Turkish short warning missing`);
// In-app notice in all 19 runtime catalogs.
let appLocales=0;
for(const file of globSync('src/i18n/locales/*.ts')){
  const text=readFileSync(file,'utf8');
  const value=/"health\.automatedReviewNotice":\s*"((?:[^"\\]|\\.)*)"/.exec(text)?.[1];
  assert.ok(value&&value.length>40,`${file}: health.automatedReviewNotice missing`);
  appLocales++;
}
assert.equal(appLocales,19,'expected 19 runtime catalogs');
console.log(`health-ai-disclaimer-checks: ${checkedDocs} legal documents (22 languages), ${countryDocs} country supplements, 5 Turkish static pages, ${appLocales} app catalogs; PASS`);
