import { openSafeExternalHttpsUrl, requireSafeExternalHttpsUrl } from './externalLinks';

/** User-facing legal/support links share the same public HTTPS boundary as every external destination. */
export function requireSafeLegalHttpsUrl(input:string):string{
  try{return requireSafeExternalHttpsUrl(input)}catch{throw new Error('legal_link_untrusted')}
}

export async function openLegalHttpsUrl(input:string):Promise<void>{
  await openSafeExternalHttpsUrl(requireSafeLegalHttpsUrl(input));
}
