import type { AppNotification, BoostStatus, ConsumableWallet, DiscoveryFilters, DiscoverySuggestions, FeedPage, ReelsPage, Reel, LocalNetworkStatus, LostPetAlert, Match, Message, MessageEntitlement, DailyProductQuotaStatus, Pet, PetEvent, PetFriendlyPlace, PetVerificationStatus, Post, ProductFeaturePolicy, Story, TravelModeState, TravelZone, UploadIntent, PetCallSession, PetCallToken, PetCallType } from '../types/domain';
import { supabase } from './supabase';
import { getRuntimeLocale, translate } from '../i18n';
import { throwIfEdgeFunctionFailed } from './edgeErrors';
import { env } from './config';
import {bestEffortDeviceIntegrity} from './deviceIntegrity';

const SIGNED_MEDIA_TTL_SECONDS = 600;


function isRemoteUrl(value?: string | null) {
  // Never render cleartext media URLs received from application data. Production media is
  // storage-path based; HTTPS remains allowed for intentionally external/demo media only.
  return Boolean(value && /^https:\/\//i.test(value));
}


async function signedUrlMap(bucket: string, paths: Array<string | null | undefined>) {
  const map = new Map<string, string>();
  const unique = [...new Set(paths.filter((value): value is string => Boolean(value)))];
  const local = unique.filter((value) => !isRemoteUrl(value));
  unique.filter(isRemoteUrl).forEach((value) => map.set(value, value));
  if (!local.length) return map;

  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(local, SIGNED_MEDIA_TTL_SECONDS);
  if (error || !data) {
    local.forEach((value) => map.set(value, ''));
    return map;
  }
  data.forEach((item, index) => {
    const path = item.path ?? local[index];
    if (path) map.set(path, item.signedUrl ?? '');
  });
  return map;
}

async function hydratePets(pets: Pet[]) {
  const paths = pets.flatMap((pet) => (pet.photos ?? []).map((photo) => photo.url));
  const urls = await signedUrlMap('pet-photos', paths);
  return pets.map((pet) => ({
    ...pet,
    photos: (pet.photos ?? []).map((photo) => ({ ...photo, url: urls.get(photo.url) ?? '' }))
  }));
}

async function hydratePet(pet: Pet): Promise<Pet> {
  const [hydrated] = await hydratePets([pet]);
  if (!hydrated) throw new Error(translate(getRuntimeLocale(),'api.petDataUnavailable'));
  return hydrated;
}

function requireData<T>(data: T | null, error: unknown): T {
  if (error) throw error;
  if (data == null) throw new Error(translate(getRuntimeLocale(),'api.expectedDataUnavailable'));
  return data;
}

export async function getMyPets(): Promise<Pet[]> {
  const { data, error } = await supabase.rpc('get_my_pets');
  return hydratePets(requireData(data, error) as Pet[]);
}

export async function getShareablePetProfile(viewerPetId:string,targetPetId:string):Promise<Pet|null>{
  const {data,error}=await supabase.rpc('get_shareable_pet_profile',{p_viewer_pet_id:viewerPetId,p_target_pet_id:targetPetId});
  if(error)throw error;
  return data?hydratePet(data as Pet):null;
}

export async function getShareableReel(viewerPetId:string,reelId:string):Promise<Reel|null>{
  const {data,error}=await supabase.rpc('get_shareable_reel',{p_viewer_pet_id:viewerPetId,p_reel_id:reelId});
  if(error)throw error;
  if(!data)return null;
  return (await hydrateReels([data as Reel]))[0]??null;
}

export async function getShareableStory(viewerPetId:string,storyId:string):Promise<Story|null>{
  const {data,error}=await supabase.rpc('get_shareable_story',{p_viewer_pet_id:viewerPetId,p_story_id:storyId});
  if(error)throw error;
  if(!data)return null;
  return (await hydrateStories([data as Story]))[0]??null;
}

async function socialReadCache<T>(body:Record<string,unknown>):Promise<T|null>{
  try{
    const {data,error}=await supabase.functions.invoke('social-read-cache',{method:'POST',body});
    if(error||!data||data.data==null)return null;
    return data.data as T;
  }catch{return null}
}

export async function discoverPets(activePetId: string, filters: DiscoveryFilters): Promise<Pet[]> {
  const cached=await socialReadCache<Pet[]>({surface:'discover',petId:activePetId,filters});
  if(cached)return hydratePets(cached);
  const { data, error } = await supabase.rpc('discover_pets', {
    p_active_pet_id: activePetId,
    p_filters: filters
  });
  return hydratePets(requireData(data, error) as Pet[]);
}

export async function likePet(fromPetId: string, toPetId: string, kind: 'like' | 'super_like', operationId: string) {
  if(kind==='super_like') await bestEffortDeviceIntegrity('super_like');
  const { data, error } = await supabase.rpc('like_pet_idempotent', { p_from_pet_id: fromPetId, p_to_pet_id: toPetId, p_kind: kind, p_client_operation_id: operationId });
  return requireData(data, error) as { matched: boolean; match_id?: string };
}

export async function passPet(fromPetId: string, toPetId: string, operationId: string) {
  const { error } = await supabase.rpc('pass_pet_idempotent', { p_from_pet_id: fromPetId, p_to_pet_id: toPetId, p_client_operation_id: operationId });
  if (error) throw error;
}

export async function setFavoritePet(fromPetId: string, toPetId: string, enabled: boolean) {
  const { data, error } = await supabase.rpc('set_favorite_pet', { p_from_pet_id: fromPetId, p_to_pet_id: toPetId, p_favorite: enabled });
  return requireData(data, error) as boolean;
}

export async function getFavoritePetsPage(activePetId:string,cursor?:{favoritedAt:string;id:string},limit=40):Promise<Pet[]> {
  const {data,error}=await supabase.rpc('get_favorite_pets_page',{p_pet_id:activePetId,p_limit:limit,p_before_created_at:cursor?.favoritedAt??null,p_before_to_pet_id:cursor?.id??null});
  return hydratePets(requireData(data,error) as Pet[]);
}

async function hydrateMatches(rows: Match[]): Promise<Match[]> {
  const pets = await hydratePets(rows.map((match) => match.otherPet));
  return rows.flatMap((match, index) => { const pet=pets[index]; return pet ? [{ ...match, otherPet: pet }] : []; });
}

export async function getMatchesPage(activePetId: string, cursor?: {matchedAt:string;id:string}, limit=30): Promise<Match[]> {
  const { data, error } = await supabase.rpc('get_matches_page', {
    p_pet_id: activePetId,
    p_limit: limit,
    p_before_matched_at: cursor?.matchedAt ?? null,
    p_before_id: cursor?.id ?? null
  });
  return hydrateMatches(requireData(data, error) as Match[]);
}

export async function getUnreadMatchMessageCount(activePetId: string): Promise<number> {
  const { data, error } = await supabase.rpc('get_unread_match_message_count', { p_pet_id: activePetId });
  const value=requireData(data,error) as number|string;
  const count=Number(value);
  if(!Number.isFinite(count)||count<0) throw new Error(translate(getRuntimeLocale(),'api.expectedDataUnavailable'));
  return count;
}

export async function getMatchByConversation(activePetId: string, conversationId: string): Promise<Match|null> {
  const { data, error } = await supabase.rpc('get_match_by_conversation', { p_pet_id: activePetId, p_conversation_id: conversationId });
  if(error) throw error;
  if(!data) return null;
  const [match]=await hydrateMatches([data as Match]);
  return match ?? null;
}

export async function getActiveMatchWithPet(activePetId:string,otherPetId:string):Promise<Match|null>{
  const {data,error}=await supabase.rpc('get_active_match_with_pet',{p_pet_id:activePetId,p_other_pet_id:otherPetId});
  if(error)throw error;
  if(!data)return null;
  const [match]=await hydrateMatches([data as Match]);
  return match??null;
}

export async function unmatch(matchId: string, petId: string) {
  const { error } = await supabase.rpc('unmatch_pet', { p_match_id: matchId, p_pet_id: petId });
  if (error) throw error;
}

export async function getConversationMessageEntitlement(conversationId:string,senderPetId:string):Promise<MessageEntitlement>{
  const {data,error}=await supabase.rpc('get_conversation_message_entitlement',{p_conversation_id:conversationId,p_sender_pet_id:senderPetId});
  return requireData(data,error) as MessageEntitlement;
}

export async function getDailyProductQuotaStatus():Promise<DailyProductQuotaStatus>{
  const {data,error}=await supabase.rpc('current_user_daily_product_quota_status');
  return requireData(data,error) as DailyProductQuotaStatus;
}

export async function sendMessage(conversationId: string, senderPetId: string, body: string, clientOperationId: string): Promise<Message> {
  const { data, error } = await supabase.rpc('send_message_idempotent', { p_conversation_id: conversationId, p_sender_pet_id: senderPetId, p_body: body, p_client_operation_id: clientOperationId });
  return requireData(data, error) as Message;
}

export async function sendStoryReply(conversationId:string,senderPetId:string,storyId:string,body:string,clientOperationId:string):Promise<Message>{
  const {data,error}=await supabase.rpc('send_story_reply_idempotent',{p_conversation_id:conversationId,p_sender_pet_id:senderPetId,p_story_id:storyId,p_body:body,p_client_operation_id:clientOperationId});
  return requireData(data,error) as Message;
}

export async function markConversationRead(conversationId: string, viewerPetId: string) {
  const { error } = await supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId, p_viewer_pet_id: viewerPetId });
  if (error) throw error;
}

