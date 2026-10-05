import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ScreenCapture from 'expo-screen-capture';
import { AppIcon } from '../components/AppIcon';
import { IconButton } from '../components/IconButton';
import { DateTimeField } from '../components/DateTimeField';
import { PrimaryButton } from '../components/PrimaryButton';
import { ShimmerSkeleton } from '../components/ShimmerSkeleton';
import { RetryNotice } from '../components/RetryNotice';
import { Screen } from '../components/Screen';
import { TopBar } from '../components/TopBar';
import { useAppData } from '../contexts/AppDataContext';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../i18n';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { deleteVaccination, getPetHealthDetails, updatePetHealthClaims, upsertVaccination } from '../services/api';
import { pickAndUploadHealthDocument } from '../services/uploads';
import { userMessage } from '../services/errors';
import { clearDurableClientOperation, getOrCreateDurableClientOperation } from '../services/clientOperation';
import type { HealthDetails, VaccinationRecord, VerificationState } from '../types/domain';
import { useThemedStyles, getTheme, type AppTheme } from '../theme';
import { formatDate } from '../services/locale';
import type { RootStackParamList } from '../navigation/types';

const verificationTone=(v:VerificationState)=>{const theme=getTheme();return v==='verified'?theme.colors.success:v==='rejected'?theme.colors.danger:theme.colors.warning};
const verificationBg=(v:VerificationState)=>{const theme=getTheme();return v==='verified'?theme.colors.successSoft:v==='rejected'?theme.colors.dangerSoft:theme.colors.warningSoft};
const isoDate=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

