import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root=process.cwd();
const srcDir=path.join(root,'web','legal-source');
const outRoot=path.join(root,'web','localized');
const localeRegistry=JSON.parse(fs.readFileSync(path.join(root,'release','legal-document-locales-v1.json'),'utf8'));
const locales=[...localeRegistry.runtime_ui_locales,...localeRegistry.legal_document_only_locales.map(x=>x.locale)];
const docs=[
  ['terms','terms.html'],['privacy_notice','privacy.html'],['community_guidelines','community-guidelines.html'],
  ['subscription_consumer','subscription-consumer.html'],['marketing_push_consent','marketing-push-consent.html'],
  ['moderation_appeals','moderation-appeals.html'],['intellectual_property','intellectual-property.html'],
  ['accessibility','accessibility.html'],['support','support.html'],['account_deletion','delete-account.html'],
  ['jurisdiction_privacy_supplement','kvkk.html'],['jurisdiction_consumer_supplement','consumer-language-supplement.html']
];
const rtl=new Set(['ar']);
const deleteCopy=JSON.parse(fs.readFileSync(path.join(root,'web','delete-account-copy.json'),'utf8'));
const chromeCopy=JSON.parse(fs.readFileSync(path.join(root,'web','legal-chrome-copy.json'),'utf8'));
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const hashObj=o=>hash(JSON.stringify(o));
const renderBlock=b=>{
  if(b.kind==='p')return `<p>${esc(b.text)}</p>`;
  if(b.kind==='list')return `<ul>${(b.items||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`;
  throw new Error(`unknown legal block kind: ${b.kind}`);
};
const renderDeletionForm=locale=>{
  const c=deleteCopy[locale];
  if(!c)throw new Error(`${locale}: deletion-form copy missing`);
  return `<form id="deleteForm" data-unconfigured="${esc(c.unconfigured)}" data-verification="${esc(c.verification)}" data-sending="${esc(c.sending)}" data-success="${esc(c.success)}" data-failure="${esc(c.failure)}"><label for="email">${esc(c.label)}</label><p id="emailHint" class="muted">${esc(c.hint)}</p><input id="email" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" aria-describedby="emailHint" required maxlength="254"><button type="submit">${esc(c.button)}</button></form><p id="result" role="status" aria-live="polite"></p>`;
};

fs.rmSync(outRoot,{recursive:true,force:true});
fs.mkdirSync(outRoot,{recursive:true});
const canonicalSourceVersion=JSON.parse(fs.readFileSync(path.join(srcDir,'en.json'),'utf8')).source_version;
if(!canonicalSourceVersion)throw new Error('canonical legal source_version missing');
const manifest={schema_version:2,version:canonicalSourceVersion,source:'web/legal-source',locales:{}};
for(const locale of locales){
  const sourceFile=path.join(srcDir,`${locale}.json`);
  if(!fs.existsSync(sourceFile))throw new Error(`${locale}: legal source missing`);
  const pack=JSON.parse(fs.readFileSync(sourceFile,'utf8'));
  if(pack.locale!==locale)throw new Error(`${locale}: locale mismatch`);
  if(pack.source_version!==canonicalSourceVersion)throw new Error(`${locale}: legal source_version drift ${pack.source_version} != ${canonicalSourceVersion}`);
  const dir=path.join(outRoot,locale);fs.mkdirSync(dir,{recursive:true});
  manifest.locales[locale]={documents:{}};
  for(const [docId,defaultFile] of docs){
    const d=pack.documents?.[docId];
    if(!d)continue;
    const file=d.file||defaultFile;
    if(!d?.title||!Array.isArray(d.sections)||!d.sections.length)throw new Error(`${locale}/${docId}: incomplete source`);
    const intro=(d.intro||[]).map(renderBlock).join('');
    const sections=d.sections.map((s,i)=>{
      let body=(s.blocks||[]).map(renderBlock).join('');
      if(docId==='account_deletion'&&i===0)body+=renderDeletionForm(locale);
      return `<h2>${esc(s.heading)}</h2>${body}`;
    }).join('');
    const nav=docs.filter(([id])=>pack.documents?.[id]).map(([id,href])=>`<a href="${esc(pack.documents[id].file||href)}">${esc(pack.documents[id].title)}</a>`).join(' · ');
    const script=docId==='account_deletion'?'<script src="../../delete-account.js" defer></script>':'';
    const html=`<!doctype html><html lang="${esc(locale)}" dir="${rtl.has(locale)?'rtl':'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data:; connect-src 'self' https://*.supabase.co https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'none'; form-action 'self'; upgrade-insecure-requests"><title>Tailmance | ${esc(d.title)}</title><link rel="stylesheet" href="../../styles.css"><script src="../../config.js"></script></head><body><main class="wrap"><div class="brand">Tailmance 🐾</div><h1>${esc(d.title)}</h1>${intro}<div class="card">${sections}</div><footer>${nav}<p class="legal-owner">${esc(chromeCopy[locale]?.ownership_notice??'')}</p></footer></main>${script}</body></html>\n`;
    fs.writeFileSync(path.join(dir,file),html);
    manifest.locales[locale].documents[docId]={file,sha256:hash(html),source_sha256:hashObj(docId==='account_deletion'?{document:d,form:deleteCopy[locale]}:d),sections:d.sections.length};
  }
}
fs.writeFileSync(path.join(root,'release','legal-web-localization-manifest-v1.json'),JSON.stringify(manifest,null,2)+'\n');
const generatedCount=Object.values(manifest.locales).reduce((n,x)=>n+Object.keys(x.documents).length,0);
console.log(`generate-legal-web-localizations: PASS ${locales.length}/${locales.length} locales; ${generatedCount} documents generated`);