async function hydratePosts(rows: Post[]): Promise<Post[]> {
  const petPhotoPaths = rows.flatMap((post) => (post.pet.photos ?? []).map((photo) => photo.url));
  const mediaPaths = rows.flatMap((post) => post.mediaUrls ?? []);
  const [petUrls, mediaUrls] = await Promise.all([signedUrlMap('pet-photos', petPhotoPaths), signedUrlMap('social-media', mediaPaths)]);
  return rows.map((post) => ({...post, pet:{...post.pet,photos:(post.pet.photos ?? []).map((photo)=>({...photo,url:petUrls.get(photo.url) ?? ''}))}, mediaUrls:(post.mediaUrls ?? []).map((path)=>mediaUrls.get(path) ?? '')}));
}

export async function getFeedPage(activePetId:string, mode:'local'|'for_you'|'following'='for_you', cursor?:{snapshotAt:string;rankScore:number;createdAt:string;id:string}, limit=20):Promise<FeedPage>{
  const cached=await socialReadCache<FeedPage>({surface:'feed',petId:activePetId,mode,limit,cursor:cursor??null});
  if(cached)return {...cached,items:await hydratePosts(cached.items??[])};
  const {data,error}=await supabase.rpc('get_feed_page',{p_pet_id:activePetId,p_mode:mode,p_limit:limit,p_snapshot_at:cursor?.snapshotAt??null,p_before_rank:cursor?.rankScore??null,p_before_created_at:cursor?.createdAt??null,p_before_id:cursor?.id??null});
  const page=requireData(data,error) as FeedPage;
  return {...page,items:await hydratePosts(page.items??[])};
}


