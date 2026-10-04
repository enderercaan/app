import { useCallback, useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppIcon } from '../components/AppIcon';
import { EmptyState } from '../components/EmptyState';
import { IconButton } from '../components/IconButton';
import { RetryNotice } from '../components/RetryNotice';
import { Screen } from '../components/Screen';
import { TopBar } from '../components/TopBar';
import { TrustPill } from '../components/TrustPill';
import { useAppData } from '../contexts/AppDataContext';
import { useI18n } from '../i18n';
import { useReduceMotion } from '../hooks/useReduceMotion';
import type { RootStackParamList } from '../navigation/types';
import { getFavoritePetsPage, setFavoritePet } from '../services/api';
import { userMessage } from '../services/errors';
import type { Pet } from '../types/domain';
import { useThemedStyles, type AppTheme } from '../theme';

const PAGE_SIZE=40;

export function FavoritesScreen({route,navigation}:NativeStackScreenProps<RootStackParamList,'Favorites'>){
  const {theme,styles}=useThemedStyles(createStyles);
  const {t}=useI18n();
  const reduceMotion=useReduceMotion();
  const {myPets}=useAppData();
  const petId=route.params.petId;
  const ownPet=myPets.find(p=>p.id===petId)??null;
  const [items,setItems]=useState<Pet[]>([]);
  const [loading,setLoading]=useState(true);
  const [loadingMore,setLoadingMore]=useState(false);
  const [hasMore,setHasMore]=useState(false);
  const [cursor,setCursor]=useState<{favoritedAt:string;id:string}|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [actionId,setActionId]=useState<string|null>(null);
  const requestRef=useRef(0);
  const routeEpochRef=useRef(0);
  const paginationRef=useRef(false);
  const actionRef=useRef<string|null>(null);

  const load=useCallback(async()=>{
    const requestId=++requestRef.current;
    paginationRef.current=false;
    setLoadingMore(false);
    setError(null);
    if(!ownPet){setItems([]);setCursor(null);setHasMore(false);setLoading(false);return}
    setLoading(true);
    try{
      const page=await getFavoritePetsPage(petId,undefined,PAGE_SIZE);
      if(requestId!==requestRef.current)return;
      setItems(page);
      const last=page[page.length-1];
      setCursor(last?.favoritedAt?{favoritedAt:last.favoritedAt,id:last.id}:null);
      setHasMore(page.length===PAGE_SIZE);
    }catch(e){if(requestId===requestRef.current)setError(userMessage(e,t('favorites.loadFailed')))}
    finally{if(requestId===requestRef.current)setLoading(false)}
  },[petId,ownPet?.id,t]);

  const loadMore=useCallback(async()=>{
    if(!ownPet||!cursor||!hasMore||paginationRef.current)return;
    const requestId=requestRef.current;
    const cursorSnapshot={...cursor};
    paginationRef.current=true;
    try{
      setLoadingMore(true);
      const page=await getFavoritePetsPage(petId,cursorSnapshot,PAGE_SIZE);
      if(requestId!==requestRef.current)return;
      setItems(current=>{const seen=new Set(current.map(item=>item.id));return [...current,...page.filter(item=>!seen.has(item.id))]});
      const last=page[page.length-1];
      setCursor(last?.favoritedAt?{favoritedAt:last.favoritedAt,id:last.id}:null);
      setHasMore(page.length===PAGE_SIZE);
    }catch(e){if(requestId===requestRef.current)setError(userMessage(e,t('favorites.loadFailed')))}
    finally{if(requestId===requestRef.current){paginationRef.current=false;setLoadingMore(false)}}
  },[petId,ownPet?.id,cursor?.favoritedAt,cursor?.id,hasMore,t]);

  useEffect(()=>{
    routeEpochRef.current+=1;
    actionRef.current=null;
    setActionId(null);
    void load();
    return()=>{routeEpochRef.current+=1;requestRef.current+=1;paginationRef.current=false;actionRef.current=null};
  },[load]);

  const remove=async(pet:Pet)=>{
    if(!ownPet||actionRef.current)return;
    const epoch=routeEpochRef.current;
    const requestId=requestRef.current;
    actionRef.current=pet.id;
    setActionId(pet.id);
    try{
      await setFavoritePet(petId,pet.id,false);
      if(epoch!==routeEpochRef.current)return;
      if(requestId!==requestRef.current){void load();return}
      setItems(current=>current.filter(item=>item.id!==pet.id));
    }catch(e){if(epoch===routeEpochRef.current&&requestId===requestRef.current)Alert.alert(t('favorites.removeFailedTitle'),userMessage(e,t('favorites.removeFailed')));else if(epoch===routeEpochRef.current)void load()}
    finally{if(epoch===routeEpochRef.current){actionRef.current=null;setActionId(null)}}
  };

  return <Screen>
    <TopBar title={t('favorites.title')} subtitle={t('favorites.subtitle')}/>
    <FlatList
      data={items}
      keyExtractor={pet=>pet.id}
      refreshing={loading}
      onRefresh={()=>void load()}
      onEndReachedThreshold={0.6}
      onEndReached={()=>void loadMore()}
      contentContainerStyle={styles.body}
      ListHeaderComponent={error&&items.length?<RetryNotice title={t('favorites.refreshFailed')} body={error} retrying={loading} onRetry={()=>void load()}/>:null}
      renderItem={({item:pet})=><View style={styles.card}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('favorites.openProfile',{name:pet.name})} onPress={()=>navigation.navigate('PetProfile',{pet,ownPetId:petId})} style={styles.openArea}>
          {pet.photos[0]?.url?<Image source={{uri:pet.photos[0].url}} style={styles.photo} cachePolicy="memory-disk" transition={reduceMotion?0:120}/>:<View style={[styles.photo,styles.photoEmpty]}><AppIcon name="paw" size={30} color={theme.colors.muted}/></View>}
          <View style={styles.content}>
            <View style={styles.nameLine}><Text style={styles.name}>{pet.name}</Text>{pet.profileVerified?<AppIcon name="verified" size={16} color={theme.colors.primary}/>:null}</View>
            <Text style={styles.meta}>{pet.breed} · {pet.district}</Text>
            <View style={styles.pills}>{pet.ownerVerified?<TrustPill label={t('favorites.ownerVerified')} icon="verified"/>:null}{pet.health.vaccinationStatus==='complete'?<TrustPill label={t('favorites.vaccinesComplete')} icon="health"/>:null}</View>
          </View>
        </Pressable>
        <IconButton icon="star" label={t('favorites.remove',{name:pet.name})} variant="primary" selected disabled={actionId===pet.id} onPress={()=>void remove(pet)}/>
      </View>}
      ListFooterComponent={loadingMore?<Text style={styles.loadingMore}>{t('common.loading')}</Text>:null}
      ListEmptyComponent={!loading?(error?<RetryNotice title={t('favorites.loadFailed')} body={error} onRetry={()=>void load()}/>:<EmptyState icon="star" title={t('favorites.emptyTitle')} body={t('favorites.emptyBody')}/>):null}
    />
  </Screen>;
}

const createStyles=(theme:AppTheme)=>StyleSheet.create({
  body:{padding:16,paddingBottom:100},
  card:{backgroundColor:theme.colors.surface,borderWidth:1,borderColor:theme.colors.border,borderRadius:theme.radius.xl,padding:10,flexDirection:'row',alignItems:'center',gap:8,marginBottom:10,...theme.shadow.card},openArea:{flex:1,flexDirection:'row',alignItems:'center',gap:12},
  photo:{width:82,height:100,borderRadius:16,backgroundColor:theme.colors.surfaceAlt},photoEmpty:{alignItems:'center',justifyContent:'center'},
  content:{flex:1},nameLine:{flexDirection:'row',alignItems:'center',gap:5},name:{fontSize:18,fontWeight:'900',color:theme.colors.text},meta:{marginTop:3,color:theme.colors.muted,fontWeight:'700',fontSize:11},pills:{flexDirection:'row',flexWrap:'wrap',gap:5,marginTop:7},loadingMore:{textAlign:'center',padding:14,color:theme.colors.muted,fontWeight:'700'}
});
