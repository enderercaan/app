import { env } from './config';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CUSTOM_SCHEMES=new Set(['tailmance:']);
const APP_LINK_HOST=/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
type TailmanceDeepLinkTarget={kind:'pet'|'reel'|'story';id:string};

function normalizedAppLinkHost(){
  const host=env.appLinkHost.trim().toLowerCase();
  return APP_LINK_HOST.test(host)?host:'';
}

function targetFromParts(kind:string,id:string):TailmanceDeepLinkTarget|null{
  if(!['pet','reel','story'].includes(kind)||!UUID.test(id))return null;
  return {kind:kind as TailmanceDeepLinkTarget['kind'],id:id.toLowerCase()};
}

export function parseTailmanceDeepLink(raw:string):TailmanceDeepLinkTarget|null{
  try{
    const parsed=new URL(raw);
    if(parsed.username||parsed.password||parsed.port||parsed.hash||parsed.search)return null;
    if(CUSTOM_SCHEMES.has(parsed.protocol)){
      const kind=parsed.hostname.toLowerCase();
      const id=parsed.pathname.replace(/^\/+|\/+$/g,'');
      return targetFromParts(kind,id);
    }
    if(parsed.protocol!=='https:')return null;
    const host=normalizedAppLinkHost();
    if(!host||parsed.hostname.toLowerCase()!==host)return null;
    const match=parsed.pathname.match(/^\/(pet|reel|story)\/([^/]+)\/?$/i);
    if(!match)return null;
    const kind=match[1];const id=match[2];
    if(!kind||!id)return null;
    return targetFromParts(kind.toLowerCase(),id);
  }catch{return null;}
}

export function parsePetProfileDeepLink(raw:string):string|null{
  const target=parseTailmanceDeepLink(raw);
  return target?.kind==='pet'?target.id:null;
}

function universalUrl(kind:TailmanceDeepLinkTarget['kind'],id:string):string|null{
  if(!UUID.test(id))return null;
  const host=normalizedAppLinkHost();
  return host?`https://${host}/${kind}/${id.toLowerCase()}`:null;
}

export const petProfileUniversalUrl=(petId:string)=>universalUrl('pet',petId);
export const reelUniversalUrl=(reelId:string)=>universalUrl('reel',reelId);
export const storyUniversalUrl=(storyId:string)=>universalUrl('story',storyId);
