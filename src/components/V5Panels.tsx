import { useCallback, useEffect, useState } from 'react';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from './PrimaryButton';
import { V5Chips, V5Field, V5Link, V5Notice, V5Row } from './V5Kit';
import { getRuntimeLocale, translate, useI18n } from '../i18n';
import { cancelPetEvent, checkInPlace, checkOutPlace, createCommentReply, expandLostPetAlert, extendLostPetAlert, getFollowState, getLostPetSightings, getPlaceCheckins, joinEventWaitlist,
  leaveEventWaitlist, removeFollower, reportLostPetSighting, searchCommunities, setCommentLike, setEventCommunity, setEventParticipationRules, setLostPetAlertDetails, setPetMute, setPostCommunity,
  withdrawLostPetSighting, type FollowState, type LostPetSighting, type PlaceCheckin } from '../services/api';
import { userMessage } from '../services/errors';
import { useThemedStyles, type AppTheme } from '../theme';
import type { LostPetAlert, Pet, PetEvent, PostComment } from '../types/domain';

type Translate=ReturnType<typeof useI18n>['t'];
const fail=(t:Translate,e:unknown)=>Alert.alert(t('v5.actionFailed'),userMessage(e,t('v5.actionFailed')));
const SIZES=['mini','small','medium','large','giant'] as const;

/** Like and one-level reply actions under a comment (spec 3.3). */
export function CommentActions({petId,comment,onChanged}:{petId:string;comment:PostComment;onChanged:()=>void}){
  const {styles}=useThemedStyles(createStyles); const {t}=useI18n(); const [replying,setReplying]=useState(false); const [text,setText]=useState(''); const [busy,setBusy]=useState(false);
  const [liked,setLiked]=useState(Boolean(comment.likedByMe)); const [count,setCount]=useState(comment.likeCount??0);
  const toggleLike=async()=>{if(busy)return;setBusy(true);try{const r=await setCommentLike(petId,comment.id,!liked);setLiked(r.liked);setCount(r.likeCount)}catch(e){fail(t,e)}finally{setBusy(false)}};
  const send=async()=>{if(busy||!text.trim())return;setBusy(true);try{await createCommentReply(petId,comment.id,text,Crypto.randomUUID());setText('');setReplying(false);Alert.alert(t('v5.comment.replySent'));onChanged()}catch(e){fail(t,e)}finally{setBusy(false)}};
  return <View style={styles.inline}>
    <View style={styles.actions}>{comment.parentCommentId?<Text style={styles.meta}>{t('v5.comment.isReply')}</Text>:null}
      <Pressable accessibilityRole="button" accessibilityState={{selected:liked}} accessibilityLabel={t('v5.comment.like')} onPress={()=>void toggleLike()}><Text style={[styles.action,liked?styles.on:null]}>{t('v5.comment.likes',{count:String(count)})}</Text></Pressable>
      <V5Link label={t('v5.comment.reply')} onPress={()=>setReplying(v=>!v)}/></View>
    {replying?<View style={styles.replyBox}><V5Field label={t('v5.comment.replyLabel')} value={text} maxLength={1000} onChangeText={setText}/><PrimaryButton label={t('v5.send')} loading={busy} disabled={!text.trim()} onPress={()=>void send()}/></View>:null}
  </View>;
}

