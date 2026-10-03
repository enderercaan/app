import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL, type CustomerInfo, type PurchasesPackage, type PurchasesStoreProduct } from 'react-native-purchases';
import { env, isPurchasesConfigured } from './config';
import { supabase } from './supabase';
import { throwIfEdgeFunctionFailed } from './edgeErrors';
import {bestEffortDeviceIntegrity} from './deviceIntegrity';
import { openSafeExternalHttpsUrl } from './externalLinks';
import { clearDurableClientOperation, getOrCreateDurableClientOperation } from './clientOperation';
import { runBestEffort } from './bestEffort';

let configured = false;
let identifiedUserId:string|null=null;
let identityQueue:Promise<void>=Promise.resolve();

type BillingMutationKind='purchase'|'restore';
export type PurchaseLegalGuard={bundleId:string;applicabilityMatrixId:string;uiLocale:string;subscriptionPurchaseDocumentSetSha256:string};

type ConsumableProductKind='boost'|'super_like';
export type ConsumableStoreProduct={kind:ConsumableProductKind;product:PurchasesStoreProduct};

export async function getConsumableProducts():Promise<ConsumableStoreProduct[]>{
  if(Platform.OS==='web'||!isPurchasesConfigured(Platform.OS==='ios'?'ios':'android'))return [];
  return withCurrentPurchasesIdentity(async()=>{
    const boostIds=new Set(env.revenueCatBoostProductIds);
    const superLikeIds=new Set(env.revenueCatSuperLikeProductIds);
    if([...boostIds].some(id=>superLikeIds.has(id)))throw new Error('consumable_product_mapping_ambiguous');
    const specs:Array<{kind:ConsumableProductKind;ids:string[]}>= [
      {kind:'boost',ids:[...boostIds]},
      {kind:'super_like',ids:[...superLikeIds]},
    ];
    const out:ConsumableStoreProduct[]=[];
    for(const spec of specs){
      if(!spec.ids.length)continue;
      const products=await Purchases.getProducts(spec.ids,Purchases.PRODUCT_CATEGORY.NON_SUBSCRIPTION);
      for(const product of products)out.push({kind:spec.kind,product});
    }
    return out;
  });
}

let consumablePurchaseInFlight:{productIdentifier:string,promise:Promise<{productIdentifier:string;customerInfo:CustomerInfo}>}|null=null;
export function purchaseConsumable(product:PurchasesStoreProduct):Promise<{productIdentifier:string;customerInfo:CustomerInfo}>{
  const productIdentifier=String(product?.identifier??'').trim();
  if(!productIdentifier)throw new Error('consumable_product_identifier_missing');
  const current=consumablePurchaseInFlight;
  if(current){
    // Exact duplicate taps share one store transaction. A different product must wait rather than
    // inheriting the first product's result, which could make the caller render the wrong purchase.
    if(current.productIdentifier===productIdentifier)return current.promise;
    return current.promise.then(()=>purchaseConsumable(product),()=>purchaseConsumable(product));
  }
  const promise=withCurrentPurchasesIdentity(async userId=>{
    const result=await Purchases.purchaseStoreProduct(product);
    const {data}=await supabase.auth.getSession();
    if(data.session?.user.id===userId)await syncPremiumEntitlement().catch(()=>undefined);
    return result;
  }).finally(()=>{
    if(consumablePurchaseInFlight?.promise===promise)consumablePurchaseInFlight=null;
  });
  consumablePurchaseInFlight={productIdentifier,promise};
  return promise;
}
let billingMutationInFlight:{kind:BillingMutationKind,promise:Promise<CustomerInfo>}|null=null;

function runBillingSingleFlight(kind:BillingMutationKind,work:()=>Promise<CustomerInfo>):Promise<CustomerInfo>{
  const current=billingMutationInFlight;
  if(current){
    if(current.kind===kind)return current.promise;
    return current.promise.then(()=>runBillingSingleFlight(kind,work),()=>runBillingSingleFlight(kind,work));
  }
  const promise=work().finally(()=>{
    if(billingMutationInFlight?.promise===promise)billingMutationInFlight=null;
  });
  billingMutationInFlight={kind,promise};
  return promise;
}


