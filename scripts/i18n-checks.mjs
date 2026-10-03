import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
const src=readFileSync('src/i18n/index.tsx','utf8');
const appConfig=readFileSync('app.config.ts','utf8');
const pendingSql=globSync('supabase/migrations/{011,012,013,014,015,016,017,018,019,020,021,022,023,024}_*.sql').sort().map(p=>readFileSync(p,'utf8')).join('\n');
const vaccinationWorker=readFileSync('supabase/functions/vaccination-reminders/index.ts','utf8');
const supported=[...src.matchAll(/SUPPORTED_LOCALES\s*=\s*\[([^\]]+)\]/g)][0]?.[1]?.match(/'[^']+'/g)?.map(x=>x.slice(1,-1))??[];
const ready=/RELEASE_READY_LOCALES:[^=]+=\s*SUPPORTED_LOCALES\s*;/.test(src)?supported:([...src.matchAll(/RELEASE_READY_LOCALES:[^=]+=\s*\[([^\]]+)\]/g)][0]?.[1]?.match(/'[^']+'/g)?.map(x=>x.slice(1,-1))??[]);
assert.equal(supported.length,19,'Exactly 19 target locales must be declared');
assert.deepEqual(new Set(supported).size,19,'Target locales must be unique');
assert.ok(supported.includes('ar'),'Arabic locale is required');
assert.match(src,/RTL_LOCALES[^\n]+\['ar'\]/,'Arabic must be declared RTL');
assert.deepEqual(ready,supported,'All 19 completed runtime catalogs must be release-ready in canonical order');
const fallbackOnly=[...src.matchAll(/FALLBACK_ONLY_LOCALES:[^=]+=\s*\[([^\]]+)\]/g)][0]?.[1]?.match(/'[^']+'/g)?.map(x=>x.slice(1,-1))??[];
assert.deepEqual(fallbackOnly,[],'No completed locale may remain fallback-only');
assert.match(src,/const DICTIONARIES:Record<AppLocale,Messages>/,'Typed locale catalog is required');
for(const locale of supported){const importName=locale==='pt-BR'?'ptBR':locale==='zh-Hans'?'zhHans':locale==='zh-Hant'?'zhHant':locale;assert.match(src,new RegExp(`import\\s+${importName}\\s+from\\s+['\"]\\.\\/locales\\/${locale}['\"]`),`${locale} must have a dedicated locale module`);}
assert.match(src,/DEFAULT_RELEASE_LOCALE:AppLocale='en'/,'Unknown/unsupported locale requests must fail closed to the global English fallback');
assert.match(src,/RELEASE_READY_LOCALES\.includes\(next\)\?next:DEFAULT_RELEASE_LOCALE/,'Locale switching must fail closed to the release-safe locale');
assert.match(src,/en\[key\]\?\?key/,'English fallback is required');

