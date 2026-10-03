import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import type { Pet } from '../types/domain';
import { useThemedStyles, type AppTheme } from '../theme';
import { AppIcon } from './AppIcon';
import { IconButton } from './IconButton';
import { TrustPill } from './TrustPill';
import { HealthTrustPill } from './HealthTrustPill';
import { useI18n } from '../i18n';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { formatDistance } from '../services/locale';
import { petPromptTranslationKey } from '../domain/petPrompts';
import { visiblePurposes } from '../domain/featurePolicy';

export function PetCard({pet,onOpen,onLike,onSuperLike,onPass,onFavorite,matingOwnerArrangedEnabled=false}:{pet:Pet;onOpen:()=>void;onLike:()=>void;onSuperLike?:()=>void;onPass:()=>void;onFavorite:()=>void;matingOwnerArrangedEnabled?:boolean}){const {theme,styles}=useThemedStyles(createStyles);
  const reduceMotion=useReduceMotion();
  const {t,locale,measurementSystem}=useI18n(); const photo=pet.photos[0]?.url; const prompt=pet.prompts?.[0]; const promptKey=prompt?petPromptTranslationKey(prompt.promptKey):null; const purposeLabels:Record<string,string>={socialize:t('petCard.purpose.socialize'),playmate:t('petCard.purpose.playmate'),mating:t('petCard.purpose.mating'),walk:t('petCard.purpose.walk')};
  return <View style={styles.card}>
    <Pressable accessibilityRole="button" accessibilityLabel={t('petCard.openProfile',{name:pet.name})} onPress={onOpen} style={styles.media}>
      {photo?<View style={styles.photo}>
        <Image source={{uri:photo}} style={StyleSheet.absoluteFill} contentFit="cover" transition={reduceMotion?0:180} cachePolicy="disk" accessibilityLabel={t('petCard.photoA11y',{name:pet.name})}/>
        <View style={styles.topOverlay}><View style={styles.trustRow}>{pet.profileVerified?<TrustPill label={t('petCard.petVerified')}/>:null}{pet.ownerVerified?<TrustPill label={t('petCard.ownerVerified')} tone="success"/>:null}</View>{pet.compatibilityScore!=null?<View style={styles.compat}><Text style={styles.compatValue}>%{pet.compatibilityScore}</Text><Text style={styles.compatLabel}>{t('petCard.compatibility')}</Text></View>:null}</View>
        <View style={styles.bottomScrim}><Text style={styles.name}>{pet.name}</Text><Text style={styles.meta}>{pet.breed} · {t('petCard.age',pet.ageYears!=null?{age:pet.ageYears,count:pet.ageYears}:{age:'?'})} · {pet.district}</Text><View style={styles.location}><AppIcon name="location" size={14} color={theme.colors.white}/><Text style={styles.distance}>{pet.neighborhood?`${pet.neighborhood} · `:''}{pet.approximateDistanceKm!=null?t('petCard.approxDistance',{distance:formatDistance(pet.approximateDistanceKm,measurementSystem,locale)}):pet.city}</Text></View></View>
      </View>:<View style={[styles.photo,styles.noPhoto]}><AppIcon name="paw" size={46} color={theme.colors.muted}/></View>}
    </Pressable>
    <View style={styles.body}><View style={styles.purposeRow}>{visiblePurposes(pet.purposes,matingOwnerArrangedEnabled,pet.species).slice(0,3).map(p=><View key={p} style={styles.purpose}><Text style={styles.purposeText}>{purposeLabels[p]??p}</Text></View>)}{pet.health.veterinarianVerified&&pet.health.trust?<HealthTrustPill trust={pet.health.trust} label={t('petCard.vetVerified')}/>:null}</View>{prompt?<View style={styles.prompt}><Text style={styles.promptQ}>{promptKey?t(promptKey):prompt.promptKey}</Text><Text style={styles.promptA} numberOfLines={2}>{prompt.answer}</Text></View>:pet.bio?<Text style={styles.bio} numberOfLines={2}>{pet.bio}</Text>:null}<View style={styles.actions}><IconButton icon="close" label={t('petCard.pass')} onPress={onPass}/><IconButton icon="star" label={t(pet.isFavorite?'petCard.removeFavorite':'petCard.favorite')} onPress={onFavorite} variant={pet.isFavorite?"primary":"soft"} selected={Boolean(pet.isFavorite)}/>{onSuperLike?<IconButton icon="spark" label={t('petCard.superLike')} onPress={onSuperLike} variant="soft"/>:null}<IconButton icon="heart" label={t('petCard.like')} onPress={onLike} variant="primary" size={56}/></View></View>
  </View>
}

const createStyles=(theme:AppTheme)=>StyleSheet.create({
  card:{marginHorizontal:16,marginBottom:20,borderRadius:theme.radius.xl,overflow:'hidden',backgroundColor:theme.colors.surface,...theme.shadow.card},
  media:{backgroundColor:theme.colors.surfaceAlt},
  photo:{width:'100%',aspectRatio:.82,justifyContent:'space-between',backgroundColor:theme.colors.surfaceAlt,overflow:'hidden'},
  noPhoto:{alignItems:'center',justifyContent:'center'},
  topOverlay:{padding:12,flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start'},trustRow:{gap:6,alignItems:'flex-start'},
  compat:{minWidth:58,paddingHorizontal:9,paddingVertical:7,borderRadius:16,backgroundColor:theme.colors.petCardBadgeSurface,alignItems:'center'},compatValue:{fontSize:15,fontWeight:'900',color:theme.colors.primary},compatLabel:{fontSize:11,fontWeight:'800',color:theme.colors.muted},
  bottomScrim:{padding:16,paddingTop:34,backgroundColor:theme.colors.petCardScrim},name:{fontSize:31,lineHeight:34,fontWeight:'900',color:theme.colors.white,letterSpacing:-.5},meta:{marginTop:4,color:theme.colors.white,fontWeight:'700'},location:{flexDirection:'row',alignItems:'center',gap:4,marginTop:7},distance:{color:theme.colors.white,fontSize:11,fontWeight:'700'},
  body:{padding:14},purposeRow:{flexDirection:'row',flexWrap:'wrap',gap:6},purpose:{paddingHorizontal:9,paddingVertical:6,borderRadius:theme.radius.pill,backgroundColor:theme.colors.surfaceAlt},purposeText:{fontSize:11,fontWeight:'800',color:theme.colors.textSoft},
  prompt:{marginTop:12,padding:13,borderRadius:theme.radius.md,backgroundColor:theme.colors.primarySoft},promptQ:{fontSize:11,fontWeight:'900',color:theme.colors.primary},promptA:{marginTop:4,fontSize:15,lineHeight:20,fontWeight:'700',color:theme.colors.text},bio:{marginTop:12,...theme.type.body,color:theme.colors.textSoft},actions:{flexDirection:'row',justifyContent:'center',alignItems:'center',gap:12,marginTop:14}
});
