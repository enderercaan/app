import { fetchWithTimeout, readResponseJsonBounded } from './http.ts';
const REDIS_TIMEOUT_MS=1_500;

type RedisConfig={url:string;token:string};

type RedisReply={result?:unknown;error?:string};

function normalizedConfig():RedisConfig|null{
  const rawUrl=(Deno.env.get('UPSTASH_REDIS_REST_URL')??'').trim();
  const token=(Deno.env.get('UPSTASH_REDIS_REST_TOKEN')??'').trim();
  if(!rawUrl&&!token)return null;
  if(!rawUrl||!token)throw new Error('redis_cache_config_invalid');
  let parsed:URL;
  try{parsed=new URL(rawUrl)}catch{throw new Error('redis_cache_config_invalid')}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash||(parsed.port&&parsed.port!=='443'))throw new Error('redis_cache_config_invalid');
  const cleanPath=parsed.pathname.replace(/\/+$/,'');
  if(cleanPath&&cleanPath!=='/')throw new Error('redis_cache_config_invalid');
  return {url:parsed.origin,token};
}

async function command(config:RedisConfig,args:Array<string|number>):Promise<unknown>{
  const response=await fetchWithTimeout(config.url,{
    method:'POST',
    redirect:'error',
    headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},
    body:JSON.stringify(args)
  },REDIS_TIMEOUT_MS);
  if(!response.ok)throw new Error('redis_cache_unavailable');
  const payload=await readResponseJsonBounded<RedisReply>(response,128_000);
  if(payload.error)throw new Error('redis_cache_unavailable');
  return payload.result;
}

export function redisCacheConfigured(){return normalizedConfig()!==null}

export async function redisCacheKey(namespace:string,parts:unknown){
  const bytes=new TextEncoder().encode(`${namespace}:v1:${JSON.stringify(parts)}`);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  const hex=Array.from(new Uint8Array(digest)).map(value=>value.toString(16).padStart(2,'0')).join('');
  return `tailmance:${namespace}:v1:${hex}`;
}

export async function redisGetJson<T>(key:string):Promise<T|null>{
  const config=normalizedConfig();
  if(!config)return null;
  const result=await command(config,['GET',key]);
  if(typeof result!=='string'||!result)return null;
  try{return JSON.parse(result) as T}catch{throw new Error('redis_cache_corrupt')}
}

export async function redisSetJson(key:string,value:unknown,ttlSeconds:number){
  const config=normalizedConfig();
  if(!config)return false;
  if(!Number.isInteger(ttlSeconds)||ttlSeconds<1||ttlSeconds>300)throw new Error('redis_cache_ttl_invalid');
  const serialized=JSON.stringify(value);
  if(new TextEncoder().encode(serialized).byteLength>96_000)throw new Error('redis_cache_value_too_large');
  await command(config,['SET',key,serialized,'EX',ttlSeconds]);
  return true;
}
