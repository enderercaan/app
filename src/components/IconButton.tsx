import { Pressable, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { AppIcon } from './AppIcon';
import { useThemedStyles, type AppTheme } from '../theme';

type Props={icon:Parameters<typeof AppIcon>[0]['name'];onPress:()=>void;label:string;variant?:'surface'|'primary'|'soft'|'danger';size?:number;disabled?:boolean;selected?:boolean};
export function IconButton({icon,onPress,label,variant='surface',size=48,disabled,selected}:Props){const {theme,styles}=useThemedStyles(createStyles);
  const bg=variant==='primary'?theme.colors.primary:variant==='soft'?theme.colors.primarySoft:variant==='danger'?theme.colors.dangerSoft:theme.colors.surface;
  const fg=variant==='primary'?theme.colors.onPrimary:variant==='danger'?theme.colors.danger:variant==='soft'?theme.colors.primary:theme.colors.text;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled:Boolean(disabled),selected:Boolean(selected)}} disabled={disabled} hitSlop={6} onPress={()=>{void Haptics.selectionAsync();onPress();}} style={({pressed})=>[styles.base,{width:size,height:size,borderRadius:size/2,backgroundColor:bg,opacity:disabled?.45:pressed?.72:1},variant==='surface'&&styles.border]}><AppIcon name={icon} size={Math.round(size*.45)} color={fg}/></Pressable>;
}
const createStyles=(theme:AppTheme)=>StyleSheet.create({base:{alignItems:'center',justifyContent:'center'},border:{borderWidth:1,borderColor:theme.colors.border}});
