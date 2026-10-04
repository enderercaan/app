import * as ImagePicker from 'expo-image-picker';
import { runBestEffort } from './bestEffort';
import * as DocumentPicker from 'expo-document-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import { supabase } from './supabase';
import { cancelUploadIntent, createUploadIntent, submitPetVerification } from './api';
import { getRuntimeLocale, translate } from '../i18n';
import { confirmPrePermission } from './permissionPrompts';
import { clearDurableClientOperation, getOrCreateDurableClientOperation } from './clientOperation';
import { prefilterImageSafety } from './edgeAi';

type ImageSource = 'camera' | 'library';

type PetPhotoUploadResult={
  path:string;
};

async function assertImagePassesOnDeviceSafety(uri:string) {
  const safety=await prefilterImageSafety(uri);
  if(safety.decision==='block')throw new Error('edge_ai_local_safety_blocked');
  // Review/allow/unavailable outcomes never grant moderation approval. Every uploaded
  // asset still goes through the authoritative server-side moderation pipeline.
  return safety;
}

const IMAGE_MIMES = ['image/jpeg','image/png','image/webp','image/heic','image/heif'];

const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const HEALTH_MAX_BYTES = 15 * 1024 * 1024;
const REEL_MAX_BYTES = 40 * 1024 * 1024;
const REEL_MAX_DURATION_MS = 60_000;
const VIDEO_MIMES = ['video/mp4','video/quicktime'] as const;
const MAX_UPLOAD_IMAGE_EDGE = 2400;
const MAX_SOCIAL_IMAGE_EDGE = 2048;
function uploadMaxBytes(bucket:string,contentType?:string){if(contentType?.startsWith('video/'))return REEL_MAX_BYTES;return bucket==='health-documents'?HEALTH_MAX_BYTES:IMAGE_MAX_BYTES}
function uploadTooLargeKey(bucket:string,contentType?:string){if(contentType?.startsWith('video/'))return 'upload.videoTooLarge';return bucket==='health-documents'?'upload.healthTooLarge':'upload.photoTooLarge'}

function isImageMime(mimeType:string){return mimeType.startsWith('image/')}

type NormalizedImageFormat='jpeg'|'webp';

async function privacyNormalizeImage(uri:string,width?:number|null,height?:number|null,format:NormalizedImageFormat='jpeg'){
  const longest=Math.max(Number(width)||0,Number(height)||0);
  const targetEdge=format==='webp'?MAX_SOCIAL_IMAGE_EDGE:MAX_UPLOAD_IMAGE_EDGE;
  const actions:ImageManipulator.Action[]=[];
  if(longest>targetEdge){
    if((Number(width)||0)>=(Number(height)||0))actions.push({resize:{width:targetEdge}});
    else actions.push({resize:{height:targetEdge}});
  }
  // Re-encoding into a fresh cache file strips source-container metadata such as EXIF/GPS.
  // Social/profile media use WebP for transfer/cache efficiency; health/verification images
  // stay JPEG for the broadest downstream document/OCR/provider compatibility.
  const saveFormat=format==='webp'?ImageManipulator.SaveFormat.WEBP:ImageManipulator.SaveFormat.JPEG;
  const result=await ImageManipulator.manipulateAsync(uri,actions,{compress:format==='webp'?.84:.88,format:saveFormat});
  return format==='webp'
    ?{uri:result.uri,mimeType:'image/webp' as const,extension:'webp' as const}
    :{uri:result.uri,mimeType:'image/jpeg' as const,extension:'jpg' as const};
}

