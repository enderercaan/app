import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppIcon } from '../components/AppIcon';
import { Screen } from '../components/Screen';
import { TopBar } from '../components/TopBar';
import { useI18n } from '../i18n';
import { getCurrentLegalContext } from '../services/api';
import { openLegalHttpsUrl } from '../services/legalLinks';
import type { LegalContext } from '../types/domain';
import { useThemedStyles, type AppTheme } from '../theme';

export function SafetyCenterScreen(){const {theme,styles}=useThemedStyles(createStyles);
  const {t,locale}=useI18n();
  const [legalContext,setLegalContext]=useState<LegalContext|null>(null);
  useEffect(()=>{let active=true;void getCurrentLegalContext(locale).then(c=>{if(active&&c.status==='ready'&&c.uiLocale===locale)setLegalContext(c)}).catch(()=>{if(active)setLegalContext(null)});return()=>{active=false}},[locale]);
  const open=async(url:string)=>{if(!url){Alert.alert(t('safety.linkMissingTitle'),t('safety.linkMissingBody'));return}try{await openLegalHttpsUrl(url)}catch{Alert.alert(t('safety.linkFailedTitle'),t('safety.linkFailedBody'))}};
  const items=useMemo(()=>[
    {icon:'verified' as const,title:t('safety.item.verificationTitle'),body:t('safety.item.verificationBody')},
    {icon:'privacy' as const,title:t('safety.item.locationTitle'),body:t('safety.item.locationBody')},
    {icon:'shield' as const,title:t('safety.item.reportTitle'),body:t('safety.item.reportBody')},
    {icon:'chat' as const,title:t('safety.item.chatTitle'),body:t('safety.item.chatBody')},
    {icon:'location' as const,title:t('safety.item.meetupTitle'),body:t('safety.item.meetupBody')},
    {icon:'health' as const,title:t('safety.item.healthTitle'),body:t('safety.item.healthBody')},
    {icon:'warning' as const,title:t('safety.item.lostTitle'),body:t('safety.item.lostBody')},
    {icon:'paw' as const,title:t('safety.item.petFirstTitle'),body:t('safety.item.petFirstBody')},
    {icon:'lock' as const,title:t('safety.item.noSaleTitle'),body:t('safety.item.noSaleBody')},
    {icon:'flag' as const,title:t('safety.item.moderationTitle'),body:t('safety.item.moderationBody')},
    {icon:'health' as const,title:t('safety.item.matingTitle'),body:t('safety.item.matingBody')},
  ],[t]);
  return <Screen><TopBar title={t('safety.title')} subtitle={t('safety.subtitle')}/><ScrollView contentContainerStyle={styles.body}><View style={styles.hero}><View style={styles.heroIcon}><AppIcon name="shield" size={30} color={theme.colors.primary}/></View><Text style={styles.heroTitle}>{t('safety.heroTitle')}</Text><Text style={styles.heroBody}>{t('safety.heroBody')}</Text></View>{items.map(i=><View key={i.title} style={styles.card}><View style={styles.icon}><AppIcon name={i.icon} size={21} color={theme.colors.primary}/></View><View style={{flex:1}}><Text style={styles.title}>{i.title}</Text><Text style={styles.copy}>{i.body}</Text></View></View>)}<View style={styles.links}><Pressable accessibilityRole="link" onPress={()=>void open(legalContext?.communityGuidelinesUrl??'')} style={styles.link}><Text style={styles.linkText}>{t('safety.guidelines')}</Text><AppIcon name="chevron" size={18} color={theme.colors.muted}/></Pressable><Pressable accessibilityRole="link" onPress={()=>void open(legalContext?.supportUrl??'')} style={styles.link}><Text style={styles.linkText}>{t('safety.support')}</Text><AppIcon name="chevron" size={18} color={theme.colors.muted}/></Pressable></View></ScrollView></Screen>
}
const createStyles=(theme:AppTheme)=>StyleSheet.create({body:{padding:16,paddingBottom:50},hero:{padding:20,borderRadius:theme.radius.xl,backgroundColor:theme.colors.primarySoft,marginBottom:14},heroIcon:{width:54,height:54,borderRadius:27,backgroundColor:theme.colors.surface,alignItems:'center',justifyContent:'center',marginBottom:14},heroTitle:{...theme.type.h2,color:theme.colors.text},heroBody:{...theme.type.body,color:theme.colors.textSoft,marginTop:7},card:{padding:16,borderRadius:theme.radius.lg,backgroundColor:theme.colors.surface,borderWidth:1,borderColor:theme.colors.border,flexDirection:'row',gap:12,marginBottom:10},icon:{width:42,height:42,borderRadius:21,backgroundColor:theme.colors.primarySoft,alignItems:'center',justifyContent:'center'},title:{fontSize:15,fontWeight:'900',color:theme.colors.text},copy:{...theme.type.body,color:theme.colors.muted,marginTop:5},links:{marginTop:6,borderRadius:theme.radius.lg,overflow:'hidden',borderWidth:1,borderColor:theme.colors.border},link:{minHeight:56,paddingHorizontal:15,backgroundColor:theme.colors.surface,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:theme.colors.border},linkText:{fontWeight:'800',color:theme.colors.text}});
