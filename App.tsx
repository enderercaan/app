import React, { useEffect, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppIcon } from './src/components/AppIcon';
import { AppErrorBoundary } from './src/components/AppErrorBoundary';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { AccountStateProvider, useAccountState } from './src/contexts/AccountStateContext';
import { AppDataProvider } from './src/contexts/AppDataContext';
import { AppNavigator } from './src/navigation/AppNavigator';
import { AuthScreen } from './src/screens/AuthScreen';
import { ResetPasswordScreen } from './src/screens/ResetPasswordScreen';
import { MfaChallengeScreen } from './src/screens/MfaChallengeScreen';
import { PausedAccountScreen } from './src/screens/PausedAccountScreen';
import { SuspendedAccountScreen } from './src/screens/SuspendedAccountScreen';
import { getRuntimeConfig, type RuntimeConfigPayload } from './src/services/api';
import { secureStorage } from './src/services/secureStorage';
import { env, isBackendConfigured, isDemoEnabled } from './src/services/config';
import { useTheme, useThemedStyles, type AppTheme } from './src/theme';
import { I18nProvider, useI18n } from './src/i18n';
import { initCrashReporting, recordOperationalIssue, wrapRootWithCrashReporting } from './src/services/crashReporting';
import { startFramePerformanceTelemetry } from './src/services/performanceTelemetry';
import { startImageMemoryGuard } from './src/services/imageMemory';
import { openSafeExternalHttpsUrl } from './src/services/externalLinks';

initCrashReporting();

