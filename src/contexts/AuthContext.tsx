import React,{createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react';
import type {Session,User} from '@supabase/supabase-js';
import {Alert,Linking} from 'react-native';
import {isBackendConfigured,isDemoEnabled} from '../services/config';
import {bindAuthAutoRefresh,flushPendingOAuthRevocationCredential,handleAuthDeepLink,supabase} from '../services/supabase';
import {configurePurchases,logInPurchases,reconcilePurchasesIdentity} from '../services/purchases';
import { getRuntimeLocale, translate } from '../i18n';
import { syncPreferredLocale } from '../services/localePreference';
import { userMessage } from '../services/errors';
import { getMfaAalState } from '../services/mfa';
import { bindDurableClientOperationsToUser, clearAllDurableClientOperations } from '../services/clientOperation';
import { bindOfflineMutationQueueToUser, clearOfflineMutationQueue, replayOfflineMutations } from '../services/offlineMutationQueue';
import { bindOfflineForegroundReplay, ensureOfflineBackgroundSyncRegistered, unregisterOfflineBackgroundSync } from '../services/offlineSyncTask';

type AuthBootstrapStatus='loading'|'ready'|'error';
type MfaStatus='checking'|'required'|'satisfied'|'error';
type AuthState={loading:boolean;bootstrapStatus:AuthBootstrapStatus;bootstrapError:string|null;retryBootstrap:()=>Promise<void>;session:Session|null;user:User|null;demoMode:boolean;recoveryMode:boolean;mfaStatus:MfaStatus;refreshMfaRequirement:()=>Promise<void>;finishRecovery:()=>void};
const noop=()=>undefined;
const noopAsync=async()=>undefined;
const isVerifiedIdentity=(user:User|undefined|null)=>Boolean(user?.email_confirmed_at||user?.phone_confirmed_at);
const AuthContext=createContext<AuthState>({loading:true,bootstrapStatus:'loading',bootstrapError:null,retryBootstrap:noopAsync,session:null,user:null,demoMode:isDemoEnabled,recoveryMode:false,mfaStatus:'checking',refreshMfaRequirement:noopAsync,finishRecovery:noop});

export function AuthProvider({children}:{children:React.ReactNode}){
  const [core,setCore]=useState<Omit<AuthState,'finishRecovery'|'retryBootstrap'|'refreshMfaRequirement'>>({loading:true,bootstrapStatus:'loading',bootstrapError:null,session:null,user:null,demoMode:isDemoEnabled,recoveryMode:false,mfaStatus:'checking'});
  const bootstrapEpoch=useRef(0);
  const mounted=useRef(true);
  const configureOfflineSync=async(userId:string|null)=>{
    try{
      await bindOfflineMutationQueueToUser(userId);
      if(userId){await ensureOfflineBackgroundSyncRegistered();void replayOfflineMutations().catch(()=>undefined)}
      else await unregisterOfflineBackgroundSync();
      return true;
    }catch{
      await unregisterOfflineBackgroundSync().catch(()=>undefined);
      return false;
    }
  };
  const bootstrap=async()=>{
    const epoch=++bootstrapEpoch.current;
    if(!isBackendConfigured){
      if(isDemoEnabled){configurePurchases('demo-user');setCore(x=>({...x,loading:false,bootstrapStatus:'ready',bootstrapError:null,session:null,user:null,demoMode:true,mfaStatus:'satisfied'}))}
      else setCore(x=>({...x,loading:false,bootstrapStatus:'ready',bootstrapError:null,session:null,user:null,demoMode:false,mfaStatus:'satisfied'}));
      return;
    }
    setCore(x=>({...x,loading:true,bootstrapStatus:'loading',bootstrapError:null}));
    try{
      const {data,error}=await supabase.auth.getSession();
      if(error)throw error;
      let session=data.session;
      if(session&&!isVerifiedIdentity(session.user)){await supabase.auth.signOut({scope:'local'}).catch(()=>undefined);session=null}
      if(session){
        const {data:active,error:activeError}=await supabase.rpc('current_session_not_revoked');
        if(activeError)throw activeError;
        if(active!==true){await supabase.auth.signOut({scope:'local'}).catch(()=>undefined);session=null}
      }
      await bindDurableClientOperationsToUser(session?.user.id??null).catch(()=>undefined);
      await configureOfflineSync(session?.user.id??null);
      if(!mounted.current||epoch!==bootstrapEpoch.current)return;
      setCore(x=>({...x,loading:false,bootstrapStatus:'ready',bootstrapError:null,session,user:session?.user??null,demoMode:false,mfaStatus:session?'checking':'satisfied'}));
      if(session?.user.id){void logInPurchases(session.user.id);void syncPreferredLocale(getRuntimeLocale()).catch(()=>undefined);void flushPendingOAuthRevocationCredential().catch(()=>undefined)};
    }catch(error){
      if(!mounted.current||epoch!==bootstrapEpoch.current)return;
      const message=userMessage(error,translate(getRuntimeLocale(),'auth.sessionVerifyFallback'));
      setCore(x=>({...x,loading:false,bootstrapStatus:'error',bootstrapError:message}));
    }
  };
  useEffect(()=>{
    mounted.current=true;
    const unbind=bindAuthAutoRefresh();
    const unbindOfflineForeground=bindOfflineForegroundReplay();
    if(!isBackendConfigured){void bootstrap();return()=>{unbindOfflineForeground();unbind()}}
    const consume=async(url:string|null)=>{if(!url||!mounted.current)return;const r=await handleAuthDeepLink(url);if(!mounted.current)return;if(r.oauthCapture==='failed')Alert.alert(translate(getRuntimeLocale(),'auth.socialFailedTitle'),translate(getRuntimeLocale(),'auth.socialFailedBody'));if(r.recovery)setCore(x=>({...x,recoveryMode:true}))};
    void Linking.getInitialURL().then(consume).catch(()=>undefined);
    const linkSub=Linking.addEventListener('url',e=>void consume(e.url));
    void bootstrap();
    const {data:listener}=supabase.auth.onAuthStateChange((event,session)=>{bootstrapEpoch.current++;const verifiedSession=isVerifiedIdentity(session?.user)?session:null;void bindDurableClientOperationsToUser(verifiedSession?.user.id??null).catch(()=>undefined);void configureOfflineSync(verifiedSession?.user.id??null);if(event==='SIGNED_OUT'){void clearAllDurableClientOperations().catch(()=>undefined);void clearOfflineMutationQueue().catch(()=>undefined);void unregisterOfflineBackgroundSync().catch(()=>undefined)}if(session&&!verifiedSession)void supabase.auth.signOut({scope:'local'}).catch(()=>undefined);setCore(x=>({...x,loading:false,bootstrapStatus:'ready',bootstrapError:null,session:verifiedSession,user:verifiedSession?.user??null,demoMode:false,mfaStatus:verifiedSession?'checking':'satisfied',recoveryMode:event==='PASSWORD_RECOVERY'&&verifiedSession?true:x.recoveryMode}));void reconcilePurchasesIdentity(verifiedSession?.user.id??null).catch(()=>undefined);if(verifiedSession?.user.id){void syncPreferredLocale(getRuntimeLocale()).catch(()=>undefined);void flushPendingOAuthRevocationCredential().catch(()=>undefined)}});
    return()=>{mounted.current=false;bootstrapEpoch.current++;listener.subscription.unsubscribe();linkSub.remove();unbindOfflineForeground();unbind()};
  },[]);
  const refreshMfaRequirement=useCallback(async()=>{
    const accessToken=core.session?.access_token;
    if(core.demoMode||!accessToken){setCore(x=>({...x,mfaStatus:'satisfied'}));return}
    setCore(x=>({...x,mfaStatus:'checking'}));
    try{const state=await getMfaAalState();setCore(x=>x.session?.access_token===accessToken?({...x,mfaStatus:state.required?'required':'satisfied'}):x)}
    catch{setCore(x=>x.session?.access_token===accessToken?({...x,mfaStatus:'error'}):x)}
  },[core.session?.access_token,core.demoMode]);
  useEffect(()=>{if(core.session?.access_token&&!core.demoMode)void refreshMfaRequirement()},[core.session?.access_token,core.demoMode,refreshMfaRequirement]);
  const value=useMemo<AuthState>(()=>({...core,retryBootstrap:bootstrap,refreshMfaRequirement,finishRecovery:()=>setCore(x=>({...x,recoveryMode:false}))}),[core,refreshMfaRequirement]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth(){return useContext(AuthContext)}
