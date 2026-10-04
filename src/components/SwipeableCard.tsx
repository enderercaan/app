import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useThemedStyles, type AppTheme } from '../theme';
import { useI18n } from '../i18n';
import { useReduceMotion } from '../hooks/useReduceMotion';

export function SwipeableCard({children,onSwipeLeft,onSwipeRight,disabled=false}:{children:React.ReactNode;onSwipeLeft:()=>void|Promise<void>;onSwipeRight:()=>void|Promise<void>;disabled?:boolean}){const {theme,styles}=useThemedStyles(createStyles);
  const {t}=useI18n();
  const reduceMotion=useReduceMotion();
  const {width}=useWindowDimensions();
  const screenWidth=Math.max(width,1);
  const threshold=Math.min(120,screenWidth*.24);
  const position=useRef(new Animated.ValueXY()).current;
  const busy=useRef(false);
  const rotate=position.x.interpolate({inputRange:[-screenWidth,0,screenWidth],outputRange:['-8deg','0deg','8deg'],extrapolate:'clamp'});
  const likeOpacity=position.x.interpolate({inputRange:[0,threshold],outputRange:[0,1],extrapolate:'clamp'});
  const passOpacity=position.x.interpolate({inputRange:[-threshold,0],outputRange:[1,0],extrapolate:'clamp'});

  useEffect(()=>{
    if(!busy.current)position.setValue({x:0,y:0});
  },[position,screenWidth]);

  const finish=useCallback((direction:'left'|'right')=>{
    if(busy.current)return;
    busy.current=true;
    const x=direction==='right'?screenWidth*1.25:-screenWidth*1.25;
    const complete=()=>{
      const action=direction==='right'?onSwipeRight:onSwipeLeft;
      Promise.resolve().then(action).catch(()=>undefined).finally(()=>{
        position.setValue({x:0,y:0});
        busy.current=false;
      });
    };
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(()=>undefined);
    if(reduceMotion){position.setValue({x,y:0});complete();return}
    Animated.spring(position,{toValue:{x,y:0},useNativeDriver:true,speed:24,bounciness:5,overshootClamping:true}).start(complete);
  },[onSwipeLeft,onSwipeRight,position,reduceMotion,screenWidth]);

  const panResponder=useMemo(()=>PanResponder.create({
    onMoveShouldSetPanResponder:(_,g)=>!disabled&&!busy.current&&Math.abs(g.dx)>8&&Math.abs(g.dx)>Math.abs(g.dy)*1.15,
    onPanResponderMove:(_,g)=>position.setValue({x:g.dx,y:0}),
    onPanResponderRelease:(_,g)=>{
      if(g.dx>threshold)finish('right');
      else if(g.dx<-threshold)finish('left');
      else if(reduceMotion)position.setValue({x:0,y:0});
      else Animated.spring(position,{toValue:{x:0,y:0},useNativeDriver:true,speed:20,bounciness:7}).start();
    },
    onPanResponderTerminate:()=>reduceMotion?position.setValue({x:0,y:0}):Animated.spring(position,{toValue:{x:0,y:0},useNativeDriver:true}).start()
  }),[disabled,finish,position,reduceMotion,threshold]);

  return <View style={styles.wrap}>
    <Animated.View pointerEvents="none" style={[styles.stamp,styles.like,{opacity:likeOpacity}]}><Text style={[styles.stampText,{color:theme.colors.success}]}>{t('swipe.like')}</Text></Animated.View>
    <Animated.View pointerEvents="none" style={[styles.stamp,styles.pass,{opacity:passOpacity}]}><Text style={[styles.stampText,{color:theme.colors.danger}]}>{t('swipe.pass')}</Text></Animated.View>
    <Animated.View {...panResponder.panHandlers} style={{transform:[...position.getTranslateTransform(),{rotate}]}}>{children}</Animated.View>
  </View>;
}

const createStyles=(theme:AppTheme)=>StyleSheet.create({
  wrap:{position:'relative'},
  stamp:{position:'absolute',top:30,zIndex:20,paddingHorizontal:14,paddingVertical:7,borderRadius:12,backgroundColor:theme.colors.swipeStampSurface,borderWidth:2},
  like:{left:34,borderColor:theme.colors.success,transform:[{rotate:'-8deg'}]},
  pass:{right:34,borderColor:theme.colors.danger,transform:[{rotate:'8deg'}]},
  stampText:{fontSize:18,fontWeight:'900',letterSpacing:1.5}
});
