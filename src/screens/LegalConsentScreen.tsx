import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppIcon } from '../components/AppIcon';
import { PrimaryButton } from '../components/PrimaryButton';
import { ShimmerSkeleton } from '../components/ShimmerSkeleton';
import { getLegalCountryDisplayName, getLegalDocumentLocaleDisplayName, useI18n } from '../i18n';
import { acceptLegalTerms, getCurrentLegalContext } from '../services/api';
import { userMessage } from '../services/errors';
import { openLegalHttpsUrl } from '../services/legalLinks';
import type { LegalContext } from '../types/domain';
import { useThemedStyles, type AppTheme } from '../theme';
import { LegalGateAccountActions } from '../components/LegalGateAccountActions';

export function LegalConsentScreen({onAccepted}:{onAccepted:()=>Promise<void>|void}){const {theme,styles}=useThemedStyles(createStyles);
  const {t,locale}=useI18n();
  const [accepted,setAccepted]=useState(false);
  const [busy,setBusy]=useState(false);
  const [context,setContext]=useState<LegalContext|null>(null);
  const [contextError,setContextError]=useState(false);
  const contextRequestRef=useRef(0);const acceptRef=useRef(false);const mountedRef=useRef(true);const localeRef=useRef(locale);localeRef.current=locale;
  const requiredOverlayActions=context?.overlayDocuments?.some(document=>document.actionRequirement!=='none')??false;
  const acceptanceComprehension=context?.comprehensionDocuments?.filter(document=>['terms','privacy_notice','community_guidelines','jurisdiction_privacy_supplement'].includes(document.sourceDocumentType))??[];
  const acceptanceOverlayComprehension=context?.comprehensionOverlayDocuments?.filter(document=>document.sourceDocumentType!=='marketing_push_consent')??[];
  const loadContext=async()=>{
    if(!mountedRef.current)return;
    const requestId=++contextRequestRef.current;const requestedLocale=localeRef.current;setContextError(false);setContext(null);setAccepted(false);
    try{const next=await getCurrentLegalContext(requestedLocale);if(!mountedRef.current||requestId!==contextRequestRef.current||localeRef.current!==requestedLocale)return;if(next.status!=='ready'||next.uiLocale!==requestedLocale||!next.bundleId)throw new Error(next.status||'legal_context_not_ready');setContext(next)}
    catch{if(mountedRef.current&&requestId===contextRequestRef.current&&localeRef.current===requestedLocale)setContextError(true)}
  };
  useEffect(()=>{mountedRef.current=true;return()=>{mountedRef.current=false;contextRequestRef.current+=1;acceptRef.current=false}},[]);
  useEffect(()=>{void loadContext()},[locale]);
  const open=async(url?:string)=>{
    if(!url){if(mountedRef.current)Alert.alert(t('legalConsent.linkMissingTitle'),t('legalConsent.linkMissingBody'));return}
    try{await openLegalHttpsUrl(url)}catch(e){if(mountedRef.current)Alert.alert(t('legalConsent.linkFailedTitle'),userMessage(e,t('legalConsent.linkFailedBody')))}
  };
  const confirm=async()=>{
    if(!mountedRef.current||!accepted||acceptRef.current||!context)return;const submittedContext=context;const submittedLocale=localeRef.current;acceptRef.current=true;
    try{
      setBusy(true);
      if(submittedContext.uiLocale!==submittedLocale)throw new Error('legal_context_locale_changed');
      const result=await acceptLegalTerms(submittedContext);
      if(!mountedRef.current||localeRef.current!==submittedLocale)throw new Error('legal_context_locale_changed');
      if(result.bundleId!==submittedContext.bundleId||result.applicabilityMatrixId!==submittedContext.applicabilityMatrixId||result.overlayDocumentSetSha256!==submittedContext.overlayDocumentSetSha256||result.presentationSha256!==submittedContext.acceptancePresentationSha256)throw new Error('legal_presentation_changed_during_acceptance');
      if(mountedRef.current)await onAccepted();
    }catch(e){if(mountedRef.current){Alert.alert(t('legalConsent.failedTitle'),userMessage(e,t('legalConsent.failedBody')));void loadContext()}}
    finally{acceptRef.current=false;if(mountedRef.current)setBusy(false)}
  };
  if(!context&&!contextError)return <SafeAreaView edges={['top','right','bottom','left']} style={styles.safe}><ScrollView contentContainerStyle={styles.loadingShell}><View accessibilityRole="progressbar" style={styles.loadingProgress}><ShimmerSkeleton width={62} height={62} radius={20}/><ShimmerSkeleton width="38%" height={18}/><ShimmerSkeleton width="72%" height={30}/><ShimmerSkeleton width="100%" height={92} radius={14}/><ShimmerSkeleton width="100%" height={48} radius={14}/><ShimmerSkeleton width="100%" height={48} radius={14}/></View><LegalGateAccountActions/></ScrollView></SafeAreaView>;
  if(contextError)return <SafeAreaView edges={['top','right','bottom','left']} style={styles.safe}><ScrollView contentContainerStyle={styles.body}><View style={styles.mark}><AppIcon name="warning" size={30} color={theme.colors.onPrimary}/></View><Text style={styles.title}>{t('legalConsent.contextUnavailableTitle')}</Text><Text style={styles.bodyText}>{t('legalConsent.contextUnavailableBody')}</Text><PrimaryButton label={t('common.retry')} icon="refresh" onPress={()=>void loadContext()}/><LegalGateAccountActions/></ScrollView></SafeAreaView>;
  return <SafeAreaView edges={['top','right','bottom','left']} style={styles.safe}><ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
    <View style={styles.mark}><AppIcon name="shield" size={30} color={theme.colors.onPrimary}/></View>
    <Text style={styles.brand}>Tailmance</Text>
    <Text style={styles.title}>{t('legalConsent.title')}</Text>
    <Text style={styles.bodyText}>{t('legalConsent.body')}</Text>
    <View style={styles.contextCard} accessibilityRole="summary">
      <Text style={styles.contextTitle}>{t('legalConsent.contextTitle')}</Text>
      <Text style={styles.contextText}>{t('legalConsent.contextLine',{country:[getLegalCountryDisplayName(context?.legalCountryCode,locale),context?.legalSubnationalCode].filter(Boolean).join(' · ')||'?',uiLocale:getLegalDocumentLocaleDisplayName(context?.uiLocale),documentLocale:getLegalDocumentLocaleDisplayName(context?.documentLocale)})}</Text>
      <Text style={styles.contextText}>{t('legalConsent.versionLine',{version:context?.legalVersion??'?',effective:context?.effectiveAt?new Date(context.effectiveAt).toLocaleDateString(locale):'?'})}</Text>
      <Text style={styles.contextText}>{t('legalConsent.ageLine',{age:context?.minimumUserAge??18,mode:context?.ageAssuranceMode??'?'})}</Text>
      <Text selectable style={styles.bundleText}>{t('legalConsent.bundleLine',{bundleId:context?.bundleId??'?'})}</Text>
    </View>
    <View style={styles.links}>
      <Pressable accessibilityRole="link" onPress={()=>void open(context?.termsUrl)} style={styles.linkButton}><Text style={styles.linkText}>{t('legalConsent.terms')}</Text></Pressable>
      <Pressable accessibilityRole="link" onPress={()=>void open(context?.privacyNoticeUrl)} style={styles.linkButton}><Text style={styles.linkText}>{t('legalConsent.privacy')}</Text></Pressable>
      <Pressable accessibilityRole="link" onPress={()=>void open(context?.communityGuidelinesUrl)} style={styles.linkButton}><Text style={styles.linkText}>{t('legalConsent.guidelines')}</Text></Pressable>
      {context?.countryJurisdictionBindingSupplement?<Pressable accessibilityRole="link" onPress={()=>void open(context.countryJurisdictionBindingSupplement?.documentUrl)} style={styles.overlayLink}><View style={styles.overlayLinkCopy}><Text style={styles.linkText}>{t('legalConsent.countrySupplementTitle')}</Text><Text style={styles.overlayMeta}>{t('legalConsent.countrySupplementBindingMeta',{documentLocale:getLegalDocumentLocaleDisplayName(context.countryJurisdictionBindingSupplement.documentLocale)})}</Text></View><AppIcon name="chevron" size={18} color={theme.colors.primary}/></Pressable>:null}
      {context?.countryJurisdictionUiSupplement?<Pressable accessibilityRole="link" onPress={()=>void open(context.countryJurisdictionUiSupplement?.documentUrl)} style={styles.overlayLink}><View style={styles.overlayLinkCopy}><Text style={styles.linkText}>{t('legalConsent.countrySupplementTranslationTitle')}</Text><Text style={styles.overlayMeta}>{t('legalConsent.countrySupplementTranslationMeta',{documentLocale:getLegalDocumentLocaleDisplayName(context.countryJurisdictionUiSupplement.documentLocale),bindingLocale:getLegalDocumentLocaleDisplayName(context.countryJurisdictionBindingSupplement?.documentLocale??context.documentLocale)})}</Text></View><AppIcon name="chevron" size={18} color={theme.colors.primary}/></Pressable>:null}
    </View>
    {(acceptanceComprehension.length+acceptanceOverlayComprehension.length)>0?<View style={styles.additionalCard}>
      <Text style={styles.additionalTitle}>{t('legalConsent.comprehensionDocumentsTitle')}</Text>
      <Text style={styles.additionalBody}>{t('legalConsent.comprehensionDocumentsBody')}</Text>
      {acceptanceComprehension.map(document=><Pressable key={document.comprehensionDocumentId} accessibilityRole="link" onPress={()=>void open(document.documentUrl)} style={styles.overlayLink}><View style={styles.overlayLinkCopy}><Text style={styles.linkText}>{t(`legalConsent.docType.${document.sourceDocumentType}`)}</Text><Text style={styles.overlayMeta}>{t('legalConsent.comprehensionContext',{documentLocale:document.documentLocale,sourceDocumentLocale:document.sourceDocumentLocale,version:document.translationVersion})}</Text></View><AppIcon name="chevron" size={18} color={theme.colors.primary}/></Pressable>)}
      {acceptanceOverlayComprehension.map(document=><Pressable key={document.comprehensionDocumentId} accessibilityRole="link" onPress={()=>void open(document.documentUrl)} style={styles.overlayLink}><View style={styles.overlayLinkCopy}><Text style={styles.linkText}>{t(`legalConsent.docType.${document.sourceDocumentType}`)}</Text><Text style={styles.overlayMeta}>{t('legalConsent.comprehensionContext',{documentLocale:document.documentLocale,sourceDocumentLocale:document.sourceDocumentLocale,version:document.translationVersion})}</Text></View><AppIcon name="chevron" size={18} color={theme.colors.primary}/></Pressable>)}
    </View>:null}
    {(context?.overlayDocuments?.length??0)>0?<View style={styles.additionalCard}>
      <Text style={styles.additionalTitle}>{t('legalConsent.additionalDocumentsTitle')}</Text>
      <Text style={styles.additionalBody}>{t('legalConsent.additionalDocumentsBody')}</Text>
      {context?.overlayDocuments?.map(document=>{
        const jurisdiction=[document.jurisdictionCountryCode,document.jurisdictionSubnationalCode].filter(Boolean).join(' · ');
        return <Pressable key={document.overlayDocumentId} accessibilityRole="link" accessibilityLabel={`${t(`legalConsent.docType.${document.documentType}`)} · ${jurisdiction} · ${document.documentLocale}`} onPress={()=>void open(document.documentUrl)} style={styles.overlayLink}>
          <View style={styles.overlayLinkCopy}>
            <Text style={styles.linkText}>{t(`legalConsent.docType.${document.documentType}`)}</Text>
            <Text style={styles.overlayMeta}>{t('legalConsent.overlayContext',{jurisdiction,documentLocale:document.documentLocale,version:document.documentVersion})}</Text>
            <Text style={styles.overlayAction}>{t(`legalConsent.overlayAction.${document.actionRequirement}`)}</Text>
          </View>
          <AppIcon name="chevron" size={18} color={theme.colors.primary}/>
        </Pressable>
      })}
    </View>:null}
    <View style={styles.privacyNotice}><AppIcon name="privacy" size={18} color={theme.colors.primary}/><Text style={styles.privacyNoticeText}>{t('legalConsent.privacyNoticeStatement')}</Text></View>
    <Pressable accessibilityRole="checkbox" accessibilityState={{checked:accepted,disabled:busy}} disabled={busy} onPress={()=>setAccepted(v=>!v)} style={styles.checkRow}>
      <View style={[styles.checkBox,accepted&&styles.checkBoxOn]}>{accepted?<AppIcon name="check" size={16} color={theme.colors.onPrimary}/>:null}</View>
      <Text style={styles.checkText}>{t(requiredOverlayActions?'legalConsent.confirmWithOverlays':'legalConsent.confirm')}</Text>
    </Pressable>
    <PrimaryButton label={t('legalConsent.continue')} icon="check" onPress={()=>void confirm()} loading={busy} disabled={!accepted}/>
    <LegalGateAccountActions/>
    <Text style={styles.note}>{t('legalConsent.note')}</Text>
  </ScrollView></SafeAreaView>;
}

