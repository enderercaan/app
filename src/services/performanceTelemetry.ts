import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';
import { isBackendConfigured, env } from './config';
import { supabase } from './supabase';

const SAMPLE_WINDOW_MS=8_000;
const MIN_SAMPLE_INTERVAL_MS=15*60_000;
const SLOW_FRAME_MS=1000/30;
const FROZEN_FRAME_MS=700;

let stopCurrent: (()=>void)|null=null;
let lastSampleStartedAt=0;

function finiteBounded(value:number,min:number,max:number){
  return Number.isFinite(value)?Math.min(max,Math.max(min,value)):min;
}

async function submitSample(frameTimes:number[]){
  if(frameTimes.length<3||!isBackendConfigured||env.appEnv!=='production'||(Platform.OS!=='ios'&&Platform.OS!=='android'))return;
  const first=frameTimes[0]!,last=frameTimes[frameTimes.length-1]!;
  const durationMs=last-first;
  if(durationMs<1000||durationMs>30_000)return;
  const intervals:number[]=[];
  for(let i=1;i<frameTimes.length;i+=1){const delta=frameTimes[i]!-frameTimes[i-1]!;if(Number.isFinite(delta)&&delta>0)intervals.push(delta)}
  if(intervals.length<2)return;
  const slow=intervals.filter(delta=>delta>SLOW_FRAME_MS).length;
  const frozen=intervals.filter(delta=>delta>=FROZEN_FRAME_MS).length;
  const averageFps=finiteBounded((intervals.length*1000)/durationMs,0,240);
  const slowRate=finiteBounded(slow/intervals.length,0,1);
  const frozenRate=finiteBounded(frozen/intervals.length,0,1);
  try{
    const {data}=await supabase.auth.getSession();
    if(!data.session)return;
    await supabase.rpc('record_client_performance',{
      p_metric:'js_frame_window',
      p_surface:'app_foreground',
      p_app_version:String(Constants.expoConfig?.version??'unknown').slice(0,32),
      p_platform:Platform.OS,
      p_average_fps:Number(averageFps.toFixed(2)),
      p_slow_frame_rate:Number(slowRate.toFixed(6)),
      p_frozen_frame_rate:Number(frozenRate.toFixed(6)),
      p_frame_count:Math.min(5000,intervals.length+1),
      p_sample_duration_ms:Math.round(durationMs)
    });
  }catch{
    // Performance telemetry is strictly best-effort and must never affect UX.
  }
}

function startWindow(){
  const now=Date.now();
  if(AppState.currentState!=='active'||now-lastSampleStartedAt<MIN_SAMPLE_INTERVAL_MS)return ()=>{};
  lastSampleStartedAt=now;
  const frames:number[]=[];
  let active=true;
  let raf=0;
  const onFrame=(ts:number)=>{if(!active)return;frames.push(ts);raf=requestAnimationFrame(onFrame)};
  raf=requestAnimationFrame(onFrame);
  const timer=setTimeout(()=>{
    if(!active)return;
    active=false;
    cancelAnimationFrame(raf);
    void submitSample(frames);
  },SAMPLE_WINDOW_MS);
  return ()=>{if(!active)return;active=false;clearTimeout(timer);cancelAnimationFrame(raf)};
}

export function startFramePerformanceTelemetry(){
  stopCurrent?.();
  if(__DEV__||!isBackendConfigured||env.appEnv!=='production')return ()=>{};
  let stopWindow=startWindow();
  const subscription=AppState.addEventListener('change',state=>{
    if(state==='active'){stopWindow();stopWindow=startWindow()}
    else stopWindow();
  });
  const stop=()=>{stopWindow();subscription.remove();if(stopCurrent===stop)stopCurrent=null};
  stopCurrent=stop;
  return stop;
}
