-- Tailmance v19 R8 ultra-deep audit: authenticated clients use only retry-safe wrappers
-- for mutations where ambiguous network failure could otherwise create a second side effect.
revoke all on function public.undo_last_pass(uuid) from public,anon,authenticated;
revoke all on function public.create_comment(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.create_meetup_request(uuid,uuid,timestamptz,text,text) from public,anon,authenticated;
revoke all on function public.create_community_event(uuid,text,text,text,text,text,timestamptz,timestamptz,integer,text,text) from public,anon,authenticated;
revoke all on function public.create_lost_pet_alert(uuid,timestamptz,numeric) from public,anon,authenticated;

grant execute on function public.undo_last_pass_idempotent(uuid,text) to authenticated;
grant execute on function public.create_comment_idempotent(uuid,uuid,text,text) to authenticated;
grant execute on function public.create_meetup_request_idempotent(uuid,uuid,timestamptz,text,text,text) to authenticated;
grant execute on function public.create_community_event_idempotent(uuid,text,text,text,text,text,timestamptz,timestamptz,integer,text,text,text) to authenticated;
grant execute on function public.create_lost_pet_alert_idempotent(uuid,timestamptz,numeric,text) to authenticated;