/** Follow-request state, mute and follower removal on another pet's profile (spec 2.3, 29.1). */
export function FollowPrivacyActions({petId,target}:{petId:string;target:Pet}){
  const {styles}=useThemedStyles(createStyles); const {t}=useI18n(); const [state,setState]=useState<FollowState|null>(null); const [muted,setMuted]=useState(Boolean(target.isMuted)); const [busy,setBusy]=useState(false);
  useEffect(()=>{let live=true;void getFollowState(petId,target.id).then(s=>{if(live)setState(s)}).catch(()=>undefined);return()=>{live=false}},[petId,target.id]);
  const run=async(action:()=>Promise<void>)=>{if(busy)return;setBusy(true);try{await action()}catch(e){fail(t,e)}finally{setBusy(false)}};
  return <View style={styles.inline}>
    {target.isPrivate&&state!=='following'?<V5Notice text={state==='requested'?t('v5.follow.requestPending'):t('v5.follow.privateNotice')}/>:null}
    <View style={styles.actions}>
      <V5Link label={muted?t('v5.privacy.unmute'):t('v5.follow.mute')} onPress={()=>void run(async()=>{setMuted(await setPetMute(petId,target.id,!muted))})}/>
      <V5Link danger label={t('v5.follow.removeFollower')} onPress={()=>Alert.alert(t('v5.follow.removeFollower'),t('v5.follow.removeFollowerBody',{name:target.name}),[{text:t('v5.cancel')},{text:t('v5.confirm'),onPress:()=>void run(async()=>{const removed=await removeFollower(petId,target.id);Alert.alert(removed?t('v5.follow.removed'):t('v5.follow.notFollower'))})}])}/>
    </View>
  </View>;
}

/** Owner and helper tools on a Lost Paw alert (spec 4.5, 32.3). */
export function LostPetAlertPanel({petId,alert,onChanged}:{petId:string;alert:LostPetAlert;onChanged:()=>void}){
  const {styles}=useThemedStyles(createStyles); const {t,locale}=useI18n(); const [sightings,setSightings]=useState<LostPetSighting[]>([]); const [busy,setBusy]=useState(false);
  const [description,setDescription]=useState(alert.description??''); const [collar,setCollar]=useState(alert.collarInfo??''); const [note,setNote]=useState('');
  const load=useCallback(async()=>{try{setSightings(await getLostPetSightings(petId,alert.id))}catch{setSightings([])}},[petId,alert.id]);
  useEffect(()=>{void load()},[load]);
  const run=async(action:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);try{await action();await load();onChanged()}catch(e){fail(t,e)}finally{setBusy(false)}};
  const formatDate=(iso?:string|null)=>{if(!iso)return '';try{return new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(new Date(iso))}catch{return iso}};
  const report=(kind:'seen'|'found')=>void run(async()=>{const permission=await Location.requestForegroundPermissionsAsync();if(permission.status!=='granted')throw new Error(t('v5.lost.locationNeeded'));const pos=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced});await reportLostPetSighting(petId,alert.id,{kind,note,latitude:pos.coords.latitude,longitude:pos.coords.longitude,seenAt:new Date().toISOString()},Crypto.randomUUID());setNote('');Alert.alert(t('v5.lost.reportSent'))});
  const canExpand=alert.isMine&&(alert.radiusKm??5)<10&&Date.now()-new Date(alert.createdAt).getTime()>=24*3600*1000;
  return <View style={styles.inline}>
    {alert.expiresAt?<Text style={styles.meta}>{t('v5.lost.expires',{date:formatDate(alert.expiresAt),km:String(alert.radiusKm??'')})}</Text>:null}
    {alert.description||alert.collarInfo?<Text style={styles.body}>{[alert.description,alert.collarInfo].filter(Boolean).join(' · ')}</Text>:null}
    {alert.isMine?<>
      <V5Field label={t('v5.lost.descriptionLabel')} value={description} maxLength={500} onChangeText={setDescription}/>
      <V5Field label={t('v5.lost.collarLabel')} value={collar} maxLength={200} onChangeText={setCollar}/>
      <PrimaryButton variant="secondary" label={t('v5.save')} loading={busy} onPress={()=>void run(()=>setLostPetAlertDetails(petId,alert.id,{description,collarInfo:collar,hasMicrochip:alert.hasMicrochip??null}))}/>
      <View style={styles.actions}>
        {canExpand?<V5Link label={t('v5.lost.expand')} onPress={()=>void run(()=>expandLostPetAlert(petId,alert.id))}/>:<Text style={styles.meta}>{(alert.radiusKm??5)>=10?t('v5.lost.expanded'):t('v5.lost.expandLater')}</Text>}
        <V5Link label={t('v5.lost.extend')} onPress={()=>void run(()=>extendLostPetAlert(petId,alert.id))}/>
      </View>
      <Text style={styles.meta}>{sightings.length?t('v5.lost.reportsTitle'):t('v5.lost.noReports')}</Text>
      {sightings.map(s=><V5Row key={s.id} title={`${s.kind==='found'?t('v5.lost.found'):t('v5.lost.seen')} · ${s.reporter?.name??''}`} meta={`${formatDate(s.seenAt)} · ${s.approximateLatitude.toFixed(3)}, ${s.approximateLongitude.toFixed(3)}${s.note?` · ${s.note}`:''}`}/>)}
    </>:<>
      <V5Field label={t('v5.lost.noteLabel')} value={note} maxLength={500} onChangeText={setNote}/>
      <View style={styles.actions}><V5Link label={t('v5.lost.seen')} onPress={()=>report('seen')}/><V5Link label={t('v5.lost.found')} onPress={()=>report('found')}/></View>
      {sightings.map(s=><V5Row key={s.id} title={s.kind==='found'?t('v5.lost.found'):t('v5.lost.seen')} meta={formatDate(s.createdAt)}><V5Link danger label={t('v5.lost.withdraw')} onPress={()=>void run(()=>withdrawLostPetSighting(petId,s.id))}/></V5Row>)}
    </>}
  </View>;
}

