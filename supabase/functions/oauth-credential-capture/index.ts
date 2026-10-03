import {corsHeaders,json} from '../_shared/cors.ts';
import {authenticatedUser,requireDeviceIntegrityIfEnforced} from '../_shared/client.ts';
import {readRequestJsonBounded} from '../_shared/http.ts';
import {resolveOauthCredentialForStorage,sealOauthCredential,type OauthCaptureTokenKind,type OauthRevocationProvider} from '../_shared/oauthRevocation.ts';

const providers=new Set<OauthRevocationProvider>(['apple','google']);
const tokenKinds=new Set<OauthCaptureTokenKind>(['access_token','refresh_token','authorization_code']);

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  try{
    const {supabase,user}=await authenticatedUser(req);
    await requireDeviceIntegrityIfEnforced(supabase,user.id,'oauth_credential_capture');
    const body=await readRequestJsonBounded<{provider?:unknown;tokenKind?:unknown;token?:unknown}>(req,20_000);
    const provider=String(body.provider??'') as OauthRevocationProvider;
    const tokenKind=String(body.tokenKind??'') as OauthCaptureTokenKind;
    const token=typeof body.token==='string'?body.token:'';
    if(!providers.has(provider)||!tokenKinds.has(tokenKind))return json({error:'invalid_oauth_credential'},400);
    const identityProviders=new Set<string>([
      ...((user.identities??[]).map((identity:any)=>String(identity?.provider??''))),
      ...((Array.isArray(user.app_metadata?.providers)?user.app_metadata.providers:[]).map((value:unknown)=>String(value)))
    ]);
    if(!identityProviders.has(provider))return json({error:'oauth_identity_not_linked'},403);
    const resolved=await resolveOauthCredentialForStorage(provider,tokenKind,token);
    const sealed=await sealOauthCredential(user.id,provider,resolved.token);
    const now=new Date().toISOString();
    const {error}=await supabase.from('oauth_revocation_credentials').upsert({
      account_user_id:user.id,provider,token_kind:resolved.tokenKind,token_ciphertext:sealed.tokenCiphertext,
      token_iv:sealed.tokenIv,key_version:sealed.keyVersion,provider_client_id:resolved.providerClientId,captured_at:now,updated_at:now,retention_deadline:null
    },{onConflict:'account_user_id,provider'});
    if(error)throw new Error(`oauth_revocation_credential_write_failed:${error.message}`);
    return json({ok:true,provider,tokenKind:resolved.tokenKind,capturedAt:now});
  }catch(error){
    const message=error instanceof Error?error.message:'oauth_credential_capture_failed';
    if(message==='Unauthorized')return json({error:'Unauthorized'},401);
    if(message==='device_integrity_required')return json({error:'device_integrity_required'},403);
    if(message==='device_integrity_state_unavailable')return json({error:'device_integrity_state_unavailable'},503);
    const code=(message.split(':',1)[0]||'oauth_credential_capture_failed').slice(0,120);
    console.error('oauth_credential_capture_failed');
    return json({error:code},500);
  }
});