async function hydrateReels(rows:Reel[]):Promise<Reel[]>{
  const petPhotoPaths=rows.flatMap(reel=>(reel.pet.photos??[]).map(photo=>photo.url));
  const videoPaths=rows.map(reel=>reel.videoUrl);
  if(videoPaths.some(path=>!path))throw new Error(translate(getRuntimeLocale(),'api.expectedDataUnavailable'));
  const [petUrls,videoUrls]=await Promise.all([signedUrlMap('pet-photos',petPhotoPaths),signedUrlMap('social-media',videoPaths)]);
  return rows.map(reel=>{
    const storagePath=reel.videoUrl;
    const signedVideo=videoUrls.get(storagePath);
    if(!signedVideo)throw new Error(translate(getRuntimeLocale(),'api.expectedDataUnavailable'));
    return {...reel,pet:{...reel.pet,photos:(reel.pet.photos??[]).map(photo=>({...photo,url:petUrls.get(photo.url)??''}))},videoStoragePath:storagePath,videoUrl:signedVideo};
  });
}

export async function refreshReelVideoUrl(storagePath:string):Promise<string>{
  const clean=storagePath.trim();
  if(!clean)throw new Error(translate(getRuntimeLocale(),'api.expectedDataUnavailable'));
  const urls=await signedUrlMap('social-media',[clean]);
  const signed=urls.get(clean);
  if(!signed)throw new Error(translate(getRuntimeLocale(),'api.expectedDataUnavailable'));
  return signed;
}

export async function getReelsPage(activePetId:string,cursor?:{snapshotAt:string;rankScore:number;createdAt:string;id:string},limit=12):Promise<ReelsPage>{
  const cached=await socialReadCache<ReelsPage>({surface:'reels',petId:activePetId,limit,cursor:cursor??null});
  if(cached)return {...cached,items:await hydrateReels(cached.items??[])};
  const {data,error}=await supabase.rpc('get_reels_page',{p_pet_id:activePetId,p_limit:limit,p_snapshot_at:cursor?.snapshotAt??null,p_before_rank:cursor?.rankScore??null,p_before_created_at:cursor?.createdAt??null,p_before_id:cursor?.id??null});
  const page=requireData(data,error) as ReelsPage;
  return {...page,items:await hydrateReels(page.items??[])};
}

export async function createReel(petId:string,caption:string,storagePath:string,durationMs:number,operationId:string){
  const {data,error}=await supabase.rpc('create_reel_idempotent',{p_pet_id:petId,p_caption:caption,p_storage_path:storagePath,p_duration_ms:durationMs,p_client_operation_id:operationId});
  return requireData(data,error) as string;
}

export async function createPost(petId: string, caption: string, mediaPaths: string[], operationId:string) {
  const { data, error } = await supabase.rpc('create_post_idempotent', { p_pet_id: petId, p_caption: caption, p_media_paths: mediaPaths, p_client_operation_id:operationId });
  return requireData(data, error) as string;
}

export async function setPostLike(petId: string, postId: string, enabled:boolean) {
  const { data, error } = await supabase.rpc('set_post_like', { p_pet_id: petId, p_post_id: postId, p_liked: enabled });
  return requireData(data, error) as boolean;
}

export async function setSavePost(petId: string, postId: string, enabled:boolean) {
  const { data, error } = await supabase.rpc('set_saved_post', { p_pet_id: petId, p_post_id: postId, p_saved: enabled });
  return requireData(data, error) as boolean;
}

export async function createComment(petId: string, postId: string, body: string, operationId:string) {
  const { data, error } = await supabase.rpc('create_comment_idempotent', { p_pet_id: petId, p_post_id: postId, p_body: body, p_client_operation_id:operationId });
  return requireData(data, error) as string;
}

export async function setFollowPet(fromPetId: string, toPetId: string, enabled:boolean) {
  const { data, error } = await supabase.rpc('set_follow_pet', { p_from_pet_id: fromPetId, p_to_pet_id: toPetId, p_following: enabled });
  return requireData(data, error) as boolean;
}


export async function createStory(petId: string, mediaPath: string, operationId:string) {
  const { data, error } = await supabase.rpc('create_story_idempotent', { p_pet_id: petId, p_storage_path: mediaPath, p_client_operation_id:operationId });
  return requireData(data, error) as string;
}

export async function createEvent(input: { petId:string; title:string; description:string; city:string; district:string; neighborhood?:string; startsAt:string; endsAt?:string; capacity?:number; eventKind?:'community'|'walk'|'playdate'|'education'; recurrence?:'none'|'weekly' },operationId:string) {
  await bestEffortDeviceIntegrity('event_create');
  const { data, error } = await supabase.rpc('create_community_event_idempotent', {
    p_pet_id: input.petId, p_title: input.title, p_description: input.description, p_city: input.city,
    p_district: input.district, p_neighborhood: input.neighborhood ?? null, p_starts_at: input.startsAt,
    p_ends_at: input.endsAt ?? null, p_capacity: input.capacity ?? null, p_event_kind:input.eventKind??'community',p_recurrence:input.recurrence??'none',p_client_operation_id:operationId
  });
  return requireData(data, error) as string;
}

async function hydrateStories(rows:Story[]):Promise<Story[]>{
  const [avatars, media] = await Promise.all([
    signedUrlMap('pet-photos', rows.map((story) => story.avatarUrl)),
    signedUrlMap('social-media', rows.map((story) => story.mediaUrl))
  ]);
  return rows.map((story) => ({...story,avatarUrl: story.avatarUrl?(avatars.get(story.avatarUrl)??''):'',mediaUrl: media.get(story.mediaUrl) ?? ''}));
}

export async function getStoriesPage(activePetId:string,cursor?:{createdAt:string;id:string},limit=40):Promise<Story[]>{
  const {data,error}=await supabase.rpc('get_active_stories_page',{p_pet_id:activePetId,p_limit:limit,p_before_created_at:cursor?.createdAt??null,p_before_id:cursor?.id??null});
  return hydrateStories(requireData(data,error) as Story[]);
}

export async function markStorySeen(storyId: string, viewerPetId: string) {
  const { error } = await supabase.rpc('mark_story_seen', { p_story_id: storyId, p_viewer_pet_id: viewerPetId });
  if (error) throw error;
}

