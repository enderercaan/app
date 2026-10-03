import React,{createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react';
import {AppState} from 'react-native';
import {useAuth} from './AuthContext';
import {getAccountSettings,updateAccountPaused} from '../services/api';
import type {AccountSettings} from '../types/domain';
import {getRuntimeLocale,translate,useI18n} from '../i18n';

type AccountStateStatus='loading'|'ready'|'error';
type AccountStateValue={
  status:AccountStateStatus;
  settings:AccountSettings|null;
  paused:boolean;
  suspended:boolean;
  error:string|null;
  refresh:()=>Promise<boolean>;
  setPaused:(paused:boolean)=>Promise<void>;
};
const AccountStateContext=createContext<AccountStateValue|null>(null);

export function AccountStateProvider({children}:{children:React.ReactNode}){
  const {user,demoMode}=useAuth();
  const {setMeasurementSystem}=useI18n();
  const [status,setStatus]=useState<AccountStateStatus>(demoMode?'ready':'loading');
  const [settings,setSettings]=useState<AccountSettings|null>(null);
  const [error,setError]=useState<string|null>(null);
  const refreshEpoch=useRef(0);
  const mutationEpoch=useRef(0);
  const pauseQueue=useRef<Promise<void>>(Promise.resolve());
  const mountedRef=useRef(true);
  const userIdRef=useRef<string|null>(user?.id??null);userIdRef.current=user?.id??null;

  const refresh=useCallback(async()=>{
    const epoch=++refreshEpoch.current;
    if(demoMode||!user){setSettings(null);setError(null);setStatus('ready');return true}
    try{
      setStatus('loading');setError(null);
      const next=await getAccountSettings();
      if(epoch!==refreshEpoch.current)return false;
      if(next.measurementSystem==='metric'||next.measurementSystem==='imperial')await setMeasurementSystem(next.measurementSystem);
      if(epoch!==refreshEpoch.current)return false;
      setSettings(next);setStatus('ready');return true;
    }catch(e){
      if(epoch!==refreshEpoch.current)return false;
      setError(translate(getRuntimeLocale(),'paused.verifyBody'));setStatus('error');return false;
    }
  },[demoMode,user?.id,setMeasurementSystem]);

  useEffect(()=>{mountedRef.current=true;void refresh();return()=>{mountedRef.current=false;refreshEpoch.current++;mutationEpoch.current++}},[refresh]);
  useEffect(()=>{const subscription=AppState.addEventListener('change',state=>{if(state==='active')void refresh()});return()=>subscription.remove()},[refresh]);

  const setPaused=useCallback(async(paused:boolean)=>{
    if(demoMode)return;
    const subject=userIdRef.current;if(!subject)return;
    const mutation=++mutationEpoch.current;
    refreshEpoch.current++;
    let result:{paused:boolean}|null=null;
    const write=pauseQueue.current.catch(()=>undefined).then(async()=>{if(!mountedRef.current||userIdRef.current!==subject)return;result=await updateAccountPaused(paused)});
    pauseQueue.current=write.then(()=>undefined,()=>undefined);
    await write;
    if(!mountedRef.current||userIdRef.current!==subject||mutation!==mutationEpoch.current||!result)return;
    refreshEpoch.current++;
    setSettings(current=>current?{...current,paused:result!.paused,discoverable:result!.paused?false:current.discoverable}:{tier:'standard',dailySwipeRemaining:null,dailyNewConversationRemaining:null,discoverable:false,incognito:false,age18Confirmed:false,paused:result!.paused,suspended:false});
    setError(null);setStatus('ready');
  },[demoMode,user?.id]);

  const value=useMemo<AccountStateValue>(()=>({status,settings,paused:Boolean(settings?.paused),suspended:Boolean(settings?.suspended),error,refresh,setPaused}),[status,settings,error,refresh,setPaused]);
  return <AccountStateContext.Provider value={value}>{children}</AccountStateContext.Provider>;
}

export function useAccountState(){
  const value=useContext(AccountStateContext);
  if(!value)throw new Error('useAccountState must be used inside AccountStateProvider');
  return value;
}