export function HealthScreen({route}:NativeStackScreenProps<RootStackParamList,'Health'>){const {theme,styles}=useThemedStyles(createStyles);
  ScreenCapture.usePreventScreenCapture('tailmance-health');
  const {activePet,myPets,refreshAll}=useAppData();
  const targetPet=useMemo(()=>myPets.find(p=>p.id===route.params.petId)??(activePet?.id===route.params.petId?activePet:null),[myPets,activePet,route.params.petId]);
  const {demoMode}=useAuth();
  const {t}=useI18n();
  const reduceMotion=useReduceMotion();
  const [details,setDetails]=useState<HealthDetails|null>(null);
  const [open,setOpen]=useState(false);
  const [editing,setEditing]=useState<VaccinationRecord|null>(null);
  const [vaccine,setVaccine]=useState('');
  const [dose,setDose]=useState<Date|null>(null);
  const [next,setNext]=useState<Date|null>(null);
  const [saving,setSaving]=useState(false);
  const [loading,setLoading]=useState(true);
  const [loadError,setLoadError]=useState<string|null>(null);
  const [actionBusy,setActionBusy]=useState<string|null>(null);
  const loadRequestRef=useRef(0);
  const mutationRef=useRef(false);
  const mountedRef=useRef(true); const petEpochRef=useRef(0);
  const activePetIdRef=useRef(targetPet?.id);activePetIdRef.current=targetPet?.id;
  const isCurrentPet=(petId:string,epoch:number)=>mountedRef.current&&activePetIdRef.current===petId&&petEpochRef.current===epoch;

  const load=async()=>{
    const requestId=++loadRequestRef.current;
    if(!targetPet){if(requestId===loadRequestRef.current)setLoading(false);return}
    if(demoMode){if(requestId===loadRequestRef.current){setDetails({summary:targetPet.health,vaccinations:[],documents:[],attestations:[]});setLoadError(null);setLoading(false)}return}
    try{setLoading(true);setLoadError(null);const nextDetails=await getPetHealthDetails(targetPet.id);if(requestId===loadRequestRef.current&&activePetIdRef.current===targetPet.id&&mountedRef.current)setDetails(nextDetails)}catch(e){if(requestId===loadRequestRef.current&&activePetIdRef.current===targetPet.id&&mountedRef.current)setLoadError(userMessage(e,t('health.loadFailedFallback')))}finally{if(requestId===loadRequestRef.current&&activePetIdRef.current===targetPet.id&&mountedRef.current)setLoading(false)}
  };
  useEffect(()=>{petEpochRef.current+=1;loadRequestRef.current+=1;mutationRef.current=false;setSaving(false);setActionBusy(null);setDetails(null);setOpen(false);setEditing(null);setVaccine('');setDose(null);setNext(null);void load();return()=>{loadRequestRef.current+=1}},[targetPet?.id,demoMode]);
  useEffect(()=>()=>{mountedRef.current=false;petEpochRef.current+=1;loadRequestRef.current+=1;mutationRef.current=false},[]);

  const vaccineCount=details?.vaccinations.length??0;
  const verifiedVaccineCount=useMemo(()=>details?.vaccinations.filter(v=>v.verificationStatus==='verified').length??0,[details?.vaccinations]);
  if(!targetPet)return <Screen><Text>{t('health.noPet')}</Text></Screen>;
  const h=details?.summary??targetPet.health;
  const verificationLabel=(state:VerificationState)=>t(`health.verification.${state}`);

  const closeEditor=()=>setOpen(false);
  const showEditor=(v?:VaccinationRecord)=>{
    setEditing(v??null);setVaccine(v?.vaccineName??'');setDose(v?.doseDate?new Date(`${v.doseDate}T12:00:00`):null);setNext(v?.nextDueDate?new Date(`${v.nextDueDate}T12:00:00`):null);setOpen(true);
  };
  const saveVaccine=async()=>{
    if(mutationRef.current)return;
    if(!vaccine.trim()){Alert.alert(t('health.vaccineNameRequired'));return}
    if(dose&&next&&next<dose){Alert.alert(t('health.dateCheckTitle'),t('health.dateCheckBody'));return}
    const petId=targetPet.id;const epoch=petEpochRef.current;const vaccinationId=editing?.id;const vaccineName=vaccine.trim();const doseDate=dose?isoDate(dose):undefined;const nextDueDate=next?isoDate(next):undefined;
    mutationRef.current=true;
    try{
      setSaving(true);setActionBusy('vaccine-save');
      const operation=await getOrCreateDurableClientOperation('vaccination',[petId,vaccinationId,vaccineName,doseDate,nextDueDate]);
      if(!isCurrentPet(petId,epoch))return;
      await upsertVaccination({petId,vaccinationId,vaccineName,doseDate,nextDueDate,operationId:operation.id});
      await clearDurableClientOperation(operation.key,operation.id);
      if(!isCurrentPet(petId,epoch))return;setOpen(false);await load();
    }catch(e){if(isCurrentPet(petId,epoch))Alert.alert(t('health.saveFailed'),userMessage(e))}
    finally{if(isCurrentPet(petId,epoch)){mutationRef.current=false;setSaving(false);setActionBusy(null)}}
  };
  const updateNeutering=async(value:boolean|null)=>{if(demoMode||mutationRef.current)return;const petId=targetPet.id;const epoch=petEpochRef.current;mutationRef.current=true;try{setActionBusy('claims');await updatePetHealthClaims(petId,value);if(!isCurrentPet(petId,epoch))return;await Promise.all([load(),refreshAll()])}catch(e){if(isCurrentPet(petId,epoch))Alert.alert(t('health.updateFailed'),userMessage(e))}finally{if(isCurrentPet(petId,epoch)){mutationRef.current=false;setActionBusy(null)}}};
  const deleteVaccineRecord=async(vaccinationId:string)=>{if(demoMode||mutationRef.current)return;const petId=targetPet.id;const epoch=petEpochRef.current;mutationRef.current=true;try{setActionBusy(`delete:${vaccinationId}`);await deleteVaccination(petId,vaccinationId);if(isCurrentPet(petId,epoch))await load()}catch(e){if(isCurrentPet(petId,epoch))Alert.alert(t('health.deleteFailed'),userMessage(e))}finally{if(isCurrentPet(petId,epoch)){mutationRef.current=false;setActionBusy(null)}}};
  const uploadConsentRef=useRef(false);
  const confirmUpload=()=>{if(uploadConsentRef.current){void uploadDocument();return}Alert.alert(t('health.uploadConsentTitle'),t('health.uploadConsentBody'),[{text:t('common.cancel'),style:'cancel'},{text:t('health.uploadConsentConfirm'),onPress:()=>{uploadConsentRef.current=true;void uploadDocument()}}])};
  const uploadDocument=async()=>{if(demoMode||mutationRef.current)return;const petId=targetPet.id;const epoch=petEpochRef.current;mutationRef.current=true;try{setActionBusy('document-upload');await pickAndUploadHealthDocument(petId,'health_record');if(!isCurrentPet(petId,epoch))return;Alert.alert(t('health.documentUploadedTitle'),t('health.documentUploadedBody'));await load()}catch(e){if(isCurrentPet(petId,epoch))Alert.alert(t('health.documentUploadFailed'),userMessage(e))}finally{if(isCurrentPet(petId,epoch)){mutationRef.current=false;setActionBusy(null)}}};

  return <Screen>
    <TopBar title={t('health.title')} subtitle={t('health.subtitle',{name:targetPet.name})} actionLabel={t('health.addVaccine')} actionIcon="plus" onAction={()=>showEditor()}/>
    <ScrollView contentContainerStyle={styles.body}>
      {loadError?<RetryNotice title={t('health.retryTitle')} body={loadError} retrying={loading} onRetry={()=>void load()}/>:null}
      <View style={styles.hero}>
        <View style={styles.heroIcon}><AppIcon name="health" size={26} color={theme.colors.primary}/></View>
        <View style={{flex:1}}><Text style={styles.heroTitle}>{t('health.privateTitle')}</Text><Text style={styles.heroBody}>{t('health.privateBody')}</Text></View>
      </View>

      <Text style={styles.section}>{t('health.summary')}</Text>
      <View style={styles.summaryGrid}>
        <SummaryCard icon="health" title={t('health.vaccine')} value={h.vaccinationStatus==='complete'?t('health.vaccineComplete'):h.vaccinationStatus==='incomplete'?t('health.vaccineIncomplete'):t('health.unknown')} tone={h.vaccinationStatus==='complete'?'success':h.vaccinationStatus==='incomplete'?'warning':'neutral'}/>
        <SummaryCard icon="paw" title={t('health.neutering')} value={h.neutered===true?t('health.neutered'):h.neutered===false?t('health.notNeutered'):t('health.unknown')} tone="neutral"/>
        <SummaryCard icon="verified" title={t('health.microchip')} value={h.microchipVerified?t('health.verified'):t('health.unverified')} tone={h.microchipVerified?'success':'neutral'}/>
      </View>
      <View style={styles.claimCard}>
        <View style={styles.claimHead}><View style={styles.claimIcon}><AppIcon name="paw" size={18} color={theme.colors.primary}/></View><View style={{flex:1}}><Text style={styles.claimTitle}>{t('health.neuteringClaim')}</Text><Text style={styles.help}>{t('health.neuteringClaimBody')}</Text></View></View>
        <View style={styles.chips}>{[{v:true,l:t('health.neutered')},{v:false,l:t('health.notNeutered')},{v:null,l:t('health.unknown')}].map(x=><Pressable accessibilityRole="button" key={x.l} accessibilityState={{selected:h.neutered===x.v,disabled:Boolean(actionBusy)}} disabled={Boolean(actionBusy)} onPress={()=>void updateNeutering(x.v)} style={[styles.chip,h.neutered===x.v&&styles.chipOn]}><Text style={[styles.chipText,h.neutered===x.v&&styles.chipTextOn]}>{x.l}</Text></Pressable>)}</View>
      </View>

      <View style={styles.sectionHead}><View><Text style={styles.section}>{t('health.vaccineRecords')}</Text><Text style={styles.sectionSub}>{t('health.recordSummary',{count:vaccineCount,verified:verifiedVaccineCount})}</Text></View><Pressable accessibilityRole="button" onPress={()=>showEditor()} style={styles.inlineAction}><AppIcon name="plus" size={15} color={theme.colors.primary}/><Text style={styles.inlineActionText}>{t('health.newVaccine')}</Text></Pressable></View>
      {loading&&!details?<View style={styles.recordsLoading}><ShimmerSkeleton height={74} radius={theme.radius.lg}/><ShimmerSkeleton height={74} radius={theme.radius.lg}/><Text style={styles.help}>{t('health.loadingVaccines')}</Text></View>:details?.vaccinations.length?details.vaccinations.map(v=><Pressable accessibilityRole="button" key={v.id} onPress={()=>showEditor(v)} style={styles.vaccine}>
        <View style={styles.vaccineIcon}><AppIcon name="health" size={18} color={theme.colors.primary}/></View>
        <View style={{flex:1}}><View style={styles.vaccineTitleRow}><Text style={styles.vaccineTitle}>{v.vaccineName}</Text><View style={[styles.status,{backgroundColor:verificationBg(v.verificationStatus)}]}><Text style={[styles.statusText,{color:verificationTone(v.verificationStatus)}]}>{verificationLabel(v.verificationStatus)}</Text></View></View><Text style={styles.small}>{t('health.doseNext',{dose:v.doseDate||t('health.unspecified'),next:v.nextDueDate||t('health.unspecified')})}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('health.deleteRecordA11y',{name:v.vaccineName})} hitSlop={10} accessibilityState={{disabled:Boolean(actionBusy)}} disabled={Boolean(actionBusy)} onPress={()=>Alert.alert(t('health.deleteRecordTitle'),t('health.deleteRecordBody'),[{text:t('common.cancel')},{text:t('health.delete'),style:'destructive',onPress:()=>void deleteVaccineRecord(v.id)}])}><AppIcon name="close" size={18} color={theme.colors.danger}/></Pressable>
      </Pressable>):!loadError?<View style={styles.emptyCard}><AppIcon name="health" size={24} color={theme.colors.primary}/><Text style={styles.emptyTitle}>{t('health.emptyTitle')}</Text><Text style={styles.help}>{t('health.emptyBody')}</Text></View>:<Text style={styles.recordsUnavailable}>{t('health.recordsUnavailable')}</Text>}

      <View style={styles.sectionHead}><View style={styles.sectionHeadText}><Text style={styles.section}>{t('health.documentsTitle')}</Text><Text style={styles.sectionSub}>{t('health.documentsSubtitle')}</Text><Text testID="health.automatedReviewNotice" accessibilityRole="text" style={styles.sectionSub}>{t('health.automatedReviewNotice')}</Text></View></View>
      {h.documentCheck?.approved?<View testID="health.documentCheckApproved" style={styles.trustEvidence}><AppIcon name="verified" size={18} color={theme.colors.success}/><View style={{flex:1}}><Text style={styles.claimTitle}>{t('health.documentCheckApproved')}</Text>{h.documentCheck.validUntil?<Text style={styles.small}>{t('health.documentCheckValidUntil',{date:formatDate(h.documentCheck.validUntil)})}</Text>:null}<Text style={styles.help}>{t('health.documentCheckNote')}</Text></View></View>:null}
      <Pressable accessibilityRole="button" accessibilityState={{disabled:Boolean(actionBusy)}} disabled={Boolean(actionBusy)} style={styles.upload} onPress={confirmUpload}><View style={styles.uploadIcon}><AppIcon name="plus" size={19} color={theme.colors.primary}/></View><View style={{flex:1}}><Text style={styles.uploadTitle}>{t('health.uploadDocument')}</Text><Text style={styles.help}>{t('health.uploadDocumentBody')}</Text></View><AppIcon name="chevron" size={17} color={theme.colors.muted}/></Pressable>
      {details?.documents.map(d=><View key={d.id} style={styles.doc}><View style={styles.docIcon}><AppIcon name="health" size={17} color={theme.colors.primary}/></View><View style={{flex:1}}><Text style={styles.docTitle}>{d.documentType==='health_record'?t('health.document.healthRecord'):d.documentType.replaceAll('_',' ')}</Text><Text style={styles.small}>{formatDate(d.createdAt)}</Text></View><View style={[styles.status,{backgroundColor:verificationBg(d.verificationStatus)}]}><Text style={[styles.statusText,{color:verificationTone(d.verificationStatus)}]}>{verificationLabel(d.verificationStatus)}</Text></View></View>)}

      <View style={styles.secondarySignals}><View style={styles.signal}><AppIcon name="verified" size={17} color={h.geneticScreeningAvailable?theme.colors.success:theme.colors.muted}/><Text style={styles.signalText}>{h.geneticScreeningAvailable?t('health.geneticAvailable'):t('health.geneticUnavailable')}</Text></View><View style={styles.signal}><AppIcon name="verified" size={17} color={h.pedigreeAvailable?theme.colors.success:theme.colors.muted}/><Text style={styles.signalText}>{h.pedigreeAvailable?t('health.pedigreeAvailable'):t('health.pedigreeUnavailable')}</Text></View></View>

      <View style={styles.disclaimer}><AppIcon name="info" size={18} color={theme.colors.warning}/><Text style={styles.disclaimerText}>{t('health.disclaimer')}</Text></View>
    </ScrollView>

    <Modal visible={open} transparent animationType={reduceMotion?'none':'slide'} onRequestClose={closeEditor}><KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS==='ios'?'padding':undefined}><View accessibilityViewIsModal style={styles.sheet}>
      <View style={styles.sheetHead}><View style={{flex:1}}><Text style={styles.sheetTitle}>{editing?t('health.editVaccine'):t('health.addVaccine')}</Text><Text style={styles.sheetSub}>{t('health.editorSubtitle')}</Text></View><IconButton icon="close" label={t('common.close')} onPress={closeEditor}/></View>
      <ScrollView keyboardShouldPersistTaps="handled"><Text style={styles.fieldLabel}>{t('health.vaccineName')}</Text><TextInput accessibilityLabel={t('health.vaccineName')} value={vaccine} onChangeText={setVaccine} placeholder={t('health.vaccinePlaceholder')} placeholderTextColor={theme.colors.muted} maxLength={120} style={styles.input}/>
      <DateTimeField label={t('health.doseDate')} dateOnly value={dose} maximumDate={new Date()} onChange={setDose}/><Pressable accessibilityRole="button" onPress={()=>setDose(null)} style={styles.clearDate}><Text style={styles.clearDateText}>{t('health.clearDoseDate')}</Text></Pressable>
      <DateTimeField label={t('health.nextDose')} dateOnly value={next} minimumDate={dose??new Date()} onChange={setNext}/><Pressable accessibilityRole="button" onPress={()=>setNext(null)} style={styles.clearDate}><Text style={styles.clearDateText}>{t('health.clearNextDate')}</Text></Pressable>
      <PrimaryButton label={t('health.save')} icon="check" loading={saving} disabled={Boolean(actionBusy)&&actionBusy!=='vaccine-save'} onPress={()=>void saveVaccine()}/></ScrollView>
    </View></KeyboardAvoidingView></Modal>
  </Screen>;
}

