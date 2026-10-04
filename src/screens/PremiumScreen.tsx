import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import { AppIcon } from '../components/AppIcon';
import { PrimaryButton } from '../components/PrimaryButton';
import { GlassSurface } from '../components/GlassSurface';
import { ShimmerSkeleton } from '../components/ShimmerSkeleton';
import { Screen } from '../components/Screen';
import { TopBar } from '../components/TopBar';
import { useI18n } from '../i18n';
import { getConsumableWallet, getCurrentLegalContext } from '../services/api';
import { getConsumableProducts, getPremiumPackage, hasPremium, openSubscriptionManagement, purchaseConsumable, purchasePremium, restorePurchases, type ConsumableStoreProduct } from '../services/purchases';
import { userMessage } from '../services/errors';
import { openLegalHttpsUrl } from '../services/legalLinks';
import { useThemedStyles, type AppTheme } from '../theme';
import type { ConsumableWallet, LegalContext } from '../types/domain';

const featureKeys=[
  ['chat','premium.feature.chatTitle','premium.feature.chatBody'],
  ['heart','premium.feature.likesTitle','premium.feature.likesBody'],
  ['spark','premium.feature.superTitle','premium.feature.superBody'],
  ['undo','premium.feature.undoTitle','premium.feature.undoBody'],
  ['privacy','premium.feature.incognitoTitle','premium.feature.incognitoBody'],
  ['filter','premium.feature.filtersTitle','premium.feature.filtersBody'],
  ['heart','premium.feature.unlimitedLikesTitle','premium.feature.unlimitedLikesBody'],
  ['spark','premium.feature.boostTitle','premium.feature.boostBody'],
  ['location','premium.feature.travelTitle','premium.feature.travelBody'],
  ['paw','premium.feature.multiPetTitle','premium.feature.multiPetBody'],
] as const;