export async function getEventsPage(activePetId:string,cursor?:{startsAt:string;id:string},limit=30):Promise<PetEvent[]>{
  const {data,error}=await supabase.rpc('get_pet_events_page',{p_pet_id:activePetId,p_limit:limit,p_after_starts_at:cursor?.startsAt??null,p_after_id:cursor?.id??null});
  return requireData(data,error) as PetEvent[];
}

export async function setEventAttendance(eventId: string, petId: string, status: 'going' | 'interested' | 'none') {
  const { error } = await supabase.rpc('set_event_attendance', { p_event_id: eventId, p_pet_id: petId, p_status: status });
  if (error) throw error;
}

export async function markNotificationRead(notificationId: string) {
  const { error } = await supabase.rpc('mark_notification_read', { p_notification_id: notificationId });
  if (error) throw error;
}

export async function reportPet(reporterPetId: string, reportedPetId: string, reason: string, details?: string) {
  const { error } = await supabase.rpc('report_pet', { p_reporter_pet_id: reporterPetId, p_reported_pet_id: reportedPetId, p_reason: reason, p_details: details ?? null });
  if (error) throw error;
}

export async function blockPet(blockerPetId: string, blockedPetId: string) {
  const { error } = await supabase.rpc('block_pet', { p_blocker_pet_id: blockerPetId, p_blocked_pet_id: blockedPetId });
  if (error) throw error;
}

export async function getCurrentLegalContext(locale?:string) {
  const { getRuntimeLocale } = await import('../i18n');
  const uiLocale=(locale??getRuntimeLocale()).trim();
  const {data,error}=await supabase.rpc('get_current_legal_context',{p_ui_locale:uiLocale});
  const context=requireData(data,error) as import('../types/domain').LegalContext;
  if(context.status!=='ready')return context;
  const {data:supplementData,error:supplementError}=await supabase.rpc('get_current_country_legal_supplements',{p_ui_locale:uiLocale});
  const supplements=requireData(supplementData,supplementError) as import('../types/domain').CountryLegalSupplementContext;
  if(supplements.status!=='ready'||supplements.legalCountryCode!==context.legalCountryCode||supplements.uiLocale!==context.uiLocale||supplements.documentLocale!==context.documentLocale||supplements.presentationSha256!==context.acceptancePresentationSha256||!supplements.bindingSupplement)throw new Error(supplements.status||'country_legal_supplement_not_ready');
  return {...context,countryJurisdictionBindingSupplement:supplements.bindingSupplement,countryJurisdictionUiSupplement:supplements.uiSupplement??null};
}

export async function getRestrictedAccountLegalSupport(locale?:string) {
  const { getRuntimeLocale } = await import('../i18n');
  const uiLocale=(locale??getRuntimeLocale()).trim();
  const {data,error}=await supabase.rpc('get_restricted_account_legal_support',{p_ui_locale:uiLocale});
  return requireData(data,error) as import('../types/domain').RestrictedAccountLegalSupport;
}

export async function getCurrentMarketingConsentPresentation(locale?:string) {
  const { getRuntimeLocale }=await import('../i18n');
  const uiLocale=(locale??getRuntimeLocale()).trim();
  const {data,error}=await supabase.rpc('get_current_marketing_consent_presentation',{p_ui_locale:uiLocale});
  return requireData(data,error) as import('../types/domain').MarketingConsentPresentation;
}

export async function acceptLegalTerms(presented:import('../types/domain').LegalContext) {
  const { getRuntimeLocale } = await import('../i18n');
  const uiLocale=getRuntimeLocale();
  if(presented.status!=='ready'||!presented.bundleId||presented.uiLocale!==uiLocale||!presented.applicabilityMatrixId||!presented.overlayDocumentSetSha256||!presented.comprehensionDocumentSetSha256||!presented.acceptancePresentationSha256)throw new Error('legal_context_not_ready');
  const current=await getCurrentLegalContext(uiLocale);
  if(current.status!=='ready'||current.bundleId!==presented.bundleId||current.uiLocale!==uiLocale||current.documentLocale!==presented.documentLocale||current.applicabilityMatrixId!==presented.applicabilityMatrixId||current.overlayDocumentSetSha256!==presented.overlayDocumentSetSha256||current.comprehensionDocumentSetSha256!==presented.comprehensionDocumentSetSha256||current.acceptancePresentationSha256!==presented.acceptancePresentationSha256)throw new Error('legal_context_changed_before_acceptance');
  const body={bundleId:presented.bundleId,age18Confirmed:true,uiLocale,applicabilityMatrixId:presented.applicabilityMatrixId,acceptancePresentationSha256:presented.acceptancePresentationSha256};
  const { data, error } = await supabase.functions.invoke('accept-legal', { body });
  await throwIfEdgeFunctionFailed(data,error);
  if (data?.ok !== true || data?.age18Confirmed !== true || data?.bundleId !== presented.bundleId || data?.legalCountryCode!==presented.legalCountryCode || data?.uiLocale!==uiLocale || data?.documentLocale!==presented.documentLocale || data?.applicabilityMatrixId!==presented.applicabilityMatrixId || data?.overlayDocumentSetSha256!==presented.overlayDocumentSetSha256 || data?.presentationSha256!==presented.acceptancePresentationSha256) throw new Error('legal_acceptance_not_confirmed');
  return data as { ok:true; age18Confirmed:true; bundleId:string; legalCountryCode:string; legalSubnationalCode?:string; uiLocale:string; documentLocale:string; legalVersion:string; termsVersion:string; communityGuidelinesVersion:string; privacyNoticeVersion:string; marketingPushConsentVersion:string; applicabilityMatrixId:string; overlayDocumentSetSha256:string; presentationSha256:string; overlayActionsRecorded:number };
}

