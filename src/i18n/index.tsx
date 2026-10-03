import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { I18nManager } from 'react-native';
import { secureStorage } from '../services/secureStorage';
import { defaultMeasurementSystem, deviceLocale, setFormattingLocale } from '../services/locale';
import type { MeasurementSystem } from '../types/domain';
import { syncPreferredLocale } from '../services/localePreference';

export const SUPPORTED_LOCALES = ['en','es','pt-BR','fr','de','it','ru','tr','ar','hi','id','ja','ko','zh-Hans','zh-Hant','nl','pl','th','vi'] as const;
export type AppLocale = typeof SUPPORTED_LOCALES[number];
export const RELEASE_READY_LOCALES: readonly AppLocale[] = ['en','es','pt-BR','fr','de','it','ru','tr','ar','hi','id','ja','ko','zh-Hans','zh-Hant','nl','pl','th','vi'];
export const FALLBACK_ONLY_LOCALES: readonly AppLocale[] = [];
export const DEFAULT_RELEASE_LOCALE:AppLocale='en';
export const RTL_LOCALES: readonly AppLocale[] = ['ar'];
const LOCALE_NATIVE_NAMES:Record<AppLocale,string>={
  en:'English',es:'Español','pt-BR':'Português (Brasil)',fr:'Français',de:'Deutsch',it:'Italiano',ru:'Русский',tr:'Türkçe',ar:'العربية',hi:'हिन्दी',id:'Bahasa Indonesia',ja:'日本語',ko:'한국어','zh-Hans':'简体中文','zh-Hant':'繁體中文',nl:'Nederlands',pl:'Polski',th:'ไทย',vi:'Tiếng Việt'
};
export function getLocaleNativeName(locale:AppLocale){return LOCALE_NATIVE_NAMES[locale]??locale}
const LEGAL_DOCUMENT_LOCALE_NATIVE_NAMES:Record<string,string>={...LOCALE_NATIVE_NAMES,ca:'Català',eu:'Euskara',gl:'Galego'};
const CONFIGURED_COUNTRY_ENGLISH_NAMES:Record<string,string>={AE:'United Arab Emirates',AT:'Austria',AU:'Australia',BE:'Belgium',BR:'Brazil',CA:'Canada',CN:'China',DE:'Germany',ES:'Spain',FR:'France',GB:'United Kingdom',ID:'Indonesia',IE:'Ireland',IN:'India',IT:'Italy',JP:'Japan',KR:'South Korea',NL:'Netherlands',PL:'Poland',RU:'Russia',SA:'Saudi Arabia',SG:'Singapore',TH:'Thailand',TR:'Türkiye',TW:'Taiwan',US:'United States',VN:'Vietnam'};
export function getLegalDocumentLocaleDisplayName(locale?:string|null){const key=(locale??'').trim();return LEGAL_DOCUMENT_LOCALE_NATIVE_NAMES[key]??key}
export function getLegalCountryDisplayName(countryCode:string|undefined|null,locale:AppLocale){const code=(countryCode??'').trim().toUpperCase();if(!code)return '';try{const DisplayNames=(Intl as unknown as {DisplayNames?:new(locales:string[],options:{type:'region'})=>{of:(code:string)=>string|undefined}}).DisplayNames;const value=DisplayNames?new DisplayNames([locale],{type:'region'}).of(code):undefined;if(value&&value!==code)return value}catch(error){void error}return CONFIGURED_COUNTRY_ENGLISH_NAMES[code]??code}

const STORAGE_KEY='tailmance.locale.v1';
const MEASUREMENT_STORAGE_KEY='tailmance.measurement-system.v1';
let runtimeLocale:AppLocale=DEFAULT_RELEASE_LOCALE;
export function getRuntimeLocale(){return runtimeLocale}

import type { Vars, Messages } from './types';
import en from './locales/en';
import es from './locales/es';
import ptBR from './locales/pt-BR';
import fr from './locales/fr';
import de from './locales/de';
import it from './locales/it';
import ru from './locales/ru';
import tr from './locales/tr';
import ar from './locales/ar';
import hi from './locales/hi';
import id from './locales/id';
import ja from './locales/ja';
import ko from './locales/ko';
import zhHans from './locales/zh-Hans';
import zhHant from './locales/zh-Hant';
import nl from './locales/nl';
import pl from './locales/pl';
import th from './locales/th';
import vi from './locales/vi';

const DICTIONARIES:Record<AppLocale,Messages>={en,es,'pt-BR':ptBR,fr,de,it,ru,tr,ar,hi,id,ja,ko,'zh-Hans':zhHans,'zh-Hant':zhHant,nl,pl,th,vi};

