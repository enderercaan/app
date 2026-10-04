import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const files=[];const walk=d=>{for(const n of readdirSync(d)){const p=join(d,n);statSync(p).isDirectory()?walk(p):files.push(p)}};walk('src');
const tsx=files.filter(f=>f.endsWith('.tsx'));
const reactHooks=['useEffect','useState','useRef','useMemo','useCallback','useContext','useReducer','useLayoutEffect'];
for(const f of tsx){const source=readFileSync(f,'utf8');for(const hook of reactHooks){if(!new RegExp(`\\b${hook}\\s*\\(`).test(source))continue;const namedImport=/import\s+React\s*,?\s*\{([^}]*)\}\s*from\s*['"]react['"]/.exec(source)?.[1]??/import\s*\{([^}]*)\}\s*from\s*['"]react['"]/.exec(source)?.[1]??'';assert.match(namedImport,new RegExp(`\\b${hook}\\b`),`${f}: ${hook} is used but not imported from React`)}}
for(const f of tsx){const s=readFileSync(f,'utf8');assert.doesNotMatch(s,/fontSize:(?:[0-9]|10)(?![0-9])/,`${f}: fontSize below 11`);assert.doesNotMatch(s,/e instanceof Error\?e\.message/,`${f}: raw technical error exposed`)}
const theme=readFileSync('src/theme.ts','utf8');
const hex=name=>new RegExp(`${name}: '([^']+)'`).exec(theme)?.[1];
const lum=h=>{const a=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(x=>x<=.03928?x/12.92:((x+.055)/1.055)**2.4);return .2126*a[0]+.7152*a[1]+.0722*a[2]};
const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
assert.ok(contrast(hex('muted'),hex('background'))>=4.5,'Muted text must meet AA contrast on app background');
assert.ok(contrast(hex('white'),hex('primary'))>=4.5,'Primary buttons must meet AA contrast');
const palette=name=>{const start=theme.indexOf(`const ${name}`);assert.ok(start>=0,`Missing ${name}`);const end=theme.indexOf(name==='lightColors'?'} as const;':'};',start);assert.ok(end>start,`Could not parse ${name}`);return Object.fromEntries([...theme.slice(start,end).matchAll(/([A-Za-z][A-Za-z0-9]*):\s*'(#[0-9A-Fa-f]{6})'/g)].map(m=>[m[1],m[2]]))};
const lightPalette=palette('lightColors');const darkPalette=palette('darkColors');
for(const [name,p] of [['light',lightPalette],['dark',darkPalette]]){
  for(const [fg,bg,label] of [['text','background','body text'],['muted','background','muted text'],['onPrimary','primary','primary action'],['onAccent','accent','accent badge'],['onSuccess','success','success status']])assert.ok(contrast(p[fg],p[bg])>=4.5,`${name} ${label} must meet AA contrast`);
}
assert.match(theme,/useColorScheme\(\)/,'Theme must subscribe to system appearance changes');assert.match(theme,/scheme === 'dark' \? darkTheme : lightTheme/,'Theme must select the dark palette from the system scheme');
const appConfigSource=readFileSync('app.config.ts','utf8');const packageSource=JSON.parse(readFileSync('package.json','utf8'));
assert.match(appConfigSource,/userInterfaceStyle:\s*'automatic'/,'Expo appearance must follow the system theme');assert.match(appConfigSource,/expo-splash-screen[\s\S]*dark:\s*\{[\s\S]*backgroundColor:\s*'#0F172A'/,'Splash screen needs a dark launch background');assert.match(appConfigSource,/['\"]expo-system-ui['\"]/,'Android automatic appearance needs expo-system-ui config');assert.equal(packageSource.dependencies['expo-system-ui'],'~57.0.4','expo-system-ui must match the Expo SDK 57 line');
const themedSources=tsx.filter(f=>readFileSync(f,'utf8').includes('useThemedStyles'));
const styledSources=tsx.filter(f=>/StyleSheet\.create/.test(readFileSync(f,'utf8')));
assert.deepEqual([...themedSources].sort(),[...styledSources].sort(),'Every TSX source with a StyleSheet must use reactive themed styles');
for(const f of themedSources){const source=readFileSync(f,'utf8');assert.doesNotMatch(source,/import\s*\{\s*theme\s*\}/,`${f}: static theme import must not remain`);assert.match(source,/createStyles\s*=\s*\(theme:\s*AppTheme\)/,`${f}: themed StyleSheet factory missing`)}
const appThemeRoot=readFileSync('App.tsx','utf8');assert.match(appThemeRoot,/useTheme\(\)[\s\S]*StatusBar style=\{theme\.mode==='dark'\?'light':'dark'\}/,'Status bar must react to dark/light appearance');assert.match(appThemeRoot,/createStyles=\(theme:AppTheme\)/,'Root gate styles must be theme-aware');
for(const asset of ['icon.png','adaptive-foreground.png','notification-icon.png','favicon.png']){const p=join('assets',asset);assert.ok(existsSync(p)&&statSync(p).size>0,`Missing asset: ${asset}`)}
const settings=readFileSync('src/screens/SettingsScreen.tsx','utf8');const i18nSource=readFileSync('src/i18n/index.tsx','utf8');const enI18nSource=readFileSync('src/i18n/locales/en.ts','utf8');const trI18nSource=readFileSync('src/i18n/locales/tr.ts','utf8');assert.match(settings,/BlockedPets/);assert.match(settings,/ReportHistory/);assert.match(settings,/settings\.locationHelp/);assert.match(trI18nSource,/[\"']settings\.locationHelp[\"']\s*:\s*[\"'][^\"']*100 metre/);
const storeRating=readFileSync('src/services/storeRating.ts','utf8');assert.match(settings,/const rateApp=async\(\)=>[\s\S]*openStoreRating\(\)/,'Settings must call the store rating destination safely');assert.match(settings,/settings\.rateApp/,'Settings must expose a user-initiated Rate Tailmance row');assert.doesNotMatch(storeRating,/recordPositiveMomentForRating|PROMPT_COOLDOWN_MS/,'Custom proactive rating prompts must not be implemented without the platform review API');
const premium=readFileSync('src/screens/PremiumScreen.tsx','utf8');assert.doesNotMatch(premium,/\$9\.99/);assert.match(premium,/priceString/);assert.match(premium,/loadError[\s\S]*premium\.retry[\s\S]*onPress=\{\(\)=>void load\(\)\}/,'Store offering failures need a localized retry state');assert.match(premium,/storeActive[\s\S]*premium\.purchaseStoreDoneBody/,'Completed store purchase must be distinguished from entitlement sync failure');
const navigator=readFileSync('src/navigation/AppNavigator.tsx','utf8');assert.match(navigator,/isPetSetupComplete/);assert.match(navigator,/headerShown:false/);assert.match(navigator,/pendingNotification/,'Notification cold starts must wait for setup gating');
assert.match(navigator,/routeNotification\(matches:Match\[\],activePetId:string\|undefined,type\?:string,entityId\?:string,shouldRoute:/,'Push routing must preserve notification entity context and a final freshness guard');
assert.match(navigator,/type==='message'[\s\S]*matches\.find\(item=>item\.conversationId===entityId\)[\s\S]*getMatchByConversation\(activePetId,entityId\)[\s\S]*navigate\('Chat',\{conversationId:entityId,otherPet:match\.otherPet,matchId:match\.id,ownPetId:activePetId\}\)[\s\S]*TAB_ROUTES\.messages/,'Message push should open the exact active conversation in its route-bound owner-pet context even when it is outside the loaded match page, with Inbox as a safe fallback');
assert.match(navigator,/type==='health'&&entityId[\s\S]*navigate\('Health',\{petId:entityId\}\)/,'Health push notifications should open the relevant pet health screen when entity context exists');
assert.match(navigator,/type==='follow'\|\|type==='comment'[\s\S]*TAB_ROUTES\.feed/,'Social push notifications should return users to the feed instead of a generic dead end');
assert.match(navigator,/bootstrapFailed/,'Initial profile fetch failure must not fall through to onboarding');
const authContext=readFileSync('src/contexts/AuthContext.tsx','utf8');assert.match(authContext,/bootstrapStatus:'error'/,'Auth bootstrap errors must be represented explicitly');assert.match(authContext,/getSession\(\)[\s\S]*if\(error\)throw error/,'getSession errors must not be treated as signed-out');
const authScreen=readFileSync('src/screens/AuthScreen.tsx','utf8');const authService=readFileSync('src/services/auth.ts','utf8');assert.match(authScreen,/verificationPendingEmail[\s\S]*auth\.verifyResend[\s\S]*resendVerification/,'Signup must expose a recovery path to resend email verification');assert.match(authService,/supabase\.auth\.resend\(\{type:'signup'/,'Verification resend must use the authenticated provider signup-resend API');

const profile=readFileSync('src/screens/PetProfileScreen.tsx','utf8');assert.doesNotMatch(profile,/usePreventScreenCapture/);assert.match(profile,/Share\.share/);
const screenShell=readFileSync('src/components/Screen.tsx','utf8');assert.match(screenShell,/maxWidth:760/,'Shared screen shell must cap tablet and landscape content width');assert.match(screenShell,/edges=\['top','right','bottom','left'\]/,'Shared screen shell must protect top, bottom and horizontal safe areas');assert.match(profile,/heroWidth=Math\.min\(width,760\)/,'Pet profile hero must not overflow the shared tablet/landscape content width');assert.match(profile,/useSafeAreaInsets\(\)/,'Pet profile full-bleed controls must respect landscape/notch safe areas');assert.match(profile,/Screen edges=\{\['left','right','bottom'\]\}/,'Pet profile must preserve side and gesture-bar safe areas while allowing a full-bleed top hero');
for(const file of ['src/screens/AuthScreen.tsx','src/screens/ChatScreen.tsx','src/screens/LegalConsentScreen.tsx','src/screens/ResetPasswordScreen.tsx']){const source=readFileSync(file,'utf8');assert.match(source,/edges=\{\['top','right','bottom','left'\]\}/,`${file}: standalone safe-area screens must protect horizontal cutouts and gesture insets`);}
const legalLoadingSource=readFileSync('src/screens/LegalConsentScreen.tsx','utf8');assert.match(legalLoadingSource,/ShimmerSkeleton[\s\S]*accessibilityRole=\"progressbar\"|accessibilityRole=\"progressbar\"[\s\S]*ShimmerSkeleton/,'Legal consent initial load must use a motion-safe skeleton rather than a static spinner');

const health=readFileSync('src/screens/HealthScreen.tsx','utf8');const chat=readFileSync('src/screens/ChatScreen.tsx','utf8');
assert.match(chat,/conversationEpochRef=useRef\(0\)[\s\S]*latestRequestRef=useRef\(0\)[\s\S]*epoch!==conversationEpochRef\.current/,'Chat loads must ignore stale responses after the conversation changes');
assert.match(chat,/sendRequestRef=useRef\(0\)[\s\S]*targetConversationId=conversationId[\s\S]*requestId!==sendRequestRef\.current/,'Chat sends must not write an old conversation response into a newly opened chat');assert.match(health,/usePreventScreenCapture/);assert.match(chat,/usePreventScreenCapture/);
const discover=readFileSync('src/screens/DiscoverScreen.tsx','utf8');assert.match(discover,/discover\.apply/);assert.match(discover,/minWeightKg/);assert.match(discover,/microchipVerifiedOnly/);
const swipeable=readFileSync('src/components/SwipeableCard.tsx','utf8');assert.match(swipeable,/const \{t\}=useI18n\(\)/,'Swipe labels require a defined i18n translator');assert.match(swipeable,/useWindowDimensions\(\)/,'Swipe thresholds must respond to window-size changes');assert.doesNotMatch(swipeable,/Dimensions\.get\(['\"]window['\"]\)/,'Swipe width must not be frozen at module load');
const promptDomain=readFileSync('src/domain/petPrompts.ts','utf8');assert.match(promptDomain,/PET_PROMPT_IDS=\['favoriteGame','firstMeet','happyThing','atPark','likeInPets','threeWords'\]/,'Pet prompts need stable language-independent IDs');
const feed=readFileSync('src/screens/FeedScreen.tsx','utf8');assert.match(feed,/function PostCarousel[\s\S]*const reduceMotion=useReduceMotion\(\)/,'Post carousel transitions need an in-scope Reduce Motion preference');assert.match(feed,/pickAndUploadSocialImages/);assert.match(feed,/getFeedPage/);assert.match(feed,/reportAndConfirm[\s\S]*await reportContent/,'Feed reports must await backend confirmation');assert.match(feed,/deletePost[\s\S]*await deleteOwnedContent/,'Feed deletion must surface server failure');assert.match(feed,/feedError[\s\S]*feed\.retryA11y[\s\S]*refreshFeed[\s\S]*common\.retry/,'Feed must expose a localized retry state when loading fails');
const blockedPets=readFileSync('src/screens/BlockedPetsScreen.tsx','utf8');assert.match(blockedPets,/getBlockedPetsPage[\s\S]*onEndReached[\s\S]*loadMore/,'Blocked-pet history must stay bounded and pageable');const reportHistory=readFileSync('src/screens/ReportHistoryScreen.tsx','utf8');assert.match(reportHistory,/getMyReportsPage[\s\S]*onEndReached[\s\S]*loadMore/,'Report history must expose older records instead of silently truncating them');
const eventDomain=readFileSync('src/types/domain.ts','utf8');assert.match(eventDomain,/PetEvent = \{[\s\S]*neighborhood\?: string[\s\S]*capacity\?: number/,'Event domain type must include fields rendered by the event UI');
assert.match(feed,/getPostCommentsPage[\s\S]*loadOlderComments[\s\S]*oldest=comments\[0\][\s\S]*feed\.loadOlderComments/,'Comment history must page older rows instead of hiding comments beyond the first page');
assert.match(feed,/feedRequestRef=useRef\(0\)[\s\S]*requestId=\+\+feedRequestRef\.current[\s\S]*requestId!==feedRequestRef\.current/,'Feed refresh/pagination must ignore stale responses after pet, mode or refresh changes');
assert.match(feed,/commentRequestRef=useRef\(0\)[\s\S]*openComments[\s\S]*requestId=\+\+commentRequestRef\.current[\s\S]*requestId!==commentRequestRef\.current/,'Comment modal loads must ignore stale responses when another post is opened or the modal closes');
assert.match(feed,/closeComments=\(\)=>\{commentRequestRef\.current\+=1[\s\S]*onRequestClose=\{closeComments\}/,'Closing comments must invalidate in-flight comment requests');
const eventsScreen=readFileSync('src/screens/EventsScreen.tsx','utf8');assert.match(eventsScreen,/updateAttendance[\s\S]*actionRef\.current[\s\S]*await setEventAttendance/,'Event attendance must be synchronously serialized and error handled');assert.match(eventsScreen,/reportEvent[\s\S]*await reportContent/,'Event reports must await backend confirmation');
const appData=readFileSync('src/contexts/AppDataContext.tsx','utf8');assert.match(appData,/Promise\.allSettled/,'Independent app datasets must preserve partial success');assert.match(appData,/refreshAll:\(\)=>Promise<boolean>/,'Refresh must expose whether profile bootstrap verification succeeded');assert.match(appData,/getMatchesPage[\s\S]*MATCH_PAGE_SIZE[\s\S]*loadMoreMatches/,'Long-lived match lists must use paginated loading');assert.match(appData,/getStoriesPage[\s\S]*STORY_PAGE_SIZE[\s\S]*loadMoreStories/,'Story hydration must be bounded and pageable');assert.match(appData,/activePetIdRef[\s\S]*hydrateRequestRef[\s\S]*discoverRequestRef[\s\S]*contentRequestRef/,'App data hydration must guard against stale pet/filter/feed responses');assert.match(appData,/matchPageRequestRef[\s\S]*storyPageRequestRef[\s\S]*eventPageRequestRef/,'Paginated app data requests must be invalidated when the active pet changes');
assert.match(appData,/refreshMatches=useCallback[\s\S]*matchPageRequestRef\.current\+=1[\s\S]*setLoadingMoreMatches\(false\)/,'Refreshing matches must invalidate any in-flight older match page');
assert.match(appData,/contentRequestRef[\s\S]*matchPageRequestRef\.current\+=1[\s\S]*storyPageRequestRef\.current\+=1[\s\S]*eventPageRequestRef\.current\+=1/,'Replacing first-page app content must invalidate in-flight pagination responses');assert.match(appData,/getEventsPage[\s\S]*EVENT_PAGE_SIZE[\s\S]*loadMoreEvents/,'Upcoming events must be bounded and pageable');assert.match(navigator,/unreadMessageCount/,'Message tab badge must use a full-account unread aggregate rather than only the loaded match page');
assert.match(appData,/getMatchesPage\(petId,\{matchedAt:last\.lastMessageAt\?\?last\.matchedAt,id:last\.id\}/,'Paginated match cursor must follow conversation activity so old matches with new messages remain reachable');assert.match(appData,/refreshRealtimeSignals[\s\S]*isCurrentPet[\s\S]*activePetIdRef/,'Realtime refreshes must not write stale data after an active-pet switch');
const realtimeSource=readFileSync('src/services/realtime.ts','utf8');
assert.doesNotMatch(realtimeSource,/event: 'UPDATE', schema: 'public', table: 'notifications'/,'Notification read/push-status updates must not trigger global product refreshes');
assert.match(appData,/refreshRealtimeSignals[\s\S]*type==='match'\|\|type==='message'\|\|type==='like'[\s\S]*type==='comment'\|\|type==='follow'[\s\S]*types\.has\('event'\)[\s\S]*types\.has\('health'\)/,'Realtime notification inserts must refresh only the affected product domains');

const appRoot=readFileSync('App.tsx','utf8');assert.match(appRoot,/RUNTIME_CACHE_MAX_AGE_MS[\s\S]*cachedState=gateState[\s\S]*env\.appEnv!==['"]production['"]\|\|cachedState\.maintenance\|\|cachedState\.forceUpdate[\s\S]*verificationFailed/,'Runtime maintenance/force-update gate must not accept a cached allow-state when production verification fails');

const appBoundaryRoot=readFileSync('App.tsx','utf8');
const appRootPerfSource=readFileSync('App.tsx','utf8');
const imageMemorySource=readFileSync('src/services/imageMemory.ts','utf8');
assert.match(appRootPerfSource,/startImageMemoryGuard/,'root must install the image memory guard');
assert.match(imageMemorySource,/IOS_MEMORY_CACHE_CEILING_BYTES=100\*1024\*1024/,'iOS image cache must have a strict 100 MB ceiling');
assert.match(imageMemorySource,/Image\.configureCache\([\s\S]*maxMemoryCost:IOS_MEMORY_CACHE_CEILING_BYTES/,'iOS image cache must apply the configured byte ceiling');
assert.match(imageMemorySource,/AppState\.addEventListener\(['"]change['"][\s\S]*background[\s\S]*inactive[\s\S]*clearImageMemoryCache/,'image memory cache must clear when the app leaves the foreground');
assert.match(imageMemorySource,/AppState\.addEventListener\(['"]memoryWarning['"][\s\S]*clearImageMemoryCache/,'iOS memory pressure must clear image memory cache');
assert.match(feed,/function PostCarousel[\s\S]*cachePolicy="disk"/,'high-cardinality feed media must prefer disk cache over persistent memory cache');
const petCardPerfSource=readFileSync('src/components/PetCard.tsx','utf8');
assert.match(petCardPerfSource,/cachePolicy="disk"/,'discovery pet-card media must prefer disk cache');
const appBoundarySource=readFileSync('src/components/AppErrorBoundary.tsx','utf8');
const notificationsStateSource=readFileSync('src/screens/NotificationsScreen.tsx','utf8');
const petEditorStateSource=readFileSync('src/screens/PetEditorScreen.tsx','utf8');
assert.match(appBoundaryRoot,/AppErrorBoundary[\s\S]*RuntimeGate/,'Root UI needs a local crash recovery boundary');
assert.match(appBoundarySource,/getDerivedStateFromError[\s\S]*componentDidCatch/,'Error boundary needs a catch lifecycle');assert.match(appBoundarySource,/errorBoundary\.retry/,'Error boundary needs a localized retry label');assert.match(appBoundarySource,/common\.retry/,'Error boundary needs localized recovery copy');
assert.match(notificationsStateSource,/markAllNotificationsRead\(\)[\s\S]*catch[\s\S]*notifications\.markAllFailed/,'Mark-all-read failure must be visible and localized');
assert.match(notificationsStateSource,/getUnreadNotificationCount\(\)[\s\S]*unreadCount[\s\S]*notifications\.unread/,'Notification subtitle must use a server aggregate rather than only the loaded page');
assert.match(notificationsStateSource,/setUnreadCount\(count=>Math\.max\(0,count-1\)\)[\s\S]*setUnreadCount\(0\)/,'Notification unread aggregate must stay consistent after mark-one and mark-all actions');
assert.match(notificationsStateSource,/requestRef=useRef\(0\)[\s\S]*if\(reset\)\{requestRef\.current\+=1;paginationRef\.current=false;setLoadingMore\(false\)\}[\s\S]*const requestId=requestRef\.current[\s\S]*requestId!==requestRef\.current/,'Notification refresh must invalidate stale load-more responses and synchronously release the pagination lock');
assert.match(notificationsStateSource,/hasMore&&!loading&&!loadingMore/,'Notification infinite-scroll must not start while a refresh is active');
assert.match(petEditorStateSource,/const refreshed=await refreshAll\(\)[\s\S]*petEditor\.savedRefreshTitle/,'Pet save must distinguish saved data from refresh failure');
assert.match(petEditorStateSource,/pickAndUploadPetPhotos[\s\S]*missingPhotoSlots[\s\S]*petEditor\.addRemainingPhotos/,'First-run pet setup needs a batch path for remaining required photos');
assert.ok(petEditorStateSource.indexOf("petEditor.purpose")<petEditorStateSource.indexOf("petEditor.saveBasic"),'First-run required purpose must appear before the initial save action');
assert.ok(petEditorStateSource.indexOf("petEditor.photosTitle")<petEditorStateSource.indexOf("petEditor.optionalDetails"),'Optional enrichment must not sit between required setup and the three-photo onboarding step');
const uploadsSource=readFileSync('src/services/uploads.ts','utf8');
assert.match(uploadsSource,/pickAndUploadPetPhotos[\s\S]*allowsMultipleSelection:true[\s\S]*selectionLimit:uniqueSlots\.length/,'Batch pet-photo upload must cap multi-selection to the remaining required slots');
assert.match(uploadsSource,/let uploaded=0; let failed=0[\s\S]*if\(!uploaded&&failed&&firstError\)throw firstError/,'Batch pet-photo upload must preserve and report partial success instead of hiding already attached photos');
const appIconSource=readFileSync('src/components/AppIcon.tsx','utf8');const petCardSource=readFileSync('src/components/PetCard.tsx','utf8');
assert.match(appIconSource,/SymbolView/,'Application UI icons must remain native/vector symbols rather than raster icon assets');
assert.match(uploadsSource,/MAX_UPLOAD_IMAGE_EDGE = 2400/,'Health/verification image pipeline must retain the 2400px upper bound');
assert.match(uploadsSource,/MAX_SOCIAL_IMAGE_EDGE = 2048/,'Social/profile media must have a tighter transfer-size bound');
assert.match(uploadsSource,/SaveFormat\.WEBP/,'Social/profile media must support WebP normalization');
assert.match(uploadsSource,/SaveFormat\.JPEG/,'Health/verification media must retain JPEG normalization');
assert.match(uploadsSource,/ImageManipulator\.manipulateAsync[\s\S]*format:saveFormat/,'Image normalization must re-encode into a fresh cache file');
assert.match(petCardSource,/cachePolicy=\"disk\"/,'Discovery pet portraits should use disk-first image caching to bound memory growth');
assert.match(petEditorStateSource,/result\.failed\?t\('petEditor\.photosUploadedPartialBody'\)/,'Partial batch-photo success must be explained to the user');
assert.match(discover,/Haptics\.notificationAsync\(Haptics\.NotificationFeedbackType\.Success\)/,'A mutual match should provide a success haptic');
assert.match(profile,/Haptics\.notificationAsync\(Haptics\.NotificationFeedbackType\.Success\)/,'A mutual match from pet profile should provide the same success haptic');assert.doesNotMatch(discover,/rating\.title|recordPositiveMomentForRating/,'Discovery must not use a custom review prompt');assert.doesNotMatch(profile,/rating\.title|recordPositiveMomentForRating/,'Pet profile must not use a custom review prompt');
assert.match(discover,/toggleFavoriteSafe[\s\S]*catch[\s\S]*discover\.favoriteFailedTitle/,'Discovery favorite failures must be handled');
assert.match(discover,/refreshDiscover[\s\S]*await refreshAll\(\)[\s\S]*discover\.refreshFailedTitle/,'Discovery refresh failure must be visible');
const settingsStateSource=readFileSync('src/screens/SettingsScreen.tsx','utf8');
const verificationStateSource=readFileSync('src/screens/VerificationCenterScreen.tsx','utf8');
const healthStateSource=readFileSync('src/screens/HealthScreen.tsx','utf8');
const meetupsStateSource=readFileSync('src/screens/MeetupsScreen.tsx','utf8');
const blockedStateSource=readFileSync('src/screens/BlockedPetsScreen.tsx','utf8');
const reportsStateSource=readFileSync('src/screens/ReportHistoryScreen.tsx','utf8');
const likesStateSource=readFileSync('src/screens/LikesYouScreen.tsx','utf8');
assert.match(settingsStateSource,/settingsError[\s\S]*settings\.verifyFailedTitle[\s\S]*loadSettings/,'Settings fetch failures must not masquerade as defaults');
assert.match(settingsStateSource,/quietEnabled[\s\S]*quietStartMinutes[\s\S]*quietEndMinutes[\s\S]*timeZone/,'Settings must expose persisted timezone-aware quiet hours');
assert.match(settingsStateSource,/parseClock[\s\S]*start===end[\s\S]*settings\.quietInvalidTitle/,'Quiet-hour editor must reject malformed or zero-length windows');
assert.match(settingsStateSource,/changeMeasurementSystem[\s\S]*setMeasurementSystem\(next\)[\s\S]*updateMeasurementSystem\(next\)[\s\S]*setMeasurementSystem\(previous\)/,'Measurement preference needs local/server sync with rollback on failure');
const measurementLocaleSource=readFileSync('src/services/locale.ts','utf8');
assert.match(measurementLocaleSource,/kmToMiles[\s\S]*milesToKm[\s\S]*kgToPounds[\s\S]*poundsToKg/,'Metric/imperial conversions must remain centralized');
assert.match(measurementLocaleSource,/formatUnit[\s\S]*style:'unit'/,'Localized unit formatting must remain centralized');
assert.match(measurementLocaleSource,/formatDistance[\s\S]*formatUnit[\s\S]*formatWeight[\s\S]*formatUnit/,'Distance and weight display must route through localized unit formatting');
assert.match(settingsStateSource,/deleteAccount\(\)[\s\S]*settings\.deletedTitle/,'Account deletion must distinguish server deletion from local sign-out cleanup failure');
assert.match(verificationStateSource,/ownerState[\s\S]*unknown[\s\S]*verification\.state\.unknown/,'Verification fetch failures must remain unknown and localized');
assert.match(verificationStateSource,/AppState\.addEventListener\('change'[\s\S]*state==='active'[\s\S]*load\(\)/,'Owner verification status must refresh when the app returns from the external provider');
assert.match(healthStateSource,/loadError[\s\S]*health\.recordsUnavailable/,'Health load failures must not render a false empty state');
assert.match(meetupsStateSource,/loadError[\s\S]*RetryNotice[\s\S]*meetups\.retryTitle/,'Meetup load failures must not render a false empty state');
for(const [name,source] of [['blocked',blockedStateSource],['reports',reportsStateSource],['likes',likesStateSource]])assert.match(source,/loadError[\s\S]*RetryNotice/,`${name} load failures need retry UI`);
assert.ok(healthStateSource.indexOf('useMemo(')<healthStateSource.indexOf('if(!targetPet)return'),'Health hooks must execute before conditional early return');

assert.match(feed,/useSafeAreaInsets\(\)/,'Full-screen story controls must respect device safe-area insets');
assert.match(feed,/KeyboardAvoidingView[\s\S]*composeOpen/,'Feed compose modal must remain keyboard-aware');
assert.match(discover,/KeyboardAvoidingView[\s\S]*discover\.filtersTitle/,'Discovery filter modal must remain keyboard-aware');
assert.match(eventsScreen,/KeyboardAvoidingView[\s\S]*ScrollView[\s\S]*events\.createTitle/,'Event form must be keyboard-aware and scrollable');
assert.match(meetupsStateSource,/KeyboardAvoidingView[\s\S]*ScrollView[\s\S]*meetups\.composerTitle/,'Meetup form must be keyboard-aware and scrollable');

const localeSource=readFileSync('src/services/locale.ts','utf8');
assert.match(localeSource,/resolvedOptions\(\)\.locale/,'Locale formatting must derive from the device/runtime locale');
for(const file of [...tsx,'src/components/DateTimeField.tsx']){const source=readFileSync(file,'utf8');assert.doesNotMatch(source,/tr-TR|tr_TR/,`${file}: fixed Turkish date/time locale is not global-ready`);}

const legalConsentSource=readFileSync('src/screens/LegalConsentScreen.tsx','utf8');
assert.match(navigator,/const legalLocale=locale[\s\S]*getCurrentLegalContext\(legalLocale\)[\s\S]*context\.status!==['"]ready['"][\s\S]*context\.accepted===true\?['"]accepted['"]:['"]required['"]/,'Exact current country/locale legal bundle must gate social navigation');
assert.match(navigator,/legalState==='required'[\s\S]*<LegalConsentScreen/,'Outdated or missing legal consent must block access to UGC');
assert.match(navigator,/blocked_age_assurance_required[\s\S]*legalGate\.ageAssurance/,'Age-assurance legal blocks need explicit user-safe UX');
assert.match(navigator,/blocked_subnational_review_required[\s\S]*legalGate\.subnational/,'Subnational legal blocks need explicit user-safe UX');
assert.match(navigator,/blocked_legal_bundle_missing[\s\S]*legalGate\.bundleMissing/,'Missing country-language bundle must be explained without fallback');
assert.match(navigator,/blocked_unsupported_ui_locale[\s\S]*legalGate\.localeUnsupported/,'Unsupported legal locale must be explained without silent substitution');
assert.match(enI18nSource,/legalGate\.countryUnresolved[\s\S]*Device language, travel location, and app-store country are not used as substitutes/,'EN legal-gate copy must preserve legal-country independence');
assert.match(trI18nSource,/legalGate\.countryUnresolved[\s\S]*Cihaz dili, seyahat konumu veya uygulama mağazası ülkesi bunun yerine kullanılmaz/,'TR legal-gate copy must preserve legal-country independence');
assert.match(legalConsentSource,/requestedLocale=localeRef\.current[\s\S]*getCurrentLegalContext\(requestedLocale\)[\s\S]*submittedContext=context[\s\S]*acceptLegalTerms\(submittedContext\)[\s\S]*localeRef\.current!==submittedLocale/,'Legal consent must load and accept only the exact current locale-bound immutable bundle');
assert.match(legalConsentSource,/accessibilityRole="checkbox"/,'Legal acceptance needs explicit accessible consent');

const authLegalSource=readFileSync('src/screens/AuthScreen.tsx','utf8');
assert.match(authLegalSource,/getPreRegistrationLegalPresentation\(declaredCountry,locale,declaredSubnational\)/,'Signup must fetch exact country+UI-locale+subnational pre-registration legal information');
assert.match(authLegalSource,/getPreRegistrationSubnationalOptions\(declaredCountry,locale\)/,'Signup must expose exact approved subnational legal routes when countrywide notice is unavailable');
assert.match(authLegalSource,/subnationalSelectionRequired[\s\S]*auth\.subnationalRequired/,'Signup must explain when a subnational legal route is required instead of silently blocking');
assert.match(authLegalSource,/preRegistration\?\.communityGuidelinesUrl/,'Community Guidelines must be reachable from the exact pre-registration presentation');
assert.match(authLegalSource,/preRegistrationReady[\s\S]*disabled=/,'Account creation must remain disabled until the exact pre-registration legal presentation is ready');
assert.match(authLegalSource,/accessibilityViewIsModal/,'Pre-registration country picker must expose modal accessibility semantics');
const settingsLegalSource=readFileSync('src/screens/SettingsScreen.tsx','utf8');
assert.match(settingsLegalSource,/settings\.manageBeforeDelete/,'Premium account deletion must offer subscription management before destructive deletion');

const authContextSource=readFileSync('src/contexts/AuthContext.tsx','utf8');
assert.match(authContextSource,/userMessage\(error,translate\(getRuntimeLocale\(\),'auth\.sessionVerifyFallback'\)\)/,'Auth bootstrap must not surface raw backend/session error text');
const appRootSource=readFileSync('App.tsx','utf8');assert.match(appRootSource,/runtimePlatformVersion/);assert.match(appRootSource,/minimumSupportedVersions/);assert.match(appRootSource,/Platform\.OS==='ios'/);assert.match(appRootSource,/runtimeMessage[\s\S]*messages\.en/,'platform-specific runtime minimum version and localized maintenance message must remain wired');
assert.match(appRootSource,/cachedMinimum=cached\?\.config\?runtimePlatformVersion\(cached\.config\):''[\s\S]*validVersion\(cachedMinimum\)/,'Runtime cache validation must honor platform-specific minimum versions');
const chatReportSource=readFileSync('src/screens/ChatScreen.tsx','utf8');
assert.match(chatReportSource,/!mine[\s\S]*reportMessageA11y[\s\S]*confirmReportMessage\(item\.id\)/,'arbitrary incoming messages must expose a report action');

const accountStateSource=readFileSync('src/contexts/AccountStateContext.tsx','utf8');
const pausedAccountSource=readFileSync('src/screens/PausedAccountScreen.tsx','utf8');
assert.match(appRootSource,/AccountStateProvider[\s\S]*AuthenticatedApp[\s\S]*if\(paused\)return <PausedAccountScreen\/>[\s\S]*<AppDataProvider>/,'Paused accounts must gate the social data provider instead of leaving realtime/product state mounted');
assert.match(settingsStateSource,/settings\.pauseAccount[\s\S]*setPaused\(true\)/,'Settings must expose an explicit account-pause action');
assert.match(pausedAccountSource,/setPaused\(false\)[\s\S]*getAccountExportDownloadUrl[\s\S]*openSubscriptionManagement[\s\S]*deleteAccount[\s\S]*signOut/,'Paused state must preserve resume, export, subscription, deletion, and sign-out recovery actions');
assert.match(accountStateSource,/AppState\.addEventListener\('change'[\s\S]*state==='active'[\s\S]*refresh\(\)/,'Account restriction state must be reverified when the app returns to foreground');
assert.match(authContextSource,/bootstrapEpoch=useRef\(0\)[\s\S]*const epoch=\+\+bootstrapEpoch\.current[\s\S]*epoch!==bootstrapEpoch\.current[\s\S]*onAuthStateChange\(\(event,session\)=>\{bootstrapEpoch\.current\+\+/,'Auth bootstrap must invalidate stale getSession results after newer auth events');
assert.match(authContextSource,/const consume=async\(url:string\|null\)=>\{if\(!url\|\|!mounted\.current\)return;[\s\S]*await handleAuthDeepLink\(url\);if\(!mounted\.current\)return/,'Auth deep-link bootstrap must not write recovery state after provider unmount');
assert.match(appRootSource,/AccountStateProvider key=\{session\?\.user\.id\?\?'demo'\}/,'Authenticated account-scoped providers must remount when the auth subject changes');
assert.match(appRootSource,/LocalizedAppShell[\s\S]*direction:rtl\?'rtl':'ltr'/,'Runtime locale changes must apply root RTL/LTR direction without relying only on a native restart');
assert.match(accountStateSource,/refreshEpoch=useRef\(0\)[\s\S]*const epoch=\+\+refreshEpoch\.current[\s\S]*epoch!==refreshEpoch\.current[\s\S]*return\(\)=>\{mountedRef\.current=false;refreshEpoch\.current\+\+;mutationEpoch\.current\+\+\}/,'Account settings refresh and queued mutations must be invalidated after account/provider changes');
const i18nRuntimeSource=readFileSync('src/i18n/index.tsx','utf8');
assert.match(i18nRuntimeSource,/localeWriteQueue=useRef<Promise<void>>\(Promise\.resolve\(\)\)[\s\S]*localeWriteSeq[\s\S]*seq===localeWriteSeq\.current/,'Locale persistence must serialize writes and apply only the latest selection');
assert.match(i18nRuntimeSource,/measurementWriteQueue=useRef<Promise<void>>\(Promise\.resolve\(\)\)[\s\S]*measurementWriteSeq[\s\S]*seq===measurementWriteSeq\.current/,'Measurement persistence must serialize writes and apply only the latest selection');

assert.match(pausedAccountSource,/await deleteAccount\(\)[\s\S]*settings\.deleteFailedTitle[\s\S]*await finalizeDeletedAccountSession\(\)[\s\S]*manualProviderRevocations[\s\S]*settings\.oauthRevocationManualBody[\s\S]*settings\.deletedLocalWarning/,'Paused-account deletion must preserve hard-delete truth, perform complete local cleanup, and surface provider-revocation fallback');
assert.doesNotMatch(accountStateSource,/e instanceof Error\?e\.message/,'Account-state verification must not expose raw server errors');
const suspendedAccountSource=readFileSync('src/screens/SuspendedAccountScreen.tsx','utf8');
assert.match(appRootSource,/if\(suspended\)return <SuspendedAccountScreen\/>[\s\S]*if\(paused\)return <PausedAccountScreen\/>/,'Administrative suspension must take precedence over user pause');
assert.match(suspendedAccountSource,/getAccountExportDownloadUrl[\s\S]*openSubscriptionManagement[\s\S]*deleteAccount[\s\S]*signOut/,'Suspended accounts must retain export, subscription, deletion, and sign-out controls');
assert.match(suspendedAccountSource,/await deleteAccount\(\)[\s\S]*settings\.deleteFailedTitle[\s\S]*await finalizeDeletedAccountSession\(\)[\s\S]*settings\.deletedLocalWarning/,'Suspended-account deletion must preserve hard-delete truth while performing complete local cleanup after server deletion');
assert.doesNotMatch(suspendedAccountSource,/setPaused\(false\)|resume/,'Administrative suspension must not be removable from the client');


const featurePolicySource=readFileSync('src/domain/featurePolicy.ts','utf8');
const matingPolicySql=readFileSync('supabase/migrations/090_plus_growth_b2b_and_pet_first_product_enforcement.sql','utf8');
const matingAuthoritySql=readFileSync('supabase/migrations/134_configured_27_runtime_legal_source_authority.sql','utf8');
assert.match(featurePolicySource,/CORE_PURPOSES[\s\S]*socialize[\s\S]*playmate[\s\S]*walk/,'Core discovery purposes must remain social/play/walk');
assert.match(featurePolicySource,/enabledPurposes\(matingOwnerArrangedEnabled:boolean,species:Species='dog'\)[\s\S]*matingOwnerArrangedEnabled&&species==='dog'/,'Mating UI must remain server-policy gated and dog-only');
assert.match(matingAuthoritySql,/current_mating_feature_enabled\(\)[\s\S]*legal_source_approval_current\(r\.legal_country_code\)[\s\S]*mating_owner_arranged_enabled[\s\S]*animal_welfare_review_complete[\s\S]*kinship_control_complete[\s\S]*evidence_reference/,'Owner-arranged mating must remain fail-closed behind current internal legal-source approval, welfare, kinship and operator evidence gates');
assert.doesNotMatch(matingAuthoritySql,/current_mating_feature_enabled\(\)[\s\S]{0,1000}counsel_approved/,'Current mating authority must not depend on external-counsel metadata');
assert.doesNotMatch(matingPolicySql,/insert\s+into\s+public\.jurisdiction_product_features[\s\S]*mating_owner_arranged_enabled\s*[,=]\s*true/i,'Source migrations must not silently enable mating for any jurisdiction');
assert.match(settingsStateSource,/changeMeasurementSystem/,'Settings measurement control remains wired after preference-race hardening');
assert.match(settingsStateSource,/privacyWriteQueue=useRef<Promise<void>>/,'Privacy settings writes must be serialized');
assert.match(settingsStateSource,/privacyWriteSequence=useRef\(0\)/,'Privacy settings must ignore stale mutation responses');
assert.match(settingsStateSource,/notificationWriteQueue=useRef<Promise<void>>/,'Notification and quiet-hour writes must share a serialized queue');
assert.match(settingsStateSource,/notificationWriteSequence=useRef\(0\)/,'Notification settings must ignore stale mutation responses');
assert.match(settingsStateSource,/notificationSnapshot=useRef<NotificationPreferences>/,'Notification mutations must build from the latest optimistic snapshot');
assert.match(meetupsStateSource,/getMeetupRequestsPage[\s\S]*loadMore[\s\S]*createdAt:last\.createdAt[\s\S]*common\.loadMore/,'Meetup history must use bounded keyset pagination with an explicit load-more path');
assert.match(petEditorStateSource,/enabledPurposes\(productPolicy\?\.matingOwnerArrangedEnabled===true,species\)\.map/,'Pet editor must expose mating only from the server-authoritative product policy');
assert.match(discover,/enabledPurposes\(productPolicy\?\.matingOwnerArrangedEnabled===true,activePet\?\.species\?\?'dog'\)/,'Discovery filters must expose mating only from the server-authoritative product policy');
assert.match(profile,/visiblePurposes\(pet\.purposes,matingEnabled,pet\.species\)/,'Pet profile must hide mating metadata unless the server-authoritative product policy enables it');
const appDataSource=readFileSync('src/contexts/AppDataContext.tsx','utf8');
assert.match(appDataSource,/api\.getFeedPage\(petId,feedMode,undefined,20\)/,'Account-scoped feed refreshes must use the bounded keyset feed API');
assert.doesNotMatch(appDataSource,/api\.getFeed\(/,'App data refreshes must not regress to the legacy feed list RPC');


const reportHistorySource=readFileSync('src/screens/ReportHistoryScreen.tsx','utf8');
const moderationAppealsSource=readFileSync('src/screens/ModerationAppealsScreen.tsx','utf8');
assert.match(reportHistorySource,/paginationRef=useRef\(false\)[\s\S]*if\(!cursor\|\|!hasMore\|\|paginationRef\.current\)return[\s\S]*paginationRef\.current=true/,'Report History pagination must use a synchronous single-flight guard');
assert.match(reportHistorySource,/requestRef=useRef\(0\)[\s\S]*requestId=\+\+requestRef\.current[\s\S]*requestId!==requestRef\.current/,'Report History refresh must reject stale page responses');
assert.match(reportHistorySource,/formatDateTime\(item\.createdAt,undefined,locale\)/,'Report History dates must follow the selected app locale');
assert.match(moderationAppealsSource,/requestRef=useRef\(0\)[\s\S]*actionRef=useRef\(false\)[\s\S]*requestId=\+\+requestRef\.current/,'Moderation Appeals must guard stale loads and duplicate submissions');
assert.match(moderationAppealsSource,/formatDate\(item\.decidedAt,undefined,locale\)[\s\S]*formatDate\(item\.redressDeadline,undefined,locale\)/,'Moderation Appeals dates must follow the selected app locale');
assert.match(pausedAccountSource,/actionRef=useRef\(false\)[\s\S]*requestedLocale=localeRef\.current[\s\S]*localeRef\.current!==requestedLocale/,'Paused-account actions must be single-flight and legal-support URLs must be locale-snapshot guarded');
assert.match(suspendedAccountSource,/requestRef=useRef\(0\)[\s\S]*actionRef=useRef\(false\)[\s\S]*requestedLocale=localeRef\.current[\s\S]*localeRef\.current!==requestedLocale/,'Suspended-account loads/actions must reject stale responses and stale legal-support URLs');
assert.match(suspendedAccountSource,/formatDate\(activeRestriction\.decidedAt,undefined,locale\)/,'Suspension decision dates must follow the selected app locale');

const resetPasswordSource=readFileSync('src/screens/ResetPasswordScreen.tsx','utf8');
const petEditorMutationSource=readFileSync('src/screens/PetEditorScreen.tsx','utf8');
const mfaChallengeSource=readFileSync('src/screens/MfaChallengeScreen.tsx','utf8');
assert.match(resetPasswordSource,/saveRef=useRef\(false\)[\s\S]*if\(saveRef\.current\)return/,'Password recovery update must be synchronous single-flight');
assert.match(resetPasswordSource,/password_changed_session_revocation_unverified[\s\S]*finishRecovery\(\)[\s\S]*else Alert\.alert\(t\('reset\.failedTitle'\)/,'Recovery must close only after the password changed, not after an ordinary update failure');
assert.match(petEditorMutationSource,/mutationRef=useRef\(false\)[\s\S]*const save=async\(\)=>\{if\(mutationRef\.current\)return[\s\S]*mutationRef\.current=true/,'Pet create/update must be atomically single-flight to prevent duplicate profiles');
assert.match(mfaChallengeSource,/operationRef=useRef\(false\)[\s\S]*factorEpochRef=useRef\(0\)[\s\S]*epoch!==factorEpochRef\.current\|\|factorId!==factorSnapshot/,'MFA challenge responses must be bound to the selected factor epoch');
assert.match(premium,/storeOperationRef=useRef\(false\)[\s\S]*purchaseLocale=localeRef\.current[\s\S]*localeRef\.current!==purchaseLocale/,'Store mutations must share one operation lock and purchases must remain bound to the reviewed locale');
assert.match(premium,/loadRequestRef=useRef\(0\)[\s\S]*requestedLocale=localeRef\.current[\s\S]*requestId!==loadRequestRef\.current\|\|localeRef\.current!==requestedLocale/,'Premium offering/legal loads must reject stale locale responses');

const likesYouSource=readFileSync('src/screens/LikesYouScreen.tsx','utf8');
const notificationsScreenSource=readFileSync('src/screens/NotificationsScreen.tsx','utf8');
assert.match(likesYouSource,/paginationRef=useRef\(false\)[\s\S]*if\(!ownPet\|\|!cursor\|\|!hasMore\|\|paginationRef\.current\)return/,'Likes You pagination must be synchronous single-flight in the route-bound pet context');
assert.match(likesYouSource,/actionRef=useRef\(false\)[\s\S]*requestId=requestRef\.current[\s\S]*like\(pet,'like',petId\)[\s\S]*requestId!==requestRef\.current/,'Likes You actions must stay bound to the route pet and ignore stale results after route/request changes');
assert.match(notificationsScreenSource,/paginationRef=useRef\(false\)[\s\S]*markAllRef=useRef\(false\)[\s\S]*openRef=useRef\(new Set<string>\(\)\)/,'Notifications pagination, mark-all and row routing must have synchronous guards');
assert.match(notificationsScreenSource,/getMatchByConversation\(petId,n\.entityId\)[\s\S]*navigate\('Chat',\{conversationId:n\.entityId/,'In-app message notifications must open the exact conversation when available');
assert.match(notificationsScreenSource,/setItems\(x=>x\.map\(i=>i\.id===n\.id\?[\s\S]*void markNotificationRead\(n\.id\)/,'Notification navigation must not wait on the read receipt network round-trip');
assert.match(notificationsScreenSource,/formatDateTime\(n\.createdAt,[\s\S]*,locale\)/,'Notification timestamps must follow the selected app locale');

assert.match(appDataSource,/userIdRef=useRef<string\|null>\(user\?\.id\?\?null\)[\s\S]*accountRequestRef=useRef\(0\)[\s\S]*requestId=\+\+accountRequestRef\.current[\s\S]*userIdRef\.current!==accountId/,'AppData refreshes must reject stale results across account changes');
assert.match(appDataSource,/if\(!accountId\)\{setMyPets\(\[\]\);markActivePet\(null\)/,'AppData must explicitly clear account-scoped state when the auth subject disappears');
assert.match(chat,/entitlementEpoch=conversationEpochRef\.current[\s\S]*entitlementEpoch===conversationEpochRef\.current[\s\S]*getConversationMessageEntitlement\(targetConversationId,senderPetId\)\.then\(next=>\{if\(epoch===conversationEpochRef\.current&&requestId===sendRequestRef\.current\)setEntitlement\(next\)/,'Chat entitlement/quota writes must remain bound to the current conversation epoch on load and after send');

assert.match(settings,/settingsLoadRef=useRef\(0\)[\s\S]*requestedLocale=localeRef\.current[\s\S]*requestId!==settingsLoadRef\.current\|\|localeRef\.current!==requestedLocale/,'Settings legal/marketing/account loads must reject stale locale responses');
assert.match(settings,/languageActionRef=useRef\(false\)[\s\S]*if\(next===locale\|\|languageActionRef\.current\)return/,'Language changes must be synchronous single-flight');

const verificationCenterSource=readFileSync('src/screens/VerificationCenterScreen.tsx','utf8');
assert.match(verificationCenterSource,/ownerCanStart=\['not_started','failed','expired','cancelled','revoked'\]\.includes\(ownerState\)/,'Owner verification must be retryable after terminal non-success outcomes');
assert.match(verificationCenterSource,/petCanStart=\['not_started','rejected','cancelled'\]\.includes\(petState\)/,'Pet verification must be retryable after rejection/cancellation');
assert.match(verificationCenterSource,/loadRequestRef=useRef\(0\)[\s\S]*requestId=\+\+loadRequestRef\.current[\s\S]*requestId!==loadRequestRef\.current/,'Verification Center must reject stale owner/pet status responses');
const legalBlockSource=readFileSync('src/components/LegalBlockScreen.tsx','utf8');
assert.match(verificationCenterSource,/Linking\.addEventListener\('url'[\s\S]*tailmance:[\\/]+verification-complete/,'Owner verification must refresh directly from the canonical provider callback, not only AppState');
assert.match(verificationCenterSource,/actionRef=useRef\(false\)[\s\S]*targetPetIdRef=useRef\(targetPet\?\.id\)[\s\S]*if\(actionRef\.current\|\|!targetPet\)return[\s\S]*targetPetIdRef\.current!==requestedPetId/,'Verification mutations must be synchronous single-flight and route-pet-snapshot guarded');
assert.match(legalBlockSource,/Linking\.addEventListener\('url'[\s\S]*tailmance:[\\/]+age-verification-complete/,'Age assurance must refresh directly from the canonical provider callback');
assert.match(legalBlockSource,/actionRef=useRef\(false\)[\s\S]*retryTimerRef=useRef[\s\S]*clearTimeout\(retryTimerRef\.current\)/,'Age assurance must prevent duplicate starts and clean up delayed retry timers');

for(const [path,label] of [
  ['src/screens/PlacesScreen.tsx','Places'],
  ['src/screens/LostPetAlertsScreen.tsx','Lost Pet Alerts'],
  ['src/screens/HealthScreen.tsx','Health']
]){
  const source=readFileSync(path,'utf8');
  assert.match(source,/loadRequestRef=useRef\(0\)/,`${label} must own a request-generation guard`);
  assert.match(source,/requestId=\+\+loadRequestRef\.current/,`${label} must generation-tag each load`);
  assert.match(source,/requestId===loadRequestRef\.current|requestId!==loadRequestRef\.current/,`${label} must ignore stale load responses`);
}
assert.match(health,/setOpen\(false\)[\s\S]*setEditing\(null\)[\s\S]*setVaccine\(''\)[\s\S]*\[targetPet\?\.id,demoMode\]/,'Health editor/draft state must reset when the routed pet changes');
assert.match(health,/mutationRef=useRef\(false\)[\s\S]*const isCurrentPet=\(petId:string,epoch:number\)=>mountedRef\.current&&activePetIdRef\.current===petId&&petEpochRef\.current===epoch[\s\S]*const petId=targetPet\.id;const epoch=petEpochRef\.current;mutationRef\.current=true[\s\S]*isCurrentPet\(petId,epoch\)/,'Health mutations must be single-flight and bound to the routed pet epoch');
assert.match(feed,/petLifecycleRef=useRef\(activePet\?\.id\)[\s\S]*pendingMediaRef=useRef\(pendingMedia\)[\s\S]*previousPetId&&previousPetId!==nextPetId[\s\S]*cancelUploadIntent/,'Feed must clear pet-scoped drafts/modals and cancel orphan upload intents when the active pet changes');

const discoverSuggestionSource=readFileSync('src/screens/DiscoverScreen.tsx','utf8');
assert.match(discoverSuggestionSource,/getDiscoverySuggestions\(activePet\.id\)[\s\S]*if\(alive\)setSuggestions/,'Discover filter suggestions must ignore stale active-pet responses');
assert.match(discoverSuggestionSource,/return\(\)=>\{alive=false\}/,'Discover filter suggestion effect must cancel stale writes');

console.log(`ux-checks: ${tsx.length} TSX files + contrast/assets/journeys checked; passed`);