export function PremiumScreen(){const {theme,styles}=useThemedStyles(createStyles);
  const {t,locale}=useI18n();
  const features=useMemo(()=>featureKeys.map(([icon,titleKey,bodyKey])=>[icon,t(titleKey),t(bodyKey)] as const),[t]);
  const [pkg,setPkg]=useState<PurchasesPackage|null>(null);
  const [active,setActive]=useState(false);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [loadError,setLoadError]=useState<string|null>(null);
  const [legalContext,setLegalContext]=useState<LegalContext|null>(null);
  const [precontractReviewed,setPrecontractReviewed]=useState(false);
  const [consumables,setConsumables]=useState<ConsumableStoreProduct[]>([]);
  const [wallet,setWallet]=useState<ConsumableWallet>({boostCredits:0,superLikeCredits:0});
  const [consumableBusy,setConsumableBusy]=useState<string|null>(null);
  const loadRequestRef=useRef(0);
  const storeOperationRef=useRef(false);
  const localeRef=useRef(locale);localeRef.current=locale;

  const load=async()=>{
    const requestId=++loadRequestRef.current;const requestedLocale=localeRef.current;
    try{
      setLoading(true);setLoadError(null);
      const [nextPkg,nextActive,nextLegalContext,nextConsumables,nextWallet]=await Promise.all([getPremiumPackage(),hasPremium(),getCurrentLegalContext(requestedLocale),getConsumableProducts().catch(()=>[]),getConsumableWallet().catch(()=>({boostCredits:0,superLikeCredits:0}))]);
      if(requestId!==loadRequestRef.current||localeRef.current!==requestedLocale)return;
      setPkg(nextPkg);setActive(nextActive);setLegalContext(nextLegalContext.status==='ready'&&nextLegalContext.uiLocale===requestedLocale?nextLegalContext:null);setConsumables(nextConsumables);setWallet(nextWallet);
    }catch(e){
      if(requestId!==loadRequestRef.current||localeRef.current!==requestedLocale)return;setLoadError(userMessage(e,t('premium.loadFailedFallback')));setPkg(null);
    }finally{if(requestId===loadRequestRef.current&&localeRef.current===requestedLocale)setLoading(false)}
  };
  useEffect(()=>{void load()},[locale]);
  useEffect(()=>{setPrecontractReviewed(false)},[locale,pkg?.identifier,legalContext?.subscriptionPurchaseDocumentSetSha256]);

  const buy=async()=>{
    if(storeOperationRef.current)return;
    if(!pkg){Alert.alert(t('premium.storeUnavailableTitle'),t('premium.storeUnavailableBody'));return}
    if(!precontractReviewed){Alert.alert(t('premium.reviewRequiredTitle'),t('premium.reviewRequiredBody'));return}
    const purchaseLocale=localeRef.current;const submittedContext=legalContext;const packageSnapshot=pkg;storeOperationRef.current=true;
    try{
      setBusy(true);
      if(!submittedContext||submittedContext.status!=='ready'||submittedContext.uiLocale!==purchaseLocale||!submittedContext.subscriptionConsumerUrl||!submittedContext.subscriptionPurchaseDocumentSetSha256)throw new Error('legal_context_not_ready_for_purchase');
      const currentContext=await getCurrentLegalContext(purchaseLocale);
      if(currentContext.status!=='ready'||currentContext.uiLocale!==purchaseLocale||!currentContext.subscriptionConsumerUrl||!currentContext.subscriptionPurchaseDocumentSetSha256)throw new Error('legal_context_not_ready_for_purchase');
      if(localeRef.current!==purchaseLocale)throw new Error('subscription_locale_changed_review_required');if(currentContext.bundleId!==submittedContext.bundleId||currentContext.applicabilityMatrixId!==submittedContext.applicabilityMatrixId||currentContext.subscriptionPurchaseDocumentSetSha256!==submittedContext.subscriptionPurchaseDocumentSetSha256){setPrecontractReviewed(false);setLegalContext(currentContext);throw new Error('subscription_legal_documents_changed_review_required')}
      setActive(await hasPremium(await purchasePremium(packageSnapshot,{bundleId:submittedContext.bundleId!,applicabilityMatrixId:submittedContext.applicabilityMatrixId!,uiLocale:purchaseLocale,subscriptionPurchaseDocumentSetSha256:submittedContext.subscriptionPurchaseDocumentSetSha256!})));
    }catch(e){
      const storeActive=await hasPremium().catch(()=>false);
      setActive(storeActive);
      if(storeActive)Alert.alert(t('premium.purchaseStoreDoneTitle'),t('premium.purchaseStoreDoneBody'));
      else Alert.alert(t('premium.purchaseFailedTitle'),userMessage(e,t('premium.purchaseFailedFallback')));
    }finally{storeOperationRef.current=false;setBusy(false)}
  };
  const restore=async()=>{
    if(storeOperationRef.current)return;storeOperationRef.current=true;
    try{
      setBusy(true);
      setActive(await hasPremium(await restorePurchases()));
      Alert.alert(t('premium.restoreDoneTitle'),t('premium.restoreDoneBody'));
    }catch(e){
      const storeActive=await hasPremium().catch(()=>false);
      setActive(storeActive);
      Alert.alert(
        storeActive?t('premium.restoreStoreFoundTitle'):t('premium.restoreFailedTitle'),
        storeActive?t('premium.restoreStoreFoundBody'):userMessage(e,t('premium.restoreFailedFallback')),
      );
    }finally{storeOperationRef.current=false;setBusy(false)}
  };
  const manage=async()=>{
    try{await openSubscriptionManagement()}
    catch(e){Alert.alert(t('premium.manageFailedTitle'),userMessage(e,t('premium.manageFailedFallback')))}
  };
  const buyConsumable=async(item:ConsumableStoreProduct)=>{
    const id=String(item.product.identifier||'');if(!id||consumableBusy||storeOperationRef.current)return;storeOperationRef.current=true;
    try{setConsumableBusy(id);await purchaseConsumable(item.product);Alert.alert(t('premium.packPurchasedTitle'),t('premium.packPurchasedBody'));const next=await getConsumableWallet().catch(()=>wallet);setWallet(next)}catch(e){Alert.alert(t('premium.packPurchaseFailedTitle'),userMessage(e,t('premium.purchaseFailedFallback')))}finally{storeOperationRef.current=false;setConsumableBusy(null)}
  };
  const openLegal=async(url:string)=>{
    if(!url){Alert.alert(t('premium.legalLinkMissingTitle'),t('premium.legalLinkMissingBody'));return}
    try{await openLegalHttpsUrl(url)}catch(e){Alert.alert(t('premium.legalLinkFailedTitle'),userMessage(e,t('premium.legalLinkFailedBody')))}
  };

  const consumerOverlays=legalContext?.overlayDocuments?.filter(document=>document.documentType==='subscription_consumer'||document.documentType==='jurisdiction_consumer_supplement')??[];
  const consumerComprehension=legalContext?.comprehensionDocuments?.filter(document=>['terms','privacy_notice','subscription_consumer'].includes(document.sourceDocumentType))??[];
  const consumerOverlayComprehension=legalContext?.comprehensionOverlayDocuments?.filter(document=>document.sourceDocumentType==='subscription_consumer'||document.sourceDocumentType==='jurisdiction_consumer_supplement')??[];
  const purchaseReady=Boolean(pkg&&legalContext?.status==='ready'&&legalContext.uiLocale===locale&&legalContext.termsUrl&&legalContext.privacyNoticeUrl&&legalContext.subscriptionConsumerUrl&&legalContext.subscriptionPurchaseDocumentSetSha256);

  return <Screen><TopBar title={t('premium.title')} subtitle={t('premium.subtitle')}/><ScrollView testID="premium.screen" contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
    <GlassSurface style={styles.hero}>
      <View style={styles.mark}><AppIcon name="spark" size={28} color={theme.colors.onPrimary}/></View>
      <Text style={styles.kicker}>{t('premium.kicker')}</Text><Text style={styles.title}>{active?t('premium.active'):t('premium.headline')}</Text><Text style={styles.subtitle}>{t('premium.heroBody')}</Text>
      <View style={styles.priceRow}>{loading?<ShimmerSkeleton width={132} height={36} radius={12}/>:pkg?<><Text style={styles.price}>{pkg.product.priceString}</Text><Text style={styles.month}>{t('premium.month')}</Text></>:<View style={styles.priceError}><Text style={styles.priceUnavailable}>{loadError??t('premium.priceUnavailable')}</Text><PrimaryButton variant="secondary" label={t('premium.retry')} icon="refresh" onPress={()=>void load()}/></View>}</View>
      <Text style={styles.planDisclosure}>{t('premium.planDisclosure')}</Text>
    </GlassSurface>
    <View style={styles.card}>{features.map(([icon,title,body])=><View key={title} style={styles.feature}><View style={styles.featureIcon}><AppIcon name={icon} size={19} color={theme.colors.primary}/></View><View style={{flex:1}}><Text style={styles.featureTitle}>{title}</Text><Text style={styles.featureBody}>{body}</Text></View><AppIcon name="check" size={17} color={theme.colors.success}/></View>)}</View>
    <View style={styles.packCard}><Text style={styles.packTitle}>{t('premium.packsTitle')}</Text><Text style={styles.packBody}>{t('premium.packsBody')}</Text><View style={styles.walletRow}><Text style={styles.walletText}>{t('premium.walletBoosts',{count:wallet.boostCredits})}</Text><Text style={styles.walletText}>{t('premium.walletSuperLikes',{count:wallet.superLikeCredits})}</Text></View>{consumables.length?consumables.map(item=><Pressable key={item.product.identifier} accessibilityRole="button" accessibilityState={{disabled:Boolean(consumableBusy)}} disabled={Boolean(consumableBusy)} onPress={()=>void buyConsumable(item)} style={styles.packRow}><View style={styles.packIcon}><AppIcon name={item.kind==='boost'?'spark':'star'} size={18} color={theme.colors.primary}/></View><View style={{flex:1}}><Text style={styles.packName}>{item.kind==='boost'?t('premium.boostPack'):t('premium.superLikePack')}</Text><Text style={styles.packProduct}>{item.product.title||item.product.identifier}</Text></View><Text style={styles.packPrice}>{item.product.priceString}</Text></Pressable>):<Text style={styles.packUnavailable}>{t('premium.packsUnavailable')}</Text>}<Text style={styles.packFootnote}>{t('premium.packsFootnote')}</Text></View>

    <View style={styles.payment}><AppIcon name="lock" size={17} color={theme.colors.success}/><Text style={styles.note}>{t('premium.paymentNote')}</Text></View>
    <View style={styles.reviewCard}>
      <Text style={styles.reviewTitle}>{t('premium.reviewTitle')}</Text><Text style={styles.reviewBody}>{t('premium.reviewBody')}</Text>
      <Text style={styles.legal}>{t('premium.legal')}</Text>
      <View style={styles.legalLinks}>
        <Pressable accessibilityRole="link" onPress={()=>void openLegal(legalContext?.termsUrl??'')} style={styles.legalLink}><Text style={styles.legalLinkText}>{t('premium.terms')}</Text></Pressable>
        <Pressable accessibilityRole="link" onPress={()=>void openLegal(legalContext?.privacyNoticeUrl??'')} style={styles.legalLink}><Text style={styles.legalLinkText}>{t('premium.privacy')}</Text></Pressable>
        <Pressable accessibilityRole="link" onPress={()=>void openLegal(legalContext?.subscriptionConsumerUrl??'')} style={styles.legalLink}><Text style={styles.legalLinkText}>{t('premium.consumerInfo')}</Text></Pressable>
      </View>
      {consumerOverlays.length>0?<View style={styles.consumerOverlayCard}><Text style={styles.consumerOverlayTitle}>{t('premium.additionalConsumerDocuments')}</Text><Text style={styles.consumerOverlayBody}>{t('premium.additionalConsumerDocumentsBody')}</Text>{consumerOverlays.map(document=><Pressable key={document.overlayDocumentId} accessibilityRole="link" onPress={()=>void openLegal(document.documentUrl)} style={styles.legalLink}><Text style={styles.legalLinkText}>{t('premium.consumerOverlayDocument',{jurisdiction:[document.jurisdictionCountryCode,document.jurisdictionSubnationalCode].filter(Boolean).join('-'),locale:document.documentLocale})}</Text></Pressable>)}</View>:null}
      {(consumerComprehension.length+consumerOverlayComprehension.length)>0?<View style={styles.consumerOverlayCard}><Text style={styles.consumerOverlayTitle}>{t('premium.comprehensionDocuments')}</Text><Text style={styles.consumerOverlayBody}>{t('premium.comprehensionDocumentsBody')}</Text>{consumerComprehension.map(document=><Pressable key={document.comprehensionDocumentId} accessibilityRole="link" onPress={()=>void openLegal(document.documentUrl)} style={styles.legalLink}><Text style={styles.legalLinkText}>{t('legalConsent.comprehensionContext',{documentLocale:document.documentLocale,sourceDocumentLocale:document.sourceDocumentLocale,version:document.translationVersion})}</Text></Pressable>)}{consumerOverlayComprehension.map(document=><Pressable key={document.comprehensionDocumentId} accessibilityRole="link" onPress={()=>void openLegal(document.documentUrl)} style={styles.legalLink}><Text style={styles.legalLinkText}>{t('legalConsent.comprehensionContext',{documentLocale:document.documentLocale,sourceDocumentLocale:document.sourceDocumentLocale,version:document.translationVersion})}</Text></Pressable>)}</View>:null}
      <Pressable testID="premium.precontract-review" accessibilityRole="checkbox" accessibilityState={{checked:precontractReviewed,disabled:active||busy||!purchaseReady}} disabled={active||busy||!purchaseReady} onPress={()=>setPrecontractReviewed(v=>!v)} style={styles.reviewRow}>
        <View style={[styles.reviewBox,precontractReviewed&&styles.reviewBoxOn]}>{precontractReviewed?<AppIcon name="check" size={16} color={theme.colors.onPrimary}/>:null}</View>
        <Text style={styles.reviewText}>{t('premium.reviewCheckbox')}</Text>
      </Pressable>
    </View>

    <PrimaryButton testID="premium.purchase" label={active?t('premium.active'):t('premium.upgrade')} icon="spark" onPress={()=>void buy()} loading={busy} disabled={active||!purchaseReady||!precontractReviewed}/>
    <View style={{height:10}}/><PrimaryButton testID="premium.restore" variant="secondary" label={t('premium.restore')} icon="refresh" onPress={()=>void restore()} loading={busy}/>
    <View style={{height:10}}/><PrimaryButton variant="secondary" label={t('premium.manage')} icon="settings" onPress={()=>void manage()}/>
  </ScrollView></Screen>;
}

