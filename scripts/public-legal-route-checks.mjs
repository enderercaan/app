import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const registry=JSON.parse(fs.readFileSync('release/legal-document-locales-v1.json','utf8'));
const locales=[...registry.runtime_ui_locales,...registry.legal_document_only_locales.map(x=>x.locale)];
const legalOnly=new Set(registry.legal_document_only_locales.map(x=>x.locale));
const chrome=JSON.parse(fs.readFileSync('web/legal-chrome-copy.json','utf8'));
const deleteCopy=JSON.parse(fs.readFileSync('web/delete-account-copy.json','utf8'));
const manifest=JSON.parse(fs.readFileSync('release/localized-legal-web-manifest-r8.json','utf8'));
const baseRequired=['terms','privacy_notice','community_guidelines','marketing_push_consent','subscription_consumer','moderation_appeals','intellectual_property','accessibility','account_deletion','support'];
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const hashObj=o=>hash(JSON.stringify(o));
const errors=[];
assert.equal(manifest.schema_version,2,'public legal manifest schema');
assert.deepEqual(Object.keys(manifest.locales).sort(),[...locales].sort(),'public legal locale coverage');
for(const locale of locales){
  const pack=JSON.parse(fs.readFileSync(`web/legal-source/${locale}.json`,'utf8'));
  const required=[...baseRequired,legalOnly.has(locale)?'jurisdiction_consumer_supplement':'jurisdiction_privacy_supplement'];
  const entries=manifest.locales?.[locale]?.documents??{};
  if(Object.keys(entries).length!==11)errors.push(`${locale}: public legal manifest must have 11 docs`);
  for(const id of required){
    const doc=pack.documents?.[id]; const m=entries[id];
    if(!doc||!m){errors.push(`${locale}/${id}: source/manifest missing`);continue;}
    const p=path.join('web','legal',locale,m.file);
    if(!fs.existsSync(p)){errors.push(`${locale}/${id}: public route missing`);continue;}
    const html=fs.readFileSync(p,'utf8');
    if(hash(html)!==m.sha256)errors.push(`${locale}/${id}: public route hash drift`);
    const sourcePayload=id==='account_deletion'?{document:doc,form:deleteCopy[locale],chrome:chrome[locale]}:{document:doc,chrome:chrome[locale]};
    if(hashObj(sourcePayload)!==m.source_sha256)errors.push(`${locale}/${id}: public source hash drift`);
    for(const token of ['Content-Security-Policy',"object-src 'none'","base-uri 'none'","form-action 'self'","upgrade-insecure-requests"]){if(!html.includes(token))errors.push(`${locale}/${id}: CSP missing ${token}`)}
    if(!html.includes(`<a class="skip-link" href="#main">${escapeHtml(chrome[locale].skip_to_main)}</a>`))errors.push(`${locale}/${id}: skip link not localized`);
    if(!html.includes(`aria-label="${escapeHtml(chrome[locale].legal_navigation)}"`))errors.push(`${locale}/${id}: legal nav aria label not localized`);
    if(!html.includes(`<html lang="${locale}"`))errors.push(`${locale}/${id}: lang attr`);
    if(!html.includes(`dir="${locale==='ar'?'rtl':'ltr'}"`))errors.push(`${locale}/${id}: dir attr`);
    if(/href\s*=\s*["']\s*(?:javascript|data):/i.test(html))errors.push(`${locale}/${id}: unsafe href`);
    if(/target\s*=\s*["']_blank["']/i.test(html))errors.push(`${locale}/${id}: target blank prohibited`);
    if(id==='account_deletion'){
      for(const token of ['<form id="deleteForm"','<label for="email">','aria-describedby="emailHint"','role="status"','aria-live="polite"','../../config.js','../../delete-account.js'])if(!html.includes(token))errors.push(`${locale}: delete route missing ${token}`);
    }
  }
  const wrong=legalOnly.has(locale)?'jurisdiction_privacy_supplement':'jurisdiction_consumer_supplement';
  if(entries[wrong])errors.push(`${locale}: wrong jurisdiction supplement surfaced publicly`);
}
if(errors.length){console.error(errors.slice(0,250).join('\n'));console.error(`errors=${errors.length}`);process.exit(1)}
console.log(`public-legal-route-checks: PASS ${locales.length}/22 locales, ${locales.length*11} routes; CSP + localized a11y chrome + exact supplement + deletion flow`);
function escapeHtml(s){return String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
