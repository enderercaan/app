import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { HealthVerificationTrust } from '../types/domain';
import { useI18n } from '../i18n';
import { formatDateTime } from '../services/locale';
import { useThemedStyles, type AppTheme } from '../theme';
import { TrustPill } from './TrustPill';
import { AppIcon } from './AppIcon';

const SHA256_RE=/^[0-9a-f]{64}$/;

export function HealthTrustPill({trust,label}:{trust:HealthVerificationTrust;label:string}){
  const {t,locale}=useI18n();
  const {theme,styles}=useThemedStyles(createStyles);
  const [open,setOpen]=useState(false);
  const signature=SHA256_RE.test(trust.passportSignatureSha256)?trust.passportSignatureSha256:t('health.trust.integrityValid');
  const details=t('health.trust.body',{
    clinic:trust.clinicPublicId,
    method:t('health.trust.methodProvider'),
    verifiedAt:formatDateTime(trust.verifiedAt,{dateStyle:'medium',timeStyle:'short'},locale),
    integrity:t('health.trust.integrityValid'),
    source:trust.providerCode,
    signature,
  });
  return <>
    <TrustPill label={label} tone="success" icon="verified" onPress={()=>setOpen(true)} accessibilityLabel={t('health.trust.openA11y',{label})}/>
    <Modal transparent animationType="fade" visible={open} onRequestClose={()=>setOpen(false)}>
      <View style={styles.backdrop} accessibilityViewIsModal>
        <View style={styles.card}>
          <View style={styles.header}><View style={styles.icon}><AppIcon name="verified" size={20} color={theme.colors.success}/></View><Text style={styles.title}>{t('health.trust.title')}</Text></View>
          <Text selectable style={styles.details}>{details}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={()=>setOpen(false)} style={({pressed})=>[styles.close,pressed&&styles.pressed]}><Text style={styles.closeText}>{t('common.close')}</Text></Pressable>
        </View>
      </View>
    </Modal>
  </>;
}

const createStyles=(theme:AppTheme)=>StyleSheet.create({
  backdrop:{flex:1,backgroundColor:theme.colors.scrim,alignItems:'center',justifyContent:'center',padding:24},
  card:{width:'100%',maxWidth:520,borderRadius:theme.radius.xl,padding:22,backgroundColor:theme.colors.surface,borderWidth:1,borderColor:theme.colors.borderStrong,...theme.shadow.floating},
  header:{flexDirection:'row',alignItems:'center',gap:10},
  icon:{width:42,height:42,borderRadius:21,backgroundColor:theme.colors.successSoft,alignItems:'center',justifyContent:'center'},
  title:{flex:1,...theme.type.h2,color:theme.colors.text},
  details:{marginTop:18,...theme.type.body,color:theme.colors.textSoft,lineHeight:23},
  close:{marginTop:22,minHeight:48,borderRadius:24,backgroundColor:theme.colors.primary,alignItems:'center',justifyContent:'center',paddingHorizontal:18},
  closeText:{...theme.type.label,color:theme.colors.onPrimary},
  pressed:{opacity:.78}
});
