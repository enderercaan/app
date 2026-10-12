import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const value=name=>(process.env[name]??'').trim();
const host=value('EXPO_PUBLIC_APP_LINK_HOST').toLowerCase();
const teamId=value('APPLE_TEAM_ID').toUpperCase();
const fingerprintInput=value('ANDROID_APP_LINK_CERT_SHA256').toUpperCase();
const hostPattern=/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const fingerprintPattern=/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/;

assert.match(host,hostPattern,'EXPO_PUBLIC_APP_LINK_HOST must be a bare public DNS hostname');
assert.match(teamId,/^[A-Z0-9]{10}$/,'APPLE_TEAM_ID must be the exact 10-character Apple Developer Team ID');
const fingerprints=fingerprintInput.split(',').map(x=>x.trim()).filter(Boolean);
assert.ok(fingerprints.length>=1&&fingerprints.length<=5,'ANDROID_APP_LINK_CERT_SHA256 must contain 1-5 comma-separated SHA-256 signing fingerprints');
assert.equal(new Set(fingerprints).size,fingerprints.length,'ANDROID_APP_LINK_CERT_SHA256 contains duplicate fingerprints');
for(const fingerprint of fingerprints)assert.match(fingerprint,fingerprintPattern,'ANDROID_APP_LINK_CERT_SHA256 must use colon-separated uppercase SHA-256 certificate fingerprints');

const bundleId='tailmanceapp.wordpress.com';
const aasa={applinks:{details:[{appIDs:[`${teamId}.${bundleId}`],components:[
  {'/':'/pet/*','comment':'Tailmance pet-profile universal links'},
  {'/':'/reel/*','comment':'Tailmance Reel universal links'},
  {'/':'/story/*','comment':'Tailmance Story universal links'}
]}]}};
const assetLinks=[{relation:['delegate_permission/common.handle_all_urls'],target:{namespace:'android_app',package_name:bundleId,sha256_cert_fingerprints:fingerprints}}];
const outputs=[
  ['web/.well-known/apple-app-site-association',JSON.stringify(aasa,null,2)+'\n'],
  ['web/.well-known/assetlinks.json',JSON.stringify(assetLinks,null,2)+'\n']
];
const check=process.argv.includes('--check');
for(const [file,content] of outputs){
  if(check){
    assert.ok(existsSync(file),`${file} missing; run npm run generate:app-links with verified production association values`);
    assert.equal(readFileSync(file,'utf8'),content,`${file} is stale or does not match the verified production identity`);
  }else{
    mkdirSync(path.dirname(file),{recursive:true});
    writeFileSync(file,content);
  }
}
console.log(`app-link-associations: ${check?'PASS':'generated'} host=${host}; apple=${teamId}.${bundleId}; android_fingerprints=${fingerprints.length}`);
