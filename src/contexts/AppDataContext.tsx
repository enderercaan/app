import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { DiscoveryFilters, Match, Pet, PetEvent, Post, Story } from '../types/domain';
import { demoActivePet, demoEvents, demoMatches, demoPets, demoPosts, demoStories } from '../data/demo';
import { defaultDiscoveryFilters } from '../domain/validation';
import { useAuth } from './AuthContext';
import * as api from '../services/api';
import { subscribeToUserSignals, unsubscribe } from '../services/realtime';
import { registerPushToken, registerVoipPushToken, subscribeToPushTokenRefresh } from '../services/notifications';
import { clearDurableClientOperation, clearDurableClientOperationForIntent, getOrCreateDurableClientOperation } from '../services/clientOperation';
import { executeWithOfflineQueue, isOfflineMutationQueuedError, subscribeOfflineReplay } from '../services/offlineMutationQueue';

type AppDataState = {
  activePet: Pet|null; myPets:Pet[]; discover:Pet[]; matches:Match[]; feed:Post[]; stories:Story[]; events:PetEvent[];
  unreadMessageCount:number; matchesHasMore:boolean; loadingMoreMatches:boolean; storiesHasMore:boolean; loadingMoreStories:boolean; eventsHasMore:boolean; loadingMoreEvents:boolean;
  filters:DiscoveryFilters; feedMode:'local'|'for_you'|'following'; busy:boolean; ready:boolean; bootstrapFailed:boolean; connectionIssue:boolean; setFeedMode:(mode:'local'|'for_you'|'following')=>void; setFilters:React.Dispatch<React.SetStateAction<DiscoveryFilters>>; setActivePet:(pet:Pet)=>void;
  refreshAll:()=>Promise<boolean>; refreshMatches:()=>Promise<void>; loadMoreMatches:()=>Promise<void>; loadMoreStories:()=>Promise<void>; loadMoreEvents:()=>Promise<void>; like:(pet:Pet,kind?:'like'|'super_like',sourcePetId?:string)=>Promise<{matched:boolean;queued:boolean}>; pass:(pet:Pet)=>Promise<{queued:boolean}>; favorite:(pet:Pet)=>Promise<boolean>;
};
const AppDataContext=createContext<AppDataState|null>(null);
const MATCH_PAGE_SIZE=30;
const STORY_PAGE_SIZE=40;
const EVENT_PAGE_SIZE=30;

