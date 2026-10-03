import { Platform } from 'react-native';
import { env } from './config';
import { openSafeExternalHttpsUrl } from './externalLinks';

function storeUrl(){
  if(Platform.OS==='ios')return env.iosAppUrl;
  if(Platform.OS==='android')return env.androidAppUrl;
  return '';
}

export async function openStoreRating(){
  const url=storeUrl();
  if(!url)return false;
  try{await openSafeExternalHttpsUrl(url);return true}catch{return false}
}
