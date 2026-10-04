import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { useThemedStyles, type AppTheme } from '../theme';

export function ShimmerSkeleton({height=18,width='100%',radius=12,style}:{height?:number;width?:number|`${number}%`;radius?:number;style?:StyleProp<ViewStyle>}){
  const {styles}=useThemedStyles(createStyles);const reduceMotion=useReduceMotion();const pulse=useRef(new Animated.Value(0)).current;
  useEffect(()=>{if(reduceMotion){pulse.setValue(.45);return}const animation=Animated.loop(Animated.sequence([Animated.timing(pulse,{toValue:1,duration:720,easing:Easing.inOut(Easing.ease),useNativeDriver:true}),Animated.timing(pulse,{toValue:0,duration:720,easing:Easing.inOut(Easing.ease),useNativeDriver:true})]));animation.start();return()=>animation.stop()},[pulse,reduceMotion]);
  const opacity=pulse.interpolate({inputRange:[0,1],outputRange:[.34,.78]});
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.clip,{height,width,borderRadius:radius},style]}><Animated.View style={[StyleSheet.absoluteFill,styles.pulse,{opacity}]}/></View>;
}
const createStyles=(theme:AppTheme)=>StyleSheet.create({clip:{overflow:'hidden',backgroundColor:theme.colors.surfaceStrong},pulse:{backgroundColor:theme.colors.primarySoft}});
