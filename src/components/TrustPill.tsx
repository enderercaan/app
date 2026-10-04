import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppIcon } from './AppIcon';
import { useThemedStyles, type AppTheme } from '../theme';

type Props={label:string;tone?:'brand'|'success'|'neutral';icon?:Parameters<typeof AppIcon>[0]['name'];onPress?:()=>void;accessibilityLabel?:string};
export function TrustPill({label,tone='brand',icon='verified',onPress,accessibilityLabel}:Props){const {theme,styles}=useThemedStyles(createStyles);const bg=tone==='success'?theme.colors.successSoft:tone==='neutral'?theme.colors.surfaceAlt:theme.colors.primarySoft;const fg=tone==='success'?theme.colors.success:tone==='neutral'?theme.colors.textSoft:theme.colors.primary;const content=<><AppIcon name={icon} size={14} color={fg}/><Text style={[styles.text,{color:fg}]}>{label}</Text></>;return onPress?<Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel??label} hitSlop={6} onPress={onPress} style={({pressed})=>[styles.pill,{backgroundColor:bg,opacity:pressed?.78:1}]}>{content}</Pressable>:<View style={[styles.pill,{backgroundColor:bg}]}>{content}</View>}
const createStyles=(theme:AppTheme)=>StyleSheet.create({pill:{minHeight:32,paddingHorizontal:10,borderRadius:theme.radius.pill,flexDirection:'row',alignItems:'center',gap:5},text:{fontSize:11,fontWeight:'800'}});
