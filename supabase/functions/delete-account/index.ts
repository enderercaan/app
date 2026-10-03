import { corsHeaders, json } from '../_shared/cors.ts';
import { authenticatedUser, requireAal2IfEnrolled, requireDeviceIntegrityIfEnforced } from '../_shared/client.ts';
import { hardDeleteAccount } from '../_shared/accountDeletion.ts';

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  try{
    const {supabase,user,token}=await authenticatedUser(req);
    await requireAal2IfEnrolled(supabase,user.id,token);
    await requireDeviceIntegrityIfEnforced(supabase,user.id,'account_delete');
    return json(await hardDeleteAccount(supabase,user.id));
  }catch(error){
    const message=error instanceof Error?error.message:'delete_failed';
    if(message==='Unauthorized')return json({error:'Unauthorized'},401);
    if(message==='mfa_required')return json({error:'mfa_required'},403);
    if(message==='mfa_state_unavailable')return json({error:'mfa_state_unavailable'},503);
    if(message==='device_integrity_required')return json({error:'device_integrity_required'},403);
    if(message==='device_integrity_state_unavailable')return json({error:'device_integrity_state_unavailable'},503);
    if(message==='deletion_in_progress')return json({error:'deletion_in_progress'},409);
    const code=(message.split(':',1)[0]||'delete_failed').slice(0,120);
    console.error('delete_account_failed');
    return json({error:code},500);
  }
});
