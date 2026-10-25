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
assert.match(longText.en,/AI can make mistakes/);assert.match(longText.en,/every filled page/);assert.match(longText.en,/internal and external parasite/);assert.match(longText.en,/checked and approved/);assert.match(longText.en,/does not determine a pet['’]s breed from images/);assert.match(longText.en,/not a statement that the animal is in good health|It is not a statement that the animal is in good health/);
assert.match(shortText.en,/AI can make mistakes/);assert.match(shortText.en,/every filled page/);assert.match(shortText.en,/checked and approved/);assert.match(shortText.en,/does not mean that the pet is in perfect health/);assert.match(shortText.en,/all information and guidance given by AI/);
assert.match(longText.en,/No external person, institution or register takes part in or confirms the check/);assert.match(longText.en,/microchip number/);assert.doesNotMatch(longText.en,/veterin/i);assert.match(longText.en,/European Union region/);assert.match(longText.en,/species and date of birth/);assert.match(longText.en,/until the first date on which a vaccination or treatment falls due again/);
assert.doesNotMatch(longText.en,/routine care|required care|age and the breed/);assert.doesNotMatch(shortText.en,/ and care that apply/);
assert.match(longText.tr,/hiçbir dış kişi, kurum veya sicil katılmaz/);assert.match(longText.tr,/mikroçip numarasını/);assert.doesNotMatch(longText.tr,/veteriner/i);assert.doesNotMatch(longText.tr,/gerekli bakımlarla|senin belirttiğin ırk\) göre/);
// The on-device photo model is not shipped in the first release, so no document may say that photos are screened on the device.
for(const locale of locales){const pn=JSON.parse(readFileSync(`web/legal-source/${locale}.json`,'utf8')).documents.privacy_notice;const blob=JSON.stringify(pn);assert.doesNotMatch(blob,/on-device model|cihaz üzerindeki bir model|端末内のモデル|기기 내 모델|设备端模型|裝置端模型|модель на устройстве|Modell auf dem Gerät|modelo en el dispositivo|modèle exécuté sur l’appareil|modello sul dispositivo|model działający na urządzeniu|modelo no dispositivo|model di perangkat|mô hình chạy trên thiết bị|โมเดลบนอุปกรณ์|डिवाइस पर चलने वाला मॉडल|نموذج يعمل على الجهاز|model al dispositiu|gailuko modelo|modelo no dispositivo/i,`${locale}: privacy notice must not claim on-device photo screening`)}
assert.equal(countryDocs,594,'expected 594 country x language supplements');
// Mating is arranged by owners among themselves: every legal surface says Tailmance takes no part and gives no guarantee.
const mateTail={};
for(const locale of locales){
  const docs=JSON.parse(readFileSync(`web/legal-source/${locale}.json`,'utf8')).documents;
  const terms=docs.terms.sections[5].blocks[0].text;
  const tail=terms.slice(-70);
  mateTail[locale]=tail;
  const cgBlocks=docs.community_guidelines.sections.flatMap(sec=>sec.blocks.flatMap(b=>b.text?[b.text]:(b.items??[])));
  assert.ok(cgBlocks.some(t=>t.endsWith(tail)),`${locale}: community guidelines must carry the no-participation, no-guarantee mating statement`);
  assert.ok(terms.length>200,`${locale}: terms mating section missing`);
}
assert.match(JSON.parse(readFileSync('web/legal-source/en.json','utf8')).documents.terms.sections[5].blocks[0].text,/Tailmance takes no part in it, gives no guarantee about it, its outcome or the health, fitness or pedigree of any animal/);
let mateCountry=0;
for(const file of globSync('web/legal-country-source/*/*.json')){
  const locale=file.split('/').at(-1).replace('.json','');
  const paragraphs=JSON.parse(readFileSync(file,'utf8')).sections.flatMap(sec=>sec.paragraphs??[]);
  assert.ok(paragraphs.some(p=>p.endsWith(mateTail[locale])),`${file}: welfare paragraph must carry the mating no-guarantee statement`);
  mateCountry++;
}
assert.equal(mateCountry,594);
for(const f of ['web/terms.html','web/community-guidelines.html'])assert.ok(readFileSync(f,'utf8').includes(mateTail.tr),`${f}: Turkish mating no-guarantee statement missing`);

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
  for(const key of ['health.uploadDocumentBody','health.documentCheckApproved','health.documentCheckNote','health.documentCheckValidUntil','health.uploadConsentTitle','health.uploadConsentBody','health.uploadConsentConfirm']){const v=new RegExp(`"${key.replace('.','\\.')}":\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(text)?.[1];assert.ok(v&&v.length>2,`${file}: ${key} missing`)}
  for(const gone of ['discover.vetVerified','petCard.vetVerified','petProfile.vetVerified','petProfile.matingReason.vet','health.vet','health.trust.title','health.trust.body'])assert.ok(!text.includes(`"${gone}"`),`${file}: removed veterinarian key ${gone} is still present`);
  appLocales++;
}
assert.equal(appLocales,19,'expected 19 runtime catalogs');
const healthScreen=readFileSync('src/screens/HealthScreen.tsx','utf8');
assert.match(healthScreen,/const confirmUpload=\(\)=>\{[\s\S]*health\.uploadConsentTitle[\s\S]*health\.uploadConsentBody[\s\S]*uploadDocument\(\)/,'sharing pages with the text-recognition provider needs an explicit in-app consent before the first upload');
assert.match(healthScreen,/onPress=\{confirmUpload\}/);
console.log(`health-ai-disclaimer-checks: ${checkedDocs} legal documents (22 languages), ${countryDocs} country supplements, 5 Turkish static pages, ${appLocales} app catalogs; PASS`);
