export type WorkerPhase='started'|'completed';

export async function markWorkerHeartbeat(supabase:any,worker:string,phase:WorkerPhase){
  const now=new Date().toISOString();
  const payload=phase==='started'
    ? {worker,last_started_at:now,updated_at:now}
    : {worker,last_completed_at:now,updated_at:now};
  const {error}=await supabase.from('worker_heartbeats').upsert(payload,{onConflict:'worker'});
  if(error)console.warn('worker_heartbeat_write_failed');
}
