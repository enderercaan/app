import type { MeasurementSystem } from '../types/domain';

const FALLBACK_LOCALE='en-US';

export const deviceLocale=(()=>{
  try{return Intl.DateTimeFormat().resolvedOptions().locale||FALLBACK_LOCALE}catch{return FALLBACK_LOCALE}
})();

let formattingLocale=deviceLocale;

export function setFormattingLocale(locale:string){
  formattingLocale=locale||FALLBACK_LOCALE;
}

export function nativePickerLocale(locale:string=formattingLocale){return (locale||FALLBACK_LOCALE).replace(/-/g,'_')}

export function uses24HourClock(locale:string=formattingLocale){
  try{
    const cycle=Intl.DateTimeFormat(locale||FALLBACK_LOCALE,{hour:'numeric'}).resolvedOptions().hourCycle;
    return cycle==='h23'||cycle==='h24';
  }catch{return false}
}

export function formatDate(value:Date|string|number,options:Intl.DateTimeFormatOptions={dateStyle:'medium'},locale:string=formattingLocale){
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime()))return '';
  try{return new Intl.DateTimeFormat(locale||FALLBACK_LOCALE,options).format(date)}catch{return new Intl.DateTimeFormat(FALLBACK_LOCALE,options).format(date)}
}

export function formatTime(value:Date|string|number,options:Intl.DateTimeFormatOptions={hour:'2-digit',minute:'2-digit'},locale:string=formattingLocale){
  return formatDate(value,options,locale);
}

export function formatDateTime(value:Date|string|number,options:Intl.DateTimeFormatOptions={dateStyle:'medium',timeStyle:'short'},locale:string=formattingLocale){
  return formatDate(value,options,locale);
}

function formatNumber(value:number,options:Intl.NumberFormatOptions={},locale:string=formattingLocale){
  if(!Number.isFinite(value))return '';
  try{return new Intl.NumberFormat(locale||FALLBACK_LOCALE,options).format(value)}catch{return new Intl.NumberFormat(FALLBACK_LOCALE,options).format(value)}
}

export function formatUnit(value:number,unit:Intl.NumberFormatOptions['unit'],options:Omit<Intl.NumberFormatOptions,'style'|'unit'>={},locale:string=formattingLocale){
  if(!Number.isFinite(value))return '';
  try{return new Intl.NumberFormat(locale||FALLBACK_LOCALE,{...options,style:'unit',unit}).format(value)}catch{return `${formatNumber(value,options,locale)} ${unit??''}`.trim()}
}

export function defaultMeasurementSystem(locale:string=deviceLocale):MeasurementSystem{
  try{
    const region=new Intl.Locale(locale||FALLBACK_LOCALE).region?.toUpperCase();
    return region==='US'||region==='LR'||region==='MM'?'imperial':'metric';
  }catch{return 'metric'}
}
export function kmToMiles(km:number){return km*0.6213711922}
export function milesToKm(miles:number){return miles/0.6213711922}
export function kgToPounds(kg:number){return kg*2.2046226218}
export function poundsToKg(pounds:number){return pounds/2.2046226218}
export function displayDistanceValue(km:number,system:MeasurementSystem){return system==='imperial'?kmToMiles(km):km}
export function canonicalDistanceKm(value:number,system:MeasurementSystem){return system==='imperial'?milesToKm(value):value}
export function displayWeightValue(kg:number,system:MeasurementSystem){return system==='imperial'?kgToPounds(kg):kg}
export function canonicalWeightKg(value:number,system:MeasurementSystem){return system==='imperial'?poundsToKg(value):value}
export function formatDistance(km:number,system:MeasurementSystem,locale:string=formattingLocale){
  const value=displayDistanceValue(km,system);
  return formatUnit(value,system==='imperial'?'mile':'kilometer',{maximumFractionDigits:1},locale);
}
export function formatWeight(kg:number,system:MeasurementSystem,locale:string=formattingLocale){
  const value=displayWeightValue(kg,system);
  return formatUnit(value,system==='imperial'?'pound':'kilogram',{maximumFractionDigits:1},locale);
}