async function uploadUri(bucket: string, path: string, uri: string, contentType: string) {
  const maxBytes=uploadMaxBytes(bucket,contentType);
  if(Platform.OS!=='web'){
    const file=new File(uri);
    if(!file.exists||file.size<=0)throw new Error(translate(getRuntimeLocale(),'upload.fileReadFailed'));
    if(file.size>maxBytes)throw new Error(translate(getRuntimeLocale(),uploadTooLargeKey(bucket,contentType)));
    const {data:signed,error:signError}=await supabase.storage.from(bucket).createSignedUploadUrl(path);
    if(signError||!signed?.signedUrl)throw signError??new Error(translate(getRuntimeLocale(),'upload.fileReadFailed'));
    const response=await expoFetch(signed.signedUrl,{method:'PUT',headers:{'content-type':contentType,'cache-control':'max-age=3600','x-upsert':'false'},body:file});
    if(!response.ok)throw new Error(translate(getRuntimeLocale(),'upload.fileReadFailed'));
    return path;
  }
  const response = await fetch(uri);
  if (!response.ok) throw new Error(translate(getRuntimeLocale(),'upload.fileReadFailed'));
  const declaredLength=Number(response.headers.get('content-length'));
  if(Number.isFinite(declaredLength)&&declaredLength>maxBytes)throw new Error(translate(getRuntimeLocale(),uploadTooLargeKey(bucket,contentType)));
  const blob = await response.blob();
  if(blob.size<=0)throw new Error(translate(getRuntimeLocale(),'upload.fileReadFailed'));
  if(blob.size>maxBytes)throw new Error(translate(getRuntimeLocale(),uploadTooLargeKey(bucket,contentType)));
  const { error } = await supabase.storage.from(bucket).upload(path, blob, { contentType, upsert: false });
  if (error) throw error;
  return path;
}

async function pickImage(source: ImageSource, allowsEditing: boolean, aspect?: [number, number]) {
  if (source === 'camera') {
    let permission=await ImagePicker.getCameraPermissionsAsync();
    if(!permission.granted){
      const proceed=await confirmPrePermission('camera');
      if(!proceed)return {canceled:true,assets:null} as const;
      permission = await ImagePicker.requestCameraPermissionsAsync();
    }
    if (!permission.granted) throw new Error(translate(getRuntimeLocale(),'upload.cameraPermissionDenied'));
    return ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing, aspect });
  }
  // The system photo picker grants access only to the assets the user selects; do not
  // request broad media-library access for image-only selection.
  return ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing, aspect });
}

function safeExtension(fileName?: string | null, mimeType?: string | null) {
  const fromName = fileName?.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (fromName && fromName.length <= 5) return fromName;
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/heic') return 'heic';
  if (mimeType === 'image/heif') return 'heif';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'video/mp4') return 'mp4';
  if (mimeType === 'video/quicktime') return 'mov';
  return 'jpg';
}

function assertImage(asset:{fileSize?:number|null;mimeType?:string|null}) {
  if (asset.fileSize && asset.fileSize > IMAGE_MAX_BYTES) throw new Error(translate(getRuntimeLocale(),'upload.photoTooLarge'));
  if (asset.mimeType && !IMAGE_MIMES.includes(asset.mimeType)) throw new Error(translate(getRuntimeLocale(),'upload.photoUnsupported'));
}

async function uploadWithIntent(input:{petId:string;bucket:'pet-photos'|'social-media'|'health-documents'|'pet-verification';purpose:string;uri:string;mimeType:string;extension:string}) {
  // Bind allocation to the selected local asset. If the RPC commits but its response is
  // lost, the same in-flight/retried asset reuses the server receipt instead of creating
  // a second orphan intent. The durable store persists only a fixed-length fingerprint.
  const operation=await getOrCreateDurableClientOperation('upload-intent',[input.petId,input.bucket,input.purpose,input.mimeType,input.extension,input.uri]);
  const intent=await createUploadIntent({petId:input.petId,bucket:input.bucket,purpose:input.purpose,mimeType:input.mimeType,extension:input.extension,operationId:operation.id});
  await clearDurableClientOperation(operation.key,operation.id);
  try { await uploadUri(input.bucket,intent.path,input.uri,input.mimeType); return intent; }
  catch (error) { await runBestEffort('upload_cancel_intent',()=>cancelUploadIntent(intent.id)); throw error; }
}

