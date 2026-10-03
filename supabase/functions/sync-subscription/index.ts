import { corsHeaders, json } from '../_shared/cors.ts';
import { authenticatedUser, requireDeviceIntegrityIfEnforced } from '../_shared/client.ts';
import { fetchWithTimeout, readResponseJsonBounded } from '../_shared/http.ts';

const REVENUECAT_TIMEOUT_MS=10_000;
const REVENUECAT_MAX_RESPONSE_BYTES=256_000;
function entitlementActive(entitlement: any) {
  if (!entitlement) return false;
  const expiry = entitlement.expires_date ? Date.parse(entitlement.expires_date) : null;
  const grace = entitlement.grace_period_expires_date ? Date.parse(entitlement.grace_period_expires_date) : null;
  if (expiry === null) return true;
  const now = Date.now();
  return (Number.isFinite(expiry) && expiry > now) || (grace !== null && Number.isFinite(grace) && grace > now);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const { supabase, user } = await authenticatedUser(req);
    await requireDeviceIntegrityIfEnforced(supabase,user.id,'subscription_sync');
    const {error:limitError}=await supabase.rpc('service_rate_limit_user',{p_user_id:user.id,p_action:'subscription_sync',p_limit:30,p_window_seconds:3600});
    if(limitError) throw limitError;
    const observedAt=new Date().toISOString();
    const apiKey = Deno.env.get('REVENUECAT_REST_API_KEY');
    if (!apiKey) return json({ error: 'RevenueCat server configuration missing' }, 503);
    const entitlementId = Deno.env.get('REVENUECAT_ENTITLEMENT_ID');
    if (!entitlementId) return json({ error: 'RevenueCat entitlement configuration missing' }, 503);
    const response = await fetchWithTimeout(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(user.id)}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
    }, REVENUECAT_TIMEOUT_MS);
    if (!response.ok) return json({ error: 'revenuecat_upstream_error' }, 502);
    const payload = await readResponseJsonBounded<any>(response, REVENUECAT_MAX_RESPONSE_BYTES);
    const entitlement = payload?.subscriber?.entitlements?.[entitlementId];
    const premium = entitlementActive(entitlement);
    const {data:applied,error:applyError}=await supabase.rpc('apply_manual_subscription_sync',{p_user_id:user.id,p_observed_at:observedAt,p_premium:premium});
    if(applyError)throw applyError;
    const effectivePremium=applied?.effectivePremium===true;
    return json({
      ok: true,
      premium:effectivePremium,
      observedPremium:premium,
      stateApplied:applied?.applied===true,
      entitlementId,
      expiresAt: entitlement?.expires_date ?? null,
      gracePeriodExpiresAt: entitlement?.grace_period_expires_date ?? null,
      managementUrl: (() => {
        const value=String(payload?.subscriber?.management_url??'');
        if(!value||value.length>2048)return null;
        try{const url=new URL(value);return url.protocol==='https:'?url.toString():null}catch{return null}
      })()
    });
  } catch (error:any) {
    const message = error instanceof Error ? error.message : '';
    if(error?.name==='AbortError') return json({error:'revenuecat_timeout'},504);
    if(message==='Unauthorized') return json({error:'Unauthorized'},401);
    if(message==='device_integrity_required') return json({error:'device_integrity_required'},403);
    if(message==='device_integrity_state_unavailable') return json({error:'device_integrity_state_unavailable'},503);
    if(message.includes('rate_limit_exceeded')) return json({error:'rate_limit_exceeded'},429);
    if(message==='body_too_large') return json({error:'revenuecat_response_too_large'},502);
    if(error instanceof SyntaxError) return json({error:'revenuecat_invalid_json'},502);
    return json({ error: 'subscription_sync_failed' }, 500);
  }
});
