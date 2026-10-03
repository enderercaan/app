-- Tailmance v19 R8 ultra-deep hardening: make legacy retry-unsafe RPC closure explicit
-- against PostgreSQL's default PUBLIC EXECUTE privilege as well as anon/authenticated roles.
-- Earlier migrations already removed PUBLIC/anon grants for these functions; repeating the
-- revocation here makes the final authoritative surface drift-resistant and self-evident.

revoke all on function public.send_message(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.toggle_favorite_pet(uuid,uuid) from public,anon,authenticated;
revoke all on function public.toggle_post_like(uuid,uuid) from public,anon,authenticated;
revoke all on function public.toggle_save_post(uuid,uuid) from public,anon,authenticated;
revoke all on function public.toggle_follow_pet(uuid,uuid) from public,anon,authenticated;
