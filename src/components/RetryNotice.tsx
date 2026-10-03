import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppIcon } from './AppIcon';
import { useThemedStyles, type AppTheme } from '../theme';
import { useI18n } from '../i18n';

export function RetryNotice({title,body,onRetry,retrying=false}:{title:string;body:string;onRetry:()=>void;retrying?:boolean}){const {theme,styles}=useThemedStyles(createStyles);
  const {t}=useI18n();
  return <View accessibilityRole="alert" style={styles.wrap}>
    <View style={styles.icon}><AppIcon name="warning" size={18} color={theme.colors.danger}/></View>
    <View style={styles.copy}><Text style={styles.title}>{title}</Text><Text style={styles.body}>{body}</Text></View>
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}: ${t('common.retry')}`} accessibilityState={{disabled:retrying,busy:retrying}} disabled={retrying} onPress={onRetry} style={({pressed})=>[styles.button,retrying&&styles.disabled,pressed&&styles.pressed]}>{retrying?<ActivityIndicator color={theme.colors.primary}/>:<Text style={styles.buttonText}>{t('common.retry')}</Text>}</Pressable>
  </View>
}
const createStyles=(theme:AppTheme)=>StyleSheet.create({wrap:{margin:16,padding:12,borderRadius:theme.radius.lg,backgroundColor:theme.colors.dangerSoft,flexDirection:'row',alignItems:'center',gap:9},icon:{width:36,height:36,borderRadius:18,backgroundColor:theme.colors.surface,alignItems:'center',justifyContent:'center'},copy:{flex:1},title:{fontSize:12,fontWeight:'900',color:theme.colors.danger},body:{marginTop:3,...theme.type.caption,color:theme.colors.textSoft},button:{minHeight:44,minWidth:82,paddingHorizontal:10,borderRadius:theme.radius.pill,backgroundColor:theme.colors.surface,alignItems:'center',justifyContent:'center'},buttonText:{fontSize:11,fontWeight:'900',color:theme.colors.primary},disabled:{opacity:.55},pressed:{opacity:.72}});