/** Two-hour park check-in for one place (spec 4.2). */
export function PlaceCheckinPanel({petId,placeId}:{petId:string;placeId:string}){
  const {styles}=useThemedStyles(createStyles); const {t}=useI18n(); const [items,setItems]=useState<PlaceCheckin[]>([]); const [busy,setBusy]=useState(false);
  const load=useCallback(async()=>{try{setItems(await getPlaceCheckins(petId,placeId))}catch{setItems([])}},[petId,placeId]);
  useEffect(()=>{void load()},[load]);
  const mine=items.some(i=>i.isMine);
  const toggle=async()=>{if(busy)return;setBusy(true);try{if(mine)await checkOutPlace(petId);else{const permission=await Location.requestForegroundPermissionsAsync();if(permission.status!=='granted')throw new Error(t('v5.lost.locationNeeded'));const pos=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.High});await checkInPlace(petId,placeId,pos.coords.latitude,pos.coords.longitude)}await load()}catch(e){fail(t,e)}finally{setBusy(false)}};
  return <View style={styles.inline}>
    <Text style={styles.meta}>{items.length?t('v5.checkin.now',{count:String(items.length)}):t('v5.checkin.nobody')}</Text>
    {items.slice(0,6).map(i=><Text key={i.id} style={styles.body}>{`${i.petName} · ${t(`v5.size.${i.size}`)}`}</Text>)}
    <PrimaryButton variant="secondary" label={mine?t('v5.checkin.leave'):t('v5.checkin.arrive')} loading={busy} onPress={()=>void toggle()}/>
    <Text style={styles.meta}>{t('v5.checkin.privacy')}</Text>
  </View>;
}

