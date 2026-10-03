import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/client.ts';
import { fetchWithTimeout, readRequestTextBounded, readResponseJsonBounded } from '../_shared/http.ts';

function timingSafeEqual(a: string, b: string) { if (a.length !== b.length) return false; let diff=0; for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i); return diff===0; }
function verifyRevenueCatAuthorization(req: Request) {
  const expectedAuth=Deno.env.get('REVENUECAT_WEBHOOK_AUTH');
  if(!expectedAuth||expectedAuth.length<32)return false;
  return timingSafeEqual(req.headers.get('Authorization')??'',expectedAuth);
}
function parseRevenueCatSignature(value:string){
  const parts=value.split(',').map(x=>x.trim()).filter(Boolean);
  let timestamp:string|null=null;
  const signatures:string[]=[];
  for(const part of parts){
    const eq=part.indexOf('=');
    if(eq<=0)continue;
    const key=part.slice(0,eq).trim();
    const val=part.slice(eq+1).trim();
    if(key==='t'&&!timestamp)timestamp=val;
    if(key==='v1'&&/^[a-f0-9]{64}$/i.test(val))signatures.push(val.toLowerCase());
  }
  return {timestamp,signatures};
}
async function hmacSha256Hex(secret:string,message:string){
  const enc=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(message)));
  return Array.from(sig,b=>b.toString(16).padStart(2,'0')).join('');
}
async function verifyRevenueCatHmac(req:Request,raw:string){
  const secret=Deno.env.get('REVENUECAT_WEBHOOK_SIGNING_SECRET');
  if(!secret||secret.length<32)return false;
  const header=req.headers.get('X-RevenueCat-Webhook-Signature')??'';
  const {timestamp,signatures}=parseRevenueCatSignature(header);
  if(!timestamp||!/^\d{10,13}$/.test(timestamp)||!signatures.length)return false;
  const seconds=Number(timestamp.length===13?Number(timestamp)/1000:timestamp);
  if(!Number.isFinite(seconds))return false;
  const maxSkewSeconds=300;
  if(Math.abs(Date.now()/1000-seconds)>maxSkewSeconds)return false;
  const expected=await hmacSha256Hex(secret,`${timestamp}.${raw}`);
  return signatures.some(signature=>timingSafeEqual(signature,expected));
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function candidateUsers(event:any){
  const values=event?.type==='TRANSFER'?[...(event.transferred_from??[]),...(event.transferred_to??[])]:[event?.app_user_id,event?.original_app_user_id,...(event?.aliases??[])];
  return [...new Set(values.map((x:any)=>String(x??'')).filter((x:string)=>uuid.test(x)))];
}

type ConsumableDefinition={kind:'boost'|'super_like';quantity:number};
function consumableDefinition(productId:string):ConsumableDefinition|null{
  const raw=Deno.env.get('REVENUECAT_CONSUMABLE_PRODUCTS_JSON');
  if(!raw||!productId)return null;
  try{
    const parsed=JSON.parse(raw);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return null;
    const value=(parsed as Record<string,unknown>)[productId] as any;
    if(!value||!['boost','super_like'].includes(value.kind)||!Number.isInteger(value.quantity)||value.quantity<1||value.quantity>1000)return null;
    return {kind:value.kind,quantity:value.quantity};
  }catch{return null}
}

function safeFailureCode(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return 'revenuecat_timeout';
  if (error instanceof Error) {
    const message = error.message;
    if (/^revenuecat_status_\d{3}$/.test(message)) return message;
    if (message === 'REVENUECAT_REST_API_KEY_missing') return 'revenuecat_rest_key_missing';
    if (/consumable|credit|ledger|claim/i.test(message)) return 'consumable_credit_sync_failed';
  }
  return 'subscription_sync_failed';
}
const REVENUECAT_TIMEOUT_MS=10_000;
const REVENUECAT_MAX_RESPONSE_BYTES=256_000;
async function currentPremiumStatus(userId:string,entitlementId:string){
  const apiKey=Deno.env.get('REVENUECAT_REST_API_KEY');
  if(!apiKey)throw new Error('REVENUECAT_REST_API_KEY_missing');
  const response=await fetchWithTimeout(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,{headers:{Authorization:`Bearer ${apiKey}`,Accept:'application/json'}},REVENUECAT_TIMEOUT_MS);
  if(!response.ok)throw new Error(`revenuecat_status_${response.status}`);
  const payload=await readResponseJsonBounded<any>(response,REVENUECAT_MAX_RESPONSE_BYTES);
  const entitlement=payload?.subscriber?.entitlements?.[entitlementId];
  if(!entitlement)return false;
  const expiry=entitlement.expires_date?Date.parse(entitlement.expires_date):null;
  const grace=entitlement.grace_period_expires_date?Date.parse(entitlement.grace_period_expires_date):null;
  if(expiry===null)return true;
  const now=Date.now();
  return (Number.isFinite(expiry)&&expiry>now)||(grace!==null&&Number.isFinite(grace)&&grace>now);
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  let raw:string;
  try{raw=await readRequestTextBounded(req,1_000_000)}catch{return json({error:'payload_too_large'},413)}
  if(!verifyRevenueCatAuthorization(req)||!(await verifyRevenueCatHmac(req,raw)))return json({error:'Unauthorized'},401);
  let payload:any; try{payload=JSON.parse(raw)}catch{return json({error:'Invalid JSON'},400)}
  const event=payload?.event; if(!event?.id||!event?.type)return json({error:'Invalid RevenueCat event'},400);
  const productId=String(event.product_id??'').trim();
  const mappedConsumable=consumableDefinition(productId);
  const consumablePurchase=event.type==='NON_RENEWING_PURCHASE'?mappedConsumable:null;
  const consumableRefund=event.type==='CANCELLATION'?mappedConsumable:null;
  const consumableRefundReversal=event.type==='REFUND_REVERSED'?mappedConsumable:null;
  const consumableLifecycle=consumablePurchase??consumableRefund??consumableRefundReversal;
  const consumableTransactionId=consumableLifecycle?String(event.transaction_id??'').trim():'';
  if(consumableLifecycle&&!consumableTransactionId)return json({error:'consumable_transaction_id_missing'},400);
  const consumableEventTimestampMs=consumableLifecycle?Number(event.event_timestamp_ms):0;
  if(consumableLifecycle&&(!Number.isSafeInteger(consumableEventTimestampMs)||consumableEventTimestampMs<946684800000||consumableEventTimestampMs>Date.now()+600_000))return json({error:'consumable_event_timestamp_invalid'},400);
  const entitlementId=Deno.env.get('REVENUECAT_ENTITLEMENT_ID');
  const subscriptionImpacted=Boolean(entitlementId)&&(event.type==='TRANSFER'||(Array.isArray(event.entitlement_ids)?event.entitlement_ids.includes(entitlementId):event.entitlement_id===entitlementId));
  if(!consumableLifecycle&&!subscriptionImpacted)return json({ok:true,ignored:true});

  // RevenueCat distinguishes store transactions by SANDBOX/PRODUCTION. Keep this
  // server-authoritative so a correctly signed sandbox event cannot mutate production state.
  const expectedEnvironment=String(Deno.env.get('REVENUECAT_WEBHOOK_ENVIRONMENT')??'').trim().toUpperCase();
  if(!['PRODUCTION','SANDBOX'].includes(expectedEnvironment))return json({error:'revenuecat_environment_not_configured'},503);
  const eventEnvironment=String(event.environment??'').trim().toUpperCase();
  if(!['PRODUCTION','SANDBOX'].includes(eventEnvironment))return json({error:'revenuecat_environment_missing'},400);
  if(eventEnvironment!==expectedEnvironment)return json({ok:true,ignored:true,reason:'environment_mismatch'});

  const allowedAppIdsRaw=Deno.env.get('REVENUECAT_ALLOWED_APP_IDS_JSON');
  if(!allowedAppIdsRaw)return json({error:'revenuecat_app_allowlist_not_configured'},503);
  let allowedAppIds:string[];
  try{const parsed=JSON.parse(allowedAppIdsRaw);allowedAppIds=Array.isArray(parsed)?parsed.map(x=>String(x).trim()).filter(Boolean):[]}catch{return json({error:'revenuecat_app_allowlist_invalid'},503)}
  if(!allowedAppIds.length)return json({error:'revenuecat_app_allowlist_invalid'},503);
  const eventAppId=String(event.app_id??'').trim();
  if(!eventAppId||!allowedAppIds.includes(eventAppId))return json({ok:true,ignored:true,reason:'app_not_allowed'});

  const allCandidateUsers=candidateUsers(event).slice(0,20);
  const s=adminClient();
  let allUsers:string[]=[];
  if(allCandidateUsers.length){
    const {data:existingRows,error:existingUsersError}=await s.from('users').select('id').in('id',allCandidateUsers);
    if(existingUsersError)return json({error:'billing_user_resolution_failed'},503);
    const existingIds=new Set((existingRows??[]).map((row:{id:string})=>String(row.id)).filter((id:string)=>uuid.test(id)));
    allUsers=allCandidateUsers.filter(id=>existingIds.has(id));
  }
  const directId=String(event.app_user_id??'');
  const directConsumableUser=uuid.test(directId)&&allUsers.includes(directId)?directId:null;
  let purchaseUser=directConsumableUser;
  if(consumableLifecycle){
    const {data:storedOwner,error:ownerError}=await s.rpc('resolve_consumable_transaction_owner',{
      p_store_transaction_id:consumableTransactionId,
      p_provider_app_id:eventAppId,p_provider_environment:eventEnvironment,
      p_product_id:productId,p_credit_kind:consumableLifecycle.kind,p_quantity:consumableLifecycle.quantity
    });
    if(ownerError)return json({error:'consumable_transaction_resolution_failed'},503);
    if(typeof storedOwner==='string'&&uuid.test(storedOwner))purchaseUser=storedOwner;
    else if(!purchaseUser&&allUsers.length===1)purchaseUser=allUsers[0];
    else if(!purchaseUser&&allUsers.length>1)return json({error:'consumable_user_ambiguous'},409);
  }
  const users=consumableLifecycle?(purchaseUser?[purchaseUser]:[]):allUsers;
  if(!users.length)return json({ok:true,ignored:true,reason:'no_internal_user'});
  const {data:claim,error:claimError}=await s.rpc('claim_billing_webhook_event',{p_event_id:String(event.id),p_event_type:String(event.type),p_user_ids:users});
  if(claimError)return json({error:'billing_ledger_unavailable'},503);
  if(claim?.claimed!==true)return json({ok:true,duplicate:true,processing:claim?.status==='processing'});
  const claimToken=String(claim.claimToken??'');
  if(!uuid.test(claimToken))return json({error:'billing_claim_invalid'},503);

  try{
    if(consumableLifecycle&&purchaseUser){
      const rpcName=consumablePurchase?'apply_consumable_billing_webhook_event_ordered':consumableRefund?'apply_consumable_refund_billing_webhook_event_ordered':'apply_consumable_refund_reversal_billing_webhook_event_ordered';
      const {data:applied,error:creditError}=await s.rpc(rpcName,{
        p_event_id:String(event.id),p_claim_token:claimToken,p_user_id:purchaseUser,p_product_id:productId,
        p_credit_kind:consumableLifecycle.kind,p_quantity:consumableLifecycle.quantity,
        p_store_transaction_id:consumableTransactionId,
        p_provider_app_id:eventAppId,p_provider_environment:eventEnvironment,p_event_timestamp_ms:consumableEventTimestampMs
      });
      if(creditError)throw creditError;
      if(applied!==true)return json({ok:true,duplicate:true,staleClaim:true});
      if(consumableRefund)return json({ok:true,refunded:true,kind:consumableLifecycle.kind,quantity:consumableLifecycle.quantity});
      if(consumableRefundReversal)return json({ok:true,refundReversed:true,kind:consumableLifecycle.kind,quantity:consumableLifecycle.quantity});
      return json({ok:true,credited:true,kind:consumableLifecycle.kind,quantity:consumableLifecycle.quantity});
    }

    if(!entitlementId)throw new Error('revenuecat_entitlement_not_configured');
    const states=await Promise.all(users.map(async userId=>({userId,premium:await currentPremiumStatus(userId,entitlementId)})));
    const auditUser=states.find(x=>x.userId===String(event.app_user_id))?.userId??states[0]?.userId;
    const platform=event.store==='APP_STORE'?'apple':event.store==='PLAY_STORE'?'google':null;
    const expirationMs=event.expiration_at_ms===null||event.expiration_at_ms===undefined?null:Number(event.expiration_at_ms);
    const currentPeriodEnd=expirationMs!==null&&Number.isFinite(expirationMs)?new Date(expirationMs).toISOString():null;
    const {data:applied,error:applyError}=await s.rpc('apply_billing_webhook_event',{
      p_event_id:String(event.id),p_claim_token:claimToken,p_user_states:states,
      p_subscription_user_id:auditUser&&platform?auditUser:null,p_platform:auditUser&&platform?platform:null,
      p_product_id:auditUser&&platform?productId||'unknown':null,
      p_entitlement_id:auditUser&&platform?entitlementId:null,p_subscription_status:auditUser&&platform?String(event.type):null,
      p_store_transaction_id:auditUser&&platform&&event.transaction_id?String(event.transaction_id):null,
      p_current_period_end:auditUser&&platform?currentPeriodEnd:null,
      p_will_renew:auditUser&&platform?!['CANCELLATION','EXPIRATION','REFUND'].includes(String(event.type)):null
    });
    if(applyError)throw applyError;
    if(applied!==true)return json({ok:true,duplicate:true,staleClaim:true});
    return json({ok:true,synced:states.length});
  }catch(e){
    const failureCode=safeFailureCode(e);
    const {error:failedLedgerError}=await s.rpc('finish_billing_webhook_event',{p_event_id:String(event.id),p_claim_token:claimToken,p_status:'failed',p_last_error:failureCode});
    if(failedLedgerError)console.error('billing_failure_state_write_failed');
    return json({error:failureCode},503);
  }
});
