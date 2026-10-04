import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

function keys(path){
  const text=readFileSync(path,'utf8');
  const found=[...text.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)].map(m=>({key:m[1],value:m[2]}));
  assert.equal(new Set(found.map(x=>x.key)).size,found.length,`${path} must not contain duplicate keys`);
  return found;
}
function exact(path,expected){
  const actual=keys(path).map(x=>x.key).sort();
  assert.deepEqual(actual,[...new Set(expected)].sort(),`${path} environment surface drift`);
}

const clientRuntime=readFileSync('src/services/config.ts','utf8');
assert.doesNotMatch(clientRuntime,/process\.env\s*\[/,'Expo client env must use static dot access for Metro inlining');
const require=createRequire(import.meta.url);
let babel;
let preset;
try{babel=require('@babel/core');preset=require.resolve('babel-preset-expo')}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
if(babel&&preset){
  const previous=process.env.EXPO_PUBLIC_SUPABASE_URL;
  const sentinel='https://tailmance-local-env-inlining-validation.invalid';
  try{
    process.env.EXPO_PUBLIC_SUPABASE_URL=sentinel;
    const result=babel.transformSync(clientRuntime,{filename:'src/services/config.ts',babelrc:false,configFile:false,presets:[preset],caller:{name:'metro',bundler:'metro',platform:'ios',isDev:false}});
    assert.ok(result.code.includes(sentinel),'Expo Babel must inline the configured public backend URL');
    assert.doesNotMatch(result.code,/process\.env\s*(?:\[|\.EXPO_PUBLIC_)/,'public client variables must be replaced in the production transform');
    console.log('environment-inlining: real Expo Babel production transform PASS (local synthetic URL; no live backend request)');
  }finally{if(previous===undefined)delete process.env.EXPO_PUBLIC_SUPABASE_URL;else process.env.EXPO_PUBLIC_SUPABASE_URL=previous;}
}else{console.log('environment-inlining: static contract PASS; Expo Babel runtime transform unavailable without installed dependencies');}
const appConfig=readFileSync('app.config.ts','utf8');
const releaseConfig=readFileSync('scripts/release-config-check.mjs','utf8');
const appLinkGenerator=readFileSync('scripts/generate-app-link-associations.mjs','utf8');
const clientExpected=new Set();
for(const source of [clientRuntime,appConfig])for(const m of source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g))clientExpected.add(m[1]);
for(const m of appLinkGenerator.matchAll(/value\(['"]([A-Z][A-Z0-9_]*)['"]\)/g))clientExpected.add(m[1]);
for(const m of clientRuntime.matchAll(/value\(['"]([A-Z][A-Z0-9_]*)['"]\)/g))clientExpected.add(m[1]);
const requiredBlock=releaseConfig.match(/const required\s*=\s*\[(.*?)\];/s)?.[1]??'';
for(const m of requiredBlock.matchAll(/'([A-Z][A-Z0-9_]*)'/g))clientExpected.add(m[1]);
exact('.env.example',clientExpected);

const webGenerator=readFileSync('scripts/generate-web-runtime-config.mjs','utf8');
const webExpected=new Set([...webGenerator.matchAll(/'((?:TAILMANCE_WEB_)[A-Z0-9_]*)'/g)].map(m=>m[1]));
exact('web/.env.example',webExpected);

const countryRelease=readFileSync('scripts/country-release-check.mjs','utf8');
assert.match(countryRelease,/TAILMANCE_TARGET_COUNTRIES/);
exact('release/.env.example',['TAILMANCE_TARGET_COUNTRIES']);

const serverTemplate=keys('supabase/.env.example');
assert.ok(serverTemplate.some(x=>x.key==='SUPABASE_AUTH_CAPTCHA_SECRET'),'supabase/.env.example must document hosted Auth CAPTCHA secret');
const serverSensitive=serverTemplate.filter(x=>/(?:SECRET|KEY|AUTH|TOKEN|SERVICE_ACCOUNT_JSON)$/.test(x.key));
for(const {key,value} of serverSensitive)assert.ok(value===''||value==='{}'||value==='[]',`supabase/.env.example must not contain a real-looking secret for ${key}`);

// Consumable credit products: the client template and the server credit authority must describe exactly the same product IDs.
const templateValue=(path,key)=>(readFileSync(path,'utf8').match(new RegExp(`^${key}=(.*)$`,'m'))?.[1]??'').trim();
const consumableMap=JSON.parse(templateValue('supabase/.env.example','REVENUECAT_CONSUMABLE_PRODUCTS_JSON')||'{}');
const clientBoost=templateValue('.env.example','EXPO_PUBLIC_REVENUECAT_BOOST_PRODUCT_IDS').split(',').filter(Boolean);
const clientSuper=templateValue('.env.example','EXPO_PUBLIC_REVENUECAT_SUPER_LIKE_PRODUCT_IDS').split(',').filter(Boolean);
assert.ok(clientBoost.length&&clientSuper.length,'.env.example must list boost and super-like product IDs');
assert.deepEqual(Object.keys(consumableMap).sort(),[...clientBoost,...clientSuper].sort(),'server consumable map must contain exactly the client product IDs');
for(const id of clientBoost)assert.equal(consumableMap[id]?.kind,'boost',`${id} must be a boost on the server`);
for(const id of clientSuper)assert.equal(consumableMap[id]?.kind,'super_like',`${id} must be a super_like on the server`);
for(const id of Object.keys(consumableMap))assert.ok(Number.isInteger(consumableMap[id].quantity)&&consumableMap[id].quantity>0,`${id} must grant a positive integer quantity`);

console.log(`environment-template-checks: client=${clientExpected.size}, server=${serverTemplate.length}, web=${webExpected.size}, release=1 surfaces synchronized`);
