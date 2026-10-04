import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root=process.cwd();
const sourceDir=path.join(root,'web','legal-source');
const outRoot=path.join(root,'web','legal');
const localeRegistry=JSON.parse(fs.readFileSync(path.join(root,'release','legal-document-locales-v1.json'),'utf8'));
const locales=[...localeRegistry.runtime_ui_locales,...localeRegistry.legal_document_only_locales.map(x=>x.locale)];
const legalOnly=new Set(localeRegistry.legal_document_only_locales.map(x=>x.locale));
const rtl=new Set(['ar']);
const chrome=JSON.parse(fs.readFileSync(path.join(root,'web','legal-chrome-copy.json'),'utf8'));
const deleteCopy=JSON.parse(fs.readFileSync(path.join(root,'web','delete-account-copy.json'),'utf8'));
const docOrder=['terms','privacy_notice','community_guidelines','marketing_push_consent','subscription_consumer','moderation_appeals','intellectual_property','accessibility','account_deletion','support','jurisdiction_privacy_supplement','jurisdiction_consumer_supplement'];
const baseRequired=['terms','privacy_notice','community_guidelines','marketing_push_consent','subscription_consumer','moderation_appeals','intellectual_property','accessibility','account_deletion','support'];
const defaultFiles={terms:'terms.html',privacy_notice:'privacy.html',community_guidelines:'community-guidelines.html',marketing_push_consent:'marketing-push-consent.html',subscription_consumer:'subscription-consumer.html',moderation_appeals:'moderation-appeals.html',intellectual_property:'intellectual-property.html',accessibility:'accessibility.html',account_deletion:'delete-account.html',support:'support.html',jurisdiction_privacy_supplement:'kvkk.html',jurisdiction_consumer_supplement:'consumer-language-supplement.html'};
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const hashObj=o=>sha(JSON.stringify(o));
const available=locales.filter(l=>fs.existsSync(path.join(sourceDir,`${l}.json`)));
if(available.length!==locales.length)throw new Error(`legal locale source coverage ${available.length}/${locales.length}`);
fs.rmSync(outRoot,{recursive:true,force:true});
fs.mkdirSync(outRoot,{recursive:true});
const canonicalSourceVersion=JSON.parse(fs.readFileSync(path.join(sourceDir,'en.json'),'utf8')).source_version;
if(!canonicalSourceVersion)throw new Error('canonical legal source_version missing');
const manifest={schema_version:2,generated_at:'SOURCE_DETERMINISTIC',source_version:canonicalSourceVersion,source:'web/legal-source',chrome_source:'web/legal-chrome-copy.json',locales:{}};
const csp="default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data:; connect-src 'self' https://*.supabase.co https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'none'; form-action 'self'; upgrade-insecure-requests";
for(const locale of available){
  const pack=JSON.parse(fs.readFileSync(path.join(sourceDir,`${locale}.json`),'utf8'));
  if(pack.locale!==locale)throw new Error(`${locale}: pack locale mismatch`);
  if(pack.source_version!==canonicalSourceVersion)throw new Error(`${locale}: legal source_version drift ${pack.source_version} != ${canonicalSourceVersion}`);
  if(!chrome[locale]?.skip_to_main||!chrome[locale]?.legal_navigation)throw new Error(`${locale}: localized legal chrome missing`);
  if(!deleteCopy[locale])throw new Error(`${locale}: delete-account form copy missing`);
  const required=[...baseRequired,legalOnly.has(locale)?'jurisdiction_consumer_supplement':'jurisdiction_privacy_supplement'];
  for(const id of required)if(!pack.documents?.[id])throw new Error(`${locale}: required legal document missing: ${id}`);
  if(legalOnly.has(locale)&&pack.documents?.jurisdiction_privacy_supplement)throw new Error(`${locale}: legal-only locale must not carry Türkiye KVKK supplement`);
  if(!legalOnly.has(locale)&&pack.documents?.jurisdiction_consumer_supplement)throw new Error(`${locale}: runtime locale must not carry Spain consumer-language supplement`);
  const dir=path.join(outRoot,locale); fs.mkdirSync(dir,{recursive:true});
  const docs={};
  for(const type of docOrder){
    const doc=pack.documents?.[type]; if(!doc)continue;
    const file=doc.file||defaultFiles[type];
    const nav=docOrder.filter(t=>pack.documents?.[t]).map(t=>`<a href="${esc(pack.documents[t].file||defaultFiles[t])}">${esc(pack.documents[t].title)}</a>`).join(' · ');
    const intro=(doc.intro||[]).map(renderBlock).join('\n');
    const sections=(doc.sections||[]).map((s,i)=>{
      let body=(s.blocks||[]).map(renderBlock).join('\n');
      if(type==='account_deletion'&&i===0)body+=renderDeletionForm(locale);
      return `<section aria-labelledby="s${i+1}"><h2 id="s${i+1}">${esc(s.heading)}</h2>${body}</section>`;
    }).join('\n');
    const script=type==='account_deletion'?'<script src="../../delete-account.js" defer></script>':'';
    const html=`<!doctype html>\n<html lang="${esc(locale)}" dir="${rtl.has(locale)?'rtl':'ltr'}">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${esc(csp)}"><title>Tailmance | ${esc(doc.title)}</title><link rel="stylesheet" href="../../styles.css"><script src="../../config.js"></script><meta name="robots" content="index,follow"></head>\n<body><a class="skip-link" href="#main">${esc(chrome[locale].skip_to_main)}</a><header><strong>Tailmance</strong></header><main id="main" tabindex="-1"><h1>${esc(doc.title)}</h1>${intro}${sections}<nav class="legal-nav" aria-label="${esc(chrome[locale].legal_navigation)}">${nav}</nav></main>${script}</body>\n</html>\n`;
    fs.writeFileSync(path.join(dir,file),html);
    const sourcePayload=type==='account_deletion'?{document:doc,form:deleteCopy[locale],chrome:chrome[locale]}:{document:doc,chrome:chrome[locale]};
    docs[type]={file,sha256:sha(html),source_sha256:hashObj(sourcePayload),bytes:Buffer.byteLength(html),sections:(doc.sections||[]).length};
  }
  if(Object.keys(docs).length!==11)throw new Error(`${locale}: expected exactly 11 public legal documents, got ${Object.keys(docs).length}`);
  manifest.locales[locale]={documents:docs};
}
fs.mkdirSync(path.join(root,'release'),{recursive:true});
fs.writeFileSync(path.join(root,'release','localized-legal-web-manifest-r8.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`generate-localized-legal-web: generated ${available.length}/${locales.length} locale packs; ${available.length*11} public legal routes with CSP/localized chrome/delete flow`);
function renderBlock(b){if(b.kind==='list')return `<ul>${(b.items||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`;return `<p>${esc(b.text)}</p>`;}
function renderDeletionForm(locale){
  const c=deleteCopy[locale];
  return `<form id="deleteForm" data-unconfigured="${esc(c.unconfigured)}" data-verification="${esc(c.verification)}" data-sending="${esc(c.sending)}" data-success="${esc(c.success)}" data-failure="${esc(c.failure)}"><label for="email">${esc(c.label)}</label><p id="emailHint" class="muted">${esc(c.hint)}</p><input id="email" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" aria-describedby="emailHint" required maxlength="254"><button type="submit">${esc(c.button)}</button></form><p id="result" role="status" aria-live="polite"></p>`;
}
