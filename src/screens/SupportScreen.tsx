import { useCallback, useEffect, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { TopBar } from '../components/TopBar';
import { V5Chips, V5Field, V5Link, V5Notice, V5Row, V5Section } from '../components/V5Kit';
import { useI18n } from '../i18n';
import { addSupportTicketMessage, createSupportTicket, getMySupportTickets, getSupportTicket, type SupportCategory, type SupportTicket, type SupportTicketSummary } from '../services/api';
import { userMessage } from '../services/errors';
import { useThemedStyles, type AppTheme } from '../theme';

const CATEGORIES=['account','billing','safety','bug','privacy','lost_pet','other'] as const;

// Spec v5.0 36.4: support request with a ticket number, status tracking and replies.
export function SupportScreen(){
  const {styles}=useThemedStyles(createStyles); const {t,locale}=useI18n();
  const [tickets,setTickets]=useState<SupportTicketSummary[]>([]); const [open,setOpen]=useState<SupportTicket|null>(null);
  const [category,setCategory]=useState<SupportCategory>('bug'); const [subject,setSubject]=useState(''); const [body,setBody]=useState(''); const [reply,setReply]=useState('');
  const [operationId,setOperationId]=useState(()=>Crypto.randomUUID()); const [busy,setBusy]=useState(false); const [error,setError]=useState<string|null>(null);
  const load=useCallback(async()=>{setError(null);try{setTickets(await getMySupportTickets())}catch(e){setError(userMessage(e,t('v5.loadFailed')))}},[t]);
  useEffect(()=>{void load()},[load]);
  const formatDate=(iso:string)=>{try{return new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(new Date(iso))}catch{return iso}};
  const submit=async()=>{if(busy)return;setBusy(true);try{const created=await createSupportTicket(category,subject,body,operationId);setSubject('');setBody('');setOperationId(Crypto.randomUUID());Alert.alert(t('v5.support.createdTitle'),t('v5.support.createdBody',{number:created.ticketNumber}));await load()}catch(e){Alert.alert(t('v5.actionFailed'),userMessage(e,t('v5.actionFailed')))}finally{setBusy(false)}};
  const openTicket=async(id:string)=>{try{setOpen(await getSupportTicket(id))}catch(e){Alert.alert(t('v5.actionFailed'),userMessage(e,t('v5.loadFailed')))}};
  const sendReply=async()=>{if(!open||busy)return;setBusy(true);try{setOpen(await addSupportTicketMessage(open.id,reply));setReply('');await load()}catch(e){Alert.alert(t('v5.actionFailed'),userMessage(e,t('v5.actionFailed')))}finally{setBusy(false)}};
  if(open)return <Screen><TopBar title={open.ticketNumber} subtitle={t(`v5.support.status.${open.status}`)} showBack/><ScrollView contentContainerStyle={styles.body}>
    <V5Section title={open.subject}>{open.messages.map(m=><View key={m.id}><V5Row title={m.author==='staff'?t('v5.support.fromSupport'):t('v5.support.fromYou')} meta={formatDate(m.createdAt)}/><Text style={styles.message}>{m.body}</Text></View>)}</V5Section>
    {open.status!=='closed'?<V5Section title={t('v5.support.replyTitle')}><V5Field label={t('v5.support.messageLabel')} value={reply} multiline maxLength={4000} onChangeText={setReply}/><PrimaryButton label={t('v5.send')} loading={busy} disabled={!reply.trim()} onPress={()=>void sendReply()}/></V5Section>:<V5Notice text={t('v5.support.closed')}/>}
    <V5Link label={t('v5.support.backToList')} onPress={()=>setOpen(null)}/>
  </ScrollView></Screen>;
  return <Screen><TopBar title={t('v5.support.title')} subtitle={t('v5.support.subtitle')} showBack/><ScrollView contentContainerStyle={styles.body}>
    {error?<V5Notice tone="warning" text={error}/>:null}
    <V5Section title={t('v5.support.newTitle')} help={t('v5.support.newHelp')}>
      <V5Chips options={CATEGORIES} value={category} onChange={setCategory} labelFor={o=>t(`v5.support.category.${o}`)}/>
      <V5Field label={t('v5.support.subjectLabel')} value={subject} maxLength={120} onChangeText={setSubject}/>
      <V5Field label={t('v5.support.messageLabel')} value={body} multiline maxLength={4000} onChangeText={setBody}/>
      <PrimaryButton label={t('v5.send')} loading={busy} disabled={subject.trim().length<3||body.trim().length<10} onPress={()=>void submit()}/>
    </V5Section>
    <V5Section title={t('v5.support.myTickets')} help={tickets.length?undefined:t('v5.support.noTickets')}>
      {tickets.map(ticket=><V5Row key={ticket.id} title={`${ticket.ticketNumber} · ${ticket.subject}`} meta={`${t(`v5.support.status.${ticket.status}`)} · ${formatDate(ticket.updatedAt)}`}><V5Link label={t('v5.open')} onPress={()=>void openTicket(ticket.id)}/></V5Row>)}
    </V5Section>
  </ScrollView></Screen>;
}
const createStyles=(theme:AppTheme)=>StyleSheet.create({body:{padding:16,paddingBottom:80,gap:12},message:{fontSize:14,lineHeight:20,color:theme.colors.text,paddingBottom:6}});
