import { globSync, readFileSync } from 'node:fs';

const src=readFileSync('src/i18n/index.tsx','utf8');
const appConfig=readFileSync('app.config.ts','utf8');
const pendingSql=globSync('supabase/migrations/{011,012,013,014,015,016,017,018,019,020,021,022,023,024}_*.sql').sort().map(p=>readFileSync(p,'utf8')).join('\n');
const vaccinationWorker=readFileSync('supabase/functions/vaccination-reminders/index.ts','utf8');
const pushDispatch=readFileSync('supabase/functions/push-dispatch/index.ts','utf8');
const pushCopySource=readFileSync('supabase/functions/_shared/pushCopy.generated.ts','utf8');
const issues=[];

const list=(name,text=src)=>{
  if(name==='RELEASE_READY_LOCALES'&&/RELEASE_READY_LOCALES[^=]*=\s*SUPPORTED_LOCALES\s*;/.test(text))return list('SUPPORTED_LOCALES',text);
  const body=new RegExp(`${name}[^=]*=\\s*\\[([^\\]]+)\\]`).exec(text)?.[1]??'';
  return [...body.matchAll(/['"]([^'"]+)['"]/g)].map(m=>m[1]);
};
const supported=list('SUPPORTED_LOCALES');
const ready=list('RELEASE_READY_LOCALES');
const fallbackOnly=list('FALLBACK_ONLY_LOCALES');
const pushCopyLocales=list('PUSH_COPY_LOCALES',pushCopySource);
const pushTranslatedLocales=list('PUSH_TRANSLATED_LOCALES',pushCopySource);
if(supported.length!==19)issues.push(`Exactly 19 target locales are required; found ${supported.length}`);
if(new Set(supported).size!==supported.length)issues.push('SUPPORTED_LOCALES contains duplicates');
if(ready.length!==19||ready.some((locale,i)=>locale!==supported[i]))issues.push(`All 19 locales must be release-ready in the canonical order; currently ${ready.length}/19 (${ready.join(',')||'none'})`);
if(fallbackOnly.length||ready.length!==supported.length){
  const expectedFallback=supported.filter(locale=>!ready.includes(locale));
  if(JSON.stringify(fallbackOnly)!==JSON.stringify(expectedFallback))issues.push('Fallback-only locale declaration does not exactly match non-release-ready locales');
  if(expectedFallback.length)issues.push(`${expectedFallback.length} locale catalogs are intentionally English-fallback-only pending professional translation/review (${expectedFallback.join(',')})`);
}
if(pushCopyLocales.length!==19||supported.some(locale=>!pushCopyLocales.includes(locale)))issues.push(`Push notification locale routing coverage is ${pushCopyLocales.length}/19 (${pushCopyLocales.join(',')||'none'})`);
if(pushTranslatedLocales.length!==19||supported.some(locale=>!pushTranslatedLocales.includes(locale)))issues.push(`Localized push copy is ${pushTranslatedLocales.length}/19 (${pushTranslatedLocales.join(',')||'none'}); remaining locales intentionally use the English fallback`);
if(!pushCopySource.includes('notifications.item.lostPetTitle')||!pushCopySource.includes('notifications.item.lostPetBody'))issues.push('Lost-pet OS push copy is missing from the generated localized push catalog');
if(!/template_key===['\"]lost_pet['\"][\s\S]*notifications\.item\.lostPetTitle[\s\S]*notifications\.item\.lostPetBody/.test(pushDispatch))issues.push('Lost-pet OS push dispatcher is not bound to localized template copy');

function catalog(locale){
  const text=readFileSync(`src/i18n/locales/${locale}.ts`,'utf8');
  const body=/const messages:\s*Messages\s*=\s*\{([\s\S]*?)\n\};/.exec(text)?.[1]??'';
  const rawKeys=[...body.matchAll(/^\s*"([^"]+)"\s*:/gm)].map(m=>m[1]);
  const duplicates=rawKeys.filter((key,index)=>rawKeys.indexOf(key)!==index);
  let map={};
  try{map=Function(`"use strict"; return ({${body}});`)();}catch(error){void error;map={};}
  return {map,duplicates,missingExpression:!body};
}
const enCatalog=catalog('en');
const en=enCatalog.map; const enKeys=Object.keys(en);
if(!enKeys.length)issues.push('English source catalog is empty or could not be parsed');
if(enCatalog.duplicates.length)issues.push(`English catalog has duplicate keys: ${enCatalog.duplicates.join(',')}`);
const placeholders=value=>[...String(value).matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
for(const locale of supported){
  const c=catalog(locale);
  if(c.missingExpression){issues.push(`${locale} is missing from DICTIONARIES`);continue;}
  if(c.duplicates.length)issues.push(`${locale} catalog has duplicate keys: ${c.duplicates.join(',')}`);
  const keys=Object.keys(c.map); const set=new Set(keys);
  const missing=enKeys.filter(k=>!set.has(k));
  const extra=keys.filter(k=>!Object.hasOwn(en,k));
  const blank=enKeys.filter(k=>set.has(k)&&!String(c.map[k]).trim());
  if(missing.length||extra.length||blank.length)issues.push(`${locale} catalog parity failed: ${keys.length}/${enKeys.length} keys, missing=${missing.length}, extra=${extra.length}, blank=${blank.length}`);
  let placeholderErrors=0;
  for(const key of enKeys){if(!set.has(key))continue;if(JSON.stringify(placeholders(c.map[key]))!==JSON.stringify(placeholders(en[key])))placeholderErrors++;}
  if(placeholderErrors)issues.push(`${locale} placeholder parity failed for ${placeholderErrors} key${placeholderErrors===1?'':'s'}`);
}

const turkishChars='çğıöşüÇĞİÖŞÜ';
const countTurkish=text=>[...text].filter(ch=>turkishChars.includes(ch)).length;
const notificationStatements=text=>[...text.matchAll(/insert into public\.notifications[\s\S]*?;/gi)].map(m=>m[0]).join('\n');
const pendingNotificationMarkers=countTurkish(notificationStatements(pendingSql));
const runtimeEdgeNotificationMarkers=countTurkish(vaccinationWorker);
if(pendingNotificationMarkers)issues.push(`Pending SQL notification producers contain ${pendingNotificationMarkers} Turkish-character markers`);
if(runtimeEdgeNotificationMarkers)issues.push(`Runtime vaccination notification worker contains ${runtimeEdgeNotificationMarkers} Turkish-character markers`);

const localesBlock=/locales:\s*\{([^}]+)\}/.exec(appConfig)?.[1]??'';
const nativeLocaleEntries=[...localesBlock.matchAll(/(?:^|,)\s*(?:'([^']+)'|([A-Za-z][\w-]*))\s*:\s*'([^']+)'/g)].map(m=>({locale:m[1]||m[2],path:m[3]}));
const nativeLocales=nativeLocaleEntries.map(x=>x.locale);
if(nativeLocales.length!==19)issues.push(`Native Expo locale metadata is ${nativeLocales.length}/19 (${nativeLocales.join(',')||'none'})`);
if(new Set(nativeLocales).size!==nativeLocales.length)issues.push('Native Expo locale metadata contains duplicate locale declarations');
for(const locale of supported)if(!nativeLocales.includes(locale))issues.push(`${locale} native locale metadata is missing`);
for(const {locale,path} of nativeLocaleEntries){
  try{
    const metadata=JSON.parse(readFileSync(path,'utf8'));
    if(JSON.stringify(Object.keys(metadata).sort())!==JSON.stringify(['android','ios']))issues.push(`${locale} native metadata contains unsupported root keys`);
    if(metadata?.ios?.CFBundleDisplayName!=='Tailmance'||metadata?.android?.app_name!=='Tailmance')issues.push(`${locale} native app name must remain Tailmance`);
    for(const key of ['NSPhotoLibraryUsageDescription','NSCameraUsageDescription','NSLocationWhenInUseUsageDescription'])if(typeof metadata?.ios?.[key]!=='string'||metadata.ios[key].trim().length<20)issues.push(`${locale} ${key} is missing or too short`);
  }catch{issues.push(`${locale} native metadata file could not be parsed: ${path}`);}
}

if(issues.length){
  console.error(`i18n-release-check: BLOCKED (${issues.length} issue${issues.length===1?'':'s'})`);
  for(const issue of issues)console.error(`- ${issue}`);
  process.exit(1);
}
console.log(`i18n-release-check: 19/19 complete runtime catalogs + push copy + native metadata; ${enKeys.length} source keys with placeholder parity`);