/** Waitlist, participation rules, community calendar and cancellation for one event (spec 4.3, 32.2). */
export function EventParticipationPanel({petId,event,onChanged}:{petId:string;event:PetEvent;onChanged:()=>void}){
  const {styles}=useThemedStyles(createStyles); const {t}=useI18n(); const [busy,setBusy]=useState(false); const [sizes,setSizes]=useState<string[]>(event.allowedSizes??[]);
  const run=async(action:()=>Promise<unknown>,message?:string)=>{if(busy)return;setBusy(true);try{await action();if(message)Alert.alert(message);onChanged()}catch(e){fail(t,e)}finally{setBusy(false)}};
  const mineCreated=event.creatorPetId===petId; const full=event.capacity!=null&&(event.goingCount??0)>=event.capacity;
  const toggleSize=(size:string)=>setSizes(current=>current.includes(size)?current.filter(s=>s!==size):[...current,size]);
  return <View style={styles.inline}>
    <Text style={styles.meta}>{t('v5.event.counts',{going:String(event.goingCount??0),capacity:event.capacity!=null?String(event.capacity):'∞',waiting:String(event.waitlistCount??0)})}</Text>
    {event.allowedSizes?.length?<Text style={styles.meta}>{t('v5.event.sizesOnly',{sizes:event.allowedSizes.map(s=>t(`v5.size.${s}`)).join(', ')})}</Text>:null}
    {event.eligible===false?<V5Notice text={t('v5.event.notEligible')}/>:null}
    {!mineCreated&&event.myStatus!=='going'&&full&&event.eligible!==false?(event.onWaitlist?<V5Link danger label={t('v5.event.leaveWaitlist')} onPress={()=>void run(()=>leaveEventWaitlist(petId,event.id))}/>:<V5Link label={t('v5.event.joinWaitlist')} onPress={()=>void run(async()=>{const r=await joinEventWaitlist(petId,event.id);Alert.alert(t('v5.event.waitlistPosition',{position:String(r.position)}))})}/>):null}
    {mineCreated?<>
      <Text style={styles.meta}>{t('v5.event.rulesTitle')}</Text>
      <V5Chips options={SIZES} value={sizes as typeof SIZES[number][]} onChange={toggleSize} labelFor={s=>t(`v5.size.${s}`)}/>
      <View style={styles.actions}>
        <V5Link label={t('v5.save')} onPress={()=>void run(()=>setEventParticipationRules(petId,event.id,null,sizes.length?sizes:null),t('v5.saved'))}/>
        <V5Link label={t('v5.event.addToCommunity')} onPress={()=>void pickCommunity(petId,t,true,communityId=>run(()=>setEventCommunity(petId,event.id,communityId),t('v5.saved')))}/>
        <V5Link danger label={t('v5.event.cancel')} onPress={()=>Alert.alert(t('v5.event.cancel'),t('v5.event.cancelBody'),[{text:t('v5.cancel')},{text:t('v5.confirm'),style:'destructive',onPress:()=>void run(()=>cancelPetEvent(petId,event.id,''),t('v5.event.cancelled'))}])}/>
      </View>
    </>:null}
  </View>;
}

async function pickCommunity(petId:string,t:Translate,managersOnly:boolean,onPick:(communityId:string)=>Promise<void>|void){
  try{
    const mine=(await searchCommunities(petId,'',null,50)).filter(c=>managersOnly?c.myRole==='owner'||c.myRole==='moderator':c.myRole!==null).slice(0,3);
    if(!mine.length){Alert.alert(t('v5.community.noneJoined'));return}
    Alert.alert(t('v5.community.pick'),undefined,[...mine.map(c=>({text:c.name,onPress:()=>void onPick(c.id)})),{text:t('v5.cancel'),style:'cancel' as const}]);
  }catch(e){fail(t,e)}
}

/** Owner action from the post menu: share one of the pet's posts to a community feed. */
export function shareOwnPostToCommunity(petId:string,postId:string){
  const t=((key:string,vars?:Record<string,string|number>)=>translate(getRuntimeLocale(),key,vars)) as Translate;
  void pickCommunity(petId,t,false,async communityId=>{try{await setPostCommunity(petId,postId,communityId);Alert.alert(t('v5.saved'))}catch(e){fail(t,e)}});
}

const createStyles=(theme:AppTheme)=>StyleSheet.create({
  inline:{gap:6,marginTop:6},actions:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:14},
  meta:{fontSize:12,fontWeight:'700',color:theme.colors.muted},body:{fontSize:13,color:theme.colors.text},
  action:{fontSize:13,fontWeight:'900',color:theme.colors.muted},on:{color:theme.colors.primary},replyBox:{gap:6}
});
