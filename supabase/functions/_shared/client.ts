import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';

export function adminClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Missing Supabase service credentials');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function userClientForToken(token:string){
  const url=(Deno.env.get('SUPABASE_URL')??'').trim();
  const anonKey=(Deno.env.get('SUPABASE_ANON_KEY')??'').trim();
  if(!url||!anonKey)throw new Error('user_scoped_client_unavailable');
  return createClient(url,anonKey,{
    auth:{persistSession:false,autoRefreshToken:false},
    global:{headers:{Authorization:`Bearer ${token}`}}
  });
}

export async function authenticatedUser(req: Request) {
  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) throw new Error('Unauthorized');
  const supabase = adminClient();
  const token = auth.slice('Bearer '.length);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error('Unauthorized');
  let payload:any;
  try{
    const part=token.split('.')[1];
    if(!part)throw new Error('jwt_payload_missing');
    const normalized=part.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(part.length/4)*4,'=');
    payload=JSON.parse(atob(normalized));
  }catch{throw new Error('Unauthorized')}
  const sessionId=String(payload?.session_id??'');
  const issuedAt=Number(payload?.iat??0);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)||!Number.isInteger(issuedAt)||issuedAt<=0)throw new Error('Unauthorized');
  const {data:allowed,error:sessionError}=await supabase.rpc('service_session_token_allowed',{p_user_id:data.user.id,p_session_id:sessionId,p_iat:issuedAt});
  if(sessionError||allowed!==true)throw new Error('Unauthorized');
  return { supabase, user: data.user, token };
}

function jwtAal(token:string){
  try{
    const payload=token.split('.')[1];
    if(!payload)return 'aal1';
    const normalized=payload.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(payload.length/4)*4,'=');
    const parsed=JSON.parse(atob(normalized));
    return parsed?.aal==='aal2'?'aal2':'aal1';
  }catch{return 'aal1'}
}

export async function requireAal2IfEnrolled(supabase:ReturnType<typeof adminClient>,userId:string,token:string){
  const {data,error}=await supabase.rpc('service_user_has_verified_mfa',{p_user_id:userId});
  if(error)throw new Error('mfa_state_unavailable');
  if(data===true&&jwtAal(token)!=='aal2')throw new Error('mfa_required');
}

export async function requireDeviceIntegrityIfEnforced(supabase:ReturnType<typeof adminClient>,userId:string,action:string){
  const {data,error}=await supabase.rpc('service_device_integrity_gate',{p_user_id:userId,p_action:action});
  if(error)throw new Error('device_integrity_state_unavailable');
  if(data?.mode!=='observe'&&data?.allowed!==true)throw new Error('device_integrity_required');
  return data as {mode?:string;allowed?:boolean;recentVerified?:boolean;reason?:string};
}
