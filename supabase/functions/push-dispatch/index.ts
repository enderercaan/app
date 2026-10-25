import { json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/client.ts';
import { markWorkerHeartbeat } from '../_shared/workerHeartbeat.ts';
import { fetchWithTimeout, readResponseJsonBounded } from '../_shared/http.ts';
import { PUSH_COPY_LOCALES, PUSH_TRANSLATED_LOCALES, PUSH_COPY, type PushCopyLocale } from '../_shared/pushCopy.generated.ts';
import { verifyBearerSecret } from '../_shared/secretAuth.ts';
import { sendApnsVoipPush } from '../_shared/apnsVoip.ts';
import {edgeBestEffort} from '../_shared/operational.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const MAX_PUSH_ATTEMPTS = 6;
const EXPO_PUSH_TIMEOUT_MS = 10_000;
const EXPO_PUSH_MAX_RESPONSE_BYTES = 256_000;

type PreferenceKey = 'matches'|'messages'|'social'|'events'|'health'|'marketing';
type NotificationRow = {
  id:string;
  user_id:string;
  title:string;
  body:string;
  type:string;
  entity_id:string|null;
  push_attempts:number|null;
  template_key:string|null;
  template_params:Record<string,unknown>|null;
  actor_pet_id:string|null;
  recipient_pet_id:string|null;
};
type TokenRow = {id:string;token:string;transport:'expo'|'apns_voip';platform:'ios'|'android'};
type UserRow = {id:string;notification_preferences:Record<string,unknown>|null;preferred_locale:string|null;paused_at:string|null;suspended_at:string|null;age_18_confirmed:boolean;legal_version:string|null};

type MatchRow = {pet_low_id:string;pet_high_id:string;unmatched_at:string|null};

const interpolatePush=(value:string,vars:Record<string,string|number>)=>value.replace(/\{(\w+)\}/g,(_,key)=>String(vars[key]??`{${key}}`));

const localizedNotificationCopy=(n:NotificationRow,locale:string)=>{
  const requested=PUSH_COPY_LOCALES.includes(locale as typeof PUSH_COPY_LOCALES[number])?locale:'en';
  const lang:PushCopyLocale=PUSH_TRANSLATED_LOCALES.includes(requested as PushCopyLocale)?requested as PushCopyLocale:'en';
  const copy=PUSH_COPY[lang];
  if(n.template_key==='vaccination_due'){
    const params=n.template_params??{};
    const petName=String(params.petName??'');
    const vaccineName=String(params.vaccineName??'');
    const days=Number(params.daysUntil);
    const count=Number.isFinite(days)?days:0;
    const bodyKey=days===0?'notifications.item.vaccinationToday':days===1?'notifications.item.vaccinationTomorrow':'notifications.item.vaccinationDays';
    return{title:interpolatePush(copy['notifications.item.vaccinationTitle'],{petName}),body:interpolatePush(copy[bodyKey],{vaccineName,count})};
  }
  if(n.template_key==='incoming_pet_call'){
    const params=n.template_params??{};
    const petName=String(params.callerPetName??'');
    return{title:copy['notifications.item.callTitle'],body:interpolatePush(copy['notifications.item.callBody'],{petName})};
  }
  if(n.template_key==='lost_pet'){
    const params=n.template_params??{};
    const petName=String(params.petName??'');
    const district=String(params.district??'');
    const neighborhood=String(params.neighborhood??'');
    return{
      title:interpolatePush(copy['notifications.item.lostPetTitle'],{petName,district,neighborhood}),
      body:interpolatePush(copy['notifications.item.lostPetBody'],{petName,district,neighborhood})
    };
  }
  const params=n.template_params??{};
  const petName=String(params.petName??'');
  const eventTitle=String(params.eventTitle??'');
  if(n.template_key==='follow_request')return{title:copy['notifications.item.followRequestTitle'],body:copy['notifications.item.followRequestBody']};
  if(n.template_key==='follow_accepted')return{title:copy['notifications.item.followAcceptedTitle'],body:copy['notifications.item.followAcceptedBody']};
  if(n.template_key==='lost_pet_sighting'){
    const bodyKey=params.kind==='found'?'notifications.item.lostPetFoundBody':'notifications.item.lostPetSightingBody';
    return{title:interpolatePush(copy['notifications.item.lostPetSightingTitle'],{petName}),body:copy[bodyKey]};
  }
  if(n.template_key==='lost_pet_thanks')return{title:interpolatePush(copy['notifications.item.lostPetThanksTitle'],{petName}),body:copy['notifications.item.lostPetThanksBody']};
  if(n.template_key==='event_reminder'){
    const bodyKey=params.window==='1h'?'notifications.item.eventReminderHour':'notifications.item.eventReminderDay';
    return{title:interpolatePush(copy['notifications.item.eventReminderTitle'],{eventTitle}),body:copy[bodyKey]};
  }
  if(n.template_key==='event_cancelled')return{title:copy['notifications.item.eventCancelledTitle'],body:interpolatePush(copy['notifications.item.eventCancelledBody'],{eventTitle})};
  if(n.template_key==='event_waitlist_promoted')return{title:copy['notifications.item.eventWaitlistTitle'],body:interpolatePush(copy['notifications.item.eventWaitlistBody'],{eventTitle})};
  if(n.template_key==='care_reminder')return{title:interpolatePush(copy['notifications.item.careReminderTitle'],{petName}),body:String(params.reminderTitle??n.body)};
  if(n.template_key==='support_ticket_update')return{title:interpolatePush(copy['notifications.item.supportUpdateTitle'],{ticketNumber:String(params.ticketNumber??'')}),body:copy['notifications.item.supportUpdateBody']};
  const type=['match','like','message','follow','comment'].includes(n.type)?n.type:null;
  if(!type)return{title:n.title,body:n.body};
  return{title:copy[`notifications.item.${type}Title`],body:copy[`notifications.item.${type}Body`]};
};

type QuietHoursState={active:boolean;minutesUntilEnd:number};
const quietHoursState=(preferences:Record<string,unknown>|undefined,now=new Date()):QuietHoursState=>{
  if(preferences?.quietEnabled!==true)return{active:false,minutesUntilEnd:0};
  const start=Number(preferences.quietStartMinutes); const end=Number(preferences.quietEndMinutes); const timeZone=typeof preferences.timeZone==='string'?preferences.timeZone:'UTC';
  if(!Number.isInteger(start)||start<0||start>1439||!Number.isInteger(end)||end<0||end>1439||start===end)return{active:false,minutesUntilEnd:0};
  let parts:Intl.DateTimeFormatPart[];
  try{parts=new Intl.DateTimeFormat('en-US',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now)}catch{return{active:false,minutesUntilEnd:0}}
  const hour=Number(parts.find(part=>part.type==='hour')?.value); const minute=Number(parts.find(part=>part.type==='minute')?.value);
  if(!Number.isInteger(hour)||!Number.isInteger(minute))return{active:false,minutesUntilEnd:0};
  const current=hour*60+minute; const active=start<end?(current>=start&&current<end):(current>=start||current<end);
  if(!active)return{active:false,minutesUntilEnd:0};
  const minutesUntilEnd=start<end?end-current:(current>=start?1440-current+end:end-current);
  return{active:true,minutesUntilEnd:Math.max(1,minutesUntilEnd)};
};

const preferenceKeyForType = (type: string): PreferenceKey | null => {
  if (type === 'match' || type === 'like') return 'matches';
  if (type === 'message' || type === 'call') return 'messages';
  if (type === 'follow' || type === 'comment') return 'social';
  if (type === 'event') return 'events';
  if (type === 'health') return 'health';
  if (type === 'marketing') return 'marketing';
  return null;
};

async function updateNotificationState(supabase:any,id:string,values:Record<string,unknown>) {
  const {error}=await supabase.from('notifications').update({...values,push_claimed_at:null}).eq('id',id);
  if(error)throw new Error('notification_state_write_failed');
}
async function releaseClaimedBatch(supabase:any,ids:string[]){
  if(!ids.length)return;
  const {error}=await supabase.from('notifications').update({push_status:'pending',push_claimed_at:null,next_push_attempt_at:new Date(Date.now()+30_000).toISOString()}).in('id',ids).eq('push_status','processing');
  if(error)throw new Error('notification_claim_release_failed');
}
async function scheduleRetry(supabase:any,n:NotificationRow) {
  const attempts = (n.push_attempts ?? 0) + 1;
  const terminal = attempts >= MAX_PUSH_ATTEMPTS;
  const delaySeconds = Math.min(3600, 30 * Math.pow(2, Math.min(attempts, 6)));
  await updateNotificationState(supabase,n.id,{
    push_status: terminal ? 'failed' : 'pending',
    push_attempts: attempts,
    next_push_attempt_at: new Date(Date.now() + delaySeconds * 1000).toISOString()
  });
}
function safeExpoErrorCode(value:unknown){const code=typeof value==='string'?value:'';return /^[A-Za-z0-9_.-]{1,80}$/.test(code)?code:null}

async function ownerPairBlocked(supabase:any,ownerA:string,ownerB:string):Promise<boolean> {
  if (ownerA === ownerB) return false;
  const [{data:owners,error:ownersError},{data:pets,error:petsError}]=await Promise.all([
    supabase.from('users').select('id,paused_at,suspended_at').in('id',[ownerA,ownerB]),
    supabase.from('pets').select('id,owner_id').in('owner_id',[ownerA,ownerB])
  ]);
  if (ownersError) throw ownersError;
  if (petsError) throw petsError;
  if((owners??[]).length!==2||(owners??[]).some((u:any)=>u.paused_at||u.suspended_at))return true;
  const a=(pets??[]).filter((p:any)=>p.owner_id===ownerA).map((p:any)=>p.id);
  const b=(pets??[]).filter((p:any)=>p.owner_id===ownerB).map((p:any)=>p.id);
  if (!a.length || !b.length) return true;
  const all=[...a,...b];
  const {data:blocks,error:blockError}=await supabase.from('blocks').select('blocker_pet_id,blocked_pet_id').in('blocker_pet_id',all).in('blocked_pet_id',all);
  if (blockError) throw blockError;
  const aSet=new Set(a); const bSet=new Set(b);
  return (blocks??[]).some((x:any)=>(aSet.has(x.blocker_pet_id)&&bSet.has(x.blocked_pet_id))||(bSet.has(x.blocker_pet_id)&&aSet.has(x.blocked_pet_id)));
}

async function activeMatchForNotification(supabase:any,n:NotificationRow):Promise<MatchRow|null> {
  if (!n.entity_id) return null;
  if (n.type==='match') {
    const {data,error}=await supabase.from('pet_matches').select('pet_low_id,pet_high_id,unmatched_at').eq('id',n.entity_id).maybeSingle();
    if (error) throw error;
    return data as MatchRow|null;
  }
  if(n.type==='call'){
    const {data:call,error:callError}=await supabase.from('pet_call_sessions').select('match_id,status,ring_expires_at').eq('id',n.entity_id).maybeSingle();
    if(callError)throw callError;
    if(!call||call.status!=='ringing'||!call.ring_expires_at||new Date(call.ring_expires_at).getTime()<=Date.now())return null;
    const {data,error}=await supabase.from('pet_matches').select('pet_low_id,pet_high_id,unmatched_at').eq('id',call.match_id).maybeSingle();
    if(error)throw error;
    return data as MatchRow|null;
  }
  if (n.type==='message') {
    const {data:conversation,error:conversationError}=await supabase.from('conversations').select('match_id').eq('id',n.entity_id).maybeSingle();
    if (conversationError) throw conversationError;
    if (!conversation?.match_id) return null;
    const {data,error}=await supabase.from('pet_matches').select('pet_low_id,pet_high_id,unmatched_at').eq('id',conversation.match_id).maybeSingle();
    if (error) throw error;
    return data as MatchRow|null;
  }
  return null;
}

async function shouldSkipForRelationshipState(supabase:any,n:NotificationRow):Promise<boolean> {
  if (!['message','call','match','like','follow','comment'].includes(n.type)) return false;

  if(n.type==='comment'){
    if(!n.entity_id||!n.actor_pet_id)return true;
    const {data:comment,error:commentError}=await supabase.from('comments').select('id,pet_id,post_id,moderation_status,deleted_at').eq('id',n.entity_id).maybeSingle();
    if(commentError)throw commentError;
    if(!comment||comment.deleted_at||comment.moderation_status!=='approved'||comment.pet_id!==n.actor_pet_id)return true;
    const {data:post,error:postError}=await supabase.from('posts').select('pet_id,moderation_status,deleted_at').eq('id',comment.post_id).maybeSingle();
    if(postError)throw postError;
    if(!post||post.deleted_at||post.moderation_status!=='approved')return true;
    const {data:pets,error:petsError}=await supabase.from('pets').select('id,owner_id').in('id',[comment.pet_id,post.pet_id]);
    if(petsError)throw petsError;
    const actorOwner=(pets??[]).find((p:any)=>p.id===comment.pet_id)?.owner_id;
    const recipientOwner=(pets??[]).find((p:any)=>p.id===post.pet_id)?.owner_id;
    if(!actorOwner||!recipientOwner||recipientOwner!==n.user_id)return true;
    return await ownerPairBlocked(supabase,actorOwner,recipientOwner);
  }

  if (n.type==='message' || n.type==='call' || n.type==='match') {
    const match=await activeMatchForNotification(supabase,n);
    if (!match || match.unmatched_at) return true;
    const {data:pets,error}=await supabase.from('pets').select('id,owner_id').in('id',[match.pet_low_id,match.pet_high_id]);
    if (error) throw error;
    const lowOwner=(pets??[]).find((p:any)=>p.id===match.pet_low_id)?.owner_id;
    const highOwner=(pets??[]).find((p:any)=>p.id===match.pet_high_id)?.owner_id;
    if (!lowOwner || !highOwner || (n.user_id!==lowOwner && n.user_id!==highOwner)) return true;
    return await ownerPairBlocked(supabase,lowOwner,highOwner);
  }

  if (!n.entity_id) return true;
  const {data:actor,error}=await supabase.from('pets').select('owner_id').eq('id',n.entity_id).maybeSingle();
  if (error) throw error;
  if (!actor?.owner_id) return true;
  return await ownerPairBlocked(supabase,actor.owner_id,n.user_id);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const secret = Deno.env.get('PUSH_WORKER_SECRET');
  if (!verifyBearerSecret(req.headers.get('Authorization'),secret)) return json({ error: 'Unauthorized' }, 401);

  const supabase = adminClient();
  await markWorkerHeartbeat(supabase,'push-dispatch','started');
  // `failed` is terminal. Only pending work is eligible for dispatch, so the attempt cap is real.
  const { data: notifications, error } = await supabase.rpc('claim_pending_notifications',{p_limit:100});
  if (error) return json({ error: 'notification_queue_unavailable' }, 500);
  if (!notifications?.length) { await markWorkerHeartbeat(supabase,'push-dispatch','completed'); return json({ ok: true, sent: 0, skippedByPreference: 0, skippedByRelationship: 0, skippedByPause: 0, skippedBySuspension: 0 }); }

  const userIds = [...new Set(notifications.map((n: any) => n.user_id))];
  const marketingUserIds=[...new Set((notifications as NotificationRow[]).filter(n=>n.type==='marketing').map(n=>n.user_id))];
  const claimedIds=(notifications as NotificationRow[]).map(n=>n.id);
  const [{ data: users, error:usersError },{data:accessRows,error:accessError},{data:marketingConsentRows,error:marketingConsentError}]=await Promise.all([
    supabase.from('users').select('id,notification_preferences,preferred_locale,paused_at,suspended_at,age_18_confirmed,legal_version').in('id', userIds),
    supabase.rpc('service_product_access_user_ids',{p_user_ids:userIds}),
    marketingUserIds.length?supabase.rpc('service_marketing_push_consent_user_ids',{p_user_ids:marketingUserIds}):Promise.resolve({data:[],error:null})
  ]);
  // Notification preferences and effective product access are consent-like controls. If either cannot be read,
  // fail closed and release the lease without burning a delivery attempt.
  if (usersError||accessError) {
    await edgeBestEffort('push_release_claimed_batch',()=>releaseClaimedBatch(supabase,claimedIds))
    return json({error:'notification_user_state_unavailable'},500);
  }
  const preferenceMap = new Map<string, Record<string, unknown>>();
  const localeMap = new Map<string,string>();
  const pausedUsers = new Set<string>();
  const suspendedUsers = new Set<string>();
  const productAccessUsers = new Set<string>((accessRows??[]).map((row:any)=>String(row.user_id)));
  const marketingConsentUsers = new Set<string>((marketingConsentRows??[]).map((row:any)=>String(row.user_id)));
  for (const user of (users ?? []) as UserRow[]){preferenceMap.set(user.id,user.notification_preferences??{});localeMap.set(user.id,user.preferred_locale??'en');if(user.paused_at)pausedUsers.add(user.id);if(user.suspended_at)suspendedUsers.add(user.id)}

  let sent = 0;
  let skippedByPreference = 0;
  let skippedByRelationship = 0;
  let skippedByPause = 0;
  let skippedBySuspension = 0;
  let skippedByAccess = 0;
  let deferredByQuietHours = 0;
  let deferredByMarketingConsentState = 0;
  let skippedByMarketingConsent = 0;
  for (const n of notifications as NotificationRow[]) {
    try {
      const preferenceKey = preferenceKeyForType(n.type);
      const prefs = preferenceMap.get(n.user_id);
      if (suspendedUsers.has(n.user_id)) {
        await updateNotificationState(supabase,n.id,{push_status:'skipped'});
        skippedBySuspension++;
        continue;
      }
      if (pausedUsers.has(n.user_id)) {
        await updateNotificationState(supabase,n.id,{push_status:'skipped'});
        skippedByPause++;
        continue;
      }
      if(!productAccessUsers.has(n.user_id)){
        await updateNotificationState(supabase,n.id,{push_status:'skipped'});
        skippedByAccess++;
        continue;
      }
      // Missing recipient settings are not permission to deliver a push.
      if (!prefs) {
        await scheduleRetry(supabase,n);
        continue;
      }
      if (preferenceKey && prefs[preferenceKey] === false) {
        await updateNotificationState(supabase,n.id,{push_status:'skipped'});
        skippedByPreference++;
        continue;
      }
      if(n.type==='marketing'&&marketingConsentError){
        await updateNotificationState(supabase,n.id,{push_status:'pending',next_push_attempt_at:new Date(Date.now()+30_000).toISOString()});
        deferredByMarketingConsentState++;
        continue;
      }
      if(n.type==='marketing'&&!marketingConsentUsers.has(n.user_id)){
        await updateNotificationState(supabase,n.id,{push_status:'skipped'});
        skippedByMarketingConsent++;
        continue;
      }
      // Lost Paw alerts are emergency notices (spec 4.5, 6.3): they are never held back by quiet hours.
      if(n.type!=='system'&&n.type!=='lost_pet'){
        const quiet=quietHoursState(prefs);
        if(quiet.active){
          const nextAttempt=new Date(Date.now()+quiet.minutesUntilEnd*60_000).toISOString();
          await updateNotificationState(supabase,n.id,{push_status:'pending',next_push_attempt_at:nextAttempt});
          deferredByQuietHours++;
          continue;
        }
      }

      if (await shouldSkipForRelationshipState(supabase,n)) {
        await updateNotificationState(supabase,n.id,{push_status:'skipped'});
        skippedByRelationship++;
        continue;
      }

      const { data: tokens, error:tokensError } = await supabase.from('push_tokens').select('id,token,transport,platform').eq('user_id', n.user_id).eq('enabled', true).limit(30);
      if (tokensError) {
        await scheduleRetry(supabase,n);
        continue;
      }
      const eligibleTokens=((tokens??[]) as TokenRow[]).filter(token=>token.transport==='expo'||(n.type==='call'&&token.transport==='apns_voip'&&token.platform==='ios'));
      if (!eligibleTokens.length) {
        await updateNotificationState(supabase,n.id,{push_status:'skipped'});
        continue;
      }

      // Transport-neutral receipt ownership prevents duplicate delivery after a partial
      // attempt. Expo tickets remain pending until the Expo receipt worker resolves them;
      // APNs VoIP HTTP/2 acceptance is stored directly as ok.
      const tokenIds=eligibleTokens.map(t=>t.id);
      const {data:existingReceipts,error:receiptReadError}=await supabase.from('push_receipts').select('push_token_id,receipt_status').eq('notification_id',n.id).in('push_token_id',tokenIds);
      if (receiptReadError) {
        await scheduleRetry(supabase,n);
        continue;
      }
      const alreadyAccepted=new Set((existingReceipts??[]).filter((r:any)=>r.receipt_status==='pending'||r.receipt_status==='ok').map((r:any)=>r.push_token_id));
      const candidates=eligibleTokens.filter(t=>!alreadyAccepted.has(t.id));
      if (!candidates.length) {
        await updateNotificationState(supabase,n.id,{push_status:'sent'});
        sent++;
        continue;
      }

      const localized=localizedNotificationCopy(n,localeMap.get(n.user_id)??'en');
      const expoCandidates=candidates.filter(token=>token.transport==='expo');
      const voipCandidates=candidates.filter(token=>token.transport==='apns_voip');
      let acceptedNow=0;
      let enabledCandidateRemains=false;

      if(expoCandidates.length){
        const payload = expoCandidates.map((t: TokenRow) => ({
          to: t.token,
          sound: 'default',
          priority: n.type==='lost_pet'||n.type==='call'?'high':'default',
          ...(n.type==='lost_pet'?{interruptionLevel:'time-sensitive'}:{}),
          title: localized.title,
          body: localized.body,
          data: { type: n.type, entityId: n.entity_id, recipientPetId: n.recipient_pet_id, notificationId: n.id, userId: n.user_id }
        }));
        try{
          const response = await fetchWithTimeout(EXPO_PUSH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload)
          }, EXPO_PUSH_TIMEOUT_MS);
          if (!response.ok) {
            enabledCandidateRemains=true;
          } else {
            const result = await readResponseJsonBounded<any>(response, EXPO_PUSH_MAX_RESPONSE_BYTES);
            const tickets = Array.isArray(result?.data) ? result.data : [];
            for (let i = 0; i < expoCandidates.length; i++) {
              const ticket = tickets[i];
              const token = expoCandidates[i];
              if (!token) continue;
              if (!ticket) { enabledCandidateRemains=true; continue; }
              const accepted=ticket.status==='ok'&&typeof ticket.id==='string'&&ticket.id.length>0;
              const rawErrorCode=safeExpoErrorCode(ticket?.details?.error);
              const errorCode=accepted?null:(rawErrorCode??(ticket.status==='ok'?'MissingTicketId':'ExpoTicketRejected'));
              if(accepted){
                acceptedNow++;
              }else if(ticket.status==='error'&&errorCode==='DeviceNotRegistered'){
                const {error:disableError}=await supabase.from('push_tokens').update({enabled:false}).eq('id',token.id).eq('transport','expo');
                if(disableError)throw new Error('push_token_disable_failed');
              }else{
                enabledCandidateRemains=true;
              }
              const {error:receiptWriteError}=await supabase.from('push_receipts').upsert({
                notification_id:n.id,
                push_token_id:token.id,
                expo_ticket_id:accepted?ticket.id:null,
                receipt_status:accepted?'pending':'error',
                error_code:errorCode,
                error_message:accepted?null:'expo_push_ticket_error',
                checked_at:accepted?null:new Date().toISOString()
              },{onConflict:'notification_id,push_token_id'});
              if(receiptWriteError)throw new Error('push_receipt_write_failed');
            }
          }
        }catch{
          enabledCandidateRemains=true;
        }
      }

      if(voipCandidates.length){
        const params=n.template_params??{};
        const callerPetName=typeof params.callerPetName==='string'?params.callerPetName:'';
        const callType=params.callType==='audio'||params.callType==='video'?params.callType:null;
        if(n.type!=='call'||!n.entity_id||!n.recipient_pet_id||!callType){
          enabledCandidateRemains=true;
        }else{
          for(const token of voipCandidates){
            const result=await sendApnsVoipPush({token:token.token,callId:n.entity_id,callerPetName,callType,recipientPetId:n.recipient_pet_id,userId:n.user_id});
            if(result.ok){
              acceptedNow++;
            }else if(result.disableToken){
              const {error:disableError}=await supabase.from('push_tokens').update({enabled:false}).eq('id',token.id).eq('transport','apns_voip');
              if(disableError)throw new Error('push_token_disable_failed');
            }else if(result.retryable){
              enabledCandidateRemains=true;
            }
            const {error:receiptWriteError}=await supabase.from('push_receipts').upsert({
              notification_id:n.id,
              push_token_id:token.id,
              expo_ticket_id:null,
              receipt_status:result.ok?'ok':'error',
              error_code:result.reason,
              error_message:result.ok?null:'apns_voip_delivery_error',
              checked_at:new Date().toISOString()
            },{onConflict:'notification_id,push_token_id'});
            if(receiptWriteError)throw new Error('push_receipt_write_failed');
          }
        }
      }

      if(enabledCandidateRemains){
        // Keep only unresolved transports retryable; existing pending/ok receipts suppress
        // duplicate delivery to transports that already accepted this notification.
        await scheduleRetry(supabase,n);
      }else if(alreadyAccepted.size+acceptedNow>0){
        await updateNotificationState(supabase,n.id,{push_status:'sent',push_attempts:(n.push_attempts??0)+1});
        sent++;
      }else{
        // Every eligible device was permanently invalid/unregistered.
        await updateNotificationState(supabase,n.id,{push_status:'skipped',push_attempts:(n.push_attempts??0)+1});
      }
    } catch (_error) {
      await scheduleRetry(supabase,n);
    }
  }
  await markWorkerHeartbeat(supabase,'push-dispatch','completed');
  return json({ ok: true, sent, skippedByPreference, skippedByRelationship, skippedByPause, skippedBySuspension, skippedByAccess, deferredByQuietHours, deferredByMarketingConsentState, skippedByMarketingConsent });
});
