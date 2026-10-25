import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppIcon } from '../components/AppIcon';
import { Screen } from '../components/Screen';
import { TopBar } from '../components/TopBar';
import { useAppData } from '../contexts/AppDataContext';
import { useAccountState } from '../contexts/AccountStateContext';
import { getLocaleNativeName, useI18n, type AppLocale } from '../i18n';
import type { RootStackParamList } from '../navigation/types';
import { deleteAccount, getAccountExportDownloadUrl, getAccountSettings, getCurrentLegalContext, getCurrentMarketingConsentPresentation, setMarketingPushConsent, updateMeasurementSystem, updateNotificationPreferences, updatePrivacySettings } from '../services/api';
import { finalizeDeletedAccountSession, signOut } from '../services/auth';
import { updatePrivateLocation } from '../services/location';
import { ensureNotificationChannels, registerPushToken } from '../services/notifications';
import { openSubscriptionManagement } from '../services/purchases';
import { userMessage } from '../services/errors';
import { openStoreRating } from '../services/storeRating';
import { openLegalHttpsUrl } from '../services/legalLinks';
import { openSafeExternalHttpsUrl } from '../services/externalLinks';
import { useThemedStyles, type AppTheme } from '../theme';
import type { LegalContext, MarketingConsentPresentation, NotificationPreferences } from '../types/domain';
import { TAILMANCE_BRAND } from '../../brand';
import { formatTime } from '../services/locale';

const defaultNotificationPreferences: NotificationPreferences = {
  matches: true,
  messages: true,
  social: true,
  events: true,
  health: true,
  marketing: false,
  quietEnabled: false,
  quietStartMinutes: 22*60,
  quietEndMinutes: 8*60,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
};