const RUNTIME_CACHE_KEY='tailmance.runtime-config.v1';
const RUNTIME_CACHE_MAX_AGE_MS=24*60*60*1000;
function validVersion(value:string){return /^\d+(?:\.\d+){0,3}$/.test(value)}
function versionLt(a:string,b:string){if(!validVersion(a)||!validVersion(b))throw new Error('invalid_version');const A=a.split('.').map(Number),B=b.split('.').map(Number);for(let i=0;i<Math.max(A.length,B.length);i++){const x=A[i]||0,y=B[i]||0;if(x<y)return true;if(x>y)return false}return false}
function runtimePlatformVersion(c:RuntimeConfigPayload){const platform=Platform.OS==='ios'?'ios':'android';return c.minimumSupportedVersions?.[platform]??c.minimumSupportedVersion}
function runtimeMessage(c:RuntimeConfigPayload,locale:string){const messages=c.messages??{};const language=locale.split('-')[0]??locale;const candidate=messages[locale]??messages[language]??messages.en??(locale==='en'?c.message:undefined);return typeof candidate==='string'&&candidate.trim().length<=500?candidate.trim():undefined}
function gateState(c:RuntimeConfigPayload,locale:string){const version=Constants.expoConfig?.version??'1.0.0';const minimumVersion=runtimePlatformVersion(c);return{loading:false,maintenance:Boolean(c.maintenanceMode),forceUpdate:versionLt(version,minimumVersion),message:runtimeMessage(c,locale),verificationFailed:false}}
function RuntimeGate({children}:{children:React.ReactNode}){const {theme,styles}=useThemedStyles(createStyles);
  const {t,locale}=useI18n();
  const [state,setState]=useState<{loading:boolean;maintenance:boolean;forceUpdate:boolean;verificationFailed:boolean;message?:string}>({loading:isBackendConfigured,maintenance:false,forceUpdate:false,verificationFailed:false});
  const runtimeRequestRef=useRef(0);
  const check=async()=>{const requestId=++runtimeRequestRef.current;const requestedLocale=locale;
    if(!isBackendConfigured){if(requestId===runtimeRequestRef.current)setState({loading:false,maintenance:false,forceUpdate:false,verificationFailed:false});return}
    setState(previous=>({...previous,loading:true,verificationFailed:false}));
    try{
      const c=await getRuntimeConfig();
      const minimumVersion=c?runtimePlatformVersion(c):'';
      if(!c||typeof c.maintenanceMode!=='boolean'||!validVersion(minimumVersion))throw new Error('invalid_runtime_config');
      await secureStorage.setItem(RUNTIME_CACHE_KEY,JSON.stringify({config:c,fetchedAt:Date.now()})).catch(()=>recordOperationalIssue('runtime_config_cache_write_failed'));
      if(requestId===runtimeRequestRef.current)setState(gateState(c,requestedLocale));
    }catch{
      try{
        const raw=await secureStorage.getItem(RUNTIME_CACHE_KEY);
        const cached=raw?JSON.parse(raw):null;
        const cachedMinimum=cached?.config?runtimePlatformVersion(cached.config):'';
        if(cached?.config&&Number.isFinite(cached?.fetchedAt)&&Date.now()-cached.fetchedAt<=RUNTIME_CACHE_MAX_AGE_MS&&validVersion(cachedMinimum)){
          const cachedState=gateState(cached.config,requestedLocale);
          if(requestId!==runtimeRequestRef.current)return;
          if(env.appEnv!=='production'||cachedState.maintenance||cachedState.forceUpdate){setState(cachedState);return}
        }
      }catch{recordOperationalIssue('runtime_config_cache_read_failed')}
      if(requestId===runtimeRequestRef.current)setState({loading:false,maintenance:false,forceUpdate:false,verificationFailed:env.appEnv==='production'});
    }
  };
  useEffect(()=>{void check();return()=>{runtimeRequestRef.current+=1}},[locale]);
  const openStore=async(url:string)=>{try{await openSafeExternalHttpsUrl(url)}catch{Alert.alert(t('runtime.storeOpenFailedTitle'),t('runtime.storeOpenFailedBody'))}};
  if(state.loading)return <View style={styles.gate}><ActivityIndicator color={theme.colors.primary}/></View>;
  if(state.verificationFailed)return <View style={styles.gate}><View style={styles.gateIcon}><AppIcon name="warning" size={30} color={theme.colors.danger}/></View><Text style={styles.gateTitle}>{t('runtime.verifyTitle')}</Text><Text style={styles.gateBody}>{t('runtime.verifyBody')}</Text><Pressable accessibilityRole="button" accessibilityLabel={t('runtime.retryA11y')} onPress={()=>void check()} style={styles.gateButton}><Text style={styles.gateButtonText}>{t('common.retry')}</Text></Pressable></View>;
  if(state.maintenance||state.forceUpdate){const url=Platform.OS==='ios'?env.iosAppUrl:env.androidAppUrl;return <View style={styles.gate}><View style={styles.gateIcon}><AppIcon name={state.forceUpdate?'refresh':'paw'} size={30} color={theme.colors.primary}/></View><Text style={styles.gateTitle}>{state.forceUpdate?t('runtime.updateTitle'):t('runtime.maintenanceTitle')}</Text><Text style={styles.gateBody}>{state.message??(state.forceUpdate?t('runtime.updateBody'):t('runtime.maintenanceBody'))}</Text>{state.forceUpdate&&url?<Pressable accessibilityRole="button" onPress={()=>void openStore(url)} style={styles.gateButton}><Text style={styles.gateButtonText}>{t('runtime.updateStore')}</Text></Pressable>:<Pressable accessibilityRole="button" onPress={()=>void check()} style={styles.gateButton}><Text style={styles.gateButtonText}>{t('common.retry')}</Text></Pressable>}</View>}
  return <>{children}</>;
}
function AuthenticatedApp(){const {theme,styles}=useThemedStyles(createStyles);const {t}=useI18n();const {status,paused,suspended,error,refresh}=useAccountState();if(status==='loading')return <View style={styles.gate}><ActivityIndicator color={theme.colors.primary}/></View>;if(status==='error')return <View style={styles.gate}><View style={styles.gateIcon}><AppIcon name="warning" size={30} color={theme.colors.danger}/></View><Text style={styles.gateTitle}>{t('paused.verifyTitle')}</Text><Text style={styles.gateBody}>{error||t('paused.verifyBody')}</Text><Pressable accessibilityRole="button" accessibilityLabel={t('common.retry')} onPress={()=>void refresh()} style={styles.gateButton}><Text style={styles.gateButtonText}>{t('common.retry')}</Text></Pressable></View>;if(suspended)return <SuspendedAccountScreen/>;if(paused)return <PausedAccountScreen/>;return <AppDataProvider><AppNavigator/></AppDataProvider>}
function Root(){const {theme,styles}=useThemedStyles(createStyles);const {t}=useI18n();const {loading,bootstrapStatus,session,demoMode,recoveryMode,retryBootstrap,mfaStatus,refreshMfaRequirement}=useAuth();useEffect(()=>{if(!session||demoMode)return;return startFramePerformanceTelemetry()},[session?.user.id,demoMode]);if(loading)return <View style={styles.gate}><ActivityIndicator color={theme.colors.primary}/></View>;if(bootstrapStatus==='error')return <View style={styles.gate}><View style={styles.gateIcon}><AppIcon name="warning" size={30} color={theme.colors.danger}/></View><Text style={styles.gateTitle}>{t('root.connectionTitle')}</Text><Text style={styles.gateBody}>{t('root.connectionBody')}</Text><Pressable accessibilityRole="button" accessibilityLabel={t('root.retrySessionA11y')} onPress={()=>void retryBootstrap()} style={styles.gateButton}><Text style={styles.gateButtonText}>{t('common.retry')}</Text></Pressable></View>;if(!isBackendConfigured&&!isDemoEnabled)return <View style={styles.gate}><View style={styles.gateIcon}><AppIcon name="warning" size={30} color={theme.colors.danger}/></View><Text style={styles.gateTitle}>{t('root.unconfiguredTitle')}</Text><Text style={styles.gateBody}>{t('root.unconfiguredBody')}</Text></View>;if(recoveryMode&&session)return <ResetPasswordScreen/>;if(!session&&!demoMode)return <AuthScreen/>;if(session&&mfaStatus==='checking')return <View style={styles.gate}><ActivityIndicator color={theme.colors.primary}/></View>;if(session&&mfaStatus==='error')return <View style={styles.gate}><View style={styles.gateIcon}><AppIcon name="warning" size={30} color={theme.colors.danger}/></View><Text style={styles.gateTitle}>{t('mfa.checkFailedTitle')}</Text><Text style={styles.gateBody}>{t('mfa.checkFailedBody')}</Text><Pressable accessibilityRole="button" onPress={()=>void refreshMfaRequirement()} style={styles.gateButton}><Text style={styles.gateButtonText}>{t('common.retry')}</Text></Pressable></View>;if(session&&mfaStatus==='required')return <MfaChallengeScreen onVerified={refreshMfaRequirement}/>;return <AccountStateProvider key={session?.user.id??'demo'}><AuthenticatedApp/></AccountStateProvider>}
function LocalizedAppShell(){const theme=useTheme();const {rtl}=useI18n();return <View style={{flex:1,direction:rtl?'rtl':'ltr'}}><StatusBar style={theme.mode==='dark'?'light':'dark'}/><AppErrorBoundary><RuntimeGate><AuthProvider><Root/></AuthProvider></RuntimeGate></AppErrorBoundary></View>}
function App(){useEffect(()=>startImageMemoryGuard(),[]);return <SafeAreaProvider><I18nProvider><LocalizedAppShell/></I18nProvider></SafeAreaProvider>}
export default wrapRootWithCrashReporting(App);
const createStyles=(theme:AppTheme)=>StyleSheet.create({gate:{flex:1,alignItems:'center',justifyContent:'center',padding:28,backgroundColor:theme.colors.background},gateIcon:{width:64,height:64,borderRadius:22,backgroundColor:theme.colors.primarySoft,alignItems:'center',justifyContent:'center'},gateTitle:{marginTop:18,...theme.type.h1,color:theme.colors.text,textAlign:'center'},gateBody:{marginTop:8,...theme.type.body,color:theme.colors.muted,textAlign:'center',maxWidth:340},gateButton:{marginTop:20,minHeight:50,paddingHorizontal:20,borderRadius:25,backgroundColor:theme.colors.primary,alignItems:'center',justifyContent:'center'},gateButtonText:{color:theme.colors.onPrimary,fontWeight:'900'}});
