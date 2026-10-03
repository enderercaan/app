import {useEffect,useRef,useState} from 'react';
import {Alert,Pressable,StyleSheet,Text,View} from 'react-native';
import {AppIcon} from './AppIcon';
import {useI18n} from '../i18n';
import {deleteAccount,getAccountExportDownloadUrl} from '../services/api';
import {finalizeDeletedAccountSession,signOut} from '../services/auth';
import {openSafeExternalHttpsUrl} from '../services/externalLinks';
import {openSubscriptionManagement} from '../services/purchases';
import {userMessage} from '../services/errors';
import {useThemedStyles,type AppTheme} from '../theme';

type Action='export'|'subscription'|'signout'|'delete'|null;

export function LegalGateAccountActions(){
  const {theme,styles}=useThemedStyles(createStyles);const {t}=useI18n();
  const [busy,setBusy]=useState<Action>(null);const actionRef=useRef<Action>(null);const mountedRef=useRef(true);
  useEffect(()=>()=>{mountedRef.current=false;actionRef.current=null},[]);
  const run=async(action:Exclude<Action,null>,work:()=>Promise<void>)=>{
    if(actionRef.current)return;actionRef.current=action;if(mountedRef.current)setBusy(action);
    try{await work()}finally{actionRef.current=null;if(mountedRef.current)setBusy(null)}
  };
  const exportData=()=>run('export',async()=>{try{const url=await getAccountExportDownloadUrl();await openSafeExternalHttpsUrl(url)}catch(e){if(mountedRef.current)Alert.alert(t('settings.exportAlertTitle'),userMessage(e,t('settings.exportFailed')))}});
  const manageSubscription=()=>run('subscription',async()=>{try{await openSubscriptionManagement()}catch(e){if(mountedRef.current)Alert.alert(t('settings.manageFailedTitle'),userMessage(e,t('settings.manageFailedBody')))}});
  const closeSession=()=>run('signout',async()=>{try{await signOut('local')}catch(e){if(mountedRef.current)Alert.alert(t('settings.signOutFailedTitle'),userMessage(e,t('settings.signOutFailedBody')))}});
  const deletePermanently=()=>run('delete',async()=>{
    let deletion:Awaited<ReturnType<typeof deleteAccount>>;
    try{deletion=await deleteAccount()}catch(e){if(mountedRef.current)Alert.alert(t('settings.deleteFailedTitle'),userMessage(e,t('settings.deleteFailedBody')));return}
    let localCleanupWarning=false;
    try{await finalizeDeletedAccountSession()}catch{localCleanupWarning=true}
    const providers=(deletion.manualProviderRevocations??[]).map(provider=>provider==='apple'?'Apple':'Google').join(' / ');if(providers){if(mountedRef.current)Alert.alert(t('settings.oauthRevocationManualTitle'),`${localCleanupWarning?t('settings.deletedLocalWarning')+'\n\n':''}${t('settings.oauthRevocationManualBody',{providers})}`)}else if(localCleanupWarning){if(mountedRef.current)Alert.alert(t('settings.deletedTitle'),t('settings.deletedLocalWarning'))}
  });
  const confirmDelete=()=>{
    if(actionRef.current)return;
    Alert.alert(t('settings.deletePermanent'),t('settings.deletePermanentBody'),[
      {text:t('settings.cancel'),style:'cancel'},
      {text:t('settings.manageBeforeDelete'),onPress:()=>void manageSubscription()},
      {text:t('settings.deleteConfirm'),style:'destructive',onPress:()=>void deletePermanently()}
    ]);
  };
  const disabled=busy!==null;
  return <View style={styles.card}>
    <Text style={styles.title}>{t('settings.sectionAccount')}</Text>
    <Text style={styles.help}>{t('legalCenter.subtitle')}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={t('settings.exportData')} accessibilityState={{disabled}} disabled={disabled} onPress={()=>void exportData()} style={styles.row}><AppIcon name="share" size={18} color={theme.colors.primary}/><View style={styles.copy}><Text style={styles.rowTitle}>{t('settings.exportData')}</Text><Text style={styles.rowHelp}>{t('settings.exportDataHelp')}</Text></View></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={t('settings.manageStoreSubscription')} accessibilityState={{disabled}} disabled={disabled} onPress={()=>void manageSubscription()} style={styles.row}><AppIcon name="star" size={18} color={theme.colors.primary}/><View style={styles.copy}><Text style={styles.rowTitle}>{t('settings.manageStoreSubscription')}</Text><Text style={styles.rowHelp}>{t('settings.manageStoreSubscriptionHelp')}</Text></View></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={t('settings.signOutLocal')} accessibilityState={{disabled}} disabled={disabled} onPress={()=>void closeSession()} style={styles.row}><AppIcon name="logout" size={18} color={theme.colors.primary}/><Text style={styles.rowTitle}>{t('settings.signOutLocal')}</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={t('settings.deletePermanent')} accessibilityState={{disabled}} disabled={disabled} onPress={confirmDelete} style={[styles.row,styles.dangerRow]}><AppIcon name="warning" size={18} color={theme.colors.danger}/><View style={styles.copy}><Text style={[styles.rowTitle,{color:theme.colors.danger}]}>{t('settings.deletePermanent')}</Text><Text style={styles.rowHelp}>{t('settings.irreversible')}</Text></View></Pressable>
  </View>;
}

const createStyles=(theme:AppTheme)=>StyleSheet.create({
  card:{marginTop:22,padding:14,borderRadius:theme.radius.lg,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.surface,gap:8},
  title:{color:theme.colors.text,fontWeight:'900',fontSize:15},help:{color:theme.colors.muted,fontSize:12,lineHeight:18,marginBottom:2},
  row:{minHeight:52,paddingHorizontal:12,paddingVertical:10,borderRadius:12,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.surfaceAlt,flexDirection:'row',alignItems:'center',gap:10},
  dangerRow:{borderColor:theme.colors.dangerSoft},copy:{flex:1},rowTitle:{color:theme.colors.text,fontWeight:'800',fontSize:13},rowHelp:{color:theme.colors.muted,fontSize:11,lineHeight:16,marginTop:2}
});