export function AppDataProvider({children}:{children:React.ReactNode}){
  const {demoMode,user}=useAuth();
  const [myPets,setMyPets]=useState<Pet[]>(demoMode?[demoActivePet]:[]); const [activePet,setActivePetState]=useState<Pet|null>(demoMode?demoActivePet:null);
  const [discover,setDiscover]=useState<Pet[]>(demoMode?demoPets:[]); const [matches,setMatches]=useState<Match[]>(demoMode?demoMatches:[]);
  const [unreadMessageCount,setUnreadMessageCount]=useState(demoMode?demoMatches.reduce((sum,item)=>sum+(item.unreadCount||0),0):0);
  const [matchesHasMore,setMatchesHasMore]=useState(false); const [loadingMoreMatches,setLoadingMoreMatches]=useState(false);
  const [feed,setFeed]=useState<Post[]>(demoMode?demoPosts:[]); const [stories,setStories]=useState<Story[]>(demoMode?demoStories:[]); const [events,setEvents]=useState<PetEvent[]>(demoMode?demoEvents:[]);
  const [storiesHasMore,setStoriesHasMore]=useState(false); const [loadingMoreStories,setLoadingMoreStories]=useState(false);
  const [eventsHasMore,setEventsHasMore]=useState(false); const [loadingMoreEvents,setLoadingMoreEvents]=useState(false);
  const [bootstrapFailed,setBootstrapFailed]=useState(false);
  const [filters,setFilters]=useState<DiscoveryFilters>(defaultDiscoveryFilters()); const [feedMode,setFeedMode]=useState<'local'|'for_you'|'following'>('local'); const [busy,setBusy]=useState(false); const [ready,setReady]=useState(false); const [connectionIssue,setConnectionIssue]=useState(false);
  const activePetIdRef=useRef<string|null>(activePet?.id??null);
  const filtersRef=useRef(filters);filtersRef.current=filters;
  const feedModeRef=useRef(feedMode);feedModeRef.current=feedMode;
  const userIdRef=useRef<string|null>(user?.id??null);userIdRef.current=user?.id??null;
  const accountRequestRef=useRef(0);
  const petGenerationRef=useRef(0);
  const hydrateRequestRef=useRef(0);
  const discoverRequestRef=useRef(0);
  const contentRequestRef=useRef(0);
  const matchRefreshRequestRef=useRef(0);
  const matchPageRequestRef=useRef(0);
  const storyPageRequestRef=useRef(0);
  const eventPageRequestRef=useRef(0);
  const matchPageBusyRef=useRef(false); const storyPageBusyRef=useRef(false); const eventPageBusyRef=useRef(false);

  const markActivePet=useCallback((pet:Pet|null)=>{
    const nextId=pet?.id??null;
    const changed=activePetIdRef.current!==nextId;
    activePetIdRef.current=nextId;
    if(changed)petGenerationRef.current+=1;
    hydrateRequestRef.current+=1;
    discoverRequestRef.current+=1;
    contentRequestRef.current+=1;
    matchRefreshRequestRef.current+=1;
    matchPageRequestRef.current+=1;
    storyPageRequestRef.current+=1;
    eventPageRequestRef.current+=1;
    matchPageBusyRef.current=false;storyPageBusyRef.current=false;eventPageBusyRef.current=false;
    setLoadingMoreMatches(false);setLoadingMoreStories(false);setLoadingMoreEvents(false);
    if(changed){
      // Never render pet A's private/social data under pet B while the new requests are in flight.
      setDiscover([]);setMatches([]);setUnreadMessageCount(0);setMatchesHasMore(false);
      setFeed([]);setStories([]);setStoriesHasMore(false);setEvents([]);setEventsHasMore(false);
      setConnectionIssue(false);
    }
    setActivePetState(pet);
  },[]);

  const currentPetSnapshot=useCallback((petId:string)=>({petId,generation:petGenerationRef.current}),[]);
  const isCurrentPetSnapshot=useCallback((snapshot:{petId:string;generation:number})=>
    activePetIdRef.current===snapshot.petId&&petGenerationRef.current===snapshot.generation,[]);

  const loadForPet=useCallback(async(pet:Pet)=>{
    const requestId=++hydrateRequestRef.current;
    const petId=pet.id;
    const snapshot=currentPetSnapshot(petId);
    const filterSnapshot=filtersRef.current;
    const feedModeSnapshot=feedModeRef.current;
    const results=await Promise.allSettled([api.discoverPets(petId,filterSnapshot),api.getMatchesPage(petId,undefined,MATCH_PAGE_SIZE),api.getUnreadMatchMessageCount(petId),api.getFeedPage(petId,feedModeSnapshot,undefined,20).then(page=>page.items),api.getStoriesPage(petId,undefined,STORY_PAGE_SIZE),api.getEventsPage(petId,undefined,EVENT_PAGE_SIZE)]);
    if(requestId!==hydrateRequestRef.current||!isCurrentPetSnapshot(snapshot)||filtersRef.current!==filterSnapshot||feedModeRef.current!==feedModeSnapshot)return false;
    const [d,m,u,f,s,e]=results;
    if(d.status==='fulfilled')setDiscover(d.value);
    if(m.status==='fulfilled'){setMatches(m.value);setMatchesHasMore(m.value.length===MATCH_PAGE_SIZE)}
    if(u.status==='fulfilled')setUnreadMessageCount(u.value);
    if(f.status==='fulfilled')setFeed(f.value);
    if(s.status==='fulfilled'){setStories(s.value);setStoriesHasMore(s.value.length===STORY_PAGE_SIZE)}
    if(e.status==='fulfilled'){setEvents(e.value);setEventsHasMore(e.value.length===EVENT_PAGE_SIZE)}
    const allOk=results.every(result=>result.status==='fulfilled');
    setConnectionIssue(!allOk);
    return allOk;
  },[currentPetSnapshot,isCurrentPetSnapshot]);

  const refreshAll=useCallback(async()=>{
    const requestId=++accountRequestRef.current;const accountId=user?.id??null;
    if(demoMode){setMyPets([demoActivePet]);if(!activePetIdRef.current)markActivePet(demoActivePet);setDiscover(demoPets);setMatches(demoMatches);setUnreadMessageCount(demoMatches.reduce((sum,item)=>sum+(item.unreadCount||0),0));setMatchesHasMore(false);setFeed(demoPosts);setStories(demoStories);setStoriesHasMore(false);setEvents(demoEvents);setEventsHasMore(false);setBootstrapFailed(false);setReady(true);return true;}
    if(!accountId){setMyPets([]);markActivePet(null);setBootstrapFailed(false);setConnectionIssue(false);setReady(true);return true}setBusy(true);
    try{const pets=await api.getMyPets();if(requestId!==accountRequestRef.current||userIdRef.current!==accountId)return false;setMyPets(pets);const selectedPetId=activePetIdRef.current;const current=(selectedPetId?pets.find(p=>p.id===selectedPetId):undefined)??pets[0]??null;markActivePet(current);if(current)await loadForPet(current);else{setDiscover([]);setMatches([]);setUnreadMessageCount(0);setMatchesHasMore(false);setFeed([]);setStories([]);setStoriesHasMore(false);setEvents([]);setEventsHasMore(false);setConnectionIssue(false)}if(requestId!==accountRequestRef.current||userIdRef.current!==accountId)return false;setBootstrapFailed(false);return true}catch{if(requestId!==accountRequestRef.current||userIdRef.current!==accountId)return false;setBootstrapFailed(!ready);setConnectionIssue(true);return false}finally{if(requestId===accountRequestRef.current&&userIdRef.current===accountId){setBusy(false);setReady(true)}}
  },[demoMode,user?.id,loadForPet,markActivePet]);

  useEffect(()=>{void refreshAll()},[demoMode,user?.id]);
  useEffect(()=>{hydrateRequestRef.current+=1;if(demoMode||!activePet)return;const petId=activePet.id;const snapshot=currentPetSnapshot(petId);const requestId=++discoverRequestRef.current;void api.discoverPets(petId,filters).then(x=>{if(requestId!==discoverRequestRef.current||!isCurrentPetSnapshot(snapshot))return;setDiscover(x);setConnectionIssue(false)}).catch(()=>{if(requestId===discoverRequestRef.current&&isCurrentPetSnapshot(snapshot))setConnectionIssue(true)})},[demoMode,activePet?.id,filters,currentPetSnapshot,isCurrentPetSnapshot]);
  useEffect(()=>{hydrateRequestRef.current+=1;if(demoMode||!activePet)return;const petId=activePet.id;const snapshot=currentPetSnapshot(petId);matchPageRequestRef.current+=1;storyPageRequestRef.current+=1;eventPageRequestRef.current+=1;matchPageBusyRef.current=false;storyPageBusyRef.current=false;eventPageBusyRef.current=false;setLoadingMoreMatches(false);setLoadingMoreStories(false);setLoadingMoreEvents(false);const requestId=++contentRequestRef.current;void Promise.allSettled([api.getMatchesPage(petId,undefined,MATCH_PAGE_SIZE),api.getUnreadMatchMessageCount(petId),api.getFeedPage(petId,feedMode,undefined,20).then(page=>page.items),api.getStoriesPage(petId,undefined,STORY_PAGE_SIZE),api.getEventsPage(petId,undefined,EVENT_PAGE_SIZE)]).then(results=>{if(requestId!==contentRequestRef.current||!isCurrentPetSnapshot(snapshot))return;const [m,u,f,s,e]=results;if(m.status==='fulfilled'){setMatches(m.value);setMatchesHasMore(m.value.length===MATCH_PAGE_SIZE)}if(u.status==='fulfilled')setUnreadMessageCount(u.value);if(f.status==='fulfilled')setFeed(f.value);if(s.status==='fulfilled'){setStories(s.value);setStoriesHasMore(s.value.length===STORY_PAGE_SIZE)}if(e.status==='fulfilled'){setEvents(e.value);setEventsHasMore(e.value.length===EVENT_PAGE_SIZE)}setConnectionIssue(results.some(result=>result.status==='rejected'))})},[demoMode,activePet?.id,feedMode,currentPetSnapshot,isCurrentPetSnapshot]);
  useEffect(()=>{if(!demoMode&&activePet){void registerPushToken(activePet.id,false).catch(()=>undefined);void registerVoipPushToken(activePet.id).catch(()=>undefined)}},[demoMode,activePet?.id]);
  useEffect(()=>{if(demoMode||!activePet)return;const subscription=subscribeToPushTokenRefresh(activePet.id);return()=>subscription.remove()},[demoMode,activePet?.id]);
  const refreshRealtimeSignals=useCallback(async(types:Set<string>)=>{
    if(demoMode||!activePet||!types.size)return;
    const petId=activePet.id;
    const snapshot=currentPetSnapshot(petId);
    const isCurrentPet=()=>activePetIdRef.current===snapshot.petId&&isCurrentPetSnapshot(snapshot);
    const tasks:Promise<void>[]=[];
    if([...types].some(type=>type==='match'||type==='message'||type==='like')){matchPageRequestRef.current+=1;matchPageBusyRef.current=false;setLoadingMoreMatches(false);tasks.push(Promise.all([api.getMatchesPage(petId,undefined,MATCH_PAGE_SIZE),api.getUnreadMatchMessageCount(petId)]).then(([value,unread])=>{if(!isCurrentPet())return;setMatches(value);setMatchesHasMore(value.length===MATCH_PAGE_SIZE);setUnreadMessageCount(unread);if(types.has('match')){const matchedIds=new Set(value.map(item=>item.otherPet.id));setDiscover(current=>current.filter(item=>!matchedIds.has(item.id)))}}))}
    if([...types].some(type=>type==='comment'||type==='follow'))tasks.push(api.getFeedPage(petId,feedMode,undefined,20).then(page=>page.items).then(value=>{if(isCurrentPet())setFeed(value)}));
    if(types.has('event')){eventPageRequestRef.current+=1;eventPageBusyRef.current=false;setLoadingMoreEvents(false);tasks.push(api.getEventsPage(petId,undefined,EVENT_PAGE_SIZE).then(value=>{if(!isCurrentPet())return;setEvents(value);setEventsHasMore(value.length===EVENT_PAGE_SIZE)}))}
    if(types.has('health'))tasks.push(api.getMyPets().then(pets=>{if(!isCurrentPet())return;setMyPets(pets);const current=pets.find(pet=>pet.id===petId);if(current)setActivePetState(current)}));
    if(!tasks.length)return;
    const results=await Promise.allSettled(tasks);
    if(isCurrentPet()&&results.some(result=>result.status==='rejected'))setConnectionIssue(true);
  },[demoMode,activePet?.id,feedMode,currentPetSnapshot,isCurrentPetSnapshot]);

  useEffect(()=>{
    if(demoMode||!user?.id)return;
    let timer: ReturnType<typeof setTimeout>|null=null;
    const pendingTypes=new Set<string>();
    const channel=subscribeToUserSignals(user.id,type=>{
      if(type)pendingTypes.add(type);
      if(timer)clearTimeout(timer);
      timer=setTimeout(()=>{const types=new Set(pendingTypes);pendingTypes.clear();void refreshRealtimeSignals(types)},350);
    });
    return()=>{if(timer)clearTimeout(timer);void unsubscribe(channel)};
  },[demoMode,user?.id,refreshRealtimeSignals]);

  useEffect(()=>subscribeOfflineReplay(summary=>{if(!demoMode&&user?.id&&(summary.sent>0||summary.failed>0))void refreshAll()}),[demoMode,user?.id,refreshAll]);

  const refreshMatches=useCallback(async()=>{matchPageRequestRef.current+=1;matchPageBusyRef.current=false;setLoadingMoreMatches(false);if(demoMode){setMatches(demoMatches);setUnreadMessageCount(demoMatches.reduce((sum,item)=>sum+(item.unreadCount||0),0));setMatchesHasMore(false);return}if(!activePet)return;const petId=activePet.id;const snapshot=currentPetSnapshot(petId);const requestId=++matchRefreshRequestRef.current;try{const [value,unread]=await Promise.all([api.getMatchesPage(petId,undefined,MATCH_PAGE_SIZE),api.getUnreadMatchMessageCount(petId)]);if(requestId!==matchRefreshRequestRef.current||!isCurrentPetSnapshot(snapshot))return;setMatches(value);setMatchesHasMore(value.length===MATCH_PAGE_SIZE);setUnreadMessageCount(unread);setConnectionIssue(false)}catch{if(requestId===matchRefreshRequestRef.current&&isCurrentPetSnapshot(snapshot))setConnectionIssue(true)}},[demoMode,activePet?.id,currentPetSnapshot,isCurrentPetSnapshot]);

  const loadMoreMatches=useCallback(async()=>{if(demoMode||!activePet||matchPageBusyRef.current||!matchesHasMore||!matches.length)return;const petId=activePet.id;const snapshot=currentPetSnapshot(petId);const requestId=++matchPageRequestRef.current;const last=matches[matches.length-1];if(!last)return;matchPageBusyRef.current=true;try{setLoadingMoreMatches(true);const page=await api.getMatchesPage(petId,{matchedAt:last.lastMessageAt??last.matchedAt,id:last.id},MATCH_PAGE_SIZE);if(requestId!==matchPageRequestRef.current||!isCurrentPetSnapshot(snapshot))return;setMatches(current=>{const seen=new Set(current.map(item=>item.id));return [...current,...page.filter(item=>!seen.has(item.id))]});setMatchesHasMore(page.length===MATCH_PAGE_SIZE);setConnectionIssue(false)}catch{if(requestId===matchPageRequestRef.current&&isCurrentPetSnapshot(snapshot))setConnectionIssue(true)}finally{if(requestId===matchPageRequestRef.current&&isCurrentPetSnapshot(snapshot)){matchPageBusyRef.current=false;setLoadingMoreMatches(false)}}},[demoMode,activePet?.id,matchesHasMore,matches,currentPetSnapshot,isCurrentPetSnapshot]);

  const loadMoreStories=useCallback(async()=>{if(demoMode||!activePet||storyPageBusyRef.current||!storiesHasMore||!stories.length)return;const petId=activePet.id;const snapshot=currentPetSnapshot(petId);const requestId=++storyPageRequestRef.current;const last=stories[stories.length-1];if(!last)return;storyPageBusyRef.current=true;try{setLoadingMoreStories(true);const page=await api.getStoriesPage(petId,{createdAt:last.createdAt,id:last.id},STORY_PAGE_SIZE);if(requestId!==storyPageRequestRef.current||!isCurrentPetSnapshot(snapshot))return;setStories(current=>{const seen=new Set(current.map(item=>item.id));return [...current,...page.filter(item=>!seen.has(item.id))]});setStoriesHasMore(page.length===STORY_PAGE_SIZE);setConnectionIssue(false)}catch{if(requestId===storyPageRequestRef.current&&isCurrentPetSnapshot(snapshot))setConnectionIssue(true)}finally{if(requestId===storyPageRequestRef.current&&isCurrentPetSnapshot(snapshot)){storyPageBusyRef.current=false;setLoadingMoreStories(false)}}},[demoMode,activePet?.id,storiesHasMore,stories,currentPetSnapshot,isCurrentPetSnapshot]);

  const loadMoreEvents=useCallback(async()=>{if(demoMode||!activePet||eventPageBusyRef.current||!eventsHasMore||!events.length)return;const petId=activePet.id;const snapshot=currentPetSnapshot(petId);const requestId=++eventPageRequestRef.current;const last=events[events.length-1];if(!last)return;eventPageBusyRef.current=true;try{setLoadingMoreEvents(true);const page=await api.getEventsPage(petId,{startsAt:last.startsAt,id:last.id},EVENT_PAGE_SIZE);if(requestId!==eventPageRequestRef.current||!isCurrentPetSnapshot(snapshot))return;setEvents(current=>{const seen=new Set(current.map(item=>item.id));return [...current,...page.filter(item=>!seen.has(item.id))]});setEventsHasMore(page.length===EVENT_PAGE_SIZE);setConnectionIssue(false)}catch{if(requestId===eventPageRequestRef.current&&isCurrentPetSnapshot(snapshot))setConnectionIssue(true)}finally{if(requestId===eventPageRequestRef.current&&isCurrentPetSnapshot(snapshot)){eventPageBusyRef.current=false;setLoadingMoreEvents(false)}}},[demoMode,activePet?.id,eventsHasMore,events,currentPetSnapshot,isCurrentPetSnapshot]);

  const like=useCallback(async(pet:Pet,kind:'like'|'super_like'='like',sourcePetId?:string)=>{
    const petId=sourcePetId??activePet?.id;if(!petId)return{matched:false,queued:false};
    const snapshot=currentPetSnapshot(petId);const sourceIsCurrent=()=>isCurrentPetSnapshot(snapshot);
    if(demoMode){if(sourceIsCurrent())setDiscover(x=>x.filter(i=>i.id!==pet.id));const matched=pet.id==='demo-luna';return{matched,queued:false}}
    const operation=await getOrCreateDurableClientOperation('like',[petId,pet.id,kind]);
    try{
      const result=kind==='like'
        ?await executeWithOfflineQueue({type:'like',dedupeKey:`like:${operation.id}`,durableKey:operation.key,operationId:operation.id,fromPetId:petId,toPetId:pet.id,kind:'like'},()=>api.likePet(petId,pet.id,'like',operation.id))
        :await api.likePet(petId,pet.id,'super_like',operation.id);
      if(kind==='super_like')await clearDurableClientOperation(operation.key,operation.id);
      if(!sourceIsCurrent())return{matched:result.matched,queued:false};
      setDiscover(x=>x.filter(i=>i.id!==pet.id));
      if(result.matched){matchPageRequestRef.current+=1;matchPageBusyRef.current=false;setLoadingMoreMatches(false);const [value,unread]=await Promise.all([api.getMatchesPage(petId,undefined,MATCH_PAGE_SIZE),api.getUnreadMatchMessageCount(petId)]);if(sourceIsCurrent()){setMatches(value);setMatchesHasMore(value.length===MATCH_PAGE_SIZE);setUnreadMessageCount(unread)}}
      return{matched:result.matched,queued:false};
    }catch(error){
      if(kind==='like'&&isOfflineMutationQueuedError(error)){if(sourceIsCurrent())setDiscover(x=>x.filter(i=>i.id!==pet.id));return{matched:false,queued:true}}
      throw error;
    }
  },[activePet?.id,demoMode,currentPetSnapshot,isCurrentPetSnapshot]);
  const pass=useCallback(async(pet:Pet)=>{
    if(!activePet)return{queued:false};const petId=activePet.id;const snapshot=currentPetSnapshot(petId);let queued=false;
    if(!demoMode){
      const operation=await getOrCreateDurableClientOperation('pass',[petId,pet.id]);
      try{
        await executeWithOfflineQueue({type:'pass',dedupeKey:`pass:${operation.id}`,durableKey:operation.key,operationId:operation.id,fromPetId:petId,toPetId:pet.id},()=>api.passPet(petId,pet.id,operation.id));
        await clearDurableClientOperationForIntent('undo-pass',[petId]);
      }catch(error){if(isOfflineMutationQueuedError(error))queued=true;else throw error}
    }
    if(isCurrentPetSnapshot(snapshot))setDiscover(x=>x.filter(i=>i.id!==pet.id));
    return{queued};
  },[activePet,demoMode,currentPetSnapshot,isCurrentPetSnapshot]);
  const favorite=useCallback(async(pet:Pet)=>{const petId=activePet?.id;if(!petId)return Boolean(pet.isFavorite);const snapshot=currentPetSnapshot(petId);const desired=!Boolean(pet.isFavorite);const next=demoMode?desired:await api.setFavoritePet(petId,pet.id,desired);if(isCurrentPetSnapshot(snapshot))setDiscover(current=>current.map(item=>item.id===pet.id?{...item,isFavorite:next}:item));return next},[activePet?.id,demoMode,currentPetSnapshot,isCurrentPetSnapshot]);
  const setActivePet=useCallback((pet:Pet)=>markActivePet(pet),[markActivePet]);
  const value=useMemo(()=>({activePet,myPets,discover,matches,feed,stories,events,unreadMessageCount,matchesHasMore,loadingMoreMatches,storiesHasMore,loadingMoreStories,eventsHasMore,loadingMoreEvents,filters,feedMode,busy,ready,bootstrapFailed,connectionIssue,setFeedMode,setFilters,setActivePet,refreshAll,refreshMatches,loadMoreMatches,loadMoreStories,loadMoreEvents,like,pass,favorite}),[activePet,myPets,discover,matches,feed,stories,events,unreadMessageCount,matchesHasMore,loadingMoreMatches,storiesHasMore,loadingMoreStories,eventsHasMore,loadingMoreEvents,filters,feedMode,busy,ready,bootstrapFailed,connectionIssue,setFeedMode,setActivePet,refreshAll,refreshMatches,loadMoreMatches,loadMoreStories,loadMoreEvents,like,pass,favorite]);
  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}
export function useAppData(){const value=useContext(AppDataContext);if(!value)throw new Error('useAppData must be used inside AppDataProvider');return value}
