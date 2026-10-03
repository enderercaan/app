import { json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/client.ts';
import { verifyBearerSecret } from '../_shared/secretAuth.ts';

Deno.serve(async(req)=>{
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  const secret=Deno.env.get('OPS_HEALTH_SECRET');
  if(!verifyBearerSecret(req.headers.get('Authorization'),secret))return json({error:'Unauthorized'},401);
  const supabase=adminClient();
  const {data,error}=await supabase.rpc('get_ops_health_snapshot');
  if(error)return json({error:'ops_health_unavailable'},500);
  return json({ok:true,health:data});
});
