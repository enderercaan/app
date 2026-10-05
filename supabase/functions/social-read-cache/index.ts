import { corsHeaders, json } from '../_shared/cors.ts';
import { authenticatedUser, userClientForToken } from '../_shared/client.ts';
import { redisCacheKey, redisGetJson, redisSetJson } from '../_shared/redisCache.ts';
import { readRequestJsonBounded } from '../_shared/http.ts';

type Cursor={snapshotAt?:string|null;rankScore?:number|null;createdAt?:string|null;id?:string|null};
type FeedRequest={surface:'feed';petId:string;mode:'for_you'|'following'|'local';limit?:number;cursor?:Cursor|null};
type ReelsRequest={surface:'reels';petId:string;limit?:number;cursor?:Cursor|null};
type DiscoveryRequest={surface:'discover';petId:string;filters:Record<string,unknown>};
type SocialReadRequest=FeedRequest|ReelsRequest|DiscoveryRequest;
type CompactPage={snapshotAt:string;items:Array<{id:string;rankScore:number;createdAt:string}>};
type CompactDiscovery={items:Array<{id:string}>};

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FEED_TTL_SECONDS=12;
const REELS_TTL_SECONDS=12;
const DISCOVERY_TTL_SECONDS=6;

function intLimit(value:unknown,fallback:number,max:number){
  const n=Number(value??fallback);
  if(!Number.isInteger(n)||n<1||n>max)throw new Error('invalid_limit');
  return n;
}

function canonical(value:unknown):unknown{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
  return value;
}

function isDefaultDiscoveryFilters(filters:Record<string,unknown>){
  const expected:Record<string,unknown>={
    species:'all',breeds:[],sex:'all',sizes:[],minAge:null,maxAge:null,minWeightKg:null,maxWeightKg:null,
    energyLevels:[],temperamentTags:[],neutered:'all',city:null,district:null,neighborhood:null,maxDistanceKm:null,purposes:[],
    vaccinatedOnly:false,profileVerifiedOnly:false,ownerVerifiedOnly:false,microchipVerifiedOnly:false,
    geneticScreeningOnly:false,pedigreeOnly:false,matingOnlyNonNeutered:true
  };
  return JSON.stringify(canonical(filters))===JSON.stringify(canonical(expected));
}

function compactPage(page:any):CompactPage{
  if(!page||typeof page.snapshotAt!=='string'||!Array.isArray(page.items))throw new Error('social_read_invalid_page');
  return {snapshotAt:page.snapshotAt,items:page.items.map((item:any)=>{
    if(!UUID_RE.test(String(item?.id??''))||typeof item?.rankScore!=='number'||!Number.isFinite(item.rankScore)||typeof item?.createdAt!=='string')throw new Error('social_read_invalid_page');
    return {id:String(item.id),rankScore:item.rankScore,createdAt:item.createdAt};
  })};
}

function compactDiscovery(rows:any):CompactDiscovery{
  if(!Array.isArray(rows))throw new Error('social_read_invalid_discovery');
  return {items:rows.map((item:any)=>{
    if(!UUID_RE.test(String(item?.id??'')))throw new Error('social_read_invalid_discovery');
    return {id:String(item.id)};
  })};
}


async function cacheRead<T>(key:string):Promise<T|null>{
  try{return await redisGetJson<T>(key)}catch{return null}
}
async function cacheWrite(key:string,value:unknown,ttl:number){
  try{await redisSetJson(key,value,ttl)}catch{/* Cache acceleration is deliberately fail-open. */}
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  try{
    const {user,token}=await authenticatedUser(req);
    const body=await readRequestJsonBounded<SocialReadRequest>(req,32_000);
    if(!body||!UUID_RE.test(String(body.petId??'')))return json({error:'invalid_request'},400);
    const client=userClientForToken(token);

    if(body.surface==='feed'){
      if(!['for_you','following','local'].includes(body.mode))return json({error:'invalid_request'},400);
      const limit=intLimit(body.limit,20,50);
      const cursor=body.cursor??null;
      const key=await redisCacheKey('feed',{user:user.id,pet:body.petId,mode:body.mode,limit,cursor:canonical(cursor)});
      const cached=await cacheRead<CompactPage>(key);
      if(cached){
        const {data,error}=await client.rpc('rehydrate_cached_feed_page',{p_pet_id:body.petId,p_mode:body.mode,p_snapshot_at:cached.snapshotAt,p_cached_items:cached.items});
        if(!error&&data)return json({data,cache:'hit'});
      }
      const {data,error}=await client.rpc('get_feed_page',{p_pet_id:body.petId,p_mode:body.mode,p_limit:limit,p_snapshot_at:cursor?.snapshotAt??null,p_before_rank:cursor?.rankScore??null,p_before_created_at:cursor?.createdAt??null,p_before_id:cursor?.id??null});
      if(error)throw error;
      const compact=compactPage(data);
      await cacheWrite(key,compact,FEED_TTL_SECONDS);
      return json({data,cache:'miss'});
    }

    if(body.surface==='reels'){
      const limit=intLimit(body.limit,12,30);
      const cursor=body.cursor??null;
      const key=await redisCacheKey('reels',{user:user.id,pet:body.petId,limit,cursor:canonical(cursor)});
      const cached=await cacheRead<CompactPage>(key);
      if(cached){
        const {data,error}=await client.rpc('rehydrate_cached_reels_page',{p_pet_id:body.petId,p_snapshot_at:cached.snapshotAt,p_cached_items:cached.items});
        if(!error&&data)return json({data,cache:'hit'});
      }
      const {data,error}=await client.rpc('get_reels_page',{p_pet_id:body.petId,p_limit:limit,p_snapshot_at:cursor?.snapshotAt??null,p_before_rank:cursor?.rankScore??null,p_before_created_at:cursor?.createdAt??null,p_before_id:cursor?.id??null});
      if(error)throw error;
      const compact=compactPage(data);
      await cacheWrite(key,compact,REELS_TTL_SECONDS);
      return json({data,cache:'miss'});
    }

    if(body.surface==='discover'){
      const filters=body.filters&&typeof body.filters==='object'&&!Array.isArray(body.filters)?body.filters:{};
      if(!isDefaultDiscoveryFilters(filters)){
        const {data,error}=await client.rpc('discover_pets',{p_active_pet_id:body.petId,p_filters:filters});
        if(error)throw error;
        return json({data,cache:'bypass'});
      }
      const key=await redisCacheKey('discover-default',{user:user.id,pet:body.petId});
      const cached=await cacheRead<CompactDiscovery>(key);
      if(cached){
        const {data,error}=await client.rpc('rehydrate_cached_default_discovery',{p_active_pet_id:body.petId,p_cached_items:cached.items});
        if(!error&&data)return json({data,cache:'hit'});
      }
      const {data,error}=await client.rpc('discover_pets',{p_active_pet_id:body.petId,p_filters:filters});
      if(error)throw error;
      const compact=compactDiscovery(data);
      await cacheWrite(key,compact,DISCOVERY_TTL_SECONDS);
      return json({data,cache:'miss'});
    }

    return json({error:'invalid_request'},400);
  }catch(error){
    const code=error instanceof Error?error.message:String(error);
    if(code==='Unauthorized')return json({error:'unauthorized'},401);
    if(code==='redis_cache_config_invalid')return json({error:'redis_cache_config_invalid'},503);
    return json({error:'social_read_failed'},500);
  }
});
