import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root=process.cwd();
const registry=JSON.parse(fs.readFileSync('release/legal-document-locales-v1.json','utf8'));
const locales=[...registry.runtime_ui_locales,...registry.legal_document_only_locales.map(x=>x.locale)];
const docs=[['terms','terms.html'],['privacy_notice','privacy.html'],['community_guidelines','community-guidelines.html'],['subscription_consumer','subscription-consumer.html'],['marketing_push_consent','marketing-push-consent.html'],['moderation_appeals','moderation-appeals.html'],['intellectual_property','intellectual-property.html'],['accessibility','accessibility.html'],['support','support.html'],['account_deletion','delete-account.html'],['jurisdiction_privacy_supplement','kvkk.html'],['jurisdiction_consumer_supplement','consumer-language-supplement.html']];
const manifest=JSON.parse(fs.readFileSync('release/legal-web-localization-manifest-v1.json','utf8'));
const deleteCopy=JSON.parse(fs.readFileSync('web/delete-account-copy.json','utf8'));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const hashObj=o=>hash(JSON.stringify(o));
const errors=[];
assert.equal(manifest.schema_version,2,'localized legal manifest schema');
assert.equal(manifest.source,'web/legal-source','localized legal manifest canonical source');
assert.deepEqual(Object.keys(manifest.locales).sort(),[...locales].sort(),'manifest locale coverage');
for(const locale of locales){
  const pack=JSON.parse(fs.readFileSync(`web/legal-source/${locale}.json`,'utf8'));
  if(!deleteCopy[locale])errors.push(`${locale}: deletion form copy missing`);
  for(const [id,defaultFile] of docs){
    if(!pack.documents?.[id])continue;
    const file=pack.documents[id].file||defaultFile;
    const p=path.join(root,'web/localized',locale,file);
    if(!fs.existsSync(p)){errors.push(`${locale}/${id}: generated html missing`);continue;}
    const html=fs.readFileSync(p,'utf8'); const m=manifest.locales?.[locale]?.documents?.[id];
    if(!m){errors.push(`${locale}/${id}: manifest entry missing`);continue;}
    if(hash(html)!==m.sha256)errors.push(`${locale}/${id}: generated hash drift`);
    const expectedSource=id==='account_deletion'?{document:pack.documents[id],form:deleteCopy[locale]}:pack.documents[id];
    if(hashObj(expectedSource)!==m.source_sha256)errors.push(`${locale}/${id}: source hash drift`);
    if(m.sections!==pack.documents[id].sections.length)errors.push(`${locale}/${id}: section manifest drift`);
    if(!html.includes(`<html lang="${locale}"`))errors.push(`${locale}/${id}: lang attr`);
    if(!html.includes(`dir="${locale==='ar'?'rtl':'ltr'}"`))errors.push(`${locale}/${id}: direction attr`);
    for(const token of ["Content-Security-Policy","object-src 'none'","base-uri 'none'","form-action 'self'","upgrade-insecure-requests"]){if(!html.includes(token))errors.push(`${locale}/${id}: CSP missing ${token}`)}
    if(/href\s*=\s*["']\s*(?:javascript|data):/i.test(html))errors.push(`${locale}/${id}: unsafe href scheme`);
    if(/target\s*=\s*["']_blank["']/i.test(html))errors.push(`${locale}/${id}: target=_blank prohibited in legal flow`);
    for(const mm of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)){const href=mm[1]; if(/^(?:https?:|mailto:|#)/i.test(href))continue; const local=path.resolve(path.dirname(p),href.split('#')[0]); if(!fs.existsSync(local))errors.push(`${locale}/${id}: broken local href ${href}`);}
    if(id==='account_deletion'){
      if((html.match(/<form id="deleteForm"/g)||[]).length!==1)errors.push(`${locale}: delete form count`);
      for(const attr of ['data-unconfigured','data-verification','data-sending','data-success','data-failure'])if(!html.includes(`${attr}=`))errors.push(`${locale}: delete form missing ${attr}`);
      for(const token of ['<label for="email">','aria-describedby="emailHint"','role="status"','aria-live="polite"','../../delete-account.js'])if(!html.includes(token))errors.push(`${locale}: delete form semantic/script missing ${token}`);
    }
  }
}
if(errors.length){console.error(errors.slice(0,250).join('\n'));console.error(`errors=${errors.length}`);process.exit(1)}
const generatedCount=Object.values(manifest.locales).reduce((n,x)=>n+Object.keys(x.documents).length,0);
console.log(`legal-web-localization-checks: PASS ${locales.length} locales / ${generatedCount} documents; source/hash/CSP/link/form semantics`);
