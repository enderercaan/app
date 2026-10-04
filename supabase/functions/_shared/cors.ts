function validatedAllowedOrigin(){
  const raw=(Deno.env.get('CORS_ALLOWED_ORIGIN')??'').trim();
  if(!raw)return '';
  if(raw==='*')return '';
  try{
    const parsed=new URL(raw);
    if(parsed.protocol!=='https:')return '';
    if(parsed.username||parsed.password||parsed.search||parsed.hash)return '';
    if(parsed.pathname!=='/'&&parsed.pathname!=='')return '';
    return parsed.origin;
  }catch{return '';}
}

const allowedOrigin=validatedAllowedOrigin();

export const corsHeaders = {
  ...(allowedOrigin?{'Access-Control-Allow-Origin':allowedOrigin}:{}),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary':'Origin'
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    }
  });
}
