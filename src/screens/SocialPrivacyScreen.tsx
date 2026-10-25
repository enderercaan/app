import { useCallback, useEffect, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { TopBar } from '../components/TopBar';
import { V5Field, V5Link, V5Notice, V5Row, V5Section } from '../components/V5Kit';
import { useAppData } from '../contexts/AppDataContext';
import { useI18n } from '../i18n';
import { getFollowRequests, getMutedPets, isPetHandleAvailable, respondFollowRequest, setPetHandle, setPetMute, setPetPrivacy, type FollowRequest, type MutedPet } from '../services/api';
import { userMessage } from '../services/errors';
import { useThemedStyles, type AppTheme } from '../theme';
import type { RootStackParamList } from '../navigation/types';

// Spec v5.0 2.2 / 2.3 / 29.1: unique @handle, private profile with follow requests, muted pets.
export function SocialPrivacyScreen({route}:NativeStackScreenProps<RootStackParamList,'SocialPrivacy'>){
  const {styles}=useThemedStyles(createStyles); const {t}=useI18n(); const {myPets,refreshAll}=useAppData();
  const petId=route.params.petId; const pet=myPets.find(p=>p.id===petId)??null;
  const [handle,setHandle]=useState(pet?.handle??''); const [available,setAvailable]=useState<boolean|null>(null);
  const [isPrivate,setIsPrivate]=useState(Boolean(pet?.isPrivate)); const [requests,setRequests]=useState<FollowRequest[]>([]); const [muted,setMuted]=useState<MutedPet[]>([]);
  const [busy,setBusy]=useState(false); const [error,setError]=useState<string|null>(null);
  const load=useCallback(async()=>{if(!pet)return;setError(null);try{const [r,m]=await Promise.all([getFollowRequests(petId),getMutedPets(petId)]);setRequests(r);setMuted(m)}catch(e){setError(userMessage(e,t('v5.loadFailed')))}},[petId,pet?.id,t]);
  useEffect(()=>{void load()},[load]);
  const run=async(action:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);try{await action();await load()}catch(e){Alert.alert(t('v5.actionFailed'),userMessage(e,t('v5.actionFailed')))}finally{setBusy(false)}};
  const checkHandle=async()=>{try{setAvailable(await isPetHandleAvailable(handle))}catch{setAvailable(null)}};
  if(!pet)return <Screen><TopBar title={t('v5.privacy.title')} showBack/><V5Notice text={t('v5.petMissing')}/></Screen>;
  return <Screen><TopBar title={t('v5.privacy.title')} subtitle={pet.name} showBack/><ScrollView contentContainerStyle={styles.body}>
    {error?<V5Notice tone="warning" text={error}/>:null}
    <V5Section title={t('v5.privacy.handleTitle')} help={t('v5.privacy.handleHelp')}>
      <V5Field label={t('v5.privacy.handleLabel')} value={handle} autoCapitalize="none" autoCorrect={false} maxLength={31} onChangeText={value=>{setHandle(value);setAvailable(null)}} onBlur={()=>void checkHandle()}/>
      {available!==null?<Text style={available?styles.ok:styles.bad}>{available?t('v5.privacy.handleFree'):t('v5.privacy.handleTaken')}</Text>:null}
      <PrimaryButton label={t('v5.save')} loading={busy} disabled={!handle.trim()} onPress={()=>void run(async()=>{await setPetHandle(petId,handle);await refreshAll()})}/>
    </V5Section>
    <V5Section title={t('v5.privacy.privateTitle')} help={t('v5.privacy.privateHelp')}>
      <View style={styles.switchRow}><Text style={styles.switchLabel}>{t('v5.privacy.privateLabel')}</Text><Switch accessibilityLabel={t('v5.privacy.privateLabel')} value={isPrivate} disabled={busy} onValueChange={value=>{setIsPrivate(value);void run(async()=>{await setPetPrivacy(petId,value);await refreshAll()})}}/></View>
    </V5Section>
    <V5Section title={t('v5.privacy.requestsTitle')} help={requests.length?undefined:t('v5.privacy.requestsEmpty')}>
      {requests.map(r=><V5Row key={r.pet.id} title={r.pet.name} meta={`${r.pet.breed} · ${r.pet.district}`}><V5Link label={t('v5.accept')} onPress={()=>void run(()=>respondFollowRequest(petId,r.pet.id,true))}/><V5Link danger label={t('v5.decline')} onPress={()=>void run(()=>respondFollowRequest(petId,r.pet.id,false))}/></V5Row>)}
    </V5Section>
    <V5Section title={t('v5.privacy.mutedTitle')} help={muted.length?t('v5.privacy.mutedHelp'):t('v5.privacy.mutedEmpty')}>
      {muted.map(m=><V5Row key={m.pet.id} title={m.pet.name} meta={m.pet.breed}><V5Link label={t('v5.privacy.unmute')} onPress={()=>void run(()=>setPetMute(petId,m.pet.id,false))}/></V5Row>)}
    </V5Section>
  </ScrollView></Screen>;
}
const createStyles=(theme:AppTheme)=>StyleSheet.create({body:{padding:16,paddingBottom:80},ok:{fontSize:12,fontWeight:'800',color:theme.colors.primary},bad:{fontSize:12,fontWeight:'800',color:theme.colors.danger},switchRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},switchLabel:{flex:1,fontSize:14,fontWeight:'800',color:theme.colors.text}});
