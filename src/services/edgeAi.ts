import {Platform} from 'react-native';
import {File,Paths} from 'expo-file-system';
import NativeEdgeAi,{type EdgeAiCategory,type EdgeAiNativeResult} from '../../modules/tailmance-edge-ai';
import {env} from './config';
import {runBestEffortSync} from './bestEffort';

const SHA256_RE=/^[a-f0-9]{64}$/;
const MAX_MANIFEST_BYTES=256*1024;
const MAX_MODEL_BYTES=256*1024*1024;
const MAX_MANIFEST_VALIDITY_MS=180*24*60*60*1000;
const manifestFlights=new Map<string,Promise<EdgeAiModelManifest>>();
const modelFlights=new Map<string,Promise<File>>();

type EdgeAiModelRole='safety';
type EdgeAiPlatform='ios'|'android';
type ModelFormat='mlmodel'|'tflite'|'task';

type ModelArtifact={
  url:string;
  sha256:string;
  format:ModelFormat;
  sizeBytes:number;
};

type ModelDefinition={
  version:string;
  license:{name:string;url:string};
  provenance:{publisher:string;sourceUrl:string};
  platforms:{ios:ModelArtifact;android:ModelArtifact};
};

type SafetyPolicy={
  blockLabels:string[];
  reviewLabels:string[];
  blockThreshold:number;
  reviewThreshold:number;
};

type EdgeAiModelManifest={
  schemaVersion:1;
  policyVersion:string;
  publishedAt:string;
  expiresAt:string;
  models:{
    safety:ModelDefinition&{policy:SafetyPolicy};
  };
};

type SafetyPrefilterDecision={
  decision:'allow'|'review'|'block'|'unavailable';
  reason?:string;
  matchedLabel?:string;
  confidence?:number;
  modelVersion?:string;
  policyVersion?:string;
};

function isHttpsUrl(input:string){
  try{const u=new URL(input);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash;}catch{return false}
}
function exactOrigin(input:string){const u=new URL(input);return `${u.protocol}//${u.host}`}
function normalizedHash(input:string){const x=input.trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error('edge_ai_sha256_invalid');return x}
function modelCacheFile(hash:string,format:ModelFormat){return new File(Paths.cache,`tailmance-edge-ai-model-${hash}.${format}`)}
function manifestCacheFile(hash:string){return new File(Paths.cache,`tailmance-edge-ai-manifest-${hash}.json`)}

async function deleteQuietly(file:File){runBestEffortSync('edge_ai_cache_delete',()=>{if(file.exists)file.delete()})}
async function verifyFile(file:File,expectedHash:string,maxBytes:number,expectedSize?:number){
  if(!NativeEdgeAi)throw new Error('edge_ai_native_runtime_unavailable');
  if(!file.exists||file.size<=0||file.size>maxBytes)throw new Error('edge_ai_artifact_size_invalid');
  if(expectedSize!=null&&file.size!==expectedSize)throw new Error('edge_ai_artifact_size_mismatch');
  const actual=(await NativeEdgeAi.sha256FileAsync(file.uri)).trim().toLowerCase();
  if(actual!==expectedHash)throw new Error('edge_ai_artifact_integrity_mismatch');
}

async function downloadVerifiedFile(url:string,destination:File,expectedHash:string,maxBytes:number,expectedSize?:number){
  if(destination.exists){
    try{await verifyFile(destination,expectedHash,maxBytes,expectedSize);return destination}catch{await deleteQuietly(destination)}
  }
  try{
    await File.downloadFileAsync(url,destination,{idempotent:true});
    await verifyFile(destination,expectedHash,maxBytes,expectedSize);
    return destination;
  }catch(error){
    await deleteQuietly(destination);
    throw error;
  }
}

function exactObject(raw:unknown,keys:readonly string[],code:string){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error(code);
  const x=raw as Record<string,unknown>;
  const actual=Object.keys(x);
  if(actual.length!==keys.length||actual.some(key=>!keys.includes(key)))throw new Error(code);
  return x;
}

