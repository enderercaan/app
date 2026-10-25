import { useCallback, useEffect, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Alert, ScrollView, StyleSheet } from 'react-native';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { TopBar } from '../components/TopBar';
import { V5Chips, V5Field, V5Link, V5Notice, V5Row, V5Section } from '../components/V5Kit';
import { useAppData } from '../contexts/AppDataContext';
import { useI18n } from '../i18n';
import { useThemedStyles, type AppTheme } from '../theme';
import { deletePetAllergy, deletePetCareReminder, deletePetWeightLog, getPetAllergies, getPetCareReminders, getPetWeightHistory, logPetWeight, markPetCareReminderDone, upsertPetAllergy, upsertPetCareReminder,
  type CareReminder, type CareReminderKind, type PetAllergy, type WeightHistory } from '../services/api';
import { userMessage } from '../services/errors';
import type { RootStackParamList } from '../navigation/types';

const ALLERGY_CATEGORIES=['food','environmental','medication','insect','other'] as const;
const SEVERITIES=['mild','moderate','severe','unknown'] as const;
const REMINDER_KINDS=['medication','vitamin','grooming','nail_trim','teeth','bath','other'] as const;
const today=()=>new Date().toISOString().slice(0,10);
const deviceTimeZone=()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'}catch{return 'UTC'}};