function normalizeLocale(raw?:string|null):AppLocale{
  const candidate=(raw||'').replace('_','-');
  const exact=SUPPORTED_LOCALES.find(x=>x.toLowerCase()===candidate.toLowerCase()); if(exact)return exact;
  const language=candidate.split('-')[0]?.toLowerCase();
  if(language==='pt')return 'pt-BR'; if(language==='zh')return /tw|hk|hant/i.test(candidate)?'zh-Hant':'zh-Hans';
  const simple=SUPPORTED_LOCALES.find(x=>x.toLowerCase()===language); return simple||'en';
}
function releaseLocale(raw:string):AppLocale{const normalized=normalizeLocale(raw);return RELEASE_READY_LOCALES.includes(normalized)?normalized:DEFAULT_RELEASE_LOCALE}
function interpolate(value:string,vars?:Vars){return value.replace(/\{(\w+)\}/g,(_,key)=>String(vars?.[key]??`{${key}}`))}
function pluralKey(locale:AppLocale,key:string,vars?:Vars){const count=vars?.count;if(typeof count!=='number'||!Number.isFinite(count))return null;try{return `${key}.${new Intl.PluralRules(locale).select(count)}`}catch{return count===1?`${key}.one`:`${key}.other`}}
export function translate(locale:AppLocale,key:string,vars?:Vars){const pk=pluralKey(locale,key,vars);const value=(pk?DICTIONARIES[locale][pk]:undefined)??DICTIONARIES[locale][key]??(pk?en[pk]:undefined)??en[key]??key;return interpolate(value,vars)}
export function isRTL(locale:AppLocale){return RTL_LOCALES.includes(locale)}

type I18nValue={locale:AppLocale;rtl:boolean;measurementSystem:MeasurementSystem;t:(key:string,vars?:Vars)=>string;setLocale:(locale:AppLocale)=>Promise<void>;setMeasurementSystem:(system:MeasurementSystem)=>Promise<void>;supported:readonly AppLocale[];releaseReady:readonly AppLocale[]};
const I18nContext=createContext<I18nValue>({locale:DEFAULT_RELEASE_LOCALE,rtl:false,measurementSystem:defaultMeasurementSystem(deviceLocale),t:(key,vars)=>translate(DEFAULT_RELEASE_LOCALE,key,vars),setLocale:async()=>{},setMeasurementSystem:async()=>{},supported:SUPPORTED_LOCALES,releaseReady:RELEASE_READY_LOCALES});
export function I18nProvider({children}:{children:React.ReactNode}){
  const [locale,setLocaleState]=useState<AppLocale>(()=>{const initial=releaseLocale(deviceLocale);runtimeLocale=initial;setFormattingLocale(initial);return initial});
  const [measurementSystem,setMeasurementSystemState]=useState<MeasurementSystem>(()=>defaultMeasurementSystem(deviceLocale));
  const localeWriteSeq=useRef(0); const measurementWriteSeq=useRef(0);
  const localeWriteQueue=useRef<Promise<void>>(Promise.resolve()); const measurementWriteQueue=useRef<Promise<void>>(Promise.resolve());
  useEffect(()=>{
    const localeSeq=localeWriteSeq.current; const measurementSeq=measurementWriteSeq.current;
    void secureStorage.getItem(STORAGE_KEY).then(v=>{if(localeSeq===localeWriteSeq.current&&v)setLocaleState(releaseLocale(v))}).catch(()=>undefined);
    void secureStorage.getItem(MEASUREMENT_STORAGE_KEY).then(v=>{if(measurementSeq===measurementWriteSeq.current&&(v==='metric'||v==='imperial'))setMeasurementSystemState(v)}).catch(()=>undefined);
  },[]);
  useEffect(()=>{runtimeLocale=locale;setFormattingLocale(locale);I18nManager.allowRTL(true);const desired=isRTL(locale);if(I18nManager.isRTL!==desired)I18nManager.forceRTL(desired);void syncPreferredLocale(locale).catch(()=>undefined)},[locale]);
  const setLocale=useCallback(async(next:AppLocale)=>{
    const safe=RELEASE_READY_LOCALES.includes(next)?next:DEFAULT_RELEASE_LOCALE; const seq=++localeWriteSeq.current;
    const write=localeWriteQueue.current.catch(()=>undefined).then(()=>secureStorage.setItem(STORAGE_KEY,safe)); localeWriteQueue.current=write;
    await write; if(seq===localeWriteSeq.current)setLocaleState(safe);
  },[]);
  const setMeasurementSystem=useCallback(async(next:MeasurementSystem)=>{
    const safe:MeasurementSystem=next==='imperial'?'imperial':'metric'; const seq=++measurementWriteSeq.current;
    const write=measurementWriteQueue.current.catch(()=>undefined).then(()=>secureStorage.setItem(MEASUREMENT_STORAGE_KEY,safe)); measurementWriteQueue.current=write;
    await write; if(seq===measurementWriteSeq.current)setMeasurementSystemState(safe);
  },[]);
  const t=useCallback((key:string,vars?:Vars)=>translate(locale,key,vars),[locale]);
  const value=useMemo(()=>({locale,rtl:isRTL(locale),measurementSystem,t,setLocale,setMeasurementSystem,supported:SUPPORTED_LOCALES,releaseReady:RELEASE_READY_LOCALES}),[locale,measurementSystem,t,setLocale,setMeasurementSystem]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
export function useI18n(){return useContext(I18nContext)}
