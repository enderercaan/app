import { useCallback, useEffect, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { TopBar } from '../components/TopBar';
import { V5Chips, V5Field, V5Link, V5Notice, V5Row, V5Section } from '../components/V5Kit';
import { useI18n } from '../i18n';
import { createCommunity, getCommunityEvents, getCommunityFeed, getCommunityJoinRequests, getCommunityMembers, joinCommunity, leaveCommunity, removePostFromCommunity, respondCommunityJoinRequest,
  searchCommunities, setCommunityMemberRole, updateCommunity, type Community, type CommunityEvent, type CommunityMember, type CommunityPost } from '../services/api';
import { userMessage } from '../services/errors';
import { useThemedStyles, type AppTheme } from '../theme';
import type { Pet } from '../types/domain';
import type { RootStackParamList } from '../navigation/types';

const KINDS=['regional','breed'] as const;
const slugify=(value:string)=>value.toLocaleLowerCase('en').normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/\u0131/g,'i').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48);

// Spec v5.0 4.4 / 32.2 / 36.3: regional and breed communities with rules, owner and moderator pets,
// membership requests, a community feed and a community event calendar.
export function CommunitiesScreen({route}:NativeStackScreenProps<RootStackParamList,'Communities'>){
  const {styles}=useThemedStyles(createStyles); const {t,locale}=useI18n(); const petId=route.params.petId;
  const [query,setQuery]=useState(''); const [list,setList]=useState<Community[]>([]); const [selected,setSelected]=useState<Community|null>(null);
  const [feed,setFeed]=useState<CommunityPost[]>([]); const [events,setEvents]=useState<CommunityEvent[]>([]); const [members,setMembers]=useState<CommunityMember[]>([]); const [requests,setRequests]=useState<{pet:Pet;createdAt:string}[]>([]);
  const [name,setName]=useState(''); const [kind,setKind]=useState<'regional'|'breed'>('regional'); const [place,setPlace]=useState(''); const [description,setDescription]=useState(''); const [rules,setRules]=useState(''); const [approval,setApproval]=useState(false);
  const [busy,setBusy]=useState(false); const [error,setError]=useState<string|null>(null);
  const loadList=useCallback(async()=>{setError(null);try{setList(await searchCommunities(petId,query,null,30))}catch(e){setError(userMessage(e,t('v5.loadFailed')))}},[petId,query,t]);
  useEffect(()=>{void loadList()},[loadList]);
  const loadDetail=useCallback(async(community:Community)=>{setError(null);try{const manager=community.myRole==='owner'||community.myRole==='moderator';const [f,e,m,r,fresh]=await Promise.all([getCommunityFeed(petId,community.id),getCommunityEvents(petId,community.id),getCommunityMembers(petId,community.id),manager?getCommunityJoinRequests(petId,community.id):Promise.resolve([]),searchCommunities(petId,community.name,community.kind,10)]);setFeed(f);setEvents(e);setMembers(m);setRequests(r);setSelected(fresh.find(c=>c.id===community.id)??community);setDescription(community.description);setRules(community.rules)}catch(err){setError(userMessage(err,t('v5.loadFailed')))}},[petId,t]);
  const run=async(action:()=>Promise<unknown>,after?:()=>Promise<void>|void)=>{if(busy)return;setBusy(true);try{await action();await after?.()}catch(e){Alert.alert(t('v5.actionFailed'),userMessage(e,t('v5.actionFailed')))}finally{setBusy(false)}};
  const formatDate=(iso:string)=>{try{return new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(new Date(iso))}catch{return iso}};

  if(selected){
    const role=selected.myRole; const manager=role==='owner'||role==='moderator'; const refresh=()=>loadDetail(selected);
    return <Screen><TopBar title={selected.name} subtitle={t('v5.community.members',{count:String(selected.memberCount)})} showBack/><ScrollView contentContainerStyle={styles.body}>
      {error?<V5Notice tone="warning" text={error}/>:null}
      <V5Section title={t('v5.community.about')}>
        {selected.description?<Text style={styles.text}>{selected.description}</Text>:null}
        <Text style={styles.label}>{t('v5.community.rules')}</Text><Text style={styles.text}>{selected.rules||t('v5.community.platformRulesOnly')}</Text>
        <V5Notice text={t('v5.community.rulesNote')}/>
        {role===null?(selected.joinRequested?<V5Notice text={t('v5.community.requested')}/>:<PrimaryButton label={t('v5.community.join')} loading={busy} onPress={()=>void run(()=>joinCommunity(petId,selected.id),refresh)}/>):null}
        {role&&role!=='owner'?<V5Link danger label={t('v5.community.leave')} onPress={()=>void run(()=>leaveCommunity(petId,selected.id),async()=>{setSelected(null);await loadList()})}/>:null}
      </V5Section>
      {manager?<V5Section title={t('v5.community.manage')}>
        <V5Field label={t('v5.community.descriptionLabel')} value={description} multiline maxLength={1000} onChangeText={setDescription}/>
        <V5Field label={t('v5.community.rulesLabel')} value={rules} multiline maxLength={2000} onChangeText={setRules}/>
        <PrimaryButton label={t('v5.save')} loading={busy} onPress={()=>void run(()=>updateCommunity(petId,selected.id,description,rules,selected.requiresApproval),refresh)}/>
        {requests.map(r=><V5Row key={r.pet.id} title={r.pet.name} meta={t('v5.community.wantsToJoin')}><V5Link label={t('v5.accept')} onPress={()=>void run(()=>respondCommunityJoinRequest(petId,selected.id,r.pet.id,true),refresh)}/><V5Link danger label={t('v5.decline')} onPress={()=>void run(()=>respondCommunityJoinRequest(petId,selected.id,r.pet.id,false),refresh)}/></V5Row>)}
      </V5Section>:null}
      <V5Section title={t('v5.community.events')} help={events.length?undefined:t('v5.community.noEvents')}>{events.map(e=><V5Row key={e.id} title={e.title} meta={`${formatDate(e.startsAt)} · ${e.district}`}/>)}</V5Section>
      <V5Section title={t('v5.community.feed')} help={feed.length?t('v5.community.shareHint'):t('v5.community.noPosts')}>{feed.map(p=><V5Row key={p.id} title={p.pet.name} meta={`${p.caption.slice(0,120)} · ${formatDate(p.createdAt)}`}>{manager?<V5Link danger label={t('v5.community.removePost')} onPress={()=>void run(()=>removePostFromCommunity(petId,selected.id,p.id),refresh)}/>:null}</V5Row>)}</V5Section>
      <V5Section title={t('v5.community.memberList')}>{members.map(m=><V5Row key={m.pet.id} title={m.pet.name} meta={t(`v5.community.role.${m.role}`)}>
        {role==='owner'&&m.role!=='owner'?<V5Link label={m.role==='moderator'?t('v5.community.makeMember'):t('v5.community.makeModerator')} onPress={()=>void run(()=>setCommunityMemberRole(petId,selected.id,m.pet.id,m.role==='moderator'?'member':'moderator'),refresh)}/>:null}
        {role==='owner'&&m.role!=='owner'?<V5Link label={t('v5.community.transfer')} onPress={()=>Alert.alert(t('v5.community.transfer'),t('v5.community.transferBody',{name:m.pet.name}),[{text:t('v5.cancel')},{text:t('v5.confirm'),onPress:()=>void run(()=>setCommunityMemberRole(petId,selected.id,m.pet.id,'owner'),refresh)}])}/>:null}
        {manager&&m.role==='member'?<V5Link danger label={t('v5.community.remove')} onPress={()=>void run(()=>setCommunityMemberRole(petId,selected.id,m.pet.id,'removed'),refresh)}/>:null}
      </V5Row>)}</V5Section>
      <V5Link label={t('v5.community.backToList')} onPress={()=>{setSelected(null);void loadList()}}/>
    </ScrollView></Screen>;
  }
  return <Screen><TopBar title={t('v5.community.title')} subtitle={t('v5.community.subtitle')} showBack/><ScrollView contentContainerStyle={styles.body}>
    {error?<V5Notice tone="warning" text={error}/>:null}
    <V5Section title={t('v5.community.find')}>
      <V5Field label={t('v5.community.searchLabel')} value={query} onChangeText={setQuery} returnKeyType="search" onSubmitEditing={()=>void loadList()}/>
      {list.map(c=><V5Row key={c.id} title={c.name} meta={`${c.kind==='regional'?c.city??'':c.breed??''} · ${t('v5.community.members',{count:String(c.memberCount)})}${c.myRole?` · ${t(`v5.community.role.${c.myRole}`)}`:''}`}><V5Link label={t('v5.open')} onPress={()=>void loadDetail(c)}/></V5Row>)}
      {!list.length?<Text style={styles.text}>{t('v5.community.none')}</Text>:null}
    </V5Section>
    <V5Section title={t('v5.community.create')} help={t('v5.community.createHelp')}>
      <V5Field label={t('v5.community.nameLabel')} value={name} maxLength={60} onChangeText={setName}/>
      <V5Chips options={KINDS} value={kind} onChange={setKind} labelFor={o=>t(`v5.community.kind.${o}`)}/>
      <V5Field label={kind==='regional'?t('v5.community.cityLabel'):t('v5.community.breedLabel')} value={place} maxLength={80} onChangeText={setPlace}/>
      <V5Field label={t('v5.community.descriptionLabel')} value={description} multiline maxLength={1000} onChangeText={setDescription}/>
      <V5Field label={t('v5.community.rulesLabel')} value={rules} multiline maxLength={2000} onChangeText={setRules}/>
      <View style={styles.switchRow}><Text style={styles.text}>{t('v5.community.approvalLabel')}</Text><Switch accessibilityLabel={t('v5.community.approvalLabel')} value={approval} onValueChange={setApproval}/></View>
      <PrimaryButton label={t('v5.community.createButton')} loading={busy} disabled={name.trim().length<3||!place.trim()||slugify(name).length<3} onPress={()=>void run(()=>createCommunity(petId,{name,slug:slugify(name),kind,city:kind==='regional'?place:null,breed:kind==='breed'?place:null,description,rules,requiresApproval:approval}),async()=>{setName('');setPlace('');setDescription('');setRules('');await loadList()})}/>
    </V5Section>
  </ScrollView></Screen>;
}
const createStyles=(theme:AppTheme)=>StyleSheet.create({body:{padding:16,paddingBottom:80,gap:12},text:{fontSize:14,lineHeight:20,color:theme.colors.text,flex:1},label:{fontSize:12,fontWeight:'800',color:theme.colors.muted},switchRow:{flexDirection:'row',alignItems:'center',gap:10}});
