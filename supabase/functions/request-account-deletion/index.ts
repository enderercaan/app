import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/client.ts';
import { fetchWithTimeout, readRequestJsonBounded, readResponseJsonBounded } from '../_shared/http.ts';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const encoder = new TextEncoder();
async function sha256(value:string){
  const bytes=await crypto.subtle.digest('SHA-256',encoder.encode(value));
  return Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,'0')).join('');
}

async function verifyTurnstile(token:string|undefined,ip:string){
  const secret=Deno.env.get('TURNSTILE_SECRET_KEY');
  if(!secret)return false;
  if(!token||token.length>4096)return false;
  const body=new URLSearchParams({secret,response:token,remoteip:ip});
  try{
    const response=await fetchWithTimeout('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body},8000);
    if(!response.ok)return false;
    const data=await readResponseJsonBounded<any>(response,32_000);
    const expectedHostname=String(Deno.env.get('TURNSTILE_EXPECTED_HOSTNAME')??'').trim().toLowerCase();
    const expectedAction=String(Deno.env.get('TURNSTILE_EXPECTED_ACTION')??'account_deletion').trim();
    if(!expectedHostname||expectedAction!=='account_deletion')return false;
    return data?.success===true&&String(data?.hostname??'').trim().toLowerCase()===expectedHostname&&String(data?.action??'')===expectedAction;
  }catch{return false}
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  try{
    let body:any;
    try{body=await readRequestJsonBounded<any>(req,16_000)}catch(error){
      const tooLarge=error instanceof Error&&error.message==='body_too_large';
      return json({error:tooLarge?'payload_too_large':'invalid_request'},tooLarge?413:400);
    }
    const email=String(body?.email??'').trim().toLowerCase();
    if(!emailPattern.test(email)||email.length>254)return json({error:'invalid_email'},400);
    const rawIp=(req.headers.get('cf-connecting-ip')??req.headers.get('x-forwarded-for')??'unknown').split(',')[0].trim();
    const ip=rawIp.length<=64?rawIp:'unknown';
    if(!(await verifyTurnstile(body?.turnstileToken,ip)))return json({error:'challenge_failed'},400);

    const emailHash=await sha256(email);
    const ipHash=await sha256(ip);
    const hourWindow=Math.floor(Date.now()/3_600_000);
    const fingerprint=await sha256(`${emailHash}:${ipHash}:${hourWindow}`);
    const supabase=adminClient();
    const {error}=await supabase.from('account_deletion_requests').upsert({
      email,email_hash:emailHash,ip_hash:ipHash,request_fingerprint:fingerprint,source:'web',status:'pending'
    },{onConflict:'request_fingerprint',ignoreDuplicates:true});
    if(error&&error.code!=='23505')throw error;
    // Deliberately do not disclose whether the email belongs to an account or an open request already exists.
    return json({ok:true,message:'request_received'},202);
  }catch(_error){
    return json({error:'request_failed'},500);
  }
});
