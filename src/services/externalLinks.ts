import { Linking } from 'react-native';

function unsafeHost(hostname:string){
  const h=hostname.trim().toLowerCase().replace(/\.$/,'');
  if(!h||h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local'))return true;
  if(/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h)||h.includes(':'))return true;
  return !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/.test(h);
}

export function requireSafeExternalHttpsUrl(input:string){
  const raw=input.trim();
  if(!raw||/[\u0000-\u001F\u007F]/.test(raw))throw new Error('external_link_invalid');
  let parsed:URL;
  try{parsed=new URL(raw)}catch{throw new Error('external_link_invalid')}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||unsafeHost(parsed.hostname))throw new Error('external_link_untrusted');
  return parsed.toString();
}

export async function openSafeExternalHttpsUrl(input:string){
  const url=requireSafeExternalHttpsUrl(input);
  const supported=await Linking.canOpenURL(url).catch(()=>false);
  if(!supported)throw new Error('external_link_unsupported');
  await Linking.openURL(url);
}