// Spec v5.0 5.3 / 33.3: weight log, allergy card and owner-defined care reminders. The app never
// suggests a medicine or a dose; reminders only repeat what the owner already gives the pet.
export function CareScreen({route}:NativeStackScreenProps<RootStackParamList,'Care'>){
  const {styles}=useThemedStyles(createStyles);
  const {t,locale}=useI18n(); const {myPets}=useAppData(); const petId=route.params.petId; const pet=myPets.find(p=>p.id===petId)??null;
  const [weight,setWeight]=useState<WeightHistory|null>(null); const [allergies,setAllergies]=useState<PetAllergy[]>([]); const [reminders,setReminders]=useState<CareReminder[]>([]);
  const [kg,setKg]=useState(''); const [allergen,setAllergen]=useState(''); const [category,setCategory]=useState<PetAllergy['category']>('food'); const [severity,setSeverity]=useState<PetAllergy['severity']>('unknown');
  const [kind,setKind]=useState<CareReminderKind>('grooming'); const [title,setTitle]=useState(''); const [everyDays,setEveryDays]=useState('7'); const [time,setTime]=useState('09:00');
  const [busy,setBusy]=useState(false); const [error,setError]=useState<string|null>(null);
  const load=useCallback(async()=>{if(!pet)return;setError(null);try{const [w,a,r]=await Promise.all([getPetWeightHistory(petId),getPetAllergies(petId),getPetCareReminders(petId)]);setWeight(w);setAllergies(a);setReminders(r)}catch(e){setError(userMessage(e,t('v5.loadFailed')))}},[petId,pet?.id,t]);
  useEffect(()=>{void load()},[load]);
  const run=async(action:()=>Promise<unknown>,after?:()=>void)=>{if(busy)return;setBusy(true);try{await action();after?.();await load()}catch(e){Alert.alert(t('v5.actionFailed'),userMessage(e,t('v5.actionFailed')))}finally{setBusy(false)}};
  const formatDate=(iso:string)=>{try{return new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:iso.length>10?'short':undefined}).format(new Date(iso))}catch{return iso}};
  if(!pet)return <Screen><TopBar title={t('v5.care.title')} showBack/><V5Notice text={t('v5.petMissing')}/></Screen>;
  const entries=weight?.entries??[];
  return <Screen><TopBar title={t('v5.care.title')} subtitle={pet.name} showBack/><ScrollView contentContainerStyle={styles.body}>
    {error?<V5Notice tone="warning" text={error}/>:null}
    <V5Notice text={t('v5.care.disclaimer')}/>
    <V5Section title={t('v5.care.weightTitle')} help={t('v5.care.weightHelp')}>
      {weight?.vetAdvisory?<V5Notice tone="warning" text={t('v5.care.weightAdvisory',{percent:String(weight.changePercent31d??'')})}/>:null}
      {entries.slice(-8).reverse().map(entry=><V5Row key={entry.id} title={t('v5.care.weightValue',{kg:String(entry.weightKg)})} meta={formatDate(entry.measuredOn)}><V5Link danger label={t('v5.delete')} onPress={()=>void run(()=>deletePetWeightLog(petId,entry.id))}/></V5Row>)}
      <V5Field label={t('v5.care.weightLabel')} value={kg} keyboardType="decimal-pad" onChangeText={setKg}/>
      <PrimaryButton label={t('v5.add')} loading={busy} disabled={!Number(kg.replace(',','.'))} onPress={()=>void run(()=>logPetWeight(petId,Number(kg.replace(',','.')),today()),()=>setKg(''))}/>
    </V5Section>
    <V5Section title={t('v5.care.allergyTitle')} help={t('v5.care.allergyHelp')}>
      {allergies.map(a=><V5Row key={a.id} title={a.allergen} meta={`${t(`v5.care.category.${a.category}`)} · ${t(`v5.care.severity.${a.severity}`)}`}><V5Link danger label={t('v5.delete')} onPress={()=>void run(()=>deletePetAllergy(petId,a.id))}/></V5Row>)}
      <V5Field label={t('v5.care.allergenLabel')} value={allergen} maxLength={80} onChangeText={setAllergen}/>
      <V5Chips options={ALLERGY_CATEGORIES} value={category} onChange={setCategory} labelFor={o=>t(`v5.care.category.${o}`)}/>
      <V5Chips options={SEVERITIES} value={severity} onChange={setSeverity} labelFor={o=>t(`v5.care.severity.${o}`)}/>
      <PrimaryButton label={t('v5.add')} loading={busy} disabled={!allergen.trim()} onPress={()=>void run(()=>upsertPetAllergy(petId,{allergen,category,severity,notes:''}),()=>setAllergen(''))}/>
    </V5Section>
    <V5Section title={t('v5.care.reminderTitle')} help={t('v5.care.reminderHelp')}>
      {reminders.map(r=><V5Row key={r.id} title={r.title} meta={t('v5.care.reminderMeta',{days:String(r.everyDays),time:r.timeOfDay,next:formatDate(r.nextDueAt)})}><V5Link label={t('v5.care.done')} onPress={()=>void run(()=>markPetCareReminderDone(petId,r.id))}/><V5Link danger label={t('v5.delete')} onPress={()=>void run(()=>deletePetCareReminder(petId,r.id))}/></V5Row>)}
      <V5Chips options={REMINDER_KINDS} value={kind} onChange={setKind} labelFor={o=>t(`v5.care.kind.${o}`)}/>
      <V5Field label={t('v5.care.reminderLabel')} value={title} maxLength={80} onChangeText={setTitle}/>
      <V5Field label={t('v5.care.everyDaysLabel')} value={everyDays} keyboardType="number-pad" onChangeText={setEveryDays}/>
      <V5Field label={t('v5.care.timeLabel')} value={time} maxLength={5} onChangeText={setTime}/>
      <PrimaryButton label={t('v5.add')} loading={busy} disabled={!title.trim()||!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time)||!(Number(everyDays)>=1&&Number(everyDays)<=365)} onPress={()=>void run(()=>upsertPetCareReminder(petId,{kind,title,everyDays:Number(everyDays),timeOfDay:time,timeZone:deviceTimeZone(),active:true}),()=>setTitle(''))}/>
    </V5Section>
  </ScrollView></Screen>;
}
const createStyles=(theme:AppTheme)=>StyleSheet.create({body:{padding:16,paddingBottom:80,gap:12,backgroundColor:theme.colors.background}});
