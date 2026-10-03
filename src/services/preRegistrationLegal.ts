import {supabase} from './supabase';
import type {PreRegistrationLegalPresentation,PreRegistrationSubnationalOptions} from '../types/domain';
import type {AppLocale} from '../i18n';
import type {LegalMarketCountryCode} from '../data/legalMarkets';

export async function getPreRegistrationLegalPresentation(countryCode:LegalMarketCountryCode,uiLocale:AppLocale,subnationalCode?:string|null){
  const {data,error}=await supabase.rpc('get_pre_registration_legal_presentation',{p_declared_country_code:countryCode,p_ui_locale:uiLocale,p_declared_subnational_code:subnationalCode??null});
  if(error)throw error;
  return data as PreRegistrationLegalPresentation;
}

export async function getPreRegistrationSubnationalOptions(countryCode:LegalMarketCountryCode,uiLocale:AppLocale){
  const {data,error}=await supabase.rpc('get_pre_registration_subnational_options',{p_declared_country_code:countryCode,p_ui_locale:uiLocale});
  if(error)throw error;
  const value=data as PreRegistrationSubnationalOptions;
  return {...value,options:Array.isArray(value?.options)?value.options:[]};
}