export async function pickAndUploadPetPhoto(petId: string, sortOrder: 1 | 2 | 3, source: ImageSource = 'library'):Promise<PetPhotoUploadResult|null> {
  const result = await pickImage(source, true, [4, 5]);
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0]; assertImage(asset);
  const normalized=await privacyNormalizeImage(asset.uri,asset.width,asset.height,'webp');
  await assertImagePassesOnDeviceSafety(normalized.uri);
  const intent = await uploadWithIntent({petId,bucket:'pet-photos',purpose:`pet_photo_${sortOrder}`,uri:normalized.uri,mimeType:normalized.mimeType,extension:normalized.extension});
  try {
    const { error } = await supabase.rpc('attach_pet_photo', { p_pet_id: petId, p_storage_path: intent.path, p_sort_order: sortOrder });
    if (error) throw error; return {path:intent.path};
  } catch(error) { await runBestEffort('upload_cancel_intent',()=>cancelUploadIntent(intent.id)); throw error; }
}

export async function pickAndUploadPetPhotos(petId:string, slots:Array<1|2|3>) {
  const uniqueSlots=[...new Set(slots)].filter((slot):slot is 1|2|3=>slot===1||slot===2||slot===3).slice(0,3);
  if(!uniqueSlots.length)return {uploaded:0,failed:0};
  const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],quality:.85,allowsMultipleSelection:true,selectionLimit:uniqueSlots.length,orderedSelection:true});
  if(result.canceled)return {uploaded:0,failed:0};
  const assets=result.assets.slice(0,uniqueSlots.length);assets.forEach(assertImage);
  let uploaded=0; let failed=0; let firstError:unknown=null;
  for(let index=0;index<assets.length;index++){
    const asset=assets[index];const sortOrder=uniqueSlots[index];if(!asset||!sortOrder)continue;
    try{
      const normalized=await privacyNormalizeImage(asset.uri,asset.width,asset.height,'webp');
      await assertImagePassesOnDeviceSafety(normalized.uri);
      const intent=await uploadWithIntent({petId,bucket:'pet-photos',purpose:`pet_photo_${sortOrder}`,uri:normalized.uri,mimeType:normalized.mimeType,extension:normalized.extension});
      try{
        const {error}=await supabase.rpc('attach_pet_photo',{p_pet_id:petId,p_storage_path:intent.path,p_sort_order:sortOrder});
        if(error)throw error;
        uploaded++;
      }catch(error){await runBestEffort('upload_cancel_intent',()=>cancelUploadIntent(intent.id)); throw error}
    }catch(error){failed++;firstError??=error}
  }
  if(!uploaded&&failed&&firstError)throw firstError;
  return {uploaded,failed};
}

export async function pickAndUploadHealthDocument(petId: string, documentType: string) {
  const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false, type: ['application/pdf', 'image/*'] });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  if (asset.size && asset.size > HEALTH_MAX_BYTES) throw new Error(translate(getRuntimeLocale(),'upload.healthTooLarge'));
  const allowed = ['application/pdf',...IMAGE_MIMES];
  if (asset.mimeType && !allowed.includes(asset.mimeType)) throw new Error(translate(getRuntimeLocale(),'upload.healthUnsupported'));
  const mime=asset.mimeType ?? 'application/pdf';
  const normalized=isImageMime(mime)?await privacyNormalizeImage(asset.uri):{uri:asset.uri,mimeType:mime,extension:safeExtension(asset.name,mime)};
  const intent=await uploadWithIntent({petId,bucket:'health-documents',purpose:'health_document',uri:normalized.uri,mimeType:normalized.mimeType,extension:normalized.extension});
  try { const {error}=await supabase.rpc('attach_health_document',{p_pet_id:petId,p_document_type:documentType,p_storage_path:intent.path}); if(error)throw error; return intent.path; }
  catch(error){await runBestEffort('upload_cancel_intent',()=>cancelUploadIntent(intent.id)); throw error}
}

export async function pickAndUploadSocialImage(petId: string, source: ImageSource = 'library', purpose:'post_media'|'story_media'='post_media') {
  const result = await pickImage(source, false);
  if (result.canceled || !result.assets[0]) return null;
  const asset=result.assets[0]; assertImage(asset);
  const normalized=await privacyNormalizeImage(asset.uri,asset.width,asset.height,'webp');
  await assertImagePassesOnDeviceSafety(normalized.uri);
  const intent=await uploadWithIntent({petId,bucket:'social-media',purpose,uri:normalized.uri,mimeType:normalized.mimeType,extension:normalized.extension});
  return {...intent,uri:normalized.uri};
}

