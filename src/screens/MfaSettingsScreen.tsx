import {useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Alert,Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';
import {Screen} from '../components/Screen';
import {TopBar} from '../components/TopBar';
import {useI18n} from '../i18n';
import {cancelMfaEnrollment,enrollPhone,enrollTotp,getMfaAalState,listMfaFactors,openTotpEnrollmentUri,unenrollMfaFactor,verifyPhoneFactor,verifyTotp,type MfaFactor,type PhoneEnrollment,type TotpEnrollment} from '../services/mfa';
import {userMessage} from '../services/errors';
import {useThemedStyles,type AppTheme} from '../theme';

export function MfaSettingsScreen(){
  const {theme,styles}=useThemedStyles(createStyles);
  ScreenCapture.usePreventScreenCapture('tailmance-mfa-settings');
  const {t}=useI18n();
  const [factors,setFactors]=useState<MfaFactor[]>([]);
  const [aal2,setAal2]=useState(false);
  const [totpEnrollment,setTotpEnrollment]=useState<TotpEnrollment|null>(null);
  const [totpCode,setTotpCode]=useState('');
  const [phone,setPhone]=useState('');
  const [phoneEnrollment,setPhoneEnrollment]=useState<PhoneEnrollment|null>(null);
  const [phoneCode,setPhoneCode]=useState('');
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const ownedEnrollmentRef=useRef<string|null>(null);
  const operationRef=useRef(false);
  const loadRequestRef=useRef(0);
  const mountedRef=useRef(true);

  const load=async()=>{
    const requestId=++loadRequestRef.current;
    try{
      if(mountedRef.current)setLoading(true);
      const [rows,aal]=await Promise.all([listMfaFactors(),getMfaAalState()]);
      if(!mountedRef.current||requestId!==loadRequestRef.current)return;
      setFactors(rows.filter(x=>x.status==='verified'));
      setAal2(aal.currentLevel==='aal2');
    }catch(e){if(mountedRef.current&&requestId===loadRequestRef.current)Alert.alert(t('mfa.errorTitle'),userMessage(e,t('mfa.loadFailed')))}
    finally{if(mountedRef.current&&requestId===loadRequestRef.current)setLoading(false)}
  };
  useEffect(()=>{mountedRef.current=true;void load();return()=>{mountedRef.current=false;loadRequestRef.current+=1;operationRef.current=true;const id=ownedEnrollmentRef.current;ownedEnrollmentRef.current=null;if(id)void cancelMfaEnrollment(id).catch(()=>undefined)}},[]);

  const startTotp=async()=>{
    if(operationRef.current||!mountedRef.current)return;operationRef.current=true;
    try{setBusy(true);const next=await enrollTotp();if(!mountedRef.current){await cancelMfaEnrollment(next.id).catch(()=>undefined);return}ownedEnrollmentRef.current=next.id;setTotpEnrollment(next);setTotpCode('')}
    catch(e){if(mountedRef.current)Alert.alert(t('mfa.errorTitle'),userMessage(e,t('mfa.enrollFailed')))}finally{operationRef.current=false;if(mountedRef.current)setBusy(false)}
  };
  const cancelEnrollment=async()=>{
    const id=totpEnrollment?.id??phoneEnrollment?.id;
    if(!id||operationRef.current||!mountedRef.current)return;operationRef.current=true;
    try{setBusy(true);await cancelMfaEnrollment(id);if(!mountedRef.current)return;ownedEnrollmentRef.current=null;setTotpEnrollment(null);setPhoneEnrollment(null);setTotpCode('');setPhoneCode('')}
    catch(e){if(mountedRef.current)Alert.alert(t('mfa.errorTitle'),userMessage(e,t('mfa.cancelFailed')))}finally{operationRef.current=false;if(mountedRef.current)setBusy(false)}
  };
  const openAuthenticator=async()=>{
    if(!totpEnrollment)return;
    try{await openTotpEnrollmentUri(totpEnrollment.uri)}catch{Alert.alert(t('mfa.authenticatorOpenFailedTitle'),t('mfa.authenticatorOpenFailedBody'))}
  };
  const confirmTotp=async()=>{
    if(!totpEnrollment||operationRef.current||!mountedRef.current)return;const factorId=totpEnrollment.id;operationRef.current=true;
    try{setBusy(true);await verifyTotp(factorId,totpCode);if(!mountedRef.current)return;ownedEnrollmentRef.current=null;setTotpEnrollment(null);setTotpCode('');await load();if(mountedRef.current)Alert.alert(t('mfa.enabledTitle'),t('mfa.enabledBody'))}
    catch(e){if(mountedRef.current)Alert.alert(t('mfa.verifyFailedTitle'),userMessage(e,t('mfa.verifyFailedBody')))}finally{operationRef.current=false;if(mountedRef.current)setBusy(false)}
  };
  const startPhone=async()=>{
    if(operationRef.current||!mountedRef.current)return;operationRef.current=true;
    try{setBusy(true);const next=await enrollPhone(phone);if(!mountedRef.current){await cancelMfaEnrollment(next.id).catch(()=>undefined);return}ownedEnrollmentRef.current=next.id;setPhoneEnrollment(next);setPhoneCode('');Alert.alert(t('mfa.phoneCodeSentTitle'),t('mfa.phoneCodeSentBody'))}
    catch(e){if(mountedRef.current)Alert.alert(t('mfa.errorTitle'),userMessage(e,t('mfa.phoneEnrollFailed')))}finally{operationRef.current=false;if(mountedRef.current)setBusy(false)}
  };
  const confirmPhone=async()=>{
    if(!phoneEnrollment||operationRef.current||!mountedRef.current)return;const enrollment=phoneEnrollment;operationRef.current=true;
    try{setBusy(true);await verifyPhoneFactor(enrollment.id,enrollment.challengeId,phoneCode);if(!mountedRef.current)return;ownedEnrollmentRef.current=null;setPhoneEnrollment(null);setPhone('');setPhoneCode('');await load();if(mountedRef.current)Alert.alert(t('mfa.enabledTitle'),t('mfa.phoneEnabledBody'))}
    catch(e){if(mountedRef.current)Alert.alert(t('mfa.verifyFailedTitle'),userMessage(e,t('mfa.verifyFailedBody')))}finally{operationRef.current=false;if(mountedRef.current)setBusy(false)}
  };
  const remove=async(factor:MfaFactor)=>{
    if(!aal2){Alert.alert(t('mfa.aal2RequiredTitle'),t('mfa.aal2RequiredBody'));return}
    if(operationRef.current||!mountedRef.current)return;operationRef.current=true;
    try{setBusy(true);const {refreshError}=await unenrollMfaFactor(factor.id);if(!mountedRef.current)return;await load();if(mountedRef.current&&refreshError)Alert.alert(t('mfa.refreshWarningTitle'),t('mfa.refreshWarningBody'))}
    catch(e){if(mountedRef.current)Alert.alert(t('mfa.errorTitle'),userMessage(e,t('mfa.removeFailed')))}finally{operationRef.current=false;if(mountedRef.current)setBusy(false)}
  };

  return <Screen><TopBar title={t('mfa.settingsTitle')} subtitle={t('mfa.settingsSubtitle')}/>{loading?<ActivityIndicator style={{marginTop:28}} color={theme.colors.primary}/>:<View style={styles.content}>
    <Text style={styles.note}>{t('mfa.securityNote')}</Text>
    {factors.map(f=><View key={f.id} style={styles.card}><View style={{flex:1}}><Text style={styles.cardTitle}>{f.friendlyName}</Text><Text style={styles.cardBody}>{f.type==='phone'?t('mfa.phoneFactor'):t('mfa.authenticatorFactor')} · {t('mfa.enabledFactor')}</Text>{f.phone?<Text style={styles.cardBody}>{f.phone}</Text>:null}</View><Pressable accessibilityRole="button" accessibilityState={{disabled:busy}} disabled={busy} onPress={()=>void remove(f)} style={styles.remove}><Text style={styles.removeText}>{t('mfa.remove')}</Text></Pressable></View>)}

    {totpEnrollment?<View style={styles.setup}><Text style={styles.setupTitle}>{t('mfa.setupTitle')}</Text><Text style={styles.setupBody}>{t('mfa.setupBody')}</Text><Text style={styles.secret}>{totpEnrollment.secret}</Text><Text style={styles.warning}>{t('mfa.secretWarning')}</Text><Pressable accessibilityRole="button" onPress={()=>void openAuthenticator()} style={styles.secondary}><Text style={styles.secondaryText}>{t('mfa.openAuthenticator')}</Text></Pressable><TextInput value={totpCode} onChangeText={setTotpCode} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={6} placeholder="123456" placeholderTextColor={theme.colors.muted} style={styles.input} accessibilityLabel={t('mfa.codeLabel')}/><Pressable accessibilityRole="button" accessibilityState={{disabled:busy||totpCode.length!==6}} disabled={busy||totpCode.length!==6} onPress={()=>void confirmTotp()} style={[styles.primary,(busy||totpCode.length!==6)&&styles.disabled]}><Text style={styles.primaryText}>{t('mfa.confirmEnable')}</Text></Pressable><Pressable accessibilityRole="button" accessibilityState={{disabled:busy}} disabled={busy} onPress={()=>void cancelEnrollment()} style={styles.cancel}><Text style={styles.cancelText}>{t('mfa.cancelSetup')}</Text></Pressable></View>:null}

    {phoneEnrollment?<View style={styles.setup}><Text style={styles.setupTitle}>{t('mfa.phoneSetupTitle')}</Text><Text style={styles.setupBody}>{t('mfa.phoneSetupBody').replace('{phone}',phoneEnrollment.phone)}</Text><TextInput value={phoneCode} onChangeText={setPhoneCode} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={6} placeholder="123456" placeholderTextColor={theme.colors.muted} style={styles.input} accessibilityLabel={t('mfa.codeLabel')}/><Pressable accessibilityRole="button" accessibilityState={{disabled:busy||phoneCode.length!==6}} disabled={busy||phoneCode.length!==6} onPress={()=>void confirmPhone()} style={[styles.primary,(busy||phoneCode.length!==6)&&styles.disabled]}><Text style={styles.primaryText}>{t('mfa.confirmEnable')}</Text></Pressable><Pressable accessibilityRole="button" accessibilityState={{disabled:busy}} disabled={busy} onPress={()=>void cancelEnrollment()} style={styles.cancel}><Text style={styles.cancelText}>{t('mfa.cancelSetup')}</Text></Pressable></View>:null}

    {!totpEnrollment&&!phoneEnrollment?<><Text style={styles.sectionTitle}>{t('mfa.addSecondFactor')}</Text><Pressable accessibilityRole="button" accessibilityState={{disabled:busy}} disabled={busy} onPress={()=>void startTotp()} style={styles.primary}><Text style={styles.primaryText}>{t('mfa.addAuthenticator')}</Text></Pressable><View style={styles.phoneBox}><TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" placeholder="+905551234567" placeholderTextColor={theme.colors.muted} style={styles.phoneInput} accessibilityLabel={t('mfa.phoneLabel')}/><Pressable accessibilityRole="button" accessibilityState={{disabled:busy||phone.trim().length<8}} disabled={busy||phone.trim().length<8} onPress={()=>void startPhone()} style={[styles.secondary,styles.phoneButton,(busy||phone.trim().length<8)&&styles.disabled]}><Text style={styles.secondaryText}>{t('mfa.addPhone')}</Text></Pressable></View><Text style={styles.phoneHint}>{t('mfa.phoneHint')}</Text></>:null}
  </View>}</Screen>
}

const createStyles=(theme:AppTheme)=>StyleSheet.create({content:{padding:18,gap:14},note:{...theme.type.body,color:theme.colors.muted},sectionTitle:{color:theme.colors.text,fontWeight:'900',marginTop:2},card:{borderWidth:1,borderColor:theme.colors.border,borderRadius:18,padding:16,backgroundColor:theme.colors.surface,flexDirection:'row',alignItems:'center',gap:12},cardTitle:{color:theme.colors.text,fontWeight:'900'},cardBody:{marginTop:4,color:theme.colors.muted,fontSize:12},remove:{minHeight:42,paddingHorizontal:14,borderRadius:21,borderWidth:1,borderColor:theme.colors.danger,justifyContent:'center'},removeText:{color:theme.colors.danger,fontWeight:'900'},setup:{borderWidth:1,borderColor:theme.colors.border,borderRadius:18,padding:16,backgroundColor:theme.colors.surface},setupTitle:{...theme.type.h2,color:theme.colors.text},setupBody:{marginTop:6,...theme.type.body,color:theme.colors.muted},secret:{marginTop:14,padding:12,borderRadius:12,backgroundColor:theme.colors.background,color:theme.colors.text,fontWeight:'800',letterSpacing:1},warning:{marginTop:8,color:theme.colors.danger,fontSize:12,fontWeight:'700'},input:{marginTop:14,minHeight:52,borderWidth:1,borderColor:theme.colors.border,borderRadius:14,paddingHorizontal:14,color:theme.colors.text,fontSize:20,fontWeight:'800',letterSpacing:7,textAlign:'center'},primary:{minHeight:50,borderRadius:25,backgroundColor:theme.colors.primary,alignItems:'center',justifyContent:'center'},primaryText:{color:theme.colors.onPrimary,fontWeight:'900'},secondary:{marginTop:12,minHeight:46,borderRadius:23,borderWidth:1,borderColor:theme.colors.primary,alignItems:'center',justifyContent:'center'},secondaryText:{color:theme.colors.primary,fontWeight:'900'},cancel:{marginTop:10,minHeight:44,alignItems:'center',justifyContent:'center'},cancelText:{color:theme.colors.muted,fontWeight:'800'},disabled:{opacity:.45},phoneBox:{gap:10},phoneInput:{minHeight:50,borderWidth:1,borderColor:theme.colors.border,borderRadius:14,paddingHorizontal:14,color:theme.colors.text,backgroundColor:theme.colors.surface},phoneButton:{marginTop:0},phoneHint:{...theme.type.caption,color:theme.colors.muted}});
