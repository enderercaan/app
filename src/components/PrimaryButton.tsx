import { useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { AppIcon } from './AppIcon';
import { useThemedStyles, type AppTheme } from '../theme';
export const PRESS_GUARD_MS=700;
export function PrimaryButton({label,onPress,loading,disabled,variant='primary',icon,testID}:{label:string;onPress:()=>void;loading?:boolean;disabled?:boolean;variant?:'primary'|'secondary'|'danger';icon?:Parameters<typeof AppIcon>[0]['name'];testID?:string}){const {theme,styles}=useThemedStyles(createStyles);
  // Ghost-tap guard: a second press inside the window is ignored even before the parent re-renders with loading=true,
  // so slow networks cannot submit a purchase, message or match action twice.
  const lastPressAt=useRef(0);
  const primary=variant==='primary';const danger=variant==='danger';const bg=primary?theme.colors.primary:danger?theme.colors.dangerSoft:theme.colors.surface;const fg=primary?theme.colors.onPrimary:danger?theme.colors.danger:theme.colors.text;return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled:Boolean(disabled||loading),busy:Boolean(loading)}} disabled={disabled||loading} onPress={()=>{const now=Date.now();if(now-lastPressAt.current<PRESS_GUARD_MS)return;lastPressAt.current=now;void Haptics.selectionAsync();onPress();}} style={({pressed})=>[styles.button,{backgroundColor:bg,borderColor:primary?theme.colors.primary:danger?theme.colors.danger:theme.colors.border,opacity:disabled?.45:pressed?.8:1}]}>{loading?<ActivityIndicator color={fg}/>:<View style={styles.content}>{icon?<AppIcon name={icon} size={19} color={fg}/>:null}<Text style={[styles.label,{color:fg}]}>{label}</Text></View>}</Pressable>}
const createStyles=(theme:AppTheme)=>StyleSheet.create({button:{minHeight:52,paddingHorizontal:18,borderRadius:theme.radius.md,borderWidth:1,alignItems:'center',justifyContent:'center'},content:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8},label:{fontSize:15,fontWeight:'900'}});
