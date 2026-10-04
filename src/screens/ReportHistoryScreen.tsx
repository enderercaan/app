import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import { AppIcon } from '../components/AppIcon';
import { EmptyState } from '../components/EmptyState';
import { Screen } from '../components/Screen';
import { RetryNotice } from '../components/RetryNotice';
import { TopBar } from '../components/TopBar';
import type {RootStackParamList} from '../navigation/types';
import { getMyReportsPage } from '../services/api';
import { useI18n } from '../i18n';
import { userMessage } from '../services/errors';
import { useThemedStyles, type AppTheme } from '../theme';
import { formatDateTime } from '../services/locale';
import type { ReportHistoryItem } from '../types/domain';

export function ReportHistoryScreen({navigation}:{navigation:NativeStackNavigationProp<RootStackParamList>}){
  const {theme,styles}=useThemedStyles(createStyles);
  const {t,locale}=useI18n();
  const statusText={open:t('reports.status.open'),reviewing:t('reports.status.reviewing'),resolved:t('reports.status.resolved'),dismissed:t('reports.status.dismissed')} as const;
  const [items,setItems]=useState<ReportHistoryItem[]>([]);
  const [loading,setLoading]=useState(true);
  const [,setLoadingMore]=useState(false);
  const [hasMore,setHasMore]=useState(false);
  const [cursor,setCursor]=useState<{createdAt:string;id:string}|null>(null);
  const [loadError,setLoadError]=useState<string|null>(null);
  const requestRef=useRef(0);
  const paginationRef=useRef(false);
  const mountedRef=useRef(true);

  const load=useCallback(async()=>{
    const requestId=++requestRef.current;
    paginationRef.current=false;
    setLoadingMore(false);
    setLoading(true);
    setLoadError(null);
    try{
      const page=await getMyReportsPage(undefined,40);
      if(!mountedRef.current||requestId!==requestRef.current)return;
      setItems(page);
      const last=page[page.length-1];
      setCursor(last?{createdAt:last.createdAt,id:last.id}:null);
      setHasMore(page.length===40);
    }catch(e){
      if(mountedRef.current&&requestId===requestRef.current)setLoadError(userMessage(e,t('reports.loadFailed')));
    }finally{
      if(mountedRef.current&&requestId===requestRef.current)setLoading(false);
    }
  },[t]);

  const loadMore=useCallback(async()=>{
    if(!cursor||!hasMore||paginationRef.current)return;
    const requestId=requestRef.current;
    const cursorSnapshot={...cursor};
    paginationRef.current=true;
    setLoadingMore(true);
    try{
      const page=await getMyReportsPage(cursorSnapshot,40);
      if(!mountedRef.current||requestId!==requestRef.current)return;
      setItems(current=>{const seen=new Set(current.map(item=>item.id));return [...current,...page.filter(item=>!seen.has(item.id))]});
      const last=page[page.length-1];
      if(last)setCursor({createdAt:last.createdAt,id:last.id});
      setHasMore(page.length===40);
    }catch(e){
      if(mountedRef.current&&requestId===requestRef.current)setLoadError(userMessage(e,t('reports.loadFailed')));
    }finally{
      if(requestId===requestRef.current){paginationRef.current=false;if(mountedRef.current)setLoadingMore(false)}
    }
  },[cursor?.createdAt,cursor?.id,hasMore,t]);

  useEffect(()=>{mountedRef.current=true;void load();return()=>{mountedRef.current=false;requestRef.current+=1;paginationRef.current=false}},[load]);

  return <Screen><TopBar title={t('reports.title')} subtitle={t('reports.subtitle')}/><FlatList data={items} keyExtractor={item=>item.id} refreshing={loading} onRefresh={()=>void load()} onEndReachedThreshold={0.6} onEndReached={()=>void loadMore()} contentContainerStyle={styles.body} ListHeaderComponent={loadError&&items.length?<RetryNotice title={t('reports.refreshFailed')} body={loadError} retrying={loading} onRetry={()=>void load()}/>:null} renderItem={({item})=><View style={styles.card}><View style={[styles.icon,item.status==='resolved'&&styles.iconDone]}><AppIcon name={item.status==='resolved'?'check':'flag'} size={18} color={item.status==='resolved'?theme.colors.success:theme.colors.primary}/></View><View style={{flex:1}}><View style={styles.head}><Text style={styles.reason}>{item.reason}</Text><Text style={[styles.status,item.status==='resolved'&&{color:theme.colors.success}]}>{statusText[item.status]}</Text></View><Text style={styles.meta}>{item.targetType} · {formatDateTime(item.createdAt,undefined,locale)}</Text>{item.details?<Text style={styles.details}>{item.details}</Text>:null}{item.resolutionExplanation?<View style={styles.resolution}><Text style={styles.resolutionTitle}>{t('reports.resolutionTitle')}</Text><Text style={styles.details}>{item.resolutionExplanation}</Text>{item.resolvedAt?<Text style={styles.meta}>{formatDateTime(item.resolvedAt,undefined,locale)}</Text>:null}</View>:null}{item.moderationDecisionId?<Pressable accessibilityRole="button" onPress={()=>navigation.navigate('ModerationAppeals')} style={styles.appealLink}><Text style={styles.appealLinkText}>{t('reports.openDecisionAppeal')}</Text></Pressable>:null}</View></View>} ListEmptyComponent={!loading?(loadError?<RetryNotice title={t('reports.loadFailed')} body={loadError} onRetry={()=>void load()}/>:<EmptyState icon="flag" title={t('reports.emptyTitle')} body={t('reports.emptyBody')}/>):null}/></Screen>;
}
const createStyles=(theme:AppTheme)=>StyleSheet.create({body:{padding:16,paddingBottom:80},card:{padding:14,borderRadius:theme.radius.lg,backgroundColor:theme.colors.surface,borderWidth:1,borderColor:theme.colors.border,flexDirection:'row',gap:11,marginBottom:9},icon:{width:38,height:38,borderRadius:19,backgroundColor:theme.colors.primarySoft,alignItems:'center',justifyContent:'center'},iconDone:{backgroundColor:theme.colors.successSoft},head:{flexDirection:'row',justifyContent:'space-between',gap:8},reason:{fontWeight:'900',color:theme.colors.text,flex:1},status:{fontSize:11,fontWeight:'900',color:theme.colors.primary},meta:{marginTop:4,fontSize:11,color:theme.colors.muted,fontWeight:'700'},details:{marginTop:7,fontSize:11,lineHeight:16,color:theme.colors.textSoft},resolution:{marginTop:10,padding:10,borderRadius:theme.radius.md,backgroundColor:theme.colors.surfaceAlt},resolutionTitle:{fontSize:11,fontWeight:'900',color:theme.colors.text},appealLink:{minHeight:44,marginTop:8,borderRadius:22,borderWidth:1,borderColor:theme.colors.border,alignItems:'center',justifyContent:'center',paddingHorizontal:12},appealLinkText:{fontSize:11,fontWeight:'900',color:theme.colors.primary}});