function withIdentityLock<T>(work:()=>Promise<T>):Promise<T>{
  const run=identityQueue.then(work,work);
  identityQueue=run.then(()=>undefined,()=>undefined);
  return run;
}

async function withCurrentPurchasesIdentity<T>(work:(userId:string)=>Promise<T>):Promise<T>{
  return withIdentityLock(async()=>{
    const {data,error}=await supabase.auth.getSession();
    if(error)throw error;
    const userId=data.session?.user.id??null;
    if(!userId)throw new Error('purchase_identity_required');
    await ensurePurchasesIdentityLocked(userId);
    const {data:after,error:afterError}=await supabase.auth.getSession();
    if(afterError)throw afterError;
    if(after.session?.user.id!==userId)throw new Error('purchase_identity_changed');
    return work(userId);
  });
}

export function configurePurchases(appUserId?: string) {
  if (configured || Platform.OS === 'web') return;
  const apiKey = Platform.OS === 'ios' ? env.revenueCatIosApiKey : env.revenueCatAndroidApiKey;
  if (!apiKey || !isPurchasesConfigured(Platform.OS === 'ios' ? 'ios' : 'android')) return;
  Purchases.setLogLevel(env.appEnv === 'production' ? LOG_LEVEL.ERROR : LOG_LEVEL.INFO);
  Purchases.configure({ apiKey, appUserID: appUserId });
  configured = true;
  identifiedUserId=appUserId??null;
}

export async function getPremiumPackage(): Promise<PurchasesPackage | null> {
  return withCurrentPurchasesIdentity(async()=>{
    const offerings = await Purchases.getOfferings();
    const packages=offerings.current?.availablePackages??[];
    return packages.find(pkg=>pkg.identifier===env.revenueCatPremiumPackageId)??null;
  });
}

async function assertPurchaseLegalGuard(expected:PurchaseLegalGuard){
  if(!expected?.bundleId||!expected?.applicabilityMatrixId||!expected?.uiLocale||!/^[0-9a-f]{64}$/.test(expected.subscriptionPurchaseDocumentSetSha256))throw new Error('subscription_legal_guard_required');
  const {data,error}=await supabase.rpc('get_current_legal_context',{p_ui_locale:expected.uiLocale});
  if(error||!data||data.status!=='ready')throw new Error('legal_context_not_ready_for_purchase');
  if(data.bundleId!==expected.bundleId||data.applicabilityMatrixId!==expected.applicabilityMatrixId||data.uiLocale!==expected.uiLocale||data.subscriptionPurchaseDocumentSetSha256!==expected.subscriptionPurchaseDocumentSetSha256)throw new Error('subscription_legal_documents_changed_review_required');
}

async function recordSubscriptionPrecontractPresentation(pkg:PurchasesPackage,expected:PurchaseLegalGuard){
  const storePlatform=Platform.OS==='ios'?'ios':Platform.OS==='android'?'android':null;
  if(!storePlatform)throw new Error('subscription_store_platform_unsupported');
  const productId=String(pkg.product.identifier||pkg.identifier||'').trim();
  if(!productId)throw new Error('subscription_product_identifier_missing');
  const operation=await getOrCreateDurableClientOperation('subscription-precontract',[
    expected.bundleId,expected.applicabilityMatrixId,expected.uiLocale,
    expected.subscriptionPurchaseDocumentSetSha256,storePlatform,productId
  ]);
  const {data,error}=await supabase.rpc('record_current_subscription_precontract_presentation_idempotent',{
    p_bundle_id:expected.bundleId,
    p_applicability_matrix_id:expected.applicabilityMatrixId,
    p_ui_locale:expected.uiLocale,
    p_expected_document_set_sha256:expected.subscriptionPurchaseDocumentSetSha256,
    p_store_platform:storePlatform,
    p_store_product_id:productId,
    p_client_operation_id:operation.id,
  });
  if(error||!data?.ok||data.bundleId!==expected.bundleId||data.applicabilityMatrixId!==expected.applicabilityMatrixId||data.documentSetSha256!==expected.subscriptionPurchaseDocumentSetSha256)throw new Error('subscription_precontract_presentation_not_recorded');
  await clearDurableClientOperation(operation.key,operation.id);
}

