import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extname, join, relative } from 'node:path';

const ROOT=process.cwd();
const ASSET_DIR=join(ROOT,'assets');
const MAX_SINGLE_STATIC_ASSET_BYTES=1_000_000;
const MAX_STATIC_ASSET_TOTAL_BYTES=5_000_000;
const FORBIDDEN_BUNDLED_MEDIA_EXTENSIONS=new Set(['.mp4','.mov','.m4v','.avi','.mkv','.webm','.onnx','.tflite','.mlmodel','.mlpackage','.pt','.pth','.bin']);

function walk(dir){
  const out=[];
  for(const entry of readdirSync(dir,{withFileTypes:true})){
    const full=join(dir,entry.name);
    if(entry.isDirectory())out.push(...walk(full));
    else if(entry.isFile())out.push(full);
  }
  return out;
}

const assetFiles=walk(ASSET_DIR);
let totalBytes=0;
for(const file of assetFiles){
  const size=statSync(file).size;
  totalBytes+=size;
  assert.ok(size<=MAX_SINGLE_STATIC_ASSET_BYTES,`static asset exceeds ${MAX_SINGLE_STATIC_ASSET_BYTES} bytes: ${relative(ROOT,file)} (${size})`);
  assert.ok(!FORBIDDEN_BUNDLED_MEDIA_EXTENSIONS.has(extname(file).toLowerCase()),`large/runtime media or model must not be bundled in source assets: ${relative(ROOT,file)}`);
}
assert.ok(totalBytes<=MAX_STATIC_ASSET_TOTAL_BYTES,`static assets total exceeds ${MAX_STATIC_ASSET_TOTAL_BYTES} bytes: ${totalBytes}`);

const assetHashes=new Map();
for(const file of assetFiles){
  const hash=createHash('sha256').update(readFileSync(file)).digest('hex');
  const existing=assetHashes.get(hash);
  if(existing)assert.fail(`duplicate static assets waste bundle space: ${relative(ROOT,existing)} and ${relative(ROOT,file)}`);
  assetHashes.set(hash,file);
}

for(const root of ['src','assets']){
  for(const file of walk(join(ROOT,root))){
    const ext=extname(file).toLowerCase();
    assert.ok(!FORBIDDEN_BUNDLED_MEDIA_EXTENSIONS.has(ext),`runtime-heavy binary/model checked into ${root}: ${relative(ROOT,file)}`);
  }
}

const uploads=readFileSync(join(ROOT,'src/services/uploads.ts'),'utf8');
assert.match(uploads,/const MAX_SOCIAL_IMAGE_EDGE = 2048;/);
assert.match(uploads,/format:NormalizedImageFormat='jpeg'/);
assert.match(uploads,/format==='webp'\?ImageManipulator\.SaveFormat\.WEBP:ImageManipulator\.SaveFormat\.JPEG/);
assert.match(uploads,/compress:format==='webp'\?\.84:\.88/);
assert.match(uploads,/mimeType:'image\/webp'[\s\S]*extension:'webp'/);
assert.match(uploads,/export async function pickAndUploadPetPhoto[\s\S]*privacyNormalizeImage\(asset\.uri,asset\.width,asset\.height,'webp'\)/);
assert.match(uploads,/export async function pickAndUploadSocialImage[\s\S]*privacyNormalizeImage\(asset\.uri,asset\.width,asset\.height,'webp'\)/);
assert.match(uploads,/export async function pickAndUploadHealthDocument[\s\S]*normalized=isImageMime\(mime\)\?await privacyNormalizeImage\(asset\.uri\)/);
assert.match(uploads,/export async function captureAndSubmitPetVerification[\s\S]*privacyNormalizeImage\(asset\.uri,asset\.width,asset\.height\)/);
assert.match(uploads,/ImageManipulator\.manipulateAsync/);

const healthSlices=[...uploads.matchAll(/privacyNormalizeImage\(([^;]+)\);/g)].map(m=>m[0]);
assert.ok(healthSlices.length>=4,'expected multiple privacy-normalized upload paths');

console.log(`asset-optimization-checks: ${assetFiles.length} static assets / ${totalBytes} bytes + WebP social/JPEG health privacy normalization PASS`);