export async function setMarketingPushConsent(granted:boolean,presented?:import('../types/domain').MarketingConsentPresentation){
  if(!granted){
    const {data,error}=await supabase.rpc('set_marketing_push_consent',{p_granted:false,p_consent_version:null,p_locale:null,p_country_code:null,p_presented_consent_document_set_sha256:null});
    const result=requireData(data,error) as {ok:boolean;granted:false;channel:'push';purpose:'marketing_product_updates';consentVersion:string|null;bundleId:string|null;legalCountryCode:string|null;uiLocale:string|null;documentLocale:string|null;consentDocumentSetSha256?:string|null;notificationPreferences:import('../types/domain').NotificationPreferences};
    if(result.ok!==true||result.granted!==false||result.channel!=='push'||result.purpose!=='marketing_product_updates'||result.notificationPreferences?.marketing!==false)throw new Error('marketing_consent_withdrawal_not_confirmed');
    return result;
  }
  const { getRuntimeLocale }=await import('../i18n');
  const uiLocale=getRuntimeLocale();
  if(!presented||presented.status!=='ready'||!presented.bundleId||!presented.consentVersion||!presented.legalCountryCode||presented.uiLocale!==uiLocale||!presented.applicabilityMatrixId||!presented.baseDocument?.documentUrl||!presented.consentDocumentSetSha256)throw new Error('marketing_legal_documents_not_ready');
  const current=await getCurrentMarketingConsentPresentation(uiLocale);
  if(current.status!=='ready'||current.bundleId!==presented.bundleId||current.applicabilityMatrixId!==presented.applicabilityMatrixId||current.legalCountryCode!==presented.legalCountryCode||current.documentLocale!==presented.documentLocale||current.consentVersion!==presented.consentVersion||current.consentDocumentSetSha256!==presented.consentDocumentSetSha256)throw new Error('marketing_consent_documents_changed');
  const {data,error}=await supabase.rpc('set_marketing_push_consent',{p_granted:true,p_consent_version:presented.consentVersion,p_locale:uiLocale,p_country_code:presented.legalCountryCode,p_presented_consent_document_set_sha256:presented.consentDocumentSetSha256});
  const result=requireData(data,error) as {ok:boolean;granted:true;channel:'push';purpose:'marketing_product_updates';consentVersion:string;bundleId:string;legalCountryCode:string;uiLocale:string;documentLocale:string;consentDocumentSetSha256:string;notificationPreferences:import('../types/domain').NotificationPreferences};
  if(result.ok!==true||result.granted!==true||result.channel!=='push'||result.purpose!=='marketing_product_updates'||result.consentVersion!==presented.consentVersion||result.bundleId!==presented.bundleId||result.legalCountryCode!==presented.legalCountryCode||result.uiLocale!==uiLocale||result.documentLocale!==presented.documentLocale||result.consentDocumentSetSha256!==presented.consentDocumentSetSha256)throw new Error('marketing_consent_not_confirmed');
  return result;
}

export async function getMyModerationDecisions(){
  const {data,error}=await supabase.rpc('get_my_moderation_decisions');
  return requireData(data,error) as import('../types/domain').ModerationDecision[];
}
export async function submitModerationAppeal(decisionId:string,statement:string){
  const {data,error}=await supabase.rpc('submit_moderation_appeal',{p_decision_id:decisionId,p_statement:statement});
  return requireData(data,error) as {id:string;decisionId:string;status:'pending';submittedAt:string};
}

