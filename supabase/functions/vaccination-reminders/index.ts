import { adminClient } from '../_shared/client.ts';
import { json } from '../_shared/cors.ts';
import { markWorkerHeartbeat } from '../_shared/workerHeartbeat.ts';
import { verifyBearerSecret } from '../_shared/secretAuth.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const secret = Deno.env.get('REMINDER_WORKER_SECRET');
  if (!verifyBearerSecret(req.headers.get('Authorization'),secret)) return json({ error: 'Unauthorized' }, 401);

  const supabase = adminClient();
  await markWorkerHeartbeat(supabase,'vaccination-reminders','started');
  const { data, error } = await supabase.rpc('enqueue_vaccination_reminders');
  if (error) return json({ error: 'vaccination_enqueue_failed' }, 500);
  const queued = typeof data === 'number' ? data : Number(data ?? 0);
  if (!Number.isFinite(queued) || queued < 0) return json({ error: 'invalid_enqueue_result' }, 500);
  await markWorkerHeartbeat(supabase,'vaccination-reminders','completed');
  return json({ ok: true, queued });
});
