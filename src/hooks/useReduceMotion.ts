import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReduceMotion() {
  const [reduceMotion,setReduceMotion]=useState(false);
  useEffect(()=>{
    let mounted=true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(mounted)setReduceMotion(value)}).catch(()=>undefined);
    const subscription=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduceMotion);
    return()=>{mounted=false;subscription.remove()};
  },[]);
  return reduceMotion;
}
