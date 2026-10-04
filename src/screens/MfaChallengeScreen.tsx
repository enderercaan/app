import {useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Alert,Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';
import {Screen} from '../components/Screen';
import {AppIcon} from '../components/AppIcon';
import {useI18n} from '../i18n';
import {challengePhoneFactor,listMfaFactors,verifyPhoneFactor,verifyTotp,type MfaFactor} from '../services/mfa';
import {userMessage} from '../services/errors';
import {useThemedStyles,type AppTheme} from '../theme';

export function MfaChallengeScreen({onVerified}:{onVerified:()=>Promise<void>}){
  const {theme,styles}=useThemedStyles(createStyles);
  ScreenCapture.usePreventScreenCapture('tailmance-mfa-challenge');
  const {t}=useI18n();
  const [factors,setFactors]=useState<MfaFactor[]>([]);
  const [factorId,setFactorId]=useState('');
  const [phoneChallengeId,setPhoneChallengeId]=useState('');
  const [code,setCode]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const operationRef=useRef(false);
  const factorEpochRef=useRef(0);
  const selected=factors.find(f=>f.id===factorId)??null;

  const load=async()=>{try{setLoading(true);const rows=(await listMfaFactors()).filter(x=>x.status==='verified');setFactors(rows);setFactorId(current=>rows.some(x=>x.id===current)?current:(rows[0]?.id??''));}catch(e){Alert.alert(t('mfa.errorTitle'),userMessage(e,t('mfa.loadFailed')))}finally{setLoading(false)}};
  useEffect(()=>{void load()},[]);
  useEffect(()=>{factorEpochRef.current+=1;setPhoneChallengeId('');setCode('')},[factorId]);

  const sendPhoneCode=async()=>{
    if(!selected||selected.type!=='phone'||operationRef.current)return;
    const factorSnapshot=selected.id;const epoch=factorEpochRef.current;operationRef.current=true;
    try{setBusy(true);const id=await challengePhoneFactor(factorSnapshot);if(epoch!==factorEpochRef.current||factorId!==factorSnapshot)return;setPhoneChallengeId(id);Alert.alert(t('mfa.phoneCodeSentTitle'),t('mfa.phoneCodeSentBody'))}
    catch(e){if(epoch===factorEpochRef.current)Alert.alert(t('mfa.errorTitle'),userMessage(e,t('mfa.phoneChallengeFailed')))}finally{operationRef.current=false;setBusy(false)}
  };
  const verify=async()=>{
    if(!selected||operationRef.current)return;
    if(selected.type==='phone'&&!phoneChallengeId){await sendPhoneCode();return}
    const factorSnapshot=selected.id;const typeSnapshot=selected.type;const challengeSnapshot=phoneChallengeId;const codeSnapshot=code;const epoch=factorEpochRef.current;operationRef.current=true;
    try{setBusy(true);if(typeSnapshot==='phone')await verifyPhoneFactor(factorSnapshot,challengeSnapshot,codeSnapshot);else await verifyTotp(factorSnapshot,codeSnapshot);if(epoch!==factorEpochRef.current||factorId!==factorSnapshot)return;setCode('');await onVerified()}
    catch(e){if(epoch===factorEpochRef.current)Alert.alert(t('mfa.verifyFailedTitle'),userMessage(e,t('mfa.verifyFailedBody')))}finally{operationRef.current=false;setBusy(false)}
  };

  return <Screen><View style={styles.wrap}><View style={styles.icon}><AppIcon name="shield" size={30} color={theme.colors.primary}/></View><Text style={styles.title}>{t('mfa.challengeTitle')}</Text><Text style={styles.body}>{t('mfa.challengeBody')}</Text>{loading?<ActivityIndicator style={{marginTop:20}} color={theme.colors.primary}/>:<>{factors.length>1?<View style={styles.factorList}>{factors.map(f=><Pressable key={f.id} accessibilityRole="button" accessibilityState={{selected:factorId===f.id}} onPress={()=>setFactorId(f.id)} style={[styles.factor,factorId===f.id&&styles.factorSelected]}><Text style={styles.factorText}>{f.friendlyName} · {f.type==='phone'?t('mfa.phoneFactor'):t('mfa.authenticatorFactor')}</Text></Pressable>)}</View>:null}{selected?.type==='phone'&&!phoneChallengeId?<Pressable accessibilityRole="button" accessibilityState={{disabled:busy}} disabled={busy} onPress={()=>void sendPhoneCode()} style={[styles.button,busy&&styles.disabled]}><Text style={styles.buttonText}>{t('mfa.sendPhoneCode')}</Text></Pressable>:<><TextInput value={code} onChangeText={setCode} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={6} placeholder="123456" placeholderTextColor={theme.colors.muted} style={styles.input} accessibilityLabel={t('mfa.codeLabel')}/><Pressable accessibilityRole="button" accessibilityState={{disabled:busy||!factorId||code.replace(/\s/g,'').length!==6}} disabled={busy||!factorId||code.replace(/\s/g,'').length!==6} onPress={()=>void verify()} style={[styles.button,(busy||!factorId||code.replace(/\s/g,'').length!==6)&&styles.disabled]}><Text style={styles.buttonText}>{busy?t('mfa.verifying'):t('mfa.verify')}</Text></Pressable>{selected?.type==='phone'?<Pressable accessibilityRole="button" accessibilityState={{disabled:busy}} disabled={busy} onPress={()=>void sendPhoneCode()} style={styles.resend}><Text style={styles.resendText}>{t('mfa.resendPhoneCode')}</Text></Pressable>:null}</>}</>}</View></Screen>
}
const createStyles=(theme:AppTheme)=>StyleSheet.create({wrap:{flex:1,justifyContent:'center',padding:24},icon:{width:62,height:62,borderRadius:21,backgroundColor:theme.colors.primarySoft,alignItems:'center',justifyContent:'center',alignSelf:'center'},title:{marginTop:18,...theme.type.h1,color:theme.colors.text,textAlign:'center'},body:{marginTop:8,...theme.type.body,color:theme.colors.muted,textAlign:'center'},factorList:{marginTop:18,gap:8},factor:{minHeight:46,borderWidth:1,borderColor:theme.colors.border,borderRadius:14,paddingHorizontal:14,justifyContent:'center'},factorSelected:{borderColor:theme.colors.primary,backgroundColor:theme.colors.primarySoft},factorText:{color:theme.colors.text,fontWeight:'800'},input:{marginTop:20,minHeight:54,borderWidth:1,borderColor:theme.colors.border,borderRadius:15,paddingHorizontal:16,color:theme.colors.text,fontSize:22,fontWeight:'800',letterSpacing:8,textAlign:'center',backgroundColor:theme.colors.surface},button:{marginTop:14,minHeight:52,borderRadius:26,backgroundColor:theme.colors.primary,alignItems:'center',justifyContent:'center'},disabled:{opacity:.45},buttonText:{color:theme.colors.onPrimary,fontWeight:'900'},resend:{minHeight:44,alignItems:'center',justifyContent:'center'},resendText:{color:theme.colors.primary,fontWeight:'800'}});