const createStyles=(theme:AppTheme)=>StyleSheet.create({packCard:{marginBottom:16,padding:14,borderRadius:theme.radius.xl,backgroundColor:theme.colors.surface,borderWidth:1,borderColor:theme.colors.border},packTitle:{fontSize:15,fontWeight:'900',color:theme.colors.text},packBody:{marginTop:4,fontSize:11,lineHeight:17,color:theme.colors.textSoft},walletRow:{flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:10},walletText:{fontSize:11,fontWeight:'900',color:theme.colors.primary,backgroundColor:theme.colors.primarySoft,paddingHorizontal:9,paddingVertical:6,borderRadius:12},packRow:{minHeight:62,marginTop:10,padding:10,borderRadius:theme.radius.lg,borderWidth:1,borderColor:theme.colors.border,flexDirection:'row',alignItems:'center',gap:10},packIcon:{width:38,height:38,borderRadius:19,backgroundColor:theme.colors.primarySoft,alignItems:'center',justifyContent:'center'},packName:{fontWeight:'900',color:theme.colors.text},packProduct:{marginTop:2,fontSize:11,color:theme.colors.muted},packPrice:{fontWeight:'900',color:theme.colors.text},packUnavailable:{marginTop:10,fontSize:11,color:theme.colors.muted},packFootnote:{marginTop:9,fontSize:11,lineHeight:15,color:theme.colors.muted},body:{padding:18,paddingBottom:50},hero:{padding:22,borderRadius:theme.radius.xxl,backgroundColor:theme.colors.primarySoft,alignItems:'center'},mark:{width:58,height:58,borderRadius:20,backgroundColor:theme.colors.primary,alignItems:'center',justifyContent:'center',...theme.shadow.floating},kicker:{marginTop:15,color:theme.colors.primary,fontWeight:'900',letterSpacing:1.4,fontSize:11},title:{marginTop:8,...theme.type.h1,color:theme.colors.text,textAlign:'center'},subtitle:{marginTop:8,...theme.type.body,color:theme.colors.textSoft,textAlign:'center',maxWidth:330},priceRow:{minHeight:44,marginTop:16,flexDirection:'row',alignItems:'center'},price:{fontSize:30,fontWeight:'900',color:theme.colors.text},priceUnavailable:{fontSize:12,fontWeight:'800',color:theme.colors.muted,textAlign:'center'},priceError:{alignItems:'center',gap:8,maxWidth:280},planDisclosure:{marginTop:8,maxWidth:330,textAlign:'center',fontSize:11,lineHeight:16,fontWeight:'700',color:theme.colors.textSoft},month:{fontSize:13,fontWeight:'800',color:theme.colors.muted},card:{marginVertical:16,flexDirection:'row',flexWrap:'wrap',gap:10},feature:{width:'48%',minHeight:118,padding:12,borderRadius:theme.radius.lg,backgroundColor:theme.colors.surface,borderWidth:1,borderColor:theme.colors.border,gap:8,alignItems:'flex-start'},featureIcon:{width:44,height:44,borderRadius:14,backgroundColor:theme.colors.primarySoft,alignItems:'center',justifyContent:'center'},featureTitle:{fontWeight:'900',color:theme.colors.text},featureBody:{marginTop:3,fontSize:11,lineHeight:16,color:theme.colors.muted},payment:{marginTop:2,padding:12,borderRadius:theme.radius.lg,backgroundColor:theme.colors.successSoft,flexDirection:'row',gap:8,alignItems:'flex-start'},note:{flex:1,fontSize:11,lineHeight:17,color:theme.colors.textSoft},reviewCard:{marginVertical:14,padding:14,borderRadius:theme.radius.xl,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.surface},reviewTitle:{fontSize:14,fontWeight:'900',color:theme.colors.text,textAlign:'center'},reviewBody:{marginTop:6,fontSize:11,lineHeight:17,color:theme.colors.textSoft,textAlign:'center'},legal:{marginTop:10,textAlign:'center',fontSize:11,lineHeight:16,color:theme.colors.muted},legalLinks:{marginTop:8,flexDirection:'row',justifyContent:'center',gap:12,flexWrap:'wrap'},legalLink:{minHeight:44,justifyContent:'center',paddingHorizontal:6},legalLinkText:{color:theme.colors.primary,fontSize:11,fontWeight:'900'},consumerOverlayCard:{marginTop:12,padding:12,borderRadius:theme.radius.lg,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.surfaceAlt},consumerOverlayTitle:{fontSize:12,fontWeight:'900',color:theme.colors.text,textAlign:'center'},consumerOverlayBody:{marginTop:4,fontSize:11,lineHeight:16,color:theme.colors.muted,textAlign:'center'},reviewRow:{minHeight:52,marginTop:12,flexDirection:'row',alignItems:'flex-start',gap:10,paddingVertical:8},reviewBox:{width:26,height:26,borderRadius:8,borderWidth:1.5,borderColor:theme.colors.borderStrong,backgroundColor:theme.colors.background,alignItems:'center',justifyContent:'center'},reviewBoxOn:{backgroundColor:theme.colors.primary,borderColor:theme.colors.primary},reviewText:{flex:1,fontSize:12,lineHeight:18,color:theme.colors.textSoft,fontWeight:'700'}});
