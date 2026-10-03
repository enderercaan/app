import { RoomServiceClient } from 'npm:livekit-server-sdk@2.19.1';
import { adminClient } from '../_shared/client.ts';
import { json } from '../_shared/cors.ts';
import { verifyBearerSecret } from '../_shared/secretAuth.ts';
import { markWorkerHeartbeat } from '../_shared/workerHeartbeat.ts';

type TeardownRow={call_id:string;room_name:string;attempts:number};

function liveKitAdminConfig(){
  const raw=(Deno.env.get('LIVEKIT_URL')??'').trim();
  const apiKey=(Deno.env.get('LIVEKIT_API_KEY')??'').trim();
  const apiSecret=(Deno.env.get('LIVEKIT_API_SECRET')??'').trim();
  if(!raw||!apiKey||!apiSecret)throw new Error('livekit_not_configured');
  let parsed:URL;
  try{parsed=new URL(raw)}catch{throw new Error('livekit_config_invalid')}
  if(!['wss:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.search||parsed.hash||(parsed.port&&parsed.port!=='443'))throw new Error('livekit_config_invalid');
  const protocol=parsed.protocol==='wss:'?'https:':parsed.protocol;
  const host=`${protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/,'')}`;
  return {host,apiKey,apiSecret};
}

function retryDelaySeconds(attempts:number){
  const safe=Math.min(Math.max(Number.isInteger(attempts)?attempts:0,0),10);
  return Math.min(21600,30*(2**safe));
}

Deno.serve(async(req)=>{
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  const secret=Deno.env.get('LIVEKIT_ROOM_REAPER_SECRET');
  if(!verifyBearerSecret(req.headers.get('Authorization'),secret,32))return json({error:'Unauthorized'},401);
  try{
    const cfg=liveKitAdminConfig();
    const rooms=new RoomServiceClient(cfg.host,cfg.apiKey,cfg.apiSecret);
    const supabase=adminClient();
    await markWorkerHeartbeat(supabase,'livekit-room-reaper','started');
    const {error:expireError}=await supabase.rpc('expire_stale_pet_calls');
    if(expireError)throw new Error('call_expiry_failed');
    const {data,error}=await supabase.rpc('service_claim_livekit_room_teardowns',{p_limit:25});
    if(error)throw new Error('teardown_claim_failed');
    const claimed=(data??[]) as TeardownRow[];
    let completed=0;let retried=0;
    for(const row of claimed){
      try{
        const existing=await rooms.listRooms([row.room_name]);
        if(existing.length)await rooms.deleteRoom(row.room_name);
        const {error:completeError}=await supabase.rpc('service_complete_livekit_room_teardown',{p_call_id:row.call_id});
        if(completeError)throw new Error('teardown_complete_failed');
        completed++;
      }catch{
        const {error:retryError}=await supabase.rpc('service_retry_livekit_room_teardown',{
          p_call_id:row.call_id,
          p_error_code:'livekit_teardown_failed',
          p_delay_seconds:retryDelaySeconds(row.attempts)
        });
        if(retryError)throw new Error('teardown_retry_failed');
        retried++;
      }
    }
    await markWorkerHeartbeat(supabase,'livekit-room-reaper','completed');
    return json({ok:true,claimed:claimed.length,completed,retried});
  }catch(error){
    const code=error instanceof Error?error.message:'livekit_room_reaper_failed';
    if(code==='livekit_not_configured'||code==='livekit_config_invalid')return json({error:code},503);
    return json({error:'livekit_room_reaper_failed'},500);
  }
});