const settingsScreen=readFileSync('src/screens/SettingsScreen.tsx','utf8');
assert.match(settingsScreen,/releaseReady\.map\(code=>/,'Language picker must be driven by the release-ready locale list');
assert.doesNotMatch(settingsScreen,/supported\.map\(code=>/,'Language picker must not bypass release readiness');
// Release-ready catalog integrity: exact key parity, no duplicate keys, and placeholder parity.
const evalCatalogFile=(locale)=>{
  const text=readFileSync(`src/i18n/locales/${locale}.ts`,'utf8');
  const body=/const messages:\s*Messages\s*=\s*\{([\s\S]*?)\n\};/.exec(text)?.[1];
  assert.ok(body!=null,`${locale} catalog boundaries missing`);
  const rawKeyCount=[...body.matchAll(/^\s*"([^"]+)"\s*:/gm)].length;
  const map=Function(`"use strict"; return ({${body}});`)();
  assert.equal(rawKeyCount,Object.keys(map).length,`${locale} catalog must not contain duplicate keys`);
  return map;
};
const placeholders=value=>[...String(value).matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(m=>m[1]).sort();
const enCatalog=evalCatalogFile('en');const trCatalog=evalCatalogFile('tr');
for(const locale of ready){const catalog=evalCatalogFile(locale);assert.deepEqual(Object.keys(catalog).sort(),Object.keys(enCatalog).sort(),`${locale} release-ready catalog must exactly match English key coverage`);for(const key of Object.keys(enCatalog))assert.deepEqual(placeholders(catalog[key]),placeholders(enCatalog[key]),`${locale} placeholder mismatch for ${key}`);}
const trVisibleText=Object.values(trCatalog).join('\n');
for(const pattern of [/\bproduction\b/i,/\bbackend\b/i,/\bprovider\b/i,/\bvendor\b/i,/\bentitlement\b/i,/\bpush\b/i,/\bbundle\b/i,/\brelease[- ]ready\b/i,/\breversed\b/i,/\bhuman review\b/i,/\bmanual review\b/i,/\bstore[- ]console\b/i,/\bfallback\b/i,/\bpaywall\b/i,/\brestore purchases\b/i])assert.doesNotMatch(trVisibleText,pattern,`Turkish runtime catalog must not expose internal English jargon ${pattern}`);
assert.match(src,/secureStorage\.setItem\(STORAGE_KEY/,'Locale persistence is required');
assert.match(src,/I18nManager\.allowRTL\(true\)/,'RTL support must be explicitly enabled');
assert.match(src,/setFormattingLocale\(locale\)/,'Selected app locale must drive date/number formatting');
assert.match(src,/new Intl\.PluralRules\(locale\)/,'Locale-aware plural rules are required');
assert.ok(enCatalog['petCard.age.one'],'English singular age copy is required');
assert.equal(enCatalog['petCard.approxDistance'],'about {distance}','Pet-card distance copy must not hardcode km after locale-aware unit formatting');
assert.notEqual(enCatalog['petCard.approxDistance'],'about {distance} km','Pet-card distance copy must not append a second hardcoded unit');
assert.match(readFileSync('src/domain/petPrompts.ts','utf8'),/PET_PROMPT_IDS=\['favoriteGame','firstMeet','happyThing','atPark','likeInPets','threeWords'\]/,'Pet prompt persistence must use stable language-independent keys');
assert.match(pendingSql,/'favoriteGame','firstMeet','happyThing','atPark','likeInPets','threeWords'/,'Server prompt whitelist must accept stable language-independent prompt keys');
const files=[...globSync('src/**/*.tsx'),...globSync('src/**/*.ts')].filter(x=>!x.includes('src/i18n/'));
const demoFiles=new Set(['src/data/demo.ts']);
let productionMarkers=0,demoMarkers=0;const hotspots=[];
for(const file of files){const text=readFileSync(file,'utf8');const count=[...text].filter(ch=>'çğıöşüÇĞİÖŞÜ'.includes(ch)).length;if(!count)continue;if(demoFiles.has(file))demoMarkers+=count;else{productionMarkers+=count;hotspots.push([count,file]);}}
hotspots.sort((a,b)=>b[0]-a[0]);
assert.equal(productionMarkers,0,'Production source must not contain hardcoded Turkish-character UI copy outside the locale catalog');

let literalTextNodes=0;const literalTextHotspots=[];
for(const file of globSync('src/**/*.tsx')){
  const text=readFileSync(file,'utf8');
  for(const match of text.matchAll(/<Text\b[^>]*>([^<{][^<{]*?)<\/Text>/gs)){
    const visible=match[1].replace(/\s+/g,' ').trim();
    if(!visible||visible==='Tailmance'||/^[\d\W_]+$/u.test(visible))continue;
    literalTextNodes++;literalTextHotspots.push(`${file}:${visible.slice(0,80)}`);
  }
}
assert.equal(literalTextNodes,0,`Visible literal Text copy must use the i18n catalog: ${literalTextHotspots.slice(0,5).join(', ')}`);

const turkishChars='çğıöşüÇĞİÖŞÜ';
const countTurkish=text=>[...text].filter(ch=>turkishChars.includes(ch)).length;
const notificationStatements=text=>[...text.matchAll(/insert into public\.notifications[\s\S]*?;/gi)].map(m=>m[0]).join('\n');
const historicalNotificationMarkers=globSync('supabase/migrations/*.sql').reduce((sum,file)=>sum+countTurkish(notificationStatements(readFileSync(file,'utf8'))),0);
const pendingNotificationMarkers=countTurkish(notificationStatements(pendingSql));
const runtimeEdgeNotificationMarkers=countTurkish(vaccinationWorker);
const localesBlock=/locales:\s*\{([^}]+)\}/.exec(appConfig)?.[1]??'';
const nativeLocaleEntries=[...localesBlock.matchAll(/(?:^|,)\s*(?:'([^']+)'|([A-Za-z][\w-]*))\s*:\s*'([^']+)'/g)].map(m=>({locale:m[1]||m[2],path:m[3]}));
const nativeLocales=nativeLocaleEntries.map(x=>x.locale);
assert.equal(nativeLocales.length,19,'Native locale metadata must declare all 19 target locales');
assert.deepEqual(new Set(nativeLocales),new Set(supported),'Native locale metadata must match the 19 supported locales exactly');
for(const {locale,path} of nativeLocaleEntries){
  const metadata=JSON.parse(readFileSync(path,'utf8'));
  assert.deepEqual(Object.keys(metadata).sort(),['android','ios'],`${locale} native metadata must only contain ios/android sections`);
  assert.equal(metadata?.ios?.CFBundleDisplayName,'Tailmance',`${locale} iOS display name must remain Tailmance`);
  for(const key of ['NSPhotoLibraryUsageDescription','NSCameraUsageDescription','NSLocationWhenInUseUsageDescription'])assert.ok(typeof metadata?.ios?.[key]==='string'&&metadata.ios[key].trim().length>=20,`${locale} ${key} must be a real localized explanation`);
  assert.equal(metadata?.android?.app_name,'Tailmance',`${locale} Android app name must remain Tailmance`);
}
assert.equal(pendingNotificationMarkers,0,'Current pending SQL notification producers must not contain hardcoded Turkish fallback copy');
assert.equal(runtimeEdgeNotificationMarkers,0,'Runtime vaccination notification worker must not contain hardcoded Turkish fallback copy');
console.log(`i18n-checks: 19 locales declared; release-ready=${ready.join(',')}; production hardcoded Turkish-character markers=${productionMarkers}; visible literal Text markers=${literalTextNodes}; demo-only markers=${demoMarkers}; native locale metadata=${nativeLocales.length}/19; historical SQL notification Turkish-character markers=${historicalNotificationMarkers}; pending SQL notification Turkish-character markers=${pendingNotificationMarkers}; runtime Edge notification Turkish-character markers=${runtimeEdgeNotificationMarkers}; PASS (runtime translation coverage COMPLETE 19/19)`);
if(hotspots.length)console.log('i18n-production-hotspots:',hotspots.slice(0,10).map(([n,f])=>`${f}:${n}`).join(', '));