function validateArtifact(raw:unknown,platform:EdgeAiPlatform,manifestOrigin:string):ModelArtifact{
  const x=exactObject(raw,['url','sha256','format','sizeBytes'],'edge_ai_manifest_artifact_invalid');
  if(typeof x.url!=='string'||typeof x.sha256!=='string'||typeof x.format!=='string'||typeof x.sizeBytes!=='number')throw new Error('edge_ai_manifest_artifact_invalid');
  const url=x.url.trim();
  const sha256=normalizedHash(x.sha256);
  const format=x.format as ModelFormat;
  const sizeBytes=x.sizeBytes;
  if(!isHttpsUrl(url)||exactOrigin(url)!==manifestOrigin)throw new Error('edge_ai_manifest_model_origin_invalid');
  if(platform==='ios'&&format!=='mlmodel')throw new Error('edge_ai_manifest_ios_format_invalid');
  if(platform==='android'&&!['tflite','task'].includes(format))throw new Error('edge_ai_manifest_android_format_invalid');
  if(!Number.isInteger(sizeBytes)||sizeBytes<=0||sizeBytes>MAX_MODEL_BYTES)throw new Error('edge_ai_manifest_model_size_invalid');
  return{url,sha256,format,sizeBytes};
}

function validateLabels(raw:unknown,name:string){
  if(!Array.isArray(raw)||raw.length===0||raw.length>256||raw.some(x=>typeof x!=='string'))throw new Error(`edge_ai_manifest_${name}_labels_invalid`);
  const labels=(raw as string[]).map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(labels.length!==raw.length||new Set(labels).size!==labels.length||labels.some(x=>x.length>128))throw new Error(`edge_ai_manifest_${name}_labels_invalid`);
  return labels;
}

function validateModelDefinition(raw:unknown,manifestOrigin:string,allowPolicy=false):ModelDefinition{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('edge_ai_manifest_model_invalid');
  const x=raw as Record<string,unknown>;
  const modelKeys=allowPolicy?['version','license','provenance','platforms','policy']:['version','license','provenance','platforms'];
  if(Object.keys(x).length!==modelKeys.length||Object.keys(x).some(key=>!modelKeys.includes(key)))throw new Error('edge_ai_manifest_model_invalid');
  if(typeof x.version!=='string')throw new Error('edge_ai_manifest_model_version_invalid');
  const version=x.version.trim();
  const license=exactObject(x.license,['name','url'],'edge_ai_manifest_license_invalid');
  const provenance=exactObject(x.provenance,['publisher','sourceUrl'],'edge_ai_manifest_provenance_invalid');
  const platforms=exactObject(x.platforms,['ios','android'],'edge_ai_manifest_platforms_missing');
  if(!/^[0-9A-Za-z._-]{1,80}$/.test(version))throw new Error('edge_ai_manifest_model_version_invalid');
  if(typeof license.name!=='string'||typeof license.url!=='string')throw new Error('edge_ai_manifest_license_invalid');
  if(typeof provenance.publisher!=='string'||typeof provenance.sourceUrl!=='string')throw new Error('edge_ai_manifest_provenance_invalid');
  const licenseName=license.name.trim();
  const licenseUrl=license.url.trim();
  const publisher=provenance.publisher.trim();
  const sourceUrl=provenance.sourceUrl.trim();
  if(!licenseName||licenseName.length>160||!isHttpsUrl(licenseUrl))throw new Error('edge_ai_manifest_license_invalid');
  if(!publisher||publisher.length>160||!isHttpsUrl(sourceUrl))throw new Error('edge_ai_manifest_provenance_invalid');
  return{
    version,
    license:{name:licenseName,url:licenseUrl},
    provenance:{publisher,sourceUrl},
    platforms:{
      ios:validateArtifact(platforms.ios,'ios',manifestOrigin),
      android:validateArtifact(platforms.android,'android',manifestOrigin)
    }
  };
}