export async function deleteAccount() {
  await bestEffortDeviceIntegrity('account_delete');
  const { data, error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
  await throwIfEdgeFunctionFailed(data,error);
  if (data?.ok !== true || data?.hardDeleted !== true) throw new Error('account_deletion_not_confirmed');
  return data as { ok:true; hardDeleted:true; cleanupPending?:boolean; manualProviderRevocations?:Array<'apple'|'google'> };
}

export async function getAccountExportDownloadUrl() {
  await bestEffortDeviceIntegrity('account_export');
  const { data, error } = await supabase.functions.invoke('export-data', { method: 'POST' });
  await throwIfEdgeFunctionFailed(data,error);
  const token=typeof data?.token==='string'?data.token:'';
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('account_export_token_invalid');
  if(!env.supabaseUrl)throw new Error('backend_not_configured');
  return `${env.supabaseUrl.replace(/\/+$/,'')}/functions/v1/export-download?token=${encodeURIComponent(token)}`;
}

export async function getAccountSettings() {
  const { data, error } = await supabase.rpc('get_account_settings');
  return requireData(data, error) as import('../types/domain').AccountSettings;
}

export async function updatePrivacySettings(discoverable: boolean, incognito: boolean) {
  const { error } = await supabase.rpc('update_privacy_settings', { p_discoverable: discoverable, p_incognito: incognito });
  if (error) throw error;
}

export async function updateAccountPaused(paused: boolean) {
  const { data, error } = await supabase.rpc('set_account_paused', { p_paused: paused });
  return requireData(data, error) as { paused:boolean };
}

export async function getPetHealthDetails(petId: string) {
  const { data, error } = await supabase.rpc('get_pet_health_details', { p_pet_id: petId });
  return requireData(data, error) as import('../types/domain').HealthDetails;
}

export async function upsertVaccination(input: { petId:string; vaccinationId?:string; vaccineName:string; doseDate?:string; nextDueDate?:string; operationId:string }) {
  const { data, error } = await supabase.rpc('upsert_vaccination_idempotent', {
    p_pet_id: input.petId, p_vaccination_id: input.vaccinationId ?? null, p_vaccine_name: input.vaccineName,
    p_dose_date: input.doseDate || null, p_next_due_date: input.nextDueDate || null,
    p_client_operation_id: input.operationId
  });
  return requireData(data, error) as string;
}

export async function deleteVaccination(petId:string, vaccinationId:string) {
  const { error } = await supabase.rpc('delete_vaccination', { p_pet_id:petId, p_vaccination_id:vaccinationId });
  if (error) throw error;
}

export async function updatePetHealthClaims(petId:string, neutered:boolean|null) {
  const { error } = await supabase.rpc('update_pet_health_claims', { p_pet_id:petId, p_neutered:neutered });
  if (error) throw error;
}

export async function getIncomingLikesPage(petId:string,cursor?:{createdAt:string;fromPetId:string},limit=40): Promise<Pet[]> {
  const { data, error } = await supabase.rpc('get_incoming_likes_page', { p_pet_id:petId,p_limit:limit,p_before_created_at:cursor?.createdAt??null,p_before_from_pet_id:cursor?.fromPetId??null });
  const value = requireData(data, error) as Pet[] | {error:string};
  if (!Array.isArray(value)) throw new Error(value.error || 'premium_required');
  return hydratePets(value);
}

export async function undoLastPass(petId:string,operationId:string) {
  const { data, error } = await supabase.rpc('undo_last_pass_idempotent', { p_pet_id:petId,p_client_operation_id:operationId });
  return requireData(data, error) as { restored:boolean; petId?:string };
}

export async function createMeetupRequest(input:{matchId:string; proposedByPetId:string; startsAt:string; publicPlaceLabel:string; note?:string},operationId:string) {
  await bestEffortDeviceIntegrity('meetup_create');
  const { data, error } = await supabase.rpc('create_meetup_request_idempotent', {
    p_match_id:input.matchId,p_proposed_by_pet_id:input.proposedByPetId,p_starts_at:input.startsAt,
    p_public_place_label:input.publicPlaceLabel,p_note:input.note ?? null,p_client_operation_id:operationId
  });
  return requireData(data,error) as string;
}

export async function getMeetupRequestsPage(petId:string,matchId?:string,cursor?:{createdAt:string;id:string},limit=30) {
  const {data,error}=await supabase.rpc('get_meetup_requests_page',{p_pet_id:petId,p_match_id:matchId??null,p_limit:limit,p_before_created_at:cursor?.createdAt??null,p_before_id:cursor?.id??null});
  return requireData(data,error) as import('../types/domain').MeetupRequest[];
}
export async function respondMeetupRequest(requestId:string,petId:string,status:'accepted'|'declined'|'cancelled') {
  const { error }=await supabase.rpc('respond_meetup_request',{p_request_id:requestId,p_pet_id:petId,p_status:status});
  if(error) throw error;
}

export async function reportContent(reporterPetId:string,targetType:'pet'|'post'|'comment'|'message'|'story'|'event'|'meetup',targetId:string,reason:string,details?:string) {
  const {data,error}=await supabase.rpc('report_content',{p_reporter_pet_id:reporterPetId,p_target_type:targetType,p_target_id:targetId,p_reason:reason,p_details:details??null});
  return requireData(data,error) as string;
}

export async function deleteOwnedContent(petId:string,targetType:'post'|'comment'|'story'|'event',targetId:string,operationId:string) {
  const {error}=await supabase.rpc('delete_owned_content_idempotent',{p_pet_id:petId,p_target_type:targetType,p_target_id:targetId,p_client_operation_id:operationId});
  if(error) throw error;
}

export async function deletePetProfile(petId:string,operationId:string) {
  const { error } = await supabase.rpc('delete_pet_profile_idempotent', { p_pet_id:petId,p_client_operation_id:operationId });
  if (error) throw error;
}

export async function markAllNotificationsRead() {
  const {error}=await supabase.rpc('mark_all_notifications_read');
  if(error) throw error;
}


async function hydrateComments(rows:import('../types/domain').PostComment[]) {
  const photos=rows.flatMap(comment=>comment.pet.photos??[]);
  const urls=await signedUrlMap('pet-photos',photos.map(photo=>photo.url));
  return rows.map(comment=>({...comment,pet:{...comment.pet,photos:(comment.pet.photos??[]).map(photo=>({...photo,url:urls.get(photo.url)??''}))}}));
}

export async function getPostCommentsPage(petId:string,postId:string,cursor?:{createdAt:string;id:string},limit=40) {
  const {data,error}=await supabase.rpc('get_post_comments_page',{
    p_pet_id:petId,p_post_id:postId,p_limit:limit,
    p_before_created_at:cursor?.createdAt??null,p_before_id:cursor?.id??null
  });
  return hydrateComments(requireData(data,error) as import('../types/domain').PostComment[]);
}

export async function getPostComments(petId:string,postId:string) {
  return getPostCommentsPage(petId,postId,undefined,40);
}

export async function upsertPetProfile(input:{petId?:string|null;payload:Record<string,unknown>;prompts:import('../types/domain').PetPrompt[];operationId:string}){
  const {data,error}=await supabase.rpc('upsert_pet_profile_idempotent',{
    p_pet_id:input.petId??null,
    p_payload:input.payload,
    p_prompts:input.prompts.map((p,i)=>({promptKey:p.promptKey,answer:p.answer,sortOrder:i+1})),
    p_client_operation_id:input.operationId
  });
  return requireData(data,error) as string;
}
export async function submitMeetupFeedback(input:{requestId:string;reviewerPetId:string;met:boolean;feltSafe?:boolean;wouldMeetAgain?:boolean;issueCategory?:string;privateNote?:string}){const {error}=await supabase.rpc('submit_meetup_feedback',{p_request_id:input.requestId,p_reviewer_pet_id:input.reviewerPetId,p_met:input.met,p_felt_safe:input.feltSafe??null,p_would_meet_again:input.wouldMeetAgain??null,p_issue_category:input.issueCategory??null,p_private_note:input.privateNote??null});if(error)throw error;}

export async function getVerificationStatus(){ const {data,error}=await supabase.rpc('get_verification_status'); return requireData(data,error) as import('../types/domain').VerificationStatus; }
export async function startOwnerVerification(){ await bestEffortDeviceIntegrity('owner_verification'); const {data,error}=await supabase.functions.invoke('start-owner-verification',{method:'POST'}); await throwIfEdgeFunctionFailed(data,error); return data as {url?:string;alreadyVerified?:boolean;requestId?:string}; }
export async function startAgeAssurance(){ await bestEffortDeviceIntegrity('age_assurance'); const {data,error}=await supabase.functions.invoke('start-age-assurance',{method:'POST'}); await throwIfEdgeFunctionFailed(data,error); return data as {url?:string;alreadyVerified?:boolean;requestId?:string;minimumAge?:number}; }
export type RuntimeConfigPayload={maintenanceMode:boolean;minimumSupportedVersion:string;latestVersion:string;minimumSupportedVersions?:Partial<Record<'ios'|'android',string>>;latestVersions?:Partial<Record<'ios'|'android',string>>;features:Record<string,boolean>;productLimits?:{standardDailySwipeLimit:number;standardDailyNewConversationLimit:number};message?:string;messages?:Record<string,string>};
export async function getRuntimeConfig(){ const {data,error}=await supabase.rpc('get_runtime_config'); return requireData(data,error) as RuntimeConfigPayload; }

export async function updateNotificationPreferences(preferences: import('../types/domain').NotificationPreferences) {
  const { data, error } = await supabase.rpc('update_notification_preferences', { p_preferences: preferences });
  return requireData(data, error) as import('../types/domain').NotificationPreferences;
}

export async function updateMeasurementSystem(system: import('../types/domain').MeasurementSystem) {
  const { error } = await supabase.rpc('update_measurement_system', { p_system: system });
  if (error) throw error;
}

export async function getBlockedPetsPage(petId:string,cursor?:{createdAt:string;blockedPetId:string},limit=40): Promise<Pet[]> {
  const { data, error } = await supabase.rpc('get_blocked_pets_page', { p_pet_id:petId,p_limit:limit,p_before_created_at:cursor?.createdAt??null,p_before_blocked_pet_id:cursor?.blockedPetId??null });
  return hydratePets(requireData(data, error) as Pet[]);
}

export async function unblockPet(blockerPetId:string,blockedPetId:string) {
  const { error } = await supabase.rpc('unblock_pet', { p_blocker_pet_id:blockerPetId, p_blocked_pet_id:blockedPetId });
  if (error) throw error;
}

export async function getMyReportsPage(cursor?:{createdAt:string;id:string},limit=40): Promise<import('../types/domain').ReportHistoryItem[]> {
  const { data, error } = await supabase.rpc('get_my_reports_page', { p_limit:limit,p_before_created_at:cursor?.createdAt??null,p_before_id:cursor?.id??null });
  return requireData(data, error) as import('../types/domain').ReportHistoryItem[];
}

export async function createUploadIntent(input:{petId:string;bucket:'pet-photos'|'social-media'|'health-documents'|'pet-verification';purpose:string;mimeType:string;extension?:string;operationId:string}):Promise<UploadIntent>{
  const {data,error}=await supabase.rpc('create_upload_intent_idempotent',{p_pet_id:input.petId,p_bucket:input.bucket,p_purpose:input.purpose,p_mime_type:input.mimeType,p_extension:input.extension??'jpg',p_client_operation_id:input.operationId});
  return requireData(data,error) as UploadIntent;
}
export async function cancelUploadIntent(intentId:string){const {error}=await supabase.rpc('cancel_upload_intent',{p_intent_id:intentId});if(error)throw error;}
export async function getPetVerificationStatus(petId:string):Promise<PetVerificationStatus>{const {data,error}=await supabase.rpc('get_pet_verification_status',{p_pet_id:petId});return requireData(data,error) as PetVerificationStatus;}
export async function submitPetVerification(petId:string,storagePath:string){const {data,error}=await supabase.rpc('submit_pet_verification',{p_pet_id:petId,p_storage_path:storagePath});return requireData(data,error) as string;}
export async function getDiscoverySuggestions(petId:string):Promise<DiscoverySuggestions>{const {data,error}=await supabase.rpc('get_discovery_suggestions',{p_active_pet_id:petId});return requireData(data,error) as DiscoverySuggestions;}
export async function getConversationMessagesPage(conversationId:string,cursor?:{createdAt:string;id:string},limit=40):Promise<Message[]>{const {data,error}=await supabase.rpc('get_conversation_messages_page',{p_conversation_id:conversationId,p_limit:limit,p_before_created_at:cursor?.createdAt??null,p_before_id:cursor?.id??null});return requireData(data,error) as Message[];}
export async function getNotificationsPage(cursor?:{createdAt:string;id:string},limit=40):Promise<AppNotification[]>{const {data,error}=await supabase.rpc('get_notifications_page',{p_limit:limit,p_before_created_at:cursor?.createdAt??null,p_before_id:cursor?.id??null});return requireData(data,error) as AppNotification[];}
export async function getUnreadNotificationCount():Promise<number>{const {data,error}=await supabase.rpc('get_unread_notification_count');const value=requireData(data,error) as number|string;const count=Number(value);if(!Number.isFinite(count)||count<0)throw new Error(translate(getRuntimeLocale(),'api.expectedDataUnavailable'));return count;}


export async function getLocalNetworkStatus(petId:string):Promise<LocalNetworkStatus>{
  const {data,error}=await supabase.rpc('get_local_network_status',{p_pet_id:petId});
  return requireData(data,error) as LocalNetworkStatus;
}

export async function joinLocalWaitlist(petId:string):Promise<{joined:boolean;waitlistCount:number}>{
  const {data,error}=await supabase.rpc('join_local_waitlist',{p_pet_id:petId});
  return requireData(data,error) as {joined:boolean;waitlistCount:number};
}

export async function getNearbyLostPetAlerts(petId:string,limit=30):Promise<LostPetAlert[]>{
  const {data,error}=await supabase.rpc('get_nearby_lost_pet_alerts',{p_pet_id:petId,p_limit:limit});
  const alerts=requireData(data,error) as LostPetAlert[];
  const urls=await signedUrlMap('pet-photos',alerts.map(alert=>alert.photoPath));
  return alerts.map(alert=>({...alert,photoUrl:alert.photoPath?urls.get(alert.photoPath)??'':''}));
}

export async function createLostPetAlert(petId:string,lastSeenAt:string,radiusKm:number,operationId:string):Promise<{id:string;status:'active'}>{
  await bestEffortDeviceIntegrity('lost_pet_alert');
  const {data,error}=await supabase.rpc('create_lost_pet_alert_idempotent',{p_pet_id:petId,p_last_seen_at:lastSeenAt,p_radius_km:radiusKm,p_client_operation_id:operationId});
  return requireData(data,error) as {id:string;status:'active'};
}

export async function resolveLostPetAlert(alertId:string,petId:string){
  const {error}=await supabase.rpc('resolve_lost_pet_alert',{p_alert_id:alertId,p_pet_id:petId});
  if(error)throw error;
}

export async function getPetFriendlyPlaces(petId:string,category?:PetFriendlyPlace['category']|null,limit=50):Promise<PetFriendlyPlace[]>{
  const {data,error}=await supabase.rpc('get_pet_friendly_places',{p_pet_id:petId,p_category:category??null,p_limit:limit});
  return requireData(data,error) as PetFriendlyPlace[];
}

export async function trackPlaceReferral(placeId:string,source:'places'|'event'|'meetup'='places'){
  const {error}=await supabase.rpc('track_place_referral',{p_place_id:placeId,p_source:source});
  if(error)throw error;
}


export async function getConsumableWallet():Promise<ConsumableWallet>{
  const {data,error}=await supabase.rpc('get_consumable_wallet');
  return requireData(data,error) as ConsumableWallet;
}

export async function getAvailableTravelZones():Promise<TravelZone[]>{
  const {data,error}=await supabase.rpc('get_available_travel_zones');
  return requireData(data,error) as TravelZone[];
}

export async function getTravelMode(petId:string):Promise<TravelModeState>{
  const {data,error}=await supabase.rpc('get_travel_mode',{p_pet_id:petId});
  return requireData(data,error) as TravelModeState;
}

export async function setTravelMode(petId:string,zoneId:string|null,enabled:boolean):Promise<TravelModeState>{
  await bestEffortDeviceIntegrity('travel_mode');
  const {data,error}=await supabase.rpc('set_travel_mode',{p_pet_id:petId,p_zone_id:zoneId,p_enabled:enabled});
  return requireData(data,error) as TravelModeState;
}

export async function activatePetBoost(petId:string):Promise<{id:string;source:'premium_weekly'|'consumable_credit';endsAt:string}>{
  await bestEffortDeviceIntegrity('boost_activate');
  const {data,error}=await supabase.rpc('activate_pet_boost',{p_pet_id:petId});
  return requireData(data,error) as {id:string;source:'premium_weekly'|'consumable_credit';endsAt:string};
}

export async function getPetBoostStatus(petId:string):Promise<BoostStatus>{
  const {data,error}=await supabase.rpc('get_pet_boost_status',{p_pet_id:petId});
  return requireData(data,error) as BoostStatus;
}

export async function trackCommercialReferral(offerId:string,source:'event_ticket'|'event_sponsor'|'event_sample'):
Promise<void>{
  const {error}=await supabase.rpc('track_commercial_referral',{p_offer_id:offerId,p_source:source});
  if(error) throw error;
}

export async function getProductFeaturePolicy():Promise<ProductFeaturePolicy>{
  const {data,error}=await supabase.rpc('get_product_feature_policy');
  return requireData(data,error) as ProductFeaturePolicy;
}


export async function createPetCall(matchId:string,callerPetId:string,callType:PetCallType,clientOperationId:string):Promise<PetCallSession>{
  await bestEffortDeviceIntegrity('pet_call');
  const {data,error}=await supabase.rpc('create_pet_call_idempotent',{p_match_id:matchId,p_caller_pet_id:callerPetId,p_call_type:callType,p_client_operation_id:clientOperationId});
  return requireData(data,error) as PetCallSession;
}
export async function respondPetCall(callId:string,petId:string,accept:boolean):Promise<PetCallSession>{
  await bestEffortDeviceIntegrity('pet_call');
  const {data,error}=await supabase.rpc('respond_pet_call',{p_call_id:callId,p_pet_id:petId,p_accept:accept});
  return requireData(data,error) as PetCallSession;
}
export async function endPetCall(callId:string,petId:string):Promise<void>{
  const {error}=await supabase.rpc('end_pet_call',{p_call_id:callId,p_pet_id:petId});
  if(error)throw error;
}
export async function getIncomingPetCall(petId:string):Promise<PetCallSession|null>{
  const {data,error}=await supabase.rpc('get_incoming_pet_call',{p_pet_id:petId});
  if(error)throw error;
  if(!data)return null;
  const call=data as PetCallSession;
  return call.callerPet?{...call,callerPet:await hydratePet(call.callerPet)}:call;
}
export async function getPetCallState(callId:string,petId:string):Promise<PetCallSession>{
  const {data,error}=await supabase.rpc('get_pet_call_state',{p_call_id:callId,p_pet_id:petId});
  return requireData(data,error) as PetCallSession;
}
export async function getLiveKitCallToken(callId:string,petId:string):Promise<PetCallToken>{
  await bestEffortDeviceIntegrity('pet_call');
  const {data,error}=await supabase.functions.invoke('livekit-call-token',{body:{callId,petId}});
  await throwIfEdgeFunctionFailed(data,error);
  if(!data||typeof data.serverUrl!=='string'||!/^wss:\/\//i.test(data.serverUrl)||typeof data.participantToken!=='string'||data.participantToken.length<40||data.callId!==callId||!['audio','video'].includes(String(data.callType)))throw new Error('call_token_invalid');
  return data as PetCallToken;
}
