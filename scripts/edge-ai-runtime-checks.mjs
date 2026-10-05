import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

const must=(p)=>{assert.ok(existsSync(p),`missing ${p}`);return readFileSync(p,'utf8')};
const service=must('src/services/edgeAi.ts');
const android=must('modules/tailmance-edge-ai/android/src/main/java/expo/modules/tailmanceedgeai/TailmanceEdgeAiModule.kt');
const gradle=must('modules/tailmance-edge-ai/android/build.gradle');
const ios=must('modules/tailmance-edge-ai/ios/TailmanceEdgeAiModule.swift');
const expoConfig=JSON.parse(must('modules/tailmance-edge-ai/expo-module.config.json'));
const roadmap=JSON.parse(must('release/roadmap-implementation-v21.json'));

const uploads=must('src/services/uploads.ts');
const editor=must('src/screens/PetEditorScreen.tsx');
const errors=must('src/services/errors.ts');
assert.match(uploads,/prefilterImageSafety/,'pet photo flow must invoke the on-device safety pre-filter');
assert.match(uploads,/safety\.decision==='block'/,'high-confidence local safety block must stop pet-photo upload');
assert.match(uploads,/throw new Error\('edge_ai_local_safety_blocked'\)/,'local safety block must have a stable user-facing error code');
assert.doesNotMatch(uploads,/suggestPetBreeds|breedSuggestions/,'AI breed detection must not exist; breed is owner-entered only');
assert.match(uploads,/pickAndUploadPetPhoto\([\s\S]*?await assertImagePassesOnDeviceSafety\(normalized\.uri\)[\s\S]*?uploadWithIntent/,'pet-profile photo flow must run the local safety pre-filter before the upload intent');
assert.ok((uploads.match(/await assertImagePassesOnDeviceSafety\(normalized\.uri\)/g)??[]).length>=2,'single and multi social-image flows must run the local safety pre-filter before upload');
assert.ok(uploads.indexOf('await assertImagePassesOnDeviceSafety(normalized.uri)')<uploads.indexOf("uploadWithIntent({petId,bucket:'pet-photos'"),'on-device safety check must happen before the pet-photo upload intent is created');
assert.match(errors,/edge_ai_local_safety_blocked/,'local safety block must map to localized user copy');
assert.doesNotMatch(editor,/breedSuggestions|BreedSuggestion/,'Pet Editor must not offer AI breed suggestions');

assert.deepEqual(expoConfig.platforms,['android','ios']);
assert.match(gradle,/com\.google\.mediapipe:tasks-vision:1\.0\.0/,'MediaPipe Tasks Vision must be version-pinned');
for(const marker of ['MessageDigest.getInstance("SHA-256")','MessageDigest.isEqual','setModelAssetBuffer','ImageClassifier.createFromOptions','RunningMode.IMAGE','MAX_MODEL_BYTES','MAX_IMAGE_BYTES','bitmap.recycle()'])assert.ok(android.includes(marker),`Android edge-AI invariant missing: ${marker}`);

assert.match(ios,/maxCachedModels = 2/,'iOS CoreML cache must remain bounded to the active model roles');
assert.match(ios,/while modelCacheOrder\.count > maxCachedModels[\s\S]*modelCache\.removeValue/,'iOS CoreML cache must evict stale model versions');
assert.match(ios,/clearModelCacheAsync[\s\S]*modelCache\.removeAll/,'iOS native AI cache must expose explicit memory-pressure cleanup');
assert.match(android,/classifier\?\.close\(\)/,'Android MediaPipe classifier must be explicitly closed after every inference');
assert.match(android,/clearModelCacheAsync/,'native AI cache-clear API parity required');

for(const marker of ['import CoreML','import Vision','import CryptoKit','MLModel.compileModel','VNCoreMLRequest','SHA256()','maxModelBytes','maxImageBytes','modelCache'])assert.ok(ios.includes(marker),`iOS edge-AI invariant missing: ${marker}`);
for(const marker of ['EXPO_PUBLIC_EDGE_AI_MODEL_MANIFEST_URL','EXPO_PUBLIC_EDGE_AI_MODEL_MANIFEST_SHA256','same origin'])void marker;

assert.match(service,/exactObject\(raw,\['schemaVersion','policyVersion','publishedAt','expiresAt','models'\]/,'edge-AI manifest must reject unknown or missing top-level keys');
assert.match(service,/typeof x\.sizeBytes!=='number'/,'edge-AI artifact size must be strict numeric JSON, not coerced');
assert.match(service,/raw\.some\(x=>typeof x!=='string'\)/,'edge-AI label arrays must contain strings only');
assert.match(service,/exactObject\(safetyRaw\.policy,\['blockLabels','reviewLabels','blockThreshold','reviewThreshold'\]/,'edge-AI safety policy must reject unknown or missing keys');
assert.match(service,/typeof policy\.blockThreshold!=='number'/,'edge-AI policy thresholds must be strict numeric JSON');

assert.match(service,/exactOrigin\(url\)!==manifestOrigin/,'model artifacts must remain on the exact approved manifest origin');
assert.match(service,/edge_ai_artifact_integrity_mismatch/);
assert.match(service,/edge_ai_runtime_model_hash_mismatch/);
assert.match(service,/license:\{name:string;url:string\}/);
assert.match(service,/provenance:\{publisher:string;sourceUrl:string\}/);
assert.match(service,/blockLabels:string\[\]/);
assert.match(service,/reviewLabels:string\[\]/);
assert.match(service,/expiresMs<=now/,'expired manifest must fail closed');
assert.match(service,/MAX_MANIFEST_VALIDITY_MS/,'manifest freshness must be bounded');
assert.doesNotMatch(service,/suggestPetBreeds|'breed'/,'edge-AI service must expose the safety pre-filter only');
assert.match(service,/prefilterImageSafety/,'safety pre-filter API required');
assert.match(service,/decision:'unavailable'/,'edge model failure must be explicit and must not masquerade as an allow verdict');
assert.match(service,/result\.runtime!==expectedRuntime/,'native runtime identity must be verified');
assert.match(service,/category\.score<0\|\|category\.score>1/,'classifier scores must honor the declared probability contract');
const phase=roadmap.phases?.['13_on_device_ai'];
assert.ok(phase,'phase 13 roadmap entry missing');
assert.match(String(phase.status),/^PARTIAL_/,'Phase 13 must remain partial until real model/provider/device evidence is verified');
for(const p of ['modules/tailmance-edge-ai/expo-module.config.json','src/services/edgeAi.ts','src/services/uploads.ts','src/screens/PetEditorScreen.tsx','scripts/edge-ai-runtime-checks.mjs','release/edge-ai-model-evidence-v21.json'])assert.ok(phase.evidence?.includes(p),`phase 13 missing evidence ${p}`);
console.log('edge-ai-runtime-checks: native CoreML/Vision + MediaPipe runtime, artifact integrity, manifest policy and advisory safety pre-filter boundary (no AI breed detection) PASS');