function SummaryCard({icon,title,value,tone}:{icon:Parameters<typeof AppIcon>[0]['name'];title:string;value:string;tone:'success'|'warning'|'neutral'}){const {theme,styles}=useThemedStyles(createStyles);
  const color=tone==='success'?theme.colors.success:tone==='warning'?theme.colors.warning:theme.colors.text;
  const bg=tone==='success'?theme.colors.successSoft:tone==='warning'?theme.colors.warningSoft:theme.colors.surfaceAlt;
  return <View style={styles.summaryCard}><View style={[styles.summaryIcon,{backgroundColor:bg}]}><AppIcon name={icon} size={18} color={color}/></View><Text style={styles.summaryTitle}>{title}</Text><Text style={[styles.summaryValue,{color}]}>{value}</Text></View>;
}

const createStyles=(theme:AppTheme)=>StyleSheet.create({recordsLoading:{padding:20,alignItems:'center'},recordsUnavailable:{padding:16,color:theme.colors.muted},
  body:{padding:16,paddingBottom:64},hero:{padding:15,borderRadius:theme.radius.xl,backgroundColor:theme.colors.primarySoft,flexDirection:'row',gap:12,alignItems:'flex-start'},heroIcon:{width:46,height:46,borderRadius:16,backgroundColor:theme.colors.surface,alignItems:'center',justifyContent:'center'},heroTitle:{fontWeight:'900',fontSize:15,color:theme.colors.text},heroBody:{marginTop:4,fontSize:11,lineHeight:16,color:theme.colors.textSoft},
  section:{fontWeight:'900',fontSize:13,color:theme.colors.text,marginTop:22},sectionSub:{fontSize:11,color:theme.colors.muted,marginTop:3},sectionHeadText:{flex:1,minWidth:0},sectionHead:{flexDirection:'row',alignItems:'flex-end',justifyContent:'space-between',gap:12},summaryGrid:{flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:9},summaryCard:{width:'48%',minHeight:112,padding:13,borderRadius:theme.radius.lg,backgroundColor:theme.colors.surface,borderWidth:1,borderColor:theme.colors.border},summaryIcon:{width:34,height:34,borderRadius:12,alignItems:'center',justifyContent:'center'},summaryTitle:{marginTop:10,fontSize:11,fontWeight:'800',color:theme.colors.muted,letterSpacing:.3},summaryValue:{marginTop:4,fontWeight:'900',fontSize:14},
  trustEvidence:{marginTop:12,padding:14,borderRadius:theme.radius.lg,backgroundColor:theme.colors.successSoft,borderWidth:1,borderColor:theme.colors.border,flexDirection:'row',gap:10,alignItems:'center'},claimCard:{marginTop:12,padding:14,borderRadius:theme.radius.lg,backgroundColor:theme.colors.surface,borderWidth:1,borderColor:theme.colors.border},claimHead:{flexDirection:'row',gap:9,alignItems:'center'},claimIcon:{width:36,height:36,borderRadius:13,backgroundColor:theme.colors.primarySoft,alignItems:'center',justifyContent:'center'},claimTitle:{fontWeight:'900',color:theme.colors.text},help:{fontSize:11,lineHeight:14,color:theme.colors.muted,marginTop:3},chips:{flexDirection:'row',flexWrap:'wrap',gap:7,marginTop:12},chip:{minHeight:44,paddingHorizontal:11,borderRadius:theme.radius.pill,backgroundColor:theme.colors.surfaceAlt,justifyContent:'center'},chipOn:{backgroundColor:theme.colors.primary},chipText:{fontSize:11,fontWeight:'900',color:theme.colors.text},chipTextOn:{color:theme.colors.onPrimary},
  inlineAction:{minHeight:44,paddingHorizontal:10,borderRadius:theme.radius.pill,backgroundColor:theme.colors.primarySoft,flexDirection:'row',gap:5,alignItems:'center'},inlineActionText:{fontSize:11,fontWeight:'900',color:theme.colors.primary},vaccine:{marginTop:8,padding:13,borderRadius:theme.radius.lg,backgroundColor:theme.colors.surface,borderWidth:1,borderColor:theme.colors.border,flexDirection:'row',alignItems:'center',gap:10},vaccineIcon:{width:38,height:38,borderRadius:13,backgroundColor:theme.colors.primarySoft,alignItems:'center',justifyContent:'center'},vaccineTitleRow:{flexDirection:'row',alignItems:'center',gap:7},vaccineTitle:{flex:1,fontWeight:'900',fontSize:13,color:theme.colors.text},small:{marginTop:4,fontSize:11,color:theme.colors.muted},status:{paddingHorizontal:8,paddingVertical:5,borderRadius:theme.radius.pill},statusText:{fontSize:11,fontWeight:'900'},emptyCard:{marginTop:8,padding:20,borderRadius:theme.radius.lg,backgroundColor:theme.colors.surface,borderWidth:1,borderColor:theme.colors.border,alignItems:'center'},emptyTitle:{marginTop:8,fontWeight:'900',color:theme.colors.text},
  upload:{marginTop:9,padding:13,borderRadius:theme.radius.lg,backgroundColor:theme.colors.surface,borderWidth:1,borderColor:theme.colors.border,flexDirection:'row',alignItems:'center',gap:10},uploadIcon:{width:38,height:38,borderRadius:13,backgroundColor:theme.colors.primarySoft,alignItems:'center',justifyContent:'center'},uploadTitle:{fontWeight:'900',fontSize:12,color:theme.colors.text},doc:{marginTop:8,padding:12,borderRadius:theme.radius.lg,backgroundColor:theme.colors.surface,borderWidth:1,borderColor:theme.colors.border,flexDirection:'row',gap:9,alignItems:'center'},docIcon:{width:34,height:34,borderRadius:12,backgroundColor:theme.colors.surfaceAlt,alignItems:'center',justifyContent:'center'},docTitle:{fontWeight:'900',fontSize:11,color:theme.colors.text},secondarySignals:{marginTop:16,flexDirection:'row',gap:8},signal:{flex:1,minHeight:48,padding:10,borderRadius:theme.radius.md,backgroundColor:theme.colors.surfaceAlt,flexDirection:'row',alignItems:'center',gap:7},signalText:{flex:1,fontSize:11,fontWeight:'800',color:theme.colors.textSoft},disclaimer:{marginTop:18,padding:13,borderRadius:theme.radius.lg,backgroundColor:theme.colors.warningSoft,flexDirection:'row',gap:8,alignItems:'flex-start'},disclaimerText:{flex:1,fontSize:11,lineHeight:15,color:theme.colors.textSoft},
  backdrop:{flex:1,justifyContent:'flex-end',backgroundColor:theme.colors.overlay},sheet:{padding:18,paddingBottom:30,backgroundColor:theme.colors.background,borderTopLeftRadius:theme.radius.xxl,borderTopRightRadius:theme.radius.xxl},sheetHead:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:12,marginBottom:12},sheetTitle:{...theme.type.h2,color:theme.colors.text},sheetSub:{marginTop:3,...theme.type.caption,color:theme.colors.muted},fieldLabel:{fontSize:12,fontWeight:'900',color:theme.colors.text,marginBottom:5},input:{minHeight:50,borderWidth:1,borderColor:theme.colors.border,borderRadius:theme.radius.md,backgroundColor:theme.colors.surface,paddingHorizontal:12,marginBottom:10,color:theme.colors.text},two:{flexDirection:'row',gap:8},clearDate:{minHeight:44,alignSelf:'flex-start',justifyContent:'center'},clearDateText:{fontSize:11,fontWeight:'800',color:theme.colors.muted}
});
