import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle, View } from 'react-native';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useThemedStyles, type AppTheme } from '../theme';

export function GlassSurface({children,style,interactive=false}:{children:React.ReactNode;style?:StyleProp<ViewStyle>;interactive?:boolean}){
  const {theme,styles}=useThemedStyles(createStyles);
  const glassAvailable=isGlassEffectAPIAvailable()&&isLiquidGlassAvailable();
  const composed=[styles.base,style];
  if(!glassAvailable)return <View style={composed}>{children}</View>;
  return <GlassView colorScheme={theme.mode} isInteractive={interactive} glassEffectStyle="regular" tintColor={theme.colors.glassTint} style={composed}>{children}</GlassView>;
}
const createStyles=(theme:AppTheme)=>StyleSheet.create({base:{borderWidth:1,overflow:'hidden',backgroundColor:theme.colors.glassSurface,borderColor:theme.colors.border}});