export function SettingsScreen({navigation}:{navigation:NativeStackNavigationProp<RootStackParamList>}){const {theme,styles}=useThemedStyles(createStyles);
  const {activePet}=useAppData();
  const {setPaused}=useAccountState();
  const {t,locale,setLocale,releaseReady,measurementSystem,setMeasurementSystem}=useI18n();
  const [discoverable,setDiscoverable]=useState(true);
  const [incognito,setIncognito]=useState(false);
  const [tier,setTier]=useState<'standard'|'premium'|null>(null);
  const [dailySwipeRemaining,setDailySwipeRemaining]=useState<number|null>(null);
  const [dailyNewConversationRemaining,setDailyNewConversationRemaining]=useState<number|null>(null);
  const [quotaResetAt,setQuotaResetAt]=useState<string|null>(null);
  const [notificationPrefs,setNotificationPrefs]=useState<NotificationPreferences>(defaultNotificationPreferences);
  const [savingNotifications,setSavingNotifications]=useState(false);
  const [loadingSettings,setLoadingSettings]=useState(true);
  const [settingsError,setSettingsError]=useState<string|null>(null);
  const [languageBusy,setLanguageBusy]=useState(false);
  const [quietStartText,setQuietStartText]=useState('22:00');
  const [quietEndText,setQuietEndText]=useState('08:00');
  const [deletingAccount,setDeletingAccount]=useState(false);
  const [legalContext,setLegalContext]=useState<LegalContext|null>(null);
  const [marketingPresentation,setMarketingPresentation]=useState<MarketingConsentPresentation|null>(null);
  const privacyWriteQueue=useRef<Promise<void>>(Promise.resolve());
  const privacyWriteSequence=useRef(0);
  const privacySnapshot=useRef({discoverable:true,incognito:false});
  const notificationWriteQueue=useRef<Promise<void>>(Promise.resolve());
  const notificationWriteSequence=useRef(0);
  const notificationSnapshot=useRef<NotificationPreferences>(defaultNotificationPreferences);
  const settingsLoadRef=useRef(0);
  const localeRef=useRef(locale);localeRef.current=locale;
  const languageActionRef=useRef(false);
  const mountedRef=useRef(true); const marketingActionRef=useRef(false); const deleteActionRef=useRef(false); const measurementActionRef=useRef(false); const pushActionRef=useRef(false); const signOutActionRef=useRef(false); const locationActionRef=useRef(false); const exportActionRef=useRef(false);

  const minutesToClock=(minutes:number)=>`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
  const parseClock=(value:string)=>{const match=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());if(!match)return null;return Number(match[1])*60+Number(match[2])};

  const loadSettings=async()=>{
    const requestId=++settingsLoadRef.current;const requestedLocale=localeRef.current;
    try{
      setLoadingSettings(true);setSettingsError(null);
      const [s,currentLegalContext,currentMarketingPresentation]=await Promise.all([getAccountSettings(),getCurrentLegalContext(requestedLocale),getCurrentMarketingConsentPresentation(requestedLocale)]);
      if(requestId!==settingsLoadRef.current||localeRef.current!==requestedLocale)return;
      setLegalContext(currentLegalContext.status==='ready'&&currentLegalContext.uiLocale===requestedLocale?currentLegalContext:null);
      setMarketingPresentation(currentMarketingPresentation.status==='ready'&&currentMarketingPresentation.uiLocale===requestedLocale?currentMarketingPresentation:null);
      if(s.measurementSystem==='metric'||s.measurementSystem==='imperial')await setMeasurementSystem(s.measurementSystem);
      if(requestId!==settingsLoadRef.current||localeRef.current!==requestedLocale||!mountedRef.current)return;
      privacySnapshot.current={discoverable:s.discoverable,incognito:s.incognito};
      setDiscoverable(s.discoverable);
      setIncognito(s.incognito);
      setTier(s.tier);
      setDailySwipeRemaining(s.dailySwipeRemaining??null);
      setDailyNewConversationRemaining(s.dailyNewConversationRemaining??null);
      setQuotaResetAt(s.quotaResetAt??null);
      const nextPrefs={...defaultNotificationPreferences,...(s.notificationPreferences??{}),timeZone:s.notificationPreferences?.timeZone||defaultNotificationPreferences.timeZone};
      notificationSnapshot.current=nextPrefs;
      setNotificationPrefs(nextPrefs);
      setQuietStartText(minutesToClock(nextPrefs.quietStartMinutes));
      setQuietEndText(minutesToClock(nextPrefs.quietEndMinutes));
    }catch(e){
      if(requestId!==settingsLoadRef.current||localeRef.current!==requestedLocale)return;setTier(null);
      setSettingsError(userMessage(e,t('settings.loadFailedFallback')));
    }finally{if(requestId===settingsLoadRef.current&&localeRef.current===requestedLocale)setLoadingSettings(false)}
  };

  useEffect(()=>{mountedRef.current=true;void loadSettings();return()=>{settingsLoadRef.current+=1}},[locale]);
  useEffect(()=>()=>{mountedRef.current=false;settingsLoadRef.current+=1;privacyWriteSequence.current+=1;notificationWriteSequence.current+=1;marketingActionRef.current=false;deleteActionRef.current=false;measurementActionRef.current=false;pushActionRef.current=false;signOutActionRef.current=false;locationActionRef.current=false;exportActionRef.current=false},[]);
  useEffect(()=>{privacySnapshot.current={discoverable,incognito}},[discoverable,incognito]);
  useEffect(()=>{notificationSnapshot.current=notificationPrefs},[notificationPrefs]);

  const persistPrivacy=(nextDiscoverable:boolean,nextIncognito:boolean)=>{
    const previous=privacySnapshot.current;
    const next={discoverable:nextDiscoverable,incognito:nextIncognito};
    const sequence=++privacyWriteSequence.current;
    privacySnapshot.current=next;
    setDiscoverable(next.discoverable);
    setIncognito(next.incognito);
    privacyWriteQueue.current=privacyWriteQueue.current.catch(()=>undefined).then(async()=>{
      if(!mountedRef.current)return;
      try{
        await updatePrivacySettings(next.discoverable,next.incognito);
        if(!mountedRef.current)return;
      }catch(e){
        if(sequence===privacyWriteSequence.current){
          privacySnapshot.current=previous;
          setDiscoverable(previous.discoverable);
          setIncognito(previous.incognito);
          Alert.alert(t('settings.privacyTitle'),userMessage(e,t('settings.updateFailed')));
        }
      }
    });
    return privacyWriteQueue.current;
  };

  const queueNotificationWrite=(next:NotificationPreferences,previous:NotificationPreferences,onSaved?:(saved:NotificationPreferences)=>void)=>{
    const sequence=++notificationWriteSequence.current;
    notificationSnapshot.current=next;
    setNotificationPrefs(next);
    setSavingNotifications(true);
    notificationWriteQueue.current=notificationWriteQueue.current.catch(()=>undefined).then(async()=>{
      if(!mountedRef.current)return;
      try{
        const saved=await updateNotificationPreferences(next);
        if(!mountedRef.current)return;
        if(sequence===notificationWriteSequence.current){
          notificationSnapshot.current=saved;
          setNotificationPrefs(saved);
          onSaved?.(saved);
        }
      }catch(e){
        if(sequence===notificationWriteSequence.current){
          notificationSnapshot.current=previous;
          setNotificationPrefs(previous);
          Alert.alert(t('settings.notificationsPreferenceTitle'),userMessage(e,t('settings.updateFailed')));
        }
      }finally{
        if(sequence===notificationWriteSequence.current)setSavingNotifications(false);
      }
    });
    return notificationWriteQueue.current;
  };

  const persistNotificationPreference=(key:'matches'|'messages'|'social'|'events'|'health'|'quietEnabled',value:boolean)=>{
    const previous=notificationSnapshot.current;
    const next={...previous,[key]:value};
    return queueNotificationWrite(next,previous);
  };

  const changeMarketingConsent=(value:boolean)=>{
    const apply=async()=>{
      if(savingNotifications||marketingActionRef.current||!mountedRef.current)return;
      marketingActionRef.current=true;try{
        setSavingNotifications(true);
        if(value&&(!marketingPresentation||marketingPresentation.status!=='ready'||!marketingPresentation.baseDocument?.documentUrl||!marketingPresentation.consentDocumentSetSha256))throw new Error('marketing_legal_documents_not_ready');
        const result=await setMarketingPushConsent(value,value?marketingPresentation??undefined:undefined);
        notificationSnapshot.current=result.notificationPreferences;
        setNotificationPrefs(result.notificationPreferences);
        Alert.alert(t('settings.marketingConsentUpdatedTitle'),value?t('settings.marketingConsentGranted'):t('settings.marketingConsentWithdrawn'));
      }catch(e){Alert.alert(t('settings.notificationsPreferenceTitle'),userMessage(e,t('settings.updateFailed')))}
      finally{marketingActionRef.current=false;if(mountedRef.current)setSavingNotifications(false)}
    };
    if(!value){void apply();return}
    Alert.alert(t('settings.marketingConsentTitle'),t('settings.marketingConsentBody'),[
      {text:t('settings.cancel'),style:'cancel'},
      {text:t('settings.marketingConsentRead'),onPress:()=>void open(marketingPresentation?.baseDocument?.documentUrl??'')},
      {text:t('settings.marketingConsentGive'),onPress:()=>void apply()}
    ]);
  };

  const persistQuietHours=()=>{
    const start=parseClock(quietStartText); const end=parseClock(quietEndText);
    if(start==null||end==null||start===end){Alert.alert(t('settings.quietInvalidTitle'),t('settings.quietInvalidBody'));return Promise.resolve()}
    const previous=notificationSnapshot.current;
    const next={...previous,quietStartMinutes:start,quietEndMinutes:end,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||previous.timeZone||'UTC'};
    return queueNotificationWrite(next,previous,saved=>{
      setQuietStartText(minutesToClock(saved.quietStartMinutes));
      setQuietEndText(minutesToClock(saved.quietEndMinutes));
      Alert.alert(t('settings.quietSavedTitle'),t('settings.quietSavedBody'));
    });
  };

  const open=async(url:string)=>{
    if(!url){Alert.alert(t('settings.linkMissing'));return}
    try{await openLegalHttpsUrl(url)}catch(e){Alert.alert(t('settings.linkOpenFailedTitle'),userMessage(e,t('settings.linkOpenFailedBody')))}
  };

  const manageSubscription=async()=>{try{await openSubscriptionManagement()}catch(e){Alert.alert(t('settings.manageFailedTitle'),userMessage(e,t('settings.manageFailedBody')))}};
  const rateApp=async()=>{try{const opened=await openStoreRating();if(!opened)Alert.alert(t('settings.rateUnavailableTitle'),t('settings.rateUnavailableBody'))}catch(e){Alert.alert(t('settings.linkOpenFailedTitle'),userMessage(e,t('settings.linkOpenFailedBody')))}};
  const enablePush=async()=>{if(pushActionRef.current||!mountedRef.current)return;const petId=activePet?.id;pushActionRef.current=true;try{const ok=await registerPushToken(petId);if(mountedRef.current)Alert.alert(t('settings.pushTitle'),ok?t('settings.pushEnabled'):t('settings.pushDenied'))}catch(e){if(mountedRef.current)Alert.alert(t('settings.pushTitle'),userMessage(e,t('settings.pushFailed')))}finally{pushActionRef.current=false}};
  const performSignOut=async(scope:'local'|'global')=>{if(signOutActionRef.current||!mountedRef.current)return;signOutActionRef.current=true;try{await signOut(scope)}catch(e){if(mountedRef.current)Alert.alert(t('settings.signOutFailedTitle'),userMessage(e,t('settings.signOutFailedBody')))}finally{signOutActionRef.current=false}};
  const updateLocation=async()=>{if(!activePet||locationActionRef.current||!mountedRef.current)return;const petId=activePet.id;locationActionRef.current=true;try{await updatePrivateLocation(petId);if(mountedRef.current)Alert.alert(t('settings.locationUpdatedTitle'),t('settings.locationUpdatedBody'))}catch(e){if(mountedRef.current)Alert.alert(t('settings.locationTitle'),userMessage(e,t('settings.updateFailed')))}finally{locationActionRef.current=false}};
  const deletePermanently=async()=>{
    if(deletingAccount||deleteActionRef.current||!mountedRef.current)return;
    deleteActionRef.current=true;setDeletingAccount(true);
    let deletion:Awaited<ReturnType<typeof deleteAccount>>;
    try{deletion=await deleteAccount()}catch(e){deleteActionRef.current=false;if(mountedRef.current)setDeletingAccount(false);if(mountedRef.current)Alert.alert(t('settings.deleteFailedTitle'),userMessage(e,t('settings.deleteFailedBody')));return}
    let localCleanupWarning=false;
    try{await finalizeDeletedAccountSession()}catch{localCleanupWarning=true}
    if(mountedRef.current){
      const providers=(deletion.manualProviderRevocations??[]).map(provider=>provider==='apple'?'Apple':'Google').join(' / ');
      if(providers)Alert.alert(t('settings.oauthRevocationManualTitle'),`${localCleanupWarning?t('settings.deletedLocalWarning')+'\n\n':''}${t('settings.oauthRevocationManualBody',{providers})}`);
      else if(localCleanupWarning)Alert.alert(t('settings.deletedTitle'),t('settings.deletedLocalWarning'));
    }
    deleteActionRef.current=false;if(mountedRef.current)setDeletingAccount(false)
  };
  const confirmPauseAccount=()=>{
    Alert.alert(t('settings.pauseAccount'),t('settings.pauseAccountBody'),[
      {text:t('settings.cancel'),style:'cancel'},
      {text:t('settings.pauseConfirm'),style:'destructive',onPress:()=>void setPaused(true).catch(e=>Alert.alert(t('settings.pauseFailedTitle'),userMessage(e,t('settings.pauseFailedBody'))))}
    ]);
  };

  const confirmPermanentDelete=()=>{
    const actions=tier==='premium'
      ?[{text:t('settings.cancel'),style:'cancel' as const},{text:t('settings.manageBeforeDelete'),onPress:()=>void manageSubscription()},{text:t('settings.deleteConfirm'),style:'destructive' as const,onPress:()=>void deletePermanently()}]
      :[{text:t('settings.cancel'),style:'cancel' as const},{text:t('settings.deleteConfirm'),style:'destructive' as const,onPress:()=>void deletePermanently()}];
    Alert.alert(t('settings.deletePermanent'),t('settings.deletePermanentBody'),actions);
  };


  const changeLanguage=async(next:AppLocale)=>{
    if(next===locale||languageActionRef.current)return;languageActionRef.current=true;
    try{setLanguageBusy(true);await setLocale(next);await ensureNotificationChannels(next)}catch{Alert.alert(t('settings.languageFailedTitle'),t('settings.languageFailedBody'))}finally{languageActionRef.current=false;setLanguageBusy(false)}
  };

  const changeMeasurementSystem=async(next:'metric'|'imperial')=>{
    if(next===measurementSystem||measurementActionRef.current||!mountedRef.current)return;
    const previous=measurementSystem;measurementActionRef.current=true;
    try{await setMeasurementSystem(next);await updateMeasurementSystem(next)}catch(e){if(mountedRef.current)await setMeasurementSystem(previous).catch(()=>undefined);if(mountedRef.current)Alert.alert(t('settings.unitsFailedTitle'),userMessage(e,t('settings.unitsFailedBody')))}finally{measurementActionRef.current=false}
  };

  const exportData=async()=>{
    if(exportActionRef.current||!mountedRef.current)return;exportActionRef.current=true;
    try{
      const downloadUrl=await getAccountExportDownloadUrl();
      if(!mountedRef.current)return;
      await openSafeExternalHttpsUrl(downloadUrl);
    }catch(e){
      if(mountedRef.current)Alert.alert(t('settings.exportAlertTitle'),userMessage(e,t('settings.exportFailed')));
    }finally{exportActionRef.current=false}
  };

  return <Screen><TopBar title={t('settings.title')} subtitle={t('settings.subtitle')}/><ScrollView contentContainerStyle={styles.body}>
    {settingsError?<View accessibilityRole="alert" style={styles.settingsError}><AppIcon name="warning" size={18} color={theme.colors.danger}/><View style={{flex:1}}><Text style={styles.settingsErrorTitle}>{t('settings.verifyFailedTitle')}</Text><Text style={styles.help}>{settingsError} {t('settings.verifyFailedBody')}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={t('settings.reload')} onPress={()=>void loadSettings()} style={styles.retry}><Text style={styles.retryText}>{t('settings.retry')}</Text></Pressable></View>:null}
    <View style={styles.planCard}>
      <View style={styles.planIcon}>{loadingSettings?<ActivityIndicator color={theme.colors.primary}/>:<AppIcon name={tier==='premium'?'spark':'paw'} size={22} color={theme.colors.primary}/>}</View>
      <View style={{flex:1}}><Text style={styles.planTitle}>{tier==null?t('settings.accountChecking'):tier==='premium'?t('settings.premium'):t('settings.standard')}</Text><Text style={styles.help}>{tier==null?t('settings.accountCheckingBody'):tier==='premium'?t('settings.premiumBody'):t('settings.standardBody',{swipes:dailySwipeRemaining??'—',chats:dailyNewConversationRemaining??'—',time:quotaResetAt?formatTime(quotaResetAt,{hour:'2-digit',minute:'2-digit'},locale):'—'})}</Text></View>
      <Pressable accessibilityRole="button" accessibilityState={{disabled:tier==null}} disabled={tier==null} onPress={()=>tier==='premium'?void manageSubscription():navigation.navigate('Premium')} style={[styles.planAction,tier==null&&styles.disabled]}><Text style={styles.planActionText}>{tier==='premium'?t('settings.manage'):t('settings.premiumAction')}</Text></Pressable>
    </View>

    <Section title={t('settings.sectionLanguage')}/>
    <View style={styles.languageCard}>
      <Text style={styles.help}>{t('settings.languageHelp')}</Text>
      <View style={styles.languageOptions}>
        {releaseReady.map(code=><Pressable key={code} accessibilityRole="button" accessibilityLabel={getLocaleNativeName(code)} accessibilityState={{selected:locale===code,disabled:languageBusy}} disabled={languageBusy} onPress={()=>void changeLanguage(code)} style={[styles.languageOption,locale===code&&styles.languageOptionSelected]}><Text style={[styles.languageOptionText,locale===code&&styles.languageOptionTextSelected]}>{getLocaleNativeName(code)}</Text></Pressable>)}
      </View>
    </View>


    <Section title={t('settings.sectionUnits')}/>
    <View style={styles.languageCard}>
      <Text style={styles.help}>{t('settings.unitsHelp')}</Text>
      <View style={styles.languageOptions}>
        <Pressable accessibilityRole="button" accessibilityState={{selected:measurementSystem==='metric'}} onPress={()=>void changeMeasurementSystem('metric')} style={[styles.languageOption,measurementSystem==='metric'&&styles.languageOptionSelected]}><Text style={[styles.languageOptionText,measurementSystem==='metric'&&styles.languageOptionTextSelected]}>{t('settings.unitsMetric')}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{selected:measurementSystem==='imperial'}} onPress={()=>void changeMeasurementSystem('imperial')} style={[styles.languageOption,measurementSystem==='imperial'&&styles.languageOptionSelected]}><Text style={[styles.languageOptionText,measurementSystem==='imperial'&&styles.languageOptionTextSelected]}>{t('settings.unitsImperial')}</Text></Pressable>
      </View>
    </View>

    <Section title={t('settings.sectionPrivacy')}/>
    <ToggleRow icon="search" title={t('settings.discoverable')} help={t('settings.discoverableHelp')} value={discoverable} disabled={tier==null} onChange={v=>void persistPrivacy(v,incognito)}/>
    <ToggleRow icon="privacy" title={t('settings.incognito')} help={tier==='premium'?t('settings.incognitoPremiumHelp'):t('settings.incognitoLockedHelp')} value={incognito} disabled={tier!=='premium'||loadingSettings} onChange={v=>void persistPrivacy(discoverable,v)}/>
    <InfoRow icon="lock" title={t('settings.screenProtection')} help={t('settings.screenProtectionHelp')}/>
    <Row icon="location" title={t('settings.locationUpdate')} help={t('settings.locationHelp')} onPress={()=>void updateLocation()}/>

    <Section title={t('settings.sectionNotifications')}/>
    <View style={styles.notificationIntro}>
      <View style={styles.rowIcon}><AppIcon name="bell" size={19} color={theme.colors.primary}/></View>
      <View style={{flex:1}}><Text style={styles.rowText}>{t('settings.pushPermission')}</Text><Text style={styles.help}>{t('settings.pushPermissionHelp')}</Text></View>
      <Pressable accessibilityRole="button" onPress={()=>void enablePush()} style={styles.smallButton}><Text style={styles.smallButtonText}>{t('settings.enable')}</Text></Pressable>
    </View>
    <ToggleRow icon="heart" title={t('settings.notifyMatches')} help={t('settings.notifyMatchesHelp')} value={notificationPrefs.matches} disabled={savingNotifications||tier==null} onChange={v=>void persistNotificationPreference('matches',v)}/>
    <ToggleRow icon="chat" title={t('settings.notifyMessages')} help={t('settings.notifyMessagesHelp')} value={notificationPrefs.messages} disabled={savingNotifications||tier==null} onChange={v=>void persistNotificationPreference('messages',v)}/>
    <ToggleRow icon="person" title={t('settings.notifySocial')} help={t('settings.notifySocialHelp')} value={notificationPrefs.social} disabled={savingNotifications||tier==null} onChange={v=>void persistNotificationPreference('social',v)}/>
    <ToggleRow icon="calendar" title={t('settings.notifyEvents')} help={t('settings.notifyEventsHelp')} value={notificationPrefs.events} disabled={savingNotifications||tier==null} onChange={v=>void persistNotificationPreference('events',v)}/>
    <ToggleRow icon="health" title={t('settings.notifyHealth')} help={t('settings.notifyHealthHelp')} value={notificationPrefs.health} disabled={savingNotifications||tier==null} onChange={v=>void persistNotificationPreference('health',v)}/>
    <ToggleRow icon="spark" title={t('settings.notifyMarketing')} help={t('settings.notifyMarketingHelp')} value={notificationPrefs.marketing} disabled={savingNotifications||tier==null} onChange={changeMarketingConsent}/>
    <View style={styles.marketingLegalCard}>
      <Text style={styles.marketingLegalTitle}>{t('settings.marketingDocumentsTitle')}</Text>
      <Text style={styles.help}>{t('settings.marketingDocumentsBody')}</Text>
      <Pressable accessibilityRole="link" accessibilityState={{disabled:!marketingPresentation?.baseDocument?.documentUrl}} disabled={!marketingPresentation?.baseDocument?.documentUrl} onPress={()=>void open(marketingPresentation?.baseDocument?.documentUrl??'')} style={styles.marketingLegalLink}><Text style={styles.smallButtonText}>{t('settings.marketingConsentRead')}</Text></Pressable>
      {marketingPresentation?.overlayDocuments?.map(document=><Pressable key={document.overlayDocumentId} accessibilityRole="link" onPress={()=>void open(document.documentUrl)} style={styles.marketingLegalLink}><Text style={styles.smallButtonText}>{t('settings.marketingOverlayDocument',{jurisdiction:[document.jurisdictionCountryCode,document.jurisdictionSubnationalCode].filter(Boolean).join('-'),locale:document.documentLocale})}</Text></Pressable>)}
      {marketingPresentation?.comprehensionDocument?<Pressable accessibilityRole="link" onPress={()=>void open(marketingPresentation.comprehensionDocument?.documentUrl??'')} style={styles.marketingLegalLink}><Text style={styles.smallButtonText}>{t('settings.marketingComprehensionDocument',{locale:marketingPresentation.comprehensionDocument.documentLocale})}</Text></Pressable>:null}
      {marketingPresentation?.comprehensionOverlayDocuments?.map(document=><Pressable key={document.comprehensionDocumentId} accessibilityRole="link" onPress={()=>void open(document.documentUrl)} style={styles.marketingLegalLink}><Text style={styles.smallButtonText}>{t('settings.marketingComprehensionDocument',{locale:document.documentLocale})}</Text></Pressable>)}
    </View>
    <ToggleRow icon="moon" title={t('settings.quietHours')} help={t('settings.quietHoursHelp',{timeZone:notificationPrefs.timeZone})} value={notificationPrefs.quietEnabled} disabled={savingNotifications||tier==null} onChange={v=>void persistNotificationPreference('quietEnabled',v)}/>
    {notificationPrefs.quietEnabled?<View style={styles.quietCard}><View style={styles.quietField}><Text style={styles.quietLabel}>{t('settings.quietStart')}</Text><TextInput accessibilityLabel={t('settings.quietStart')} value={quietStartText} onChangeText={setQuietStartText} maxLength={5} autoCapitalize="none" keyboardType="numbers-and-punctuation" style={styles.quietInput}/></View><View style={styles.quietField}><Text style={styles.quietLabel}>{t('settings.quietEnd')}</Text><TextInput accessibilityLabel={t('settings.quietEnd')} value={quietEndText} onChangeText={setQuietEndText} maxLength={5} autoCapitalize="none" keyboardType="numbers-and-punctuation" style={styles.quietInput}/></View><Pressable accessibilityRole="button" accessibilityState={{disabled:savingNotifications}} disabled={savingNotifications} onPress={()=>void persistQuietHours()} style={[styles.quietSave,savingNotifications&&styles.disabled]}><Text style={styles.smallButtonText}>{t('settings.quietSave')}</Text></Pressable></View>:null}

    <Section title={t('settings.sectionSafety')}/>
    <Row icon="lock" title={t('settings.mfa')} help={t('settings.mfaHelp')} onPress={()=>navigation.navigate('MfaSettings')}/>
    <Row icon="shield" title={t('settings.safetyCenter')} help={t('settings.safetyCenterHelp')} onPress={()=>navigation.navigate('SafetyCenter')}/>
    <Row icon="shield" title={t('settings.blockedPets')} help={t('settings.blockedPetsHelp')} onPress={()=>activePet&&navigation.navigate('BlockedPets',{petId:activePet.id})}/>
    <Row icon="lock" title={t('v5.privacy.title')} help={t('v5.settings.privacyHelp')} onPress={()=>activePet&&navigation.navigate('SocialPrivacy',{petId:activePet.id})}/>
    <Row icon="health" title={t('v5.care.title')} help={t('v5.settings.careHelp')} onPress={()=>activePet&&navigation.navigate('Care',{petId:activePet.id})}/>
    <Row icon="person" title={t('v5.community.title')} help={t('v5.settings.communitiesHelp')} onPress={()=>activePet&&navigation.navigate('Communities',{petId:activePet.id})}/>
    <Row icon="info" title={t('v5.support.title')} help={t('v5.settings.supportHelp')} onPress={()=>navigation.navigate('Support')}/>
    <Row icon="flag" title={t('settings.reportHistory')} help={t('settings.reportHistoryHelp')} onPress={()=>navigation.navigate('ReportHistory')}/>
    <Row icon="flag" title={t('settings.guidelines')} onPress={()=>void open(legalContext?.communityGuidelinesUrl??'')}/>
    <Row icon="person" title={t('settings.support')} help={t('settings.supportHelp')} onPress={()=>void open(legalContext?.supportUrl??'')}/>
    <Row icon="star" title={t('settings.rateApp')} help={t('settings.rateAppHelp')} onPress={()=>void rateApp()}/>

    <Section title={t('settings.sectionLegalPrivacy')}/>
    <Row icon="privacy" title={t('settings.legalPrivacyCenter')} help={t('settings.legalPrivacyCenterHelp')} onPress={()=>navigation.navigate('LegalPrivacy')}/>

    <Section title={t('settings.sectionSubscription')}/>
    <Row icon="star" title={t('settings.manageStoreSubscription')} help={t('settings.manageStoreSubscriptionHelp')} onPress={()=>void manageSubscription()}/>

    <Section title={t('settings.sectionAbout')}/>
    <View accessible accessibilityLabel={`${t('settings.ownerBody',{owner:TAILMANCE_BRAND.owner})} ${t('settings.rightsNotice',{year:TAILMANCE_BRAND.copyrightYear,owner:TAILMANCE_BRAND.owner})} ${t('settings.trademarkNotice',{mark:TAILMANCE_BRAND.trademark,owner:TAILMANCE_BRAND.owner})}`} style={styles.aboutCard}>
      <View style={styles.rowIcon}><AppIcon name="paw" size={19} color={theme.colors.primary}/></View>
      <View style={{flex:1}}><Text style={styles.rowText}>{t('settings.ownerTitle')}</Text><Text style={styles.help}>{t('settings.ownerBody',{owner:TAILMANCE_BRAND.owner})}</Text><Text style={styles.help}>{t('settings.rightsNotice',{year:TAILMANCE_BRAND.copyrightYear,owner:TAILMANCE_BRAND.owner})}</Text><Text style={styles.help}>{t('settings.trademarkNotice',{mark:TAILMANCE_BRAND.trademark,owner:TAILMANCE_BRAND.owner})}</Text></View>
    </View>

    <Section title={t('settings.sectionAccount')}/>
    <Row icon="pause" title={t('settings.pauseAccount')} help={t('settings.pauseAccountHelp')} onPress={confirmPauseAccount}/>
    <Row icon="share" title={t('settings.exportData')} help={t('settings.exportDataHelp')} onPress={()=>void exportData()}/>
    <Row icon="refresh" title={t('settings.signOutLocal')} onPress={()=>void performSignOut('local')}/>
    <Row icon="shield" title={t('settings.signOutGlobal')} onPress={()=>Alert.alert(t('settings.signOutGlobalTitle'),t('settings.signOutGlobalBody'),[{text:t('settings.cancel')},{text:t('settings.signOut'),style:'destructive',onPress:()=>void performSignOut('global')}])}/>
    <Pressable accessibilityRole="button" accessibilityState={{disabled:deletingAccount}} disabled={deletingAccount} style={[styles.deleteRow,deletingAccount&&styles.disabled]} onPress={confirmPermanentDelete}>
      <View style={styles.rowIcon}><AppIcon name="warning" size={19} color={theme.colors.danger}/></View>
      <View style={{flex:1}}><Text style={styles.deleteText}>{t('settings.deletePermanent')}</Text><Text style={styles.help}>{t('settings.irreversible')}</Text></View>
      <AppIcon name="chevron" size={17} color={theme.colors.danger}/>
    </Pressable>
  </ScrollView></Screen>;
}

function Section({title}:{title:string}){const {styles}=useThemedStyles(createStyles);return <Text style={styles.section}>{title}</Text>}
function ToggleRow({icon,title,help,value,onChange,disabled}:{icon:Parameters<typeof AppIcon>[0]['name'];title:string;help:string;value:boolean;onChange:(v:boolean)=>void;disabled?:boolean}){const {theme,styles}=useThemedStyles(createStyles);return <View style={[styles.row,disabled&&{opacity:.55}]}><View style={styles.rowIcon}><AppIcon name={icon} size={19} color={theme.colors.primary}/></View><View style={{flex:1}}><Text style={styles.rowText}>{title}</Text><Text style={styles.help}>{help}</Text></View><Switch accessibilityLabel={title} accessibilityState={{checked:value,disabled:Boolean(disabled)}} value={value} disabled={disabled} onValueChange={onChange} trackColor={{false:theme.colors.borderStrong,true:theme.colors.primarySoft}} thumbColor={value?theme.colors.primary:theme.colors.surface}/></View>}
function InfoRow({icon,title,help}:{icon:Parameters<typeof AppIcon>[0]['name'];title:string;help:string}){const {theme,styles}=useThemedStyles(createStyles);return <View style={[styles.row,{backgroundColor:theme.colors.primarySoft,borderColor:theme.colors.primarySoft}]}><View style={[styles.rowIcon,{backgroundColor:theme.colors.surface}]}><AppIcon name={icon} size={19} color={theme.colors.primary}/></View><View style={{flex:1}}><Text style={styles.rowText}>{title}</Text><Text style={styles.help}>{help}</Text></View><AppIcon name="check" size={18} color={theme.colors.success}/></View>}
function Row({icon,title,help,onPress}:{icon:Parameters<typeof AppIcon>[0]['name'];title:string;help?:string;onPress:()=>void}){const {theme,styles}=useThemedStyles(createStyles);return <Pressable accessibilityRole="button" onPress={onPress} style={({pressed})=>[styles.row,pressed&&{opacity:.7}]}><View style={styles.rowIcon}><AppIcon name={icon} size={19} color={theme.colors.primary}/></View><View style={{flex:1}}><Text style={styles.rowText}>{title}</Text>{help?<Text style={styles.help}>{help}</Text>:null}</View><AppIcon name="chevron" size={17} color={theme.colors.muted}/></Pressable>}
const createStyles=(theme:AppTheme)=>StyleSheet.create({
  body:{padding:16,paddingBottom:60},
  planCard:{padding:15,borderRadius:theme.radius.xl,backgroundColor:theme.colors.primarySoft,flexDirection:'row',alignItems:'center',gap:11,marginBottom:10},
  planIcon:{width:44,height:44,borderRadius:16,backgroundColor:theme.colors.surface,alignItems:'center',justifyContent:'center'},
  planTitle:{fontWeight:'900',fontSize:16,color:theme.colors.text},
  planAction:{minHeight:44,paddingHorizontal:13,borderRadius:20,backgroundColor:theme.colors.primary,alignItems:'center',justifyContent:'center'},
  planActionText:{fontWeight:'900',fontSize:11,color:theme.colors.onPrimary},
  disabled:{opacity:.45},
  settingsError:{padding:12,borderRadius:theme.radius.lg,backgroundColor:theme.colors.dangerSoft,flexDirection:'row',alignItems:'center',gap:9,marginBottom:10},
  settingsErrorTitle:{fontWeight:'900',color:theme.colors.danger,fontSize:12},
  retry:{minHeight:44,paddingHorizontal:10,borderRadius:theme.radius.pill,backgroundColor:theme.colors.surface,alignItems:'center',justifyContent:'center'},
  retryText:{fontSize:11,fontWeight:'900',color:theme.colors.primary},
  section:{marginTop:20,marginBottom:8,fontWeight:'900',color:theme.colors.muted,fontSize:11,letterSpacing:1.2},
  languageCard:{padding:12,borderRadius:theme.radius.lg,backgroundColor:theme.colors.surface,borderWidth:1,borderColor:theme.colors.border,marginBottom:8},
  languageOptions:{marginTop:10,flexDirection:'row',gap:8,flexWrap:'wrap'},
  languageOption:{minHeight:44,paddingHorizontal:16,borderRadius:theme.radius.pill,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.surfaceAlt,alignItems:'center',justifyContent:'center'},
  languageOptionSelected:{borderColor:theme.colors.primary,backgroundColor:theme.colors.primarySoft},
  languageOptionText:{fontSize:12,fontWeight:'900',color:theme.colors.textSoft},
  languageOptionTextSelected:{color:theme.colors.primary},
  row:{minHeight:70,backgroundColor:theme.colors.surface,borderRadius:theme.radius.lg,borderWidth:1,borderColor:theme.colors.border,padding:12,marginBottom:8,flexDirection:'row',alignItems:'center',gap:11},
  aboutCard:{minHeight:88,backgroundColor:theme.colors.surface,borderRadius:theme.radius.lg,borderWidth:1,borderColor:theme.colors.border,padding:12,marginBottom:8,flexDirection:'row',alignItems:'flex-start',gap:11},
  notificationIntro:{minHeight:78,backgroundColor:theme.colors.primarySoft,borderRadius:theme.radius.lg,padding:12,marginBottom:8,flexDirection:'row',alignItems:'center',gap:11},
  rowIcon:{width:38,height:38,borderRadius:13,backgroundColor:theme.colors.primarySoft,alignItems:'center',justifyContent:'center'},
  rowText:{fontWeight:'900',color:theme.colors.text,fontSize:13},
  help:{marginTop:3,fontSize:11,color:theme.colors.muted,lineHeight:15},
  smallButton:{minHeight:44,paddingHorizontal:11,borderRadius:theme.radius.pill,backgroundColor:theme.colors.primary,alignItems:'center',justifyContent:'center'},
  smallButtonText:{fontSize:11,fontWeight:'900',color:theme.colors.onPrimary},
  quietCard:{backgroundColor:theme.colors.surface,borderRadius:theme.radius.lg,borderWidth:1,borderColor:theme.colors.border,padding:12,marginBottom:8,flexDirection:'row',alignItems:'flex-end',gap:8,flexWrap:'wrap'},
  quietField:{minWidth:96,flexGrow:1},
  quietLabel:{fontSize:11,fontWeight:'800',color:theme.colors.textSoft,marginBottom:5},
  quietInput:{minHeight:44,borderWidth:1,borderColor:theme.colors.border,borderRadius:theme.radius.md,paddingHorizontal:12,color:theme.colors.text,backgroundColor:theme.colors.background,fontVariant:['tabular-nums']},
  quietSave:{minHeight:44,paddingHorizontal:14,borderRadius:theme.radius.pill,backgroundColor:theme.colors.primary,alignItems:'center',justifyContent:'center'},
  deleteRow:{minHeight:70,backgroundColor:theme.colors.dangerSoft,borderRadius:theme.radius.lg,borderWidth:1,borderColor:theme.colors.danger,padding:12,marginTop:20,flexDirection:'row',alignItems:'center',gap:11},
  deleteText:{fontWeight:'900',color:theme.colors.danger,fontSize:13},
  marketingLegalCard:{marginTop:8,marginBottom:6,padding:12,borderRadius:theme.radius.lg,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.surfaceAlt},
  marketingLegalTitle:{fontSize:12,fontWeight:'900',color:theme.colors.text,marginBottom:4},
  marketingLegalLink:{minHeight:44,justifyContent:'center',alignSelf:'flex-start',paddingHorizontal:8,marginTop:4}
});