export async function pickAndUploadSocialImages(petId:string,max=5) {
  const safeMax=Math.min(5,Math.max(1,Math.trunc(max)||1));
  const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],quality:.85,allowsMultipleSelection:true,selectionLimit:safeMax,orderedSelection:true});
  if(result.canceled) return [];
  const assets=result.assets.slice(0,safeMax); assets.forEach(assertImage);
  const uploaded=[] as Array<{id:string;path:string;uri:string}>;
  try {
    for(const asset of assets){const normalized=await privacyNormalizeImage(asset.uri,asset.width,asset.height,'webp');await assertImagePassesOnDeviceSafety(normalized.uri);const intent=await uploadWithIntent({petId,bucket:'social-media',purpose:'post_media',uri:normalized.uri,mimeType:normalized.mimeType,extension:normalized.extension});uploaded.push({id:intent.id,path:intent.path,uri:normalized.uri});}
    return uploaded;
  } catch(error) { await Promise.allSettled(uploaded.map(x=>cancelUploadIntent(x.id))); throw error; }
}


function assertReelVideo(asset:{type?:string|null;fileSize?:number|null;mimeType?:string|null;duration?:number|null;width?:number|null;height?:number|null}){
  if(asset.type&&asset.type!=='video')throw new Error(translate(getRuntimeLocale(),'upload.videoUnsupported'));
  if(asset.fileSize!=null&&(asset.fileSize<=0||asset.fileSize>REEL_MAX_BYTES))throw new Error(translate(getRuntimeLocale(),'upload.videoTooLarge'));
  const rawMime=String(asset.mimeType??'').toLowerCase();
  const fileName=String((asset as {fileName?:string|null}).fileName??'').toLowerCase();
  const mime=rawMime==='video/mp4'||rawMime==='video/quicktime'?rawMime:fileName.endsWith('.mp4')?'video/mp4':fileName.endsWith('.mov')?'video/quicktime':'';
  if(!VIDEO_MIMES.includes(mime as (typeof VIDEO_MIMES)[number]))throw new Error(translate(getRuntimeLocale(),'upload.videoUnsupported'));
  const duration=Number(asset.duration);
  if(!Number.isFinite(duration)||duration<1000||duration>REEL_MAX_DURATION_MS)throw new Error(translate(getRuntimeLocale(),'upload.videoTooLong'));
  if((Number(asset.width)||0)<=0||(Number(asset.height)||0)<=0)throw new Error(translate(getRuntimeLocale(),'upload.videoUnsupported'));
  return {mimeType:mime as 'video/mp4'|'video/quicktime',durationMs:Math.round(duration)};
}

export async function pickAndUploadReelVideo(petId:string){
  const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:['videos'],allowsEditing:false,quality:1,videoMaxDuration:60,selectionLimit:1});
  if(result.canceled||!result.assets[0])return null;
  const asset=result.assets[0];
  const verified=assertReelVideo(asset);
  const extension=safeExtension(asset.fileName,verified.mimeType);
  if((verified.mimeType==='video/mp4'&&extension!=='mp4')||(verified.mimeType==='video/quicktime'&&extension!=='mov'))throw new Error(translate(getRuntimeLocale(),'upload.videoUnsupported'));
  const intent=await uploadWithIntent({petId,bucket:'social-media',purpose:'reel_media',uri:asset.uri,mimeType:verified.mimeType,extension});
  return {...intent,uri:asset.uri,durationMs:verified.durationMs,mimeType:verified.mimeType};
}

export async function captureAndSubmitPetVerification(petId:string){
  const result=await pickImage('camera',false);
  if(result.canceled||!result.assets[0])return null;
  const asset=result.assets[0];assertImage(asset);const normalized=await privacyNormalizeImage(asset.uri,asset.width,asset.height);
  const intent=await uploadWithIntent({petId,bucket:'pet-verification',purpose:'pet_verification',uri:normalized.uri,mimeType:normalized.mimeType,extension:normalized.extension});
  try { const requestId=await submitPetVerification(petId,intent.path); return requestId; }
  catch(error){await runBestEffort('upload_cancel_intent',()=>cancelUploadIntent(intent.id)); throw error}
}