export function purchasePremium(pkg: PurchasesPackage, legalGuard:PurchaseLegalGuard): Promise<CustomerInfo> {
  if(!env.revenueCatPremiumPackageId||pkg.identifier!==env.revenueCatPremiumPackageId)throw new Error('premium_package_identifier_mismatch');
  return runBillingSingleFlight('purchase',()=>withCurrentPurchasesIdentity(async userId=>{
    await assertPurchaseLegalGuard(legalGuard);
    await recordSubscriptionPrecontractPresentation(pkg,legalGuard);
    const result = await Purchases.purchasePackage(pkg);
    const premium=Boolean(result.customerInfo.entitlements.active[env.revenueCatEntitlementId]);
    const {data}=await supabase.auth.getSession();
    if(premium&&data.session?.user.id===userId)await syncPremiumEntitlement();
    return result.customerInfo;
  }));
}

export function restorePurchases(): Promise<CustomerInfo> {
  return runBillingSingleFlight('restore',()=>withCurrentPurchasesIdentity(async userId=>{
    const info = await Purchases.restorePurchases();
    const {data}=await supabase.auth.getSession();
    if(data.session?.user.id===userId)await syncPremiumEntitlement();
    return info;
  }));
}

export async function hasPremium(customerInfo?: CustomerInfo) {
  if(customerInfo)return Boolean(customerInfo.entitlements.active[env.revenueCatEntitlementId]);
  return withCurrentPurchasesIdentity(async()=>{
    const info=await Purchases.getCustomerInfo();
    return Boolean(info.entitlements.active[env.revenueCatEntitlementId]);
  });
}

async function ensurePurchasesIdentityLocked(userId:string){
  if (!configured) configurePurchases(userId);
  else if(identifiedUserId!==userId){await Purchases.logIn(userId);identifiedUserId=userId}
}

async function clearPurchasesIdentityLocked(){
  if (!configured||!identifiedUserId)return;
  await Purchases.logOut();
  identifiedUserId=null;
}

export async function logInPurchases(userId: string) {
  return withIdentityLock(async()=>{
    const {data}=await supabase.auth.getSession();
    if(data.session?.user.id!==userId)return;
    await ensurePurchasesIdentityLocked(userId);
    const {data:after}=await supabase.auth.getSession();
    if(after.session?.user.id!==userId)return;
    await runBestEffort('purchase_entitlement_refresh',()=>syncPremiumEntitlement())
  });
}

export async function logOutPurchases() {
  return withIdentityLock(clearPurchasesIdentityLocked);
}

// Auth-state events can arrive after a newer session transition. Re-read the authoritative
// Supabase session inside the same identity mutex before applying an event to RevenueCat.
export async function reconcilePurchasesIdentity(expectedUserId:string|null){
  return withIdentityLock(async()=>{
    const {data}=await supabase.auth.getSession();
    const currentUserId=data.session?.user.id??null;
    if(currentUserId!==expectedUserId)return;
    if(currentUserId){
      await ensurePurchasesIdentityLocked(currentUserId);
      const {data:after}=await supabase.auth.getSession();
      if(after.session?.user.id!==currentUserId)return;
      await runBestEffort('restore_entitlement_refresh',()=>syncPremiumEntitlement())
      return;
    }
    await clearPurchasesIdentityLocked();
  });
}

export async function openSubscriptionManagement() {
  const url = Platform.OS === 'ios' ? 'https://apps.apple.com/account/subscriptions' : 'https://play.google.com/store/account/subscriptions';
  await openSafeExternalHttpsUrl(url);
}


export async function syncPremiumEntitlement() {
  await bestEffortDeviceIntegrity('subscription_sync');
  const { data, error } = await supabase.functions.invoke('sync-subscription', { body: {} });
  await throwIfEdgeFunctionFailed(data,error);
  return Boolean(data?.premium);
}
