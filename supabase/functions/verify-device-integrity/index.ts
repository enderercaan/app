import { corsHeaders, json } from '../_shared/cors.ts';
import { authenticatedUser } from '../_shared/client.ts';
import { fetchWithTimeout, readRequestJsonBounded, readResponseJsonBounded } from '../_shared/http.ts';
import { requireAllowlistedHttpsUrl } from '../_shared/outboundUrl.ts';

const encoder=new TextEncoder();
const CHALLENGE_TTL_MS=5*60*1000;
const ASSESSMENT_TTL_SECONDS=15*60;
const GOOGLE_TIMEOUT_MS=10_000;
const APPLE_TIMEOUT_MS=10_000;
const ACTION_RE=/^[a-z][a-z0-9_.:-]{1,79}$/;

function b64url(bytes:Uint8Array){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
async function sha256B64Url(value:string){return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))))}
async function sha256Hex(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('')}
function safeJson(value:unknown){return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function sanitizeClientRiskSignals(value:unknown){
  const raw=safeJson(value); const out:Record<string,boolean>={};
  for(const key of ['debuggerAttached','emulatorOrSimulator','rootOrJailbreakHeuristic','debugBuild'])if(typeof raw[key]==='boolean')out[key]=raw[key] as boolean;
  return out;
}
function pemPkcs8(pem:string){const begin='-----BEGIN '+'PRIVATE KEY-----';const end='-----END '+'PRIVATE KEY-----';const raw=pem.replaceAll(begin,'').replaceAll(end,'').replace(/\s+/g,'');const bin=atob(raw);return Uint8Array.from(bin,c=>c.charCodeAt(0));}
function normalizeSha256Digest(value:string){const v=value.trim();if(/^[0-9a-f]{64}$/i.test(v)){const bytes=new Uint8Array(32);for(let i=0;i<32;i++)bytes[i]=Number.parseInt(v.slice(i*2,i*2+2),16);return b64url(bytes)}return v.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}

let cachedGoogle:{token:string;expiresAt:number}|null=null;
async function googleAccessToken(){
  if(cachedGoogle&&cachedGoogle.expiresAt>Date.now()+60_000)return cachedGoogle.token;
  const raw=Deno.env.get('GOOGLE_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON');
  if(!raw)throw new Error('play_integrity_service_account_missing');
  let account:any;try{account=JSON.parse(raw)}catch{throw new Error('play_integrity_service_account_invalid')}
  if(!account?.client_email||!account?.private_key)throw new Error('play_integrity_service_account_invalid');
  const now=Math.floor(Date.now()/1000);
  const header=b64url(encoder.encode(JSON.stringify({alg:'RS256',typ:'JWT'})));
  const payload=b64url(encoder.encode(JSON.stringify({iss:account.client_email,scope:'https://www.googleapis.com/auth/playintegrity',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})));
  const key=await crypto.subtle.importKey('pkcs8',pemPkcs8(String(account.private_key)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const signature=b64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,encoder.encode(`${header}.${payload}`))));
  const response=await fetchWithTimeout('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${header}.${payload}.${signature}`})},GOOGLE_TIMEOUT_MS);
  if(!response.ok)throw new Error('play_integrity_oauth_failed');
  const body=await readResponseJsonBounded<any>(response,64_000);
  if(!body?.access_token)throw new Error('play_integrity_oauth_invalid');
  cachedGoogle={token:String(body.access_token),expiresAt:Date.now()+Math.min(Number(body.expires_in||3600),3600)*1000};
  return cachedGoogle.token;
}

async function verifyAndroid(token:string,clientData:string){
  const packageName=String(Deno.env.get('PLAY_INTEGRITY_PACKAGE_NAME')??'').trim();
  if(!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName))throw new Error('play_integrity_package_not_configured');
  const accessToken=await googleAccessToken();
  const response=await fetchWithTimeout(`https://playintegrity.googleapis.com/v1/${encodeURIComponent(packageName)}:decodeIntegrityToken`,{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({integrity_token:token})},GOOGLE_TIMEOUT_MS);
  if(!response.ok){
    if(response.status===429||response.status>=500)throw new Error('play_integrity_decode_unavailable');
    throw new Error('play_integrity_token_rejected');
  }
  const decoded=await readResponseJsonBounded<any>(response,256_000);
  const p=decoded?.tokenPayloadExternal;
  const expectedHash=await sha256B64Url(clientData);
  const request=p?.requestDetails??{}; const app=p?.appIntegrity??{}; const device=p?.deviceIntegrity??{}; const account=p?.accountDetails??{};
  const labels=Array.isArray(device.deviceRecognitionVerdict)?device.deviceRecognitionVerdict.map(String):[];
  const certs=Array.isArray(app.certificateSha256Digest)?app.certificateSha256Digest.map((x:unknown)=>normalizeSha256Digest(String(x))):[];
  const allowedCerts=(Deno.env.get('PLAY_INTEGRITY_ALLOWED_CERT_SHA256')??'').split(',').map(x=>normalizeSha256Digest(x)).filter(Boolean);
  const allowedVersions=(Deno.env.get('PLAY_INTEGRITY_ALLOWED_VERSION_CODES')??'').split(',').map(x=>x.trim()).filter(Boolean);
  const recognized=app.appRecognitionVerdict==='PLAY_RECOGNIZED'&&app.packageName===packageName;
  const deviceOk=labels.includes('MEETS_DEVICE_INTEGRITY');
  const requireLicensed=String(Deno.env.get('PLAY_INTEGRITY_REQUIRE_LICENSED')??'true').trim().toLowerCase()==='true';
  const licensed=!requireLicensed||account.appLicensingVerdict==='LICENSED';
  const certOk=allowedCerts.length>0&&certs.some((x:string)=>allowedCerts.includes(x));
  const versionOk=allowedVersions.length>0&&allowedVersions.includes(String(app.versionCode??''));
  const requestPackageOk=request.requestPackageName===packageName;
  const hashOk=request.requestHash===expectedHash;
  const timestamp=Number(request.timestampMillis??0); const fresh=Number.isFinite(timestamp)&&Math.abs(Date.now()-timestamp)<=5*60*1000;
  return {verified:recognized&&deviceOk&&licensed&&certOk&&versionOk&&requestPackageOk&&hashOk&&fresh,appIntegrity:String(app.appRecognitionVerdict??'UNKNOWN'),deviceIntegrity:labels.join(','),appId:String(app.packageName??''),appVersion:String(app.versionCode??''),details:{licensed:account.appLicensingVerdict??null,meetsStrongIntegrity:labels.includes('MEETS_STRONG_INTEGRITY'),certificateMatched:certOk,versionMatched:versionOk,requestPackageMatched:requestPackageOk,requestHashMatched:hashOk,fresh}};
}

