import {useCallback,useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Alert,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {AppIcon} from '../components/AppIcon';
import {Screen} from '../components/Screen';
import {TopBar} from '../components/TopBar';
import {useI18n} from '../i18n';
import {getMyModerationDecisions,submitModerationAppeal} from '../services/api';
import {userMessage} from '../services/errors';
import {formatDate} from '../services/locale';
import type {ModerationDecision} from '../types/domain';
import {useThemedStyles,type AppTheme} from '../theme';

export function ModerationAppealsScreen(){
  const {theme,styles}=useThemedStyles(createStyles);
  const {t,locale}=useI18n();
  const termsGround=(value?:string)=>value==='community_guidelines:content_safety'?t('moderationAppeals.termsGround.contentSafety'):value;
  const [items,setItems]=useState<ModerationDecision[]>([]);
  const [loading,setLoading]=useState(true);
  const [selected,setSelected]=useState<string|null>(null);
  const [statement,setStatement]=useState('');
  const [busy,setBusy]=useState(false);
  const requestRef=useRef(0);
  const actionRef=useRef(false);
  const mountedRef=useRef(true);

  const load=useCallback(async()=>{
    const requestId=++requestRef.current;
    if(mountedRef.current)setLoading(true);
    try{
      const next=await getMyModerationDecisions();
      if(mountedRef.current&&requestId===requestRef.current)setItems(next);
    }catch(e){
      if(mountedRef.current&&requestId===requestRef.current)Alert.alert(t('moderationAppeals.loadFailedTitle'),userMessage(e,t('moderationAppeals.loadFailedBody')));
    }finally{
      if(mountedRef.current&&requestId===requestRef.current)setLoading(false);
    }
  },[t]);

  useEffect(()=>{mountedRef.current=true;void load();return()=>{mountedRef.current=false;requestRef.current+=1;actionRef.current=false}},[load]);

  const submit=async(decisionId:string)=>{
    if(actionRef.current)return;
    const text=statement.trim();
    if(text.length<3){Alert.alert(t('moderationAppeals.statementRequiredTitle'),t('moderationAppeals.statementRequiredBody'));return}
    const selectedSnapshot=selected;
    actionRef.current=true;
    if(mountedRef.current)setBusy(true);
    try{
      await submitModerationAppeal(decisionId,text);
      if(!mountedRef.current)return;
      if(selectedSnapshot===selected){setSelected(null);setStatement('')}
      await load();
      if(mountedRef.current)Alert.alert(t('moderationAppeals.submittedTitle'),t('moderationAppeals.submittedBody'));
    }catch(e){
      if(mountedRef.current)Alert.alert(t('moderationAppeals.submitFailedTitle'),userMessage(e,t('moderationAppeals.submitFailedBody')));
    }finally{
      actionRef.current=false;
      if(mountedRef.current)setBusy(false);
    }
  };

  return <Screen><TopBar title={t('moderationAppeals.title')} subtitle={t('moderationAppeals.subtitle')}/><ScrollView contentContainerStyle={styles.body}>
    <View style={styles.info}><AppIcon name="info" size={18} color={theme.colors.primary}/><Text style={styles.infoText}>{t('moderationAppeals.info')}</Text></View>
    {loading?<ActivityIndicator color={theme.colors.primary}/>:items.length===0?<Text style={styles.empty}>{t('moderationAppeals.empty')}</Text>:items.map(item=>{const open=Date.now()<=new Date(item.appealDeadline).getTime()&&item.status!=='reversed'&&!item.appeal;return <View key={item.id} style={styles.card}><View style={styles.cardHead}><Text style={styles.action}>{t(`moderationAppeals.action.${item.action}`)}</Text><Text style={styles.status}>{t(`moderationAppeals.status.${item.status}`)}</Text></View><Text style={styles.reason}>{item.reason}</Text><Text style={styles.meta}>{t('moderationAppeals.source')}: {t(`moderationAppeals.source.${item.source}`)} · {formatDate(item.decidedAt,undefined,locale)}</Text>{item.basisType?<View style={styles.statement}><Text style={styles.statementLine}><Text style={styles.statementLabel}>{t('moderationAppeals.basis')}: </Text>{t(`moderationAppeals.basis.${item.basisType}`)}</Text>{item.factsSummary&&item.factsSummary!==item.reason?<Text style={styles.statementLine}><Text style={styles.statementLabel}>{t('moderationAppeals.facts')}: </Text>{item.factsSummary}</Text>:null}{item.legalGroundReference?<Text style={styles.statementLine}><Text style={styles.statementLabel}>{t('moderationAppeals.legalGround')}: </Text>{item.legalGroundReference}</Text>:null}{item.termsGroundReference?<Text style={styles.statementLine}><Text style={styles.statementLabel}>{t('moderationAppeals.termsGround')}: </Text>{termsGround(item.termsGroundReference)}</Text>:null}{item.territorialScope?.length?<Text style={styles.statementLine}><Text style={styles.statementLabel}>{t('moderationAppeals.territorialScope')}: </Text>{item.territorialScope.join(', ')}</Text>:null}{item.automatedDecisionUsed?<Text style={styles.statementLine}>{t('moderationAppeals.automation.decision')}</Text>:item.automatedDetectionUsed?<Text style={styles.statementLine}>{t('moderationAppeals.automation.detection')}</Text>:null}{item.redressDeadline?<Text style={styles.statementLine}><Text style={styles.statementLabel}>{t('moderationAppeals.redressDeadline')}: </Text>{formatDate(item.redressDeadline,undefined,locale)}</Text>:null}</View>:null}{item.appeal?<View style={styles.appealResult}><Text style={styles.appealTitle}>{t('moderationAppeals.appealStatus')}: {t(`moderationAppeals.appeal.${item.appeal.status}`)}</Text>{item.appeal.outcomeExplanation?<Text style={styles.reason}>{item.appeal.outcomeExplanation}</Text>:null}</View>:open?<>{selected===item.id?<View><TextInput accessibilityLabel={t('moderationAppeals.statementLabel')} value={statement} onChangeText={setStatement} multiline maxLength={4000} placeholder={t('moderationAppeals.statementPlaceholder')} placeholderTextColor={theme.colors.muted} style={styles.input}/><View style={styles.actions}><Pressable accessibilityRole="button" accessibilityState={{disabled:busy}} disabled={busy} onPress={()=>{setSelected(null);setStatement('')}} style={styles.secondary}><Text style={styles.secondaryText}>{t('common.cancel')}</Text></Pressable><Pressable accessibilityRole="button" accessibilityState={{disabled:busy}} disabled={busy} onPress={()=>void submit(item.id)} style={[styles.primary,busy&&{opacity:.5}]}><Text style={styles.primaryText}>{t('moderationAppeals.submit')}</Text></Pressable></View></View>:<Pressable accessibilityRole="button" accessibilityState={{disabled:busy}} disabled={busy} onPress={()=>{setSelected(item.id);setStatement('')}} style={styles.primary}><Text style={styles.primaryText}>{t('moderationAppeals.appealButton')}</Text></Pressable>}</>:<Text style={styles.closed}>{t('moderationAppeals.windowClosed')}</Text>}</View>})}
  </ScrollView></Screen>;
}
const createStyles=(theme:AppTheme)=>StyleSheet.create({body:{padding:16,paddingBottom:50},info:{padding:13,borderRadius:theme.radius.lg,backgroundColor:theme.colors.primarySoft,flexDirection:'row',gap:9,marginBottom:10},infoText:{flex:1,fontSize:11,lineHeight:17,color:theme.colors.textSoft},empty:{textAlign:'center',color:theme.colors.muted,padding:30},card:{padding:14,borderRadius:theme.radius.xl,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.surface,marginBottom:10},cardHead:{flexDirection:'row',justifyContent:'space-between',gap:10},action:{fontWeight:'900',color:theme.colors.text,flex:1},status:{fontSize:11,fontWeight:'900',color:theme.colors.primary},reason:{marginTop:8,fontSize:12,lineHeight:18,color:theme.colors.textSoft},meta:{marginTop:8,fontSize:11,color:theme.colors.muted},statement:{marginTop:10,padding:10,borderRadius:theme.radius.lg,backgroundColor:theme.colors.surfaceAlt,gap:4},statementLine:{fontSize:11,lineHeight:17,color:theme.colors.textSoft},statementLabel:{fontWeight:'900',color:theme.colors.text},appealResult:{marginTop:10,padding:10,borderRadius:theme.radius.lg,backgroundColor:theme.colors.surfaceAlt},appealTitle:{fontWeight:'900',fontSize:11,color:theme.colors.text},input:{marginTop:12,minHeight:100,borderWidth:1,borderColor:theme.colors.border,borderRadius:theme.radius.lg,padding:12,color:theme.colors.text,textAlignVertical:'top',backgroundColor:theme.colors.surfaceAlt},actions:{flexDirection:'row',gap:8,marginTop:8},primary:{marginTop:10,minHeight:46,paddingHorizontal:14,borderRadius:23,backgroundColor:theme.colors.primary,alignItems:'center',justifyContent:'center'},primaryText:{color:theme.colors.onPrimary,fontWeight:'900'},secondary:{marginTop:10,minHeight:46,paddingHorizontal:14,borderRadius:23,borderWidth:1,borderColor:theme.colors.border,alignItems:'center',justifyContent:'center'},secondaryText:{color:theme.colors.text,fontWeight:'900'},closed:{marginTop:10,fontSize:11,color:theme.colors.muted}});