function validateManifest(raw:unknown,manifestUrl:string):EdgeAiModelManifest{
  const x=exactObject(raw,['schemaVersion','policyVersion','publishedAt','expiresAt','models'],'edge_ai_manifest_invalid');
  if(x.schemaVersion!==1)throw new Error('edge_ai_manifest_schema_unsupported');
  if(typeof x.policyVersion!=='string'||typeof x.publishedAt!=='string'||typeof x.expiresAt!=='string')throw new Error('edge_ai_manifest_invalid');
  const policyVersion=x.policyVersion.trim();
  if(!/^[0-9A-Za-z._-]{1,80}$/.test(policyVersion))throw new Error('edge_ai_manifest_policy_version_invalid');
  const publishedAt=x.publishedAt; const expiresAt=x.expiresAt;
  const publishedMs=Date.parse(publishedAt); const expiresMs=Date.parse(expiresAt); const now=Date.now();
  if(!Number.isFinite(publishedMs)||!Number.isFinite(expiresMs)||publishedMs>now+5*60_000||expiresMs<=now||expiresMs<=publishedMs||expiresMs-publishedMs>MAX_MANIFEST_VALIDITY_MS)throw new Error('edge_ai_manifest_validity_invalid');
  const models=exactObject(x.models,['safety'],'edge_ai_manifest_models_missing');
  const origin=exactOrigin(manifestUrl);
  const safetyBase=validateModelDefinition(models.safety,origin,true);
  const safetyRaw=models.safety as Record<string,unknown>;
  const policy=exactObject(safetyRaw.policy,['blockLabels','reviewLabels','blockThreshold','reviewThreshold'],'edge_ai_manifest_safety_policy_missing');
  const blockLabels=validateLabels(policy.blockLabels,'block');
  const reviewLabels=validateLabels(policy.reviewLabels,'review');
  if(blockLabels.some(x=>reviewLabels.includes(x)))throw new Error('edge_ai_manifest_safety_labels_overlap');
  if(typeof policy.blockThreshold!=='number'||typeof policy.reviewThreshold!=='number')throw new Error('edge_ai_manifest_safety_thresholds_invalid');
  const blockThreshold=policy.blockThreshold; const reviewThreshold=policy.reviewThreshold;
  if(!Number.isFinite(blockThreshold)||!Number.isFinite(reviewThreshold)||reviewThreshold<0||blockThreshold>1||reviewThreshold>blockThreshold)throw new Error('edge_ai_manifest_safety_thresholds_invalid');
  return{
    schemaVersion:1,policyVersion,publishedAt,expiresAt,
    models:{safety:{...safetyBase,policy:{blockLabels,reviewLabels,blockThreshold,reviewThreshold}}}
  };
}

function isEdgeAiConfigured(){
  return Boolean(isHttpsUrl(env.edgeAiManifestUrl)&&SHA256_RE.test(env.edgeAiManifestSha256));
}

async function getEdgeAiManifest(){
  if(Platform.OS==='web')throw new Error('edge_ai_native_runtime_required');
  if(!NativeEdgeAi||!(await NativeEdgeAi.isRuntimeAvailableAsync()))throw new Error('edge_ai_native_runtime_unavailable');
  if(!isEdgeAiConfigured())throw new Error('edge_ai_manifest_not_configured');
  const url=env.edgeAiManifestUrl;
  const hash=normalizedHash(env.edgeAiManifestSha256);
  const key=`${url}|${hash}`;
  const existing=manifestFlights.get(key); if(existing)return existing;
  const promise=(async()=>{
    const file=await downloadVerifiedFile(url,manifestCacheFile(hash),hash,MAX_MANIFEST_BYTES);
    if(file.size>MAX_MANIFEST_BYTES)throw new Error('edge_ai_manifest_too_large');
    let parsed:unknown; try{parsed=JSON.parse(await file.text())}catch{throw new Error('edge_ai_manifest_json_invalid')}
    return validateManifest(parsed,url);
  })();
  manifestFlights.set(key,promise);
  try{return await promise}finally{manifestFlights.delete(key)}
}

