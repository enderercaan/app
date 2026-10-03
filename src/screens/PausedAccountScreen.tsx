import {useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Alert,Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {AppIcon} from '../components/AppIcon';
import {Screen} from '../components/Screen';
import {useAccountState} from '../contexts/AccountStateContext';
import {useI18n} from '../i18n';
import {deleteAccount,getAccountExportDownloadUrl,getRestrictedAccountLegalSupport} from '../services/api';
import {finalizeDeletedAccountSession,signOut} from '../services/auth';
import {userMessage} from '../services/errors';
import {openLegalHttpsUrl} from '../services/legalLinks';
import {openSafeExternalHttpsUrl} from '../services/externalLinks';
import {openSubscriptionManagement} from '../services/purchases';
import { useThemedStyles, type AppTheme } from '../theme';

export function PausedAccountScreen(){const {theme,styles}=useThemedStyles(createStyles);
  const {t,locale}=useI18n();
  const {settings,setPaused}=useAccountState();
  const [busy,setBusy]=useState(false);
  const actionRef=useRef(false);
  const mountedRef=useRef(true);
  const localeRef=useRef(locale);
  localeRef.current=locale;
  useEffect(()=>()=>{mountedRef.current=false;actionRef.current=false},[]);

  const run=async(action:()=>Promise<void>,fallback:string)=>{
    if(actionRef.current)return;
    actionRef.current=true;
    if(mountedRef.current)setBusy(true);
    try{await action()}catch(e){if(mountedRef.current)Alert.alert(t('paused.actionFailedTitle'),userMessage(e,fallback))}finally{actionRef.current=false;if(mountedRef.current)setBusy(false)}
  };
  const resume=()=>void run(async()=>{await setPaused(false)},t('paused.resumeFailed'));
  const exportData=()=>void run(async()=>{const downloadUrl=await getAccountExportDownloadUrl();await openSafeExternalHttpsUrl(downloadUrl)},t('settings.exportFailed'));
  const manageSubscription=()=>void run(async()=>{await openSubscriptionManagement()},t('settings.manageFailedBody'));
  const openSupport=()=>void run(async()=>{
    const requestedLocale=localeRef.current;
    const context=await getRestrictedAccountLegalSupport(requestedLocale);
    if(!mountedRef.current||localeRef.current!==requestedLocale)return;
    if(context.status!=='ready'||context.uiLocale!==requestedLocale||!context.supportUrl)throw new Error(t('settings.linkMissing'));
    await openLegalHttpsUrl(context.supportUrl);
  },t('settings.linkOpenFailedBody'));
  const deletePermanently=async()=>{
    if(actionRef.current)return;
    actionRef.current=true;if(mountedRef.current)setBusy(true);
    let deletion:Awaited<ReturnType<typeof deleteAccount>>;
    try{deletion=await deleteAccount()}catch(e){if(mountedRef.current)Alert.alert(t('settings.deleteFailedTitle'),userMessage(e,t('settings.deleteFailedBody')));actionRef.current=false;if(mountedRef.current)setBusy(false);return}
    let localCleanupWarning=false;
    try{await finalizeDeletedAccountSession()}catch{localCleanupWarning=true}
    if(mountedRef.current){
      const providers=(deletion.manualProviderRevocations??[]).map(provider=>provider==='apple'?'Apple':'Google').join(' / ');
      if(providers)Alert.alert(t('settings.oauthRevocationManualTitle'),`${localCleanupWarning?t('settings.deletedLocalWarning')+'\n\n':''}${t('settings.oauthRevocationManualBody',{providers})}`);
      else if(localCleanupWarning)Alert.alert(t('settings.deletedTitle'),t('settings.deletedLocalWarning'));
    }
    actionRef.current=false;if(mountedRef.current)setBusy(false);
  };
  const confirmDelete=()=>{
    if(actionRef.current)return;
    const actions=settings?.tier==='premium'
      ?[{text:t('settings.cancel'),style:'cancel' as const},{text:t('settings.manageBeforeDelete'),onPress:manageSubscription},{text:t('settings.deleteConfirm'),style:'destructive' as const,onPress:()=>void deletePermanently()}]
      :[{text:t('settings.cancel'),style:'cancel' as const},{text:t('settings.deleteConfirm'),style:'destructive' as const,onPress:()=>void deletePermanently()}];
    Alert.alert(t('settings.deletePermanent'),t('settings.deletePermanentBody'),actions);
  };
  return <Screen><ScrollView contentContainerStyle={styles.body}>
    <View style={styles.hero}><View style={styles.icon}><AppIcon name="pause" size={30} color={theme.colors.primary}/></View><Text style={styles.title}>{t('paused.title')}</Text><Text style={styles.bodyText}>{t('paused.body')}</Text></View>
    <Pressable accessibilityRole="button" accessibilityState={{disabled:busy}} disabled={busy} onPress={resume} style={[styles.primary,busy&&styles.disabled]}>{busy?<ActivityIndicator color={theme.colors.onPrimary}/>:<><AppIcon name="refresh" size={18} color={theme.colors.onPrimary}/><Text style={styles.primaryText}>{t('paused.resume')}</Text></>}</Pressable>
    <View style={styles.card}>
      {settings?.tier==='premium'?<Action icon="spark" title={t('settings.manageStoreSubscription')} onPress={manageSubscription} disabled={busy}/>:null}
      <Action icon="share" title={t('settings.exportData')} onPress={exportData} disabled={busy}/>
      <Action icon="info" title={t('settings.support')} onPress={openSupport} disabled={busy}/>
      <Action icon="back" title={t('settings.signOutLocal')} onPress={()=>void run(async()=>{await signOut('local')},t('settings.signOutFailedBody'))} disabled={busy}/>
    </View>
    <Pressable accessibilityRole="button" accessibilityState={{disabled:busy}} disabled={busy} onPress={confirmDelete} style={[styles.delete,busy&&styles.disabled]}><AppIcon name="close" size={18} color={theme.colors.danger}/><Text style={styles.deleteText}>{t('settings.deletePermanent')}</Text></Pressable>
    <Text style={styles.note}>{t('paused.privacyNote')}</Text>
  </ScrollView></Screen>
}
function Action({icon,title,onPress,disabled}:{icon:Parameters<typeof AppIcon>[0]['name'];title:string;onPress:()=>void;disabled:boolean}){const {theme,styles}=useThemedStyles(createStyles);return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={styles.action}><View style={styles.actionIcon}><AppIcon name={icon} size={18} color={theme.colors.primary}/></View><Text style={styles.actionText}>{title}</Text><AppIcon name="chevron" size={16} color={theme.colors.muted}/></Pressable>}
const createStyles=(theme:AppTheme)=>StyleSheet.create({body:{flexGrow:1,padding:22,paddingTop:52,paddingBottom:40},hero:{alignItems:'center',paddingVertical:16},icon:{width:66,height:66,borderRadius:23,backgroundColor:theme.colors.primarySoft,alignItems:'center',justifyContent:'center'},title:{marginTop:18,...theme.type.h1,color:theme.colors.text,textAlign:'center'},bodyText:{marginTop:8,...theme.type.body,color:theme.colors.muted,textAlign:'center',maxWidth:380},primary:{minHeight:52,borderRadius:26,backgroundColor:theme.colors.primary,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:8,marginTop:18},primaryText:{color:theme.colors.onPrimary,fontWeight:'900'},card:{marginTop:20,borderWidth:1,borderColor:theme.colors.border,borderRadius:theme.radius.xl,overflow:'hidden',backgroundColor:theme.colors.surface},action:{minHeight:58,paddingHorizontal:14,flexDirection:'row',alignItems:'center',gap:11,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:theme.colors.border},actionIcon:{width:36,height:36,borderRadius:12,backgroundColor:theme.colors.primarySoft,alignItems:'center',justifyContent:'center'},actionText:{flex:1,fontWeight:'800',color:theme.colors.text,fontSize:13},delete:{minHeight:52,marginTop:18,borderRadius:26,backgroundColor:theme.colors.dangerSoft,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:8},deleteText:{fontWeight:'900',color:theme.colors.danger},note:{marginTop:14,fontSize:11,lineHeight:16,color:theme.colors.muted,textAlign:'center'},disabled:{opacity:.5}});
