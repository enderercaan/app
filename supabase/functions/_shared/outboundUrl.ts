function normalizeHost(hostname:string){
  return hostname.trim().toLowerCase().replace(/\.$/,'');
}

function isUnsafeLiteralOrLocalHost(hostname:string){
  const h=normalizeHost(hostname);
  if(!h||h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local'))return true;
  // Production integrations must use stable DNS hostnames, not literal IPs. Exact host
  // allowlists are still required; this also avoids accidental RFC1918/link-local SSRF targets.
  if(/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h))return true;
  if(h.includes(':')||h.startsWith('[')||h.endsWith(']'))return true;
  return !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/.test(h);
}

export function parseExactHostAllowlist(raw:string|undefined|null, errorCode='outbound_host_allowlist_invalid'){
  if(!raw)throw new Error(errorCode);
  let parsed:unknown;
  try{parsed=JSON.parse(raw)}catch{throw new Error(errorCode)}
  if(!Array.isArray(parsed)||parsed.length<1||parsed.length>32)throw new Error(errorCode);
  const hosts=new Set<string>();
  for(const item of parsed){
    if(typeof item!=='string')throw new Error(errorCode);
    const host=normalizeHost(item);
    if(isUnsafeLiteralOrLocalHost(host)||host.includes('*')||host.includes('/')||host.includes('@'))throw new Error(errorCode);
    hosts.add(host);
  }
  if(!hosts.size)throw new Error(errorCode);
  return hosts;
}

export function requireAllowlistedHttpsUrl(
  raw:string|undefined|null,
  allowlistRaw:string|undefined|null,
  options:{allowQuery?:boolean;allowFragment?:boolean;errorCode?:string}={}
){
  const errorCode=options.errorCode??'outbound_url_invalid';
  if(!raw)throw new Error(errorCode);
  let parsed:URL;
  try{parsed=new URL(raw)}catch{throw new Error(errorCode)}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw new Error(errorCode);
  if(parsed.port&&parsed.port!=='443')throw new Error(errorCode);
  const host=normalizeHost(parsed.hostname);
  if(isUnsafeLiteralOrLocalHost(host))throw new Error(errorCode);
  const allowed=parseExactHostAllowlist(allowlistRaw,`${errorCode}_allowlist`);
  if(!allowed.has(host))throw new Error(errorCode);
  if(options.allowQuery!==true&&parsed.search)throw new Error(errorCode);
  if(options.allowFragment!==true&&parsed.hash)throw new Error(errorCode);
  return parsed;
}
