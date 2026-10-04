import { corsHeaders, json } from '../_shared/cors.ts';
import { authenticatedUser } from '../_shared/client.ts';
import { readRequestJsonBounded } from '../_shared/http.ts';

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  try{
    const {supabase,user}=await authenticatedUser(req);
    let body:any;
    try{body=await readRequestJsonBounded<any>(req,8_192)}catch(error){return json({error:error instanceof Error&&error.message==='body_too_large'?'payload_too_large':'invalid_json'},error instanceof Error&&error.message==='body_too_large'?413:400)}
    const mode=String(body?.mode??'');
    if(mode==='all'){
      const {data,error}=await supabase.from('push_tokens').update({enabled:false,last_seen_at:new Date().toISOString()}).eq('user_id',user.id).eq('enabled',true).select('id');
      if(error)throw new Error('push_token_disable_failed');
      return json({ok:true,mode:'all',disabledIds:(data??[]).map((row:any)=>row.id)});
    }
    if(mode==='current'){
      const token=String(body?.token??'').trim();
      const transport=body?.transport==null?null:String(body.transport).trim();
      if(token.length<20||token.length>512)return json({error:'invalid_token'},400);
      if(transport!==null&&!['expo','apns_voip'].includes(transport))return json({error:'invalid_transport'},400);
      let query=supabase.from('push_tokens').update({enabled:false,last_seen_at:new Date().toISOString()}).eq('user_id',user.id).eq('token',token).eq('enabled',true);
      if(transport!==null)query=query.eq('transport',transport);
      const {data,error}=await query.select('id');
      if(error)throw new Error('push_token_disable_failed');
      return json({ok:true,mode:'current',disabledIds:(data??[]).map((row:any)=>row.id)});
    }
    if(mode==='restore'){
      const ids=Array.isArray(body?.ids)?body.ids.map((value:unknown)=>String(value)):[];
      if(ids.length>20||ids.some((id:string)=>!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)))return json({error:'invalid_ids'},400);
      if(!ids.length)return json({ok:true,mode:'restore',restoredIds:[]});
      const {data,error}=await supabase.from('push_tokens').update({enabled:true,last_seen_at:new Date().toISOString()}).eq('user_id',user.id).in('id',ids).select('id');
      if(error)throw new Error('push_token_restore_failed');
      return json({ok:true,mode:'restore',restoredIds:(data??[]).map((row:any)=>row.id)});
    }
    return json({error:'invalid_mode'},400);
  }catch(error){
    const message=error instanceof Error?error.message:'';
    if(message==='Unauthorized')return json({error:'Unauthorized'},401);
    return json({error:'push_token_cleanup_failed'},500);
  }
});
