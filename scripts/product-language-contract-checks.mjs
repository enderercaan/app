import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

const read=p=>readFileSync(p,'utf8');
const localeFiles=readdirSync('src/i18n/locales').filter(f=>f.endsWith('.ts')).sort();
const metadataFiles=readdirSync('store/metadata').filter(f=>f.endsWith('.json')).sort();
assert.equal(localeFiles.length,19,'expected 19 runtime locale catalogs');
assert.equal(metadataFiles.length,19,'expected 19 store-metadata locale files');

const docTokens={
  'ar':'وث', 'de':'Dokument', 'en':'document', 'es':'document', 'fr':'document', 'hi':'दस्तावेज', 'id':'dokumen',
  'it':'document', 'ja':'書類', 'ko':'문서', 'nl':'document', 'pl':'dokument', 'pt-BR':'document', 'ru':'документ',
  'th':'เอกสาร', 'tr':'belge', 'vi':'tài liệu', 'zh-Hans':'文件', 'zh-Hant':'文件'
};
const extract=(text,key)=>{
  const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const m=text.match(new RegExp(`"${escaped}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  assert.ok(m,`missing ${key}`);
  return JSON.parse(`"${m[1]}"`);
};
for(const file of localeFiles){
  const locale=file.slice(0,-3);
  const text=read(`src/i18n/locales/${file}`);
  assert.doesNotMatch(text,/Tailmance Plus|TAILMANCE PLUS|Tailmance-Plus/,`${file}: legacy Plus brand`);
  assert.doesNotMatch(text,/disease[- ]free|hastal[ıi]ks[ıi]z|guaranteed healthy/i,`${file}: prohibited health guarantee`);
  const token=docTokens[locale];
  assert.ok(token,`${file}: missing document token rule`);
  for(const key of ['verification.subtitle','verification.heroBody','verification.healthTitle','verification.healthApproved']){
    const value=extract(text,key);
    assert.ok(value.toLocaleLowerCase().includes(token.toLocaleLowerCase()),`${file}: ${key} must describe document review, not verified health`);
  }
}

for(const file of metadataFiles){
  const locale=file.slice(0,-5);
  const data=JSON.parse(read(`store/metadata/${file}`));
  const text=JSON.stringify(data);
  assert.doesNotMatch(text,/Tailmance Plus|TAILMANCE PLUS|Tailmance-Plus/,`${file}: legacy Plus brand`);
  assert.doesNotMatch(text,/disease[- ]free|guaranteed healthy/i,`${file}: prohibited health guarantee`);
  const token=docTokens[locale];
  const combined=`${data.apple?.description??''}\n${data.google?.fullDescription??''}`.toLocaleLowerCase();
  assert.ok(combined.includes(token.toLocaleLowerCase()),`${file}: store description must describe health-document review`);
}

const englishRuntime=read('src/i18n/locales/en.ts');
const englishStore=read('store/metadata/en.json');
for(const [name,text] of [['English runtime',englishRuntime],['English store metadata',englishStore]]){
  assert.doesNotMatch(text,/\bhealth verification\b|\bhealth-verified\b|\bverified health\b|\bdisease[- ]free\b|\bhealthy pet\b/i,`${name}: misleading health-verification wording`);
}

console.log('Product language contract: 19/19 runtime locales + 19/19 store locales PASS');
