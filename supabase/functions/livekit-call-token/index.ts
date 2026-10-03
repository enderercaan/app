import { AccessToken } from 'npm:livekit-server-sdk@2.19.1';
import { corsHeaders, json } from '../_shared/cors.ts';
import { authenticatedUser, requireDeviceIntegrityIfEnforced, userClientForToken } from '../_shared/client.ts';
import { readRequestJsonBounded } from '../_shared/http.ts';

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type TokenRequest={callId?:string;petId?:string};

function liveKitConfig(){
  const rawUrl=(Deno.env.get('LIVEKIT_URL')??'').trim();
  const apiKey=(Deno.env.get('LIVEKIT_API_KEY')??'').trim();
  const apiSecret=(Deno.env.get('LIVEKIT_API_SECRET')??'').trim();
  if(!rawUrl||!apiKey||!apiSecret)throw new Error('livekit_not_configured');
  let parsed:URL;
  try{parsed=new URL(rawUrl)}catch{throw new Error('livekit_config_invalid')}
  if(!['wss:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.search||parsed.hash||(parsed.port&& !['443'].includes(parsed.port)))throw new Error('livekit_config_invalid');
  const serverUrl=parsed.protocol==='https:'?`wss://${parsed.host}${parsed.pathname.replace(/\/+$/,'')}`:parsed.toString().replace(/\/+$/,'');
  return {serverUrl,apiKey,apiSecret};
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  try{
    const {supabase,user,token}=await authenticatedUser(req);
    await requireDeviceIntegrityIfEnforced(supabase,user.id,'pet_call');
    const body=await readRequestJsonBounded<TokenRequest>(req,8_000);
    const callId=String(body.callId??'');
    const petId=String(body.petId??'');
    if(!UUID_RE.test(callId)||!UUID_RE.test(petId))return json({error:'invalid_request'},400);
    const {error:limitError}=await supabase.rpc('service_rate_limit_user',{p_user_id:user.id,p_action:'livekit_call_token',p_limit:30,p_window_seconds:3600});
    if(limitError){
      if(String(limitError.message??'').includes('rate_limit_exceeded'))return json({error:'rate_limit_exceeded'},429);
      throw new Error('call_token_rate_limit_failed');
    }
    const client=userClientForToken(token);
    const {data:context,error:contextError}=await client.rpc('get_pet_call_token_context',{p_call_id:callId,p_pet_id:petId});
    if(contextError||!context)throw new Error('call_unavailable');
    const roomName=String(context.roomName??'');
    const petName=String(context.petName??'').slice(0,80);
    if(!/^tailmance_call_[0-9a-f-]{36}$/i.test(roomName)||!petName)throw new Error('call_context_invalid');
    const {serverUrl,apiKey,apiSecret}=liveKitConfig();
    const accessToken=new AccessToken(apiKey,apiSecret,{identity:`pet:${petId}`,name:petName,ttl:'5m'});
    accessToken.addGrant({roomJoin:true,room:roomName,canPublish:true,canSubscribe:true,canPublishData:false});
    const participantToken=await accessToken.toJwt();
    return json({serverUrl,participantToken,callId,callType:context.callType,expiresInSeconds:300});
  }catch(error){
    const code=error instanceof Error?error.message:String(error);
    if(code==='Unauthorized')return json({error:'unauthorized'},401);
    if(code==='device_integrity_required')return json({error:'device_integrity_required'},403);
    if(code==='device_integrity_state_unavailable')return json({error:'device_integrity_state_unavailable'},503);
    if(code==='livekit_not_configured'||code==='livekit_config_invalid')return json({error:code},503);
    if(code==='call_unavailable')return json({error:'call_unavailable'},403);
    return json({error:'call_token_failed'},500);
  }
});
