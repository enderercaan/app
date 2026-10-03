import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppIcon } from '../components/AppIcon';
import type { RootStackParamList } from '../navigation/types';
import { useI18n } from '../i18n';
import { useThemedStyles, type AppTheme } from '../theme';

export function CallScreen({navigation}:NativeStackScreenProps<RootStackParamList,'Call'>){
  const {theme,styles}=useThemedStyles(createStyles);
  const {t}=useI18n();
  return <View style={styles.root}>
    <AppIcon name="phone" size={42} color={theme.colors.primary}/>
    <Text style={styles.title}>{t('call.nativeRequiredTitle')}</Text>
    <Text style={styles.body}>{t('call.nativeRequiredBody')}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={t('call.back')} onPress={()=>navigation.goBack()} style={styles.button}>
      <Text style={styles.buttonText}>{t('call.back')}</Text>
    </Pressable>
  </View>;
}

const createStyles=(theme:AppTheme)=>StyleSheet.create({
  root:{flex:1,alignItems:'center',justifyContent:'center',padding:28,gap:12,backgroundColor:theme.colors.background},
  title:{fontSize:20,fontWeight:'900',textAlign:'center',color:theme.colors.text},
  body:{fontSize:14,lineHeight:20,textAlign:'center',maxWidth:420,color:theme.colors.muted},
  button:{minHeight:48,paddingHorizontal:22,borderRadius:24,alignItems:'center',justifyContent:'center',backgroundColor:theme.colors.primary},
  buttonText:{color:theme.colors.onPrimary,fontWeight:'900'},
});
