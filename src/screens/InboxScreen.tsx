import { Image } from 'expo-image';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppIcon } from '../components/AppIcon';
import { EmptyState } from '../components/EmptyState';
import { Screen } from '../components/Screen';
import { TopBar } from '../components/TopBar';
import { useAppData } from '../contexts/AppDataContext';
import { useI18n } from '../i18n';
import { useReduceMotion } from '../hooks/useReduceMotion';
import type { RootStackParamList } from '../navigation/types';
import { useThemedStyles, type AppTheme } from '../theme';
import { formatDateTime } from '../services/locale';

export function InboxScreen({navigation}:{navigation:NativeStackNavigationProp<RootStackParamList>}){const {theme,styles}=useThemedStyles(createStyles);
  const reduceMotion=useReduceMotion();
  const {matches,activePet,loadMoreMatches,matchesHasMore,loadingMoreMatches}=useAppData(); const {t}=useI18n(); const sorted=[...matches].sort((a,b)=>(b.lastMessageAt??b.matchedAt).localeCompare(a.lastMessageAt??a.matchedAt));
  return <Screen><TopBar title={t('inbox.title')} subtitle={t('inbox.subtitle')}/><FlatList data={sorted} keyExtractor={x=>x.id} onEndReached={()=>{if(matchesHasMore&&!loadingMoreMatches)void loadMoreMatches()}} onEndReachedThreshold={0.4} contentContainerStyle={styles.list} ListEmptyComponent={<EmptyState icon="chat" title={t('inbox.emptyTitle')} body={t('inbox.emptyBody')}/>} renderItem={({item:m})=><Pressable accessibilityRole="button" onPress={()=>activePet&&navigation.navigate('Chat',{conversationId:m.conversationId,otherPet:m.otherPet,matchId:m.id,ownPetId:activePet.id})} style={({pressed})=>[styles.row,pressed&&{opacity:.72}]}><Image source={{uri:m.otherPet.photos[0]?.url}} style={styles.avatar} cachePolicy="memory-disk" transition={reduceMotion?0:120}/><View style={{flex:1}}><View style={styles.nameLine}><Text style={styles.name}>{m.otherPet.name}</Text>{m.otherPet.profileVerified?<AppIcon name="verified" size={14} color={theme.colors.primary}/>:null}</View><Text numberOfLines={1} style={[styles.message,m.unreadCount>0&&styles.messageUnread]}>{m.lastMessage??t('inbox.firstMessage')}</Text><Text style={styles.time}>{formatDateTime(m.lastMessageAt??m.matchedAt,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</Text></View>{m.unreadCount>0?<View style={styles.badge}><Text style={styles.badgeText}>{Math.min(m.unreadCount,99)}</Text></View>:<AppIcon name="chevron" size={18} color={theme.colors.muted}/>}</Pressable>}/></Screen>;
}
const createStyles=(theme:AppTheme)=>StyleSheet.create({list:{padding:16,paddingBottom:100},row:{minHeight:82,padding:11,borderRadius:theme.radius.lg,backgroundColor:theme.colors.surface,borderWidth:1,borderColor:theme.colors.border,flexDirection:'row',gap:12,alignItems:'center',marginBottom:8},avatar:{width:58,height:58,borderRadius:20,backgroundColor:theme.colors.surfaceAlt},nameLine:{flexDirection:'row',alignItems:'center',gap:4},name:{fontWeight:'900',fontSize:16,color:theme.colors.text},message:{marginTop:4,color:theme.colors.muted,fontSize:12},messageUnread:{fontWeight:'800',color:theme.colors.textSoft},time:{marginTop:4,fontSize:11,fontWeight:'700',color:theme.colors.muted},badge:{minWidth:24,height:24,paddingHorizontal:6,borderRadius:12,backgroundColor:theme.colors.accent,alignItems:'center',justifyContent:'center'},badgeText:{fontSize:11,color:theme.colors.onAccent,fontWeight:'900'}});
