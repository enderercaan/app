import type {AppLocale} from '../i18n';

export const LEGAL_MARKET_COUNTRY_CODES=['AE','AT','AU','BE','BR','CA','CN','DE','ES','FR','GB','ID','IE','IN','IT','JP','KR','NL','PL','RU','SA','SG','TH','TR','TW','US','VN'] as const;
export type LegalMarketCountryCode=typeof LEGAL_MARKET_COUNTRY_CODES[number];

export function legalMarketCountryName(code:LegalMarketCountryCode,locale:AppLocale){
  try{return new Intl.DisplayNames([locale],{type:'region'}).of(code)??code}catch{return code}
}
