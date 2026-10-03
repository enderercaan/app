import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const locales=['en','es','pt-BR','fr','de','it','ru','tr','ar','hi','id','ja','ko','zh-Hans','zh-Hant','nl','pl','th','vi'];
const missing=[];
for(const locale of locales){
  const path=`store/metadata/${locale}.json`;
  if(!existsSync(path)){missing.push(locale);continue;}
  const x=JSON.parse(readFileSync(path,'utf8'));
  assert.equal(x.locale,locale,`${path}: locale mismatch`);
  assert.ok(x.appName&&x.appName.length<=30,`${path}: appName must be 1-30 characters`);
  assert.ok(x.apple?.subtitle&&x.apple.subtitle.length<=30,`${path}: Apple subtitle must be <=30 characters`);
  assert.ok(x.apple?.promotionalText&&x.apple.promotionalText.length<=170,`${path}: Apple promotionalText must be <=170 characters`);
  assert.ok(x.apple?.description&&x.apple.description.length<=4000,`${path}: Apple description must be <=4000 characters`);
  assert.ok(x.apple?.keywords&&Buffer.byteLength(x.apple.keywords,'utf8')<=100,`${path}: Apple keywords must be <=100 bytes`);
  assert.ok(x.google?.shortDescription&&x.google.shortDescription.length<=80,`${path}: Google shortDescription must be <=80 characters`);
  assert.ok(x.google?.fullDescription&&x.google.fullDescription.length<=4000,`${path}: Google fullDescription must be <=4000 characters`);
  assert.ok(Array.isArray(x.screenshotCaptions)&&x.screenshotCaptions.length>=5,`${path}: at least 5 localized screenshot captions are required`);
  for(const caption of x.screenshotCaptions)assert.ok(typeof caption==='string'&&caption.trim().length>0,`${path}: screenshot captions must be non-empty`);
}
if(missing.length)throw new Error(`Store metadata is not release-ready. Missing locales (${missing.length}/${locales.length}): ${missing.join(', ')}`);
console.log(`store-metadata-release-check: ${locales.length}/${locales.length} localized store metadata sets validated`);