async function getModelFile(role:EdgeAiModelRole,manifest:EdgeAiModelManifest){
  const platform=Platform.OS as EdgeAiPlatform;
  if(platform!=='ios'&&platform!=='android')throw new Error('edge_ai_native_runtime_required');
  const artifact=manifest.models[role].platforms[platform];
  const key=`${artifact.url}|${artifact.sha256}`;
  const existing=modelFlights.get(key);if(existing)return existing;
  const promise=downloadVerifiedFile(artifact.url,modelCacheFile(artifact.sha256,artifact.format),artifact.sha256,artifact.sizeBytes,artifact.sizeBytes);
  modelFlights.set(key,promise);
  try{return await promise}finally{modelFlights.delete(key)}
}

function validateNativeResult(result:EdgeAiNativeResult,artifact:ModelArtifact,platform:EdgeAiPlatform){
  if(result.modelSha256.toLowerCase()!==artifact.sha256)throw new Error('edge_ai_runtime_model_hash_mismatch');
  const expectedRuntime=platform==='ios'?'coreml-vision':'mediapipe-tasks-vision';
  if(result.runtime!==expectedRuntime)throw new Error('edge_ai_runtime_identity_mismatch');
  if(!Array.isArray(result.categories)||result.categories.length>20)throw new Error('edge_ai_classifier_output_invalid');
  for(const category of result.categories){
    if(!category||typeof category.label!=='string'||!category.label.trim()||category.label.length>256||!Number.isFinite(category.score)||category.score<0||category.score>1||!Number.isInteger(category.index))throw new Error('edge_ai_classifier_output_invalid');
  }
}

async function classify(role:EdgeAiModelRole,imageUri:string,maxResults:number,scoreThreshold:number,providedManifest?:EdgeAiModelManifest):Promise<{manifest:EdgeAiModelManifest;modelVersion:string;result:EdgeAiNativeResult}>{
  if(!NativeEdgeAi)throw new Error('edge_ai_native_runtime_unavailable');
  const manifest=providedManifest??await getEdgeAiManifest();
  const model=manifest.models[role];
  const file=await getModelFile(role,manifest);
  const platform=Platform.OS as EdgeAiPlatform;
  const artifact=model.platforms[platform];
  const result=await NativeEdgeAi.classifyImageAsync(file.uri,artifact.sha256,imageUri,maxResults,scoreThreshold);
  validateNativeResult(result,artifact,platform);
  return{manifest,modelVersion:model.version,result};
}

export async function prefilterImageSafety(imageUri:string):Promise<SafetyPrefilterDecision>{
  try{
    const manifest=await getEdgeAiManifest();
    const {modelVersion,result}=await classify('safety',imageUri,20,manifestSafetyFloor(manifest),manifest);
    const policy=manifest.models.safety.policy;
    const categories=result.categories.map(normalizeCategory);
    for(const category of categories){
      if(policy.blockLabels.includes(category.label)&&category.score>=policy.blockThreshold)return{decision:'block',matchedLabel:category.label,confidence:category.score,modelVersion,policyVersion:manifest.policyVersion};
    }
    for(const category of categories){
      if((policy.reviewLabels.includes(category.label)||policy.blockLabels.includes(category.label))&&category.score>=policy.reviewThreshold)return{decision:'review',matchedLabel:category.label,confidence:category.score,modelVersion,policyVersion:manifest.policyVersion};
    }
    return{decision:'allow',modelVersion,policyVersion:manifest.policyVersion};
  }catch(error){
    return{decision:'unavailable',reason:String((error as Error)?.message??'edge_ai_unavailable')};
  }
}

function manifestSafetyFloor(manifest:EdgeAiModelManifest){return Math.min(manifest.models.safety.policy.reviewThreshold,manifest.models.safety.policy.blockThreshold)}
function normalizeCategory(category:EdgeAiCategory){return{label:String(category.label??'').trim().toLowerCase(),score:Number(category.score)}}

export async function clearEdgeAiModelCache(){
  if(Platform.OS==='web'||!NativeEdgeAi)return;
  await NativeEdgeAi.clearModelCacheAsync();
}