const createStyles=(theme:AppTheme)=>StyleSheet.create({safe:{flex:1,backgroundColor:theme.colors.background},loadingShell:{flexGrow:1,padding:24,paddingTop:48,paddingBottom:40},loadingProgress:{gap:16},center:{flex:1,padding:24,alignItems:'stretch',justifyContent:'center',gap:16},body:{flexGrow:1,padding:24,paddingTop:48,paddingBottom:40},mark:{width:62,height:62,borderRadius:20,backgroundColor:theme.colors.primary,alignItems:'center',justifyContent:'center'},brand:{marginTop:12,fontSize:18,fontWeight:'900',color:theme.colors.text},title:{marginTop:30,...theme.type.h1,color:theme.colors.text},bodyText:{marginTop:10,...theme.type.body,color:theme.colors.muted,lineHeight:22},contextCard:{marginTop:18,padding:14,borderRadius:14,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.surface},contextTitle:{color:theme.colors.text,fontWeight:'900',marginBottom:6},contextText:{color:theme.colors.muted,fontSize:12,lineHeight:18},bundleText:{color:theme.colors.muted,fontSize:11,lineHeight:17,marginTop:5},links:{marginTop:22,gap:10},linkButton:{paddingVertical:12,paddingHorizontal:14,borderRadius:14,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.surface},linkText:{color:theme.colors.primary,fontWeight:'800'},additionalCard:{marginTop:18,padding:14,borderRadius:14,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.surface,gap:10},additionalTitle:{color:theme.colors.text,fontWeight:'900',fontSize:16},additionalBody:{color:theme.colors.muted,lineHeight:20},overlayLink:{minHeight:48,paddingVertical:10,paddingHorizontal:12,borderRadius:12,borderWidth:1,borderColor:theme.colors.border,flexDirection:'row',alignItems:'center',gap:10},overlayLinkCopy:{flex:1,gap:3},overlayMeta:{color:theme.colors.muted,fontSize:12,lineHeight:17},overlayAction:{color:theme.colors.muted,fontSize:11,lineHeight:16,fontWeight:'700'},privacyNotice:{marginTop:18,flexDirection:'row',gap:10,alignItems:'flex-start',padding:14,borderRadius:14,backgroundColor:theme.colors.surface},privacyNoticeText:{flex:1,color:theme.colors.muted,lineHeight:20},checkRow:{marginTop:22,flexDirection:'row',alignItems:'flex-start',gap:12},checkBox:{width:24,height:24,borderRadius:7,borderWidth:1,borderColor:theme.colors.border,alignItems:'center',justifyContent:'center'},checkBoxOn:{backgroundColor:theme.colors.primary,borderColor:theme.colors.primary},checkText:{flex:1,color:theme.colors.text,lineHeight:21},note:{marginTop:18,color:theme.colors.muted,fontSize:11,lineHeight:17,textAlign:'center'}});