async function verifyApple(input:{mode:string;keyId:string;attestation?:string;assertion?:string;clientData:string;userId:string}){
  const url=Deno.env.get('APPLE_APP_ATTEST_VERIFIER_URL'); const secret=Deno.env.get('APPLE_APP_ATTEST_VERIFIER_SECRET'); const expectedAppId=Deno.env.get('APPLE_APP_ATTEST_APP_ID');
  if(!url||!secret||!expectedAppId)throw new Error('app_attest_verifier_not_configured');
  let parsed:URL;try{parsed=requireAllowlistedHttpsUrl(url,Deno.env.get('APPLE_APP_ATTEST_VERIFIER_ALLOWED_HOSTS_JSON'),{errorCode:'app_attest_verifier_invalid_url'})}catch{throw new Error('app_attest_verifier_invalid_url')}
  const response=await fetchWithTimeout(parsed.toString(),{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${secret}`},body:JSON.stringify({mode:input.mode,userId:input.userId,keyId:input.keyId,attestation:input.attestation??null,assertion:input.assertion??null,clientData:input.clientData,expectedAppId})},APPLE_TIMEOUT_MS);
  if(!response.ok)throw new Error('app_attest_verifier_unavailable');
  const body=await readResponseJsonBounded<any>(response,128_000);
  const counter=body?.counter==null?null:Number(body.counter);
  const counterOk=input.mode==='attestation'?counter===0:(Number.isInteger(counter)&&Number(counter)>0);
  const verified=body?.verified===true&&body?.appId===expectedAppId&&body?.keyId===input.keyId&&counterOk;
  return {verified,appIntegrity:verified?'APP_ATTEST_VERIFIED':'APP_ATTEST_REJECTED',deviceIntegrity:'APPLE_APP_ATTEST',appId:String(body?.appId??''),appVersion:String(body?.appVersion??''),keyIdSha256:await sha256Hex(input.keyId),counter,details:{mode:input.mode}};
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json({error:'method_not_allowed'},405);
  let supabase:any,user:any;
  try{({supabase,user}=await authenticatedUser(req));}catch{return json({error:'unauthorized'},401)}
  let body:any;try{body=await readRequestJsonBounded<any>(req,64_000)}catch(error){return json({error:error instanceof Error&&error.message==='body_too_large'?'payload_too_large':'invalid_json'},error instanceof Error&&error.message==='body_too_large'?413:400)}
  const operation=String(body?.operation??'');
  if(operation==='challenge'){
    const action=String(body?.action??''); const platform=String(body?.platform??'');
    if(!ACTION_RE.test(action)||!['ios','android'].includes(platform))return json({error:'invalid_challenge_request'},400);
    const {error:limitError}=await supabase.rpc('service_rate_limit_user',{p_user_id:user.id,p_action:'device_integrity_challenge',p_limit:30,p_window_seconds:3600});
    if(limitError)return json({error:String(limitError.message??'').includes('rate_limit_exceeded')?'rate_limit_exceeded':'integrity_rate_limit_failed'},String(limitError.message??'').includes('rate_limit_exceeded')?429:503);
    const id=crypto.randomUUID(); const nonce=b64url(crypto.getRandomValues(new Uint8Array(32))); const expiresAt=new Date(Date.now()+CHALLENGE_TTL_MS).toISOString();
    const clientData=JSON.stringify({v:1,challengeId:id,nonce,userId:user.id,action,platform});
    const {error}=await supabase.from('security_attestation_challenges').insert({id,user_id:user.id,action,platform,nonce,client_data:clientData,expires_at:expiresAt});
    if(error)return json({error:'challenge_issue_failed'},503);
    return json({challengeId:id,clientData,expiresAt});
  }
  if(operation!=='verify')return json({error:'invalid_operation'},400);
  const challengeId=String(body?.challengeId??''); const clientData=String(body?.clientData??''); const platform=String(body?.platform??'');
  if(!/^[0-9a-f-]{36}$/i.test(challengeId)||clientData.length<32||clientData.length>4096||!['ios','android'].includes(platform))return json({error:'invalid_verification_request'},400);
  const {data:claim,error:claimError}=await supabase.rpc('service_claim_device_integrity_challenge',{p_user_id:user.id,p_challenge_id:challengeId,p_client_data:clientData});
  if(claimError)return json({error:'challenge_claim_failed'},503); if(!claim?.claimToken)return json({error:'challenge_invalid_or_expired'},409); if(claim.platform!==platform)return json({error:'challenge_platform_mismatch'},409);
  const claimToken=String(claim.claimToken);
  try{
    let result:any;
    if(platform==='android'){
      const token=String(body?.token??''); if(token.length<100||token.length>20000)throw new Error('play_integrity_token_invalid');
      result=await verifyAndroid(token,clientData);
    }else{
      const mode=String(body?.appleMode??''); const keyId=String(body?.keyId??''); if(!['attestation','assertion'].includes(mode)||keyId.length<10||keyId.length>512)throw new Error('app_attest_payload_invalid');
      const attestation=mode==='attestation'?String(body?.attestation??''):undefined; const assertion=mode==='assertion'?String(body?.assertion??''):undefined;
      if((attestation??assertion??'').length<20||(attestation??assertion??'').length>50000)throw new Error('app_attest_payload_invalid');
      result=await verifyApple({mode,keyId,attestation,assertion,clientData,userId:user.id});
    }
    if(result.verified!==true){
      const rejectedDetails=safeJson(result.details);
      const {data:rejectedFinished,error:rejectedFinishError}=await supabase.rpc('service_finish_device_integrity_challenge',{p_user_id:user.id,p_challenge_id:challengeId,p_claim_token:claimToken,p_verdict:'rejected',p_app_integrity:result.appIntegrity??null,p_device_integrity:result.deviceIntegrity??null,p_app_id:result.appId??null,p_app_version:result.appVersion??null,p_key_id_sha256:result.keyIdSha256??null,p_assertion_counter:result.counter??null,p_details:rejectedDetails,p_ttl_seconds:ASSESSMENT_TTL_SECONDS});
      if(rejectedFinishError||rejectedFinished!==true){
        await supabase.rpc('service_release_device_integrity_challenge',{p_user_id:user.id,p_challenge_id:challengeId,p_claim_token:claimToken}).catch(()=>undefined);
        return json({error:'device_integrity_temporarily_unavailable'},503);
      }
      return json({error:'device_integrity_rejected'},403);
    }
    const clientRiskSignals=sanitizeClientRiskSignals(body?.clientRiskSignals);
    const assessmentDetails={...safeJson(result.details),untrustedClientRiskSignals:clientRiskSignals};
    const {data:finished,error:finishError}=await supabase.rpc('service_finish_device_integrity_challenge',{p_user_id:user.id,p_challenge_id:challengeId,p_claim_token:claimToken,p_verdict:'verified',p_app_integrity:result.appIntegrity??null,p_device_integrity:result.deviceIntegrity??null,p_app_id:result.appId??null,p_app_version:result.appVersion??null,p_key_id_sha256:result.keyIdSha256??null,p_assertion_counter:result.counter??null,p_details:assessmentDetails,p_ttl_seconds:ASSESSMENT_TTL_SECONDS});
    if(finishError||finished!==true)throw new Error('integrity_state_commit_failed');
    return json({verified:true,expiresAt:new Date(Date.now()+ASSESSMENT_TTL_SECONDS*1000).toISOString()});
  }catch(error){
    await supabase.rpc('service_release_device_integrity_challenge',{p_user_id:user.id,p_challenge_id:challengeId,p_claim_token:claimToken}).catch(()=>undefined);
    const code=error instanceof Error?error.message:'device_integrity_failed';
    const retryable=/oauth|unavailable|verifier_not_configured|verifier_invalid_url|https_required|timeout|state_commit/.test(code);
    return json({error:retryable?'device_integrity_temporarily_unavailable':'device_integrity_rejected'},retryable?503:403);
  }
});
