import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppIcon } from '../components/AppIcon';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { useAppData } from '../contexts/AppDataContext';
import { useI18n } from '../i18n';
import type { RootStackParamList } from '../navigation/types';
import { useThemedStyles, type AppTheme } from '../theme';

export function OnboardingScreen({navigation}:NativeStackScreenProps<RootStackParamList,'Onboarding'>){const {theme,styles}=useThemedStyles(createStyles);
  const {myPets}=useAppData();
  const {t}=useI18n();
  const incomplete=myPets[0];
  const benefits=useMemo(()=>[
    {icon:'paw' as const,title:t('onboarding.benefit.identityTitle'),body:t('onboarding.benefit.identityBody')},
    {icon:'search' as const,title:t('onboarding.benefit.discoveryTitle'),body:t('onboarding.benefit.discoveryBody')},
    {icon:'shield' as const,title:t('onboarding.benefit.safetyTitle'),body:t('onboarding.benefit.safetyBody')},
  ],[t]);
  return <Screen><ScrollView testID="onboarding.screen" contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}><View style={styles.brand}><View style={styles.mark}><AppIcon name="paw" size={35} color={theme.colors.onPrimary}/></View><Text style={styles.wordmark}>Tailmance</Text><Text style={styles.tagline}>{t('onboarding.tagline')}</Text></View><View style={styles.hero}><Text style={styles.eyebrow}>{t('onboarding.eyebrow')}</Text><Text style={styles.title}>{incomplete?t('onboarding.titleExisting'):t('onboarding.titleNew')}</Text><Text style={styles.copy}>{incomplete?t('onboarding.bodyExisting'):t('onboarding.bodyNew')}</Text></View><View style={styles.benefits}>{benefits.map(item=><View key={item.title} style={styles.benefit}><View style={styles.icon}><AppIcon name={item.icon} size={20} color={theme.colors.primary}/></View><View style={{flex:1}}><Text style={styles.benefitTitle}>{item.title}</Text><Text style={styles.benefitBody}>{item.body}</Text></View></View>)}</View><PrimaryButton testID="onboarding.primary" icon={incomplete?'edit':'plus'} label={incomplete?t('onboarding.continueProfile'):t('onboarding.createPet')} onPress={()=>navigation.navigate('PetEditor',incomplete?{petId:incomplete.id}:undefined)}/><Pressable accessibilityRole="button" onPress={()=>navigation.navigate('SafetyCenter')} style={styles.link}><AppIcon name="shield" size={15} color={theme.colors.primary}/><Text style={styles.linkText}>{t('onboarding.safetyLink')}</Text></Pressable></ScrollView></Screen>;
}

const createStyles=(theme:AppTheme)=>StyleSheet.create({body:{padding:22,paddingTop:42,paddingBottom:60},brand:{alignItems:'center'},mark:{width:74,height:74,borderRadius:24,backgroundColor:theme.colors.primary,alignItems:'center',justifyContent:'center',...theme.shadow.card},wordmark:{marginTop:12,fontSize:28,fontWeight:'900',color:theme.colors.text,letterSpacing:-1},tagline:{marginTop:3,color:theme.colors.muted,fontWeight:'700'},hero:{marginTop:36},eyebrow:{fontSize:11,fontWeight:'900',letterSpacing:1.6,color:theme.colors.primary},title:{marginTop:7,fontSize:31,lineHeight:36,fontWeight:'900',letterSpacing:-1.2,color:theme.colors.text},copy:{marginTop:12,fontSize:14,lineHeight:21,color:theme.colors.textSoft},benefits:{marginVertical:27,gap:10},benefit:{padding:15,borderWidth:1,borderColor:theme.colors.border,borderRadius:theme.radius.lg,backgroundColor:theme.colors.surface,flexDirection:'row',gap:12},icon:{width:40,height:40,borderRadius:20,backgroundColor:theme.colors.primarySoft,alignItems:'center',justifyContent:'center'},benefitTitle:{fontWeight:'900',color:theme.colors.text},benefitBody:{marginTop:4,fontSize:11,lineHeight:16,color:theme.colors.muted},link:{minHeight:44,marginTop:12,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6},linkText:{fontSize:11,fontWeight:'800',color:theme.colors.primary}});
