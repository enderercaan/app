import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=process.cwd();
const registry=JSON.parse(fs.readFileSync(path.join(root,'release/legal-document-locales-v1.json'),'utf8'));
const locales=[...registry.runtime_ui_locales,...registry.legal_document_only_locales.map(x=>x.locale)];
const baseRequired=['terms','privacy_notice','community_guidelines','marketing_push_consent','subscription_consumer','moderation_appeals','intellectual_property','accessibility','account_deletion','support'];
const legalOnly=new Set(registry.legal_document_only_locales.map(x=>x.locale));
const en=JSON.parse(fs.readFileSync(path.join(root,'web/legal-source/en.json'),'utf8'));
const ph=s=>[...String(s).matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(x=>x[1]).sort().join('|');
const scripts={ar:/[\u0621-\u063A\u0641-\u064A]/,hi:/[\u0904-\u0939\u0958-\u0961]/,ja:/[\u3040-\u30ff\u4e00-\u9fff]/,ko:/[\uac00-\ud7af]/,ru:/[А-Яа-яЁё]/,'zh-Hans':/[\u4e00-\u9fff]/,'zh-Hant':/[\u4e00-\u9fff]/,th:/[\u0E01-\u0E2E]/};
const normalized=s=>String(s).normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu,'').trim();
const safeNonTranslated=s=>/^(?:Tailmance|App Store|Google Play|Premium|Standard|KVKK|GDPR|UK GDPR|DMCA|17 U\.S\.C\. §512|Yekta Özel|Yekta Özel|yektaozel@icloud\.com)$/i.test(String(s).trim()) || /^https?:\/\//.test(String(s));
function strings(v,out=[]){if(typeof v==='string'){out.push(v);return out;} if(Array.isArray(v)){for(const x of v)strings(x,out);return out;} if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){if(['schema_version','locale','source_version'].includes(k))continue;strings(x,out)}return out;}
const taiwanForbidden=['賬戶','數據','營銷','准則','啓用','知識產權','運營','默認','消息','網絡','用戶','服務器','登錄','設置','獲取','訪問','崩潰','導出','坐標','存儲'];
const draftSentinel=/(?:\bTODO\b|\bTBD\b|\bFIXME\b|\bPLACEHOLDER\b|\blorem\s+ipsum\b|(?<![A-Za-z])N\s*\/\s*A(?![A-Za-z]))/iu;
const errors=[];
// UI/document language must never imply the user's legal country. Country-specific law names and
// mechanisms belong only in exact legal-country supplements, not in generic language packs.
const genericLocaleCountryLeakage={
  tr:[
    /Türkiye\s+için\s+KVKK/iu,
    /Türkiye(?:'|’)?de\s+İYS/iu,
    /Kanada(?:'|’)?da\s+CASL/iu,
    /KVKK\s+Aydınlatma\s+Metni/iu,
    /\bİYS\b/iu,
    /\bCASL\b/iu
  ]
};
assert.equal(new Set(locales).size,locales.length,'legal document locale registry contains duplicates');
for(const locale of locales){
  const p=path.join(root,'web/legal-source',`${locale}.json`);
  if(locale==='zh-Hant') {
    const raw=fs.readFileSync(p,'utf8');
    for(const term of taiwanForbidden) if(raw.includes(term)) errors.push(`${locale}: Taiwan legal terminology drift contains ${term}`);
  }
  if(!fs.existsSync(p)){errors.push(`${locale}: legal source pack missing`);continue;}
  const pack=JSON.parse(fs.readFileSync(p,'utf8'));
  const genericPackRaw=fs.readFileSync(p,'utf8');
  for(const re of genericLocaleCountryLeakage[locale]??[]) if(re.test(genericPackRaw)) errors.push(`${locale}: generic legal-language pack leaks country-specific legal context via ${re}`);
  if(pack.locale!==locale)errors.push(`${locale}: locale metadata mismatch (${pack.locale})`);
  const required=[...baseRequired, legalOnly.has(locale)?'jurisdiction_consumer_supplement':'jurisdiction_privacy_supplement'];
  if(legalOnly.has(locale) && pack.documents?.jurisdiction_privacy_supplement) errors.push(`${locale}: legal-document-only locale must not carry Türkiye-specific jurisdiction_privacy_supplement/KVKK`);
  if(!legalOnly.has(locale) && pack.documents?.jurisdiction_consumer_supplement) errors.push(`${locale}: runtime locale must not carry Spain legal-only jurisdiction_consumer_supplement`);
  for(const id of required){
    const doc=pack.documents?.[id], base=en.documents?.[id], hasEnglishBase=Boolean(en.documents?.[id]);
    if(!doc){errors.push(`${locale}/${id}: missing document`);continue;}
    if(!doc.title?.trim())errors.push(`${locale}/${id}: empty title`);
    if(hasEnglishBase&&(doc.sections?.length??0)!==(base.sections?.length??0))errors.push(`${locale}/${id}: section count ${(doc.sections?.length??0)}/${base.sections?.length??0}`);
    const vals=strings(doc), baseVals=hasEnglishBase?strings(base):[];
    if(vals.some(v=>!String(v).trim()))errors.push(`${locale}/${id}: empty string`);
    for(let i=0;i<vals.length;i++) if(draftSentinel.test(String(vals[i]))) errors.push(`${locale}/${id}: draft/placeholder sentinel at string ${i+1}: ${String(vals[i]).slice(0,90)}`);
    for(let i=0;i<Math.min(vals.length,baseVals.length);i++){
      if(hasEnglishBase&&ph(vals[i])!==ph(baseVals[i]))errors.push(`${locale}/${id}: placeholder drift at string ${i+1}`);
      if(hasEnglishBase&&locale!=='en' && vals[i]===baseVals[i] && String(vals[i]).trim().length>=35 && !safeNonTranslated(vals[i]))errors.push(`${locale}/${id}: untranslated English long string ${i+1}: ${String(vals[i]).slice(0,90)}`);
      if(hasEnglishBase&&locale!=='en' && String(vals[i]).trim().length>=35 && !safeNonTranslated(vals[i]) && normalized(vals[i])===normalized(baseVals[i]))errors.push(`${locale}/${id}: normalized-English leakage at string ${i+1}: ${String(vals[i]).slice(0,90)}`);
      const re=scripts[locale];
      if(re && String(vals[i]).trim().length>=35 && !safeNonTranslated(vals[i]) && !re.test(String(vals[i])))errors.push(`${locale}/${id}: target script missing in long string ${i+1}`);
    }
  }
}
if(errors.length){console.error(errors.slice(0,200).join('\n'));console.error(`errors=${errors.length}`);process.exit(1)}
console.log(`localized-legal-language-checks: PASS ${locales.length} legal document locales × 11 required documents each; key/section/placeholder/target-script/untranslated-long-string QA`);
