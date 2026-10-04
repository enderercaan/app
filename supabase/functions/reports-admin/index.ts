import { json } from '../_shared/cors.ts';
import { adminClient } from '../_shared/client.ts';
import { readRequestJsonBounded } from '../_shared/http.ts';
import { verifyBearerSecret } from '../_shared/secretAuth.ts';

const ALLOWED_STATUSES = new Set(['open', 'reviewing', 'resolved', 'dismissed']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const secret = Deno.env.get('REPORTS_ADMIN_SECRET');
  if (!verifyBearerSecret(req.headers.get('Authorization'),secret)) return json({ error: 'Unauthorized' }, 401);

  let body: any;
  try { body = await readRequestJsonBounded<any>(req, 16_384); }
  catch(error){return json({error:error instanceof Error&&error.message==='body_too_large'?'Payload too large':'Invalid JSON'},error instanceof Error&&error.message==='body_too_large'?413:400)}
  const action = body?.action;
  const supabase = adminClient();

  if (action === 'list') {
    const status = typeof body?.status === 'string' ? body.status : null;
    if (status && !ALLOWED_STATUSES.has(status)) return json({ error: 'Invalid status' }, 400);
    const limit = Math.min(Math.max(Number(body?.limit) || 50, 1), 100);
    let query = supabase.from('reports').select('id,reporter_user_id,reporter_pet_id,target_type,target_id,reason,details,status,resolution_explanation,resolved_at,moderation_decision_id,created_at').order('created_at', { ascending: true }).limit(limit);
    if (status) query = query.eq('status', status);
    else query = query.in('status', ['open', 'reviewing']);
    const { data, error } = await query;
    if (error) return json({ error: 'report_list_failed' }, 500);
    return json({ ok: true, reports: data ?? [] });
  }

  if (action === 'update') {
    const reportId = body?.reportId;
    const status = body?.status;
    const userVisibleExplanation=typeof body?.userVisibleExplanation==='string'?body.userVisibleExplanation.trim():'';
    const reviewerReference=typeof body?.reviewerReference==='string'?body.reviewerReference.trim():'';
    if (typeof reportId !== 'string' || !UUID_RE.test(reportId) || !ALLOWED_STATUSES.has(status) || status === 'open') return json({ error: 'Invalid request' }, 400);
    if(['resolved','dismissed'].includes(status)&&(userVisibleExplanation.length<3||userVisibleExplanation.length>2000))return json({error:'User-visible resolution explanation required'},400);
    if(reviewerReference.length>200)return json({error:'Reviewer reference too long'},400);
    const { data, error } = await supabase.rpc('admin_update_report_status', { p_report_id: reportId, p_status: status, p_user_visible_explanation:userVisibleExplanation||null, p_reviewer_reference:reviewerReference||null });
    if (error) {
      if (String(error.message ?? '').includes('report_not_found')) return json({ error: 'Report not found' }, 404);
      return json({ error: 'report_update_failed' }, 500);
    }
    return json({ ok: true, report: data });
  }

  return json({ error: 'Unsupported action' }, 400);
});
