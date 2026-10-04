import { json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/client.ts';
import { fetchWithTimeout, readResponseJsonBounded } from '../_shared/http.ts';
import { markWorkerHeartbeat } from '../_shared/workerHeartbeat.ts';
import { verifyBearerSecret } from '../_shared/secretAuth.ts';

const RECEIPTS_URL='https://exp.host/--/api/v2/push/getReceipts';
const EXPO_TIMEOUT_MS=10_000;
const EXPO_MAX_RESPONSE_BYTES=256_000;

Deno.serve(async(req)=>{
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  const secret=Deno.env.get('PUSH_WORKER_SECRET');
  if(!verifyBearerSecret(req.headers.get('Authorization'),secret))return json({error:'Unauthorized'},401);
  const supabase=adminClient();
  await markWorkerHeartbeat(supabase,'push-receipts','started');
  const cutoff=new Date(Date.now()-15*60*1000).toISOString();
  const {data:rows,error}=await supabase.from('push_receipts').select('id,expo_ticket_id,push_token_id').eq('receipt_status','pending').not('expo_ticket_id','is',null).lte('created_at',cutoff).limit(300);
  if(error)return json({error:'push_receipt_queue_unavailable'},500);
  if(!rows?.length){await markWorkerHeartbeat(supabase,'push-receipts','completed');return json({ok:true,checked:0});}
  try{
    const ids=rows.map((r:any)=>r.expo_ticket_id);
    const response=await fetchWithTimeout(RECEIPTS_URL,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({ids})},EXPO_TIMEOUT_MS);
    if(!response.ok)return json({error:`expo_receipts_http_${response.status}`},502);
    const payload=await readResponseJsonBounded<any>(response,EXPO_MAX_RESPONSE_BYTES);
    const receipts=payload?.data??{};
    let checked=0;
    for(const row of rows){
      const receipt=receipts[row.expo_ticket_id];
      if(!receipt)continue;
      checked++;
      const status=receipt.status==='ok'?'ok':'error';
      const rawCode=typeof receipt?.details?.error==='string'?receipt.details.error:null;
      const code=rawCode&&rawCode.length<=120?rawCode:'ExpoReceiptError';
      const {error:updateError}=await supabase.from('push_receipts').update({receipt_status:status,error_code:code,error_message:status==='error'?'expo_receipt_error':null,checked_at:new Date().toISOString()}).eq('id',row.id);
      if(updateError)throw new Error('push_receipt_state_write_failed');
      if(code==='DeviceNotRegistered'&&row.push_token_id){const {error:disableError}=await supabase.from('push_tokens').update({enabled:false}).eq('id',row.push_token_id);if(disableError)throw new Error('push_token_disable_failed')}
    }
    await markWorkerHeartbeat(supabase,'push-receipts','completed');
    return json({ok:true,checked});
  }catch(error){
    const code=error instanceof DOMException&&error.name==='AbortError'?'expo_receipts_timeout':error instanceof Error&&error.message==='body_too_large'?'expo_receipts_response_too_large':error instanceof SyntaxError?'expo_receipts_invalid_json':'push_receipts_failed';
    return json({error:code},502);
  }
});
