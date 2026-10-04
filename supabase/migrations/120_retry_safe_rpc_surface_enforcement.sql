-- Tailmance v19 R8 ultra-deep hardening: enforce retry-safe mutation entry points.
-- The new explicit desired-state/idempotent RPCs are authoritative; legacy toggle/direct
-- message entry points remain callable internally by SECURITY DEFINER wrappers where needed,
-- but are no longer exposed to authenticated clients.

revoke execute on function public.send_message(uuid,uuid,text) from authenticated;
revoke execute on function public.toggle_favorite_pet(uuid,uuid) from authenticated;
revoke execute on function public.toggle_post_like(uuid,uuid) from authenticated;
revoke execute on function public.toggle_save_post(uuid,uuid) from authenticated;
revoke execute on function public.toggle_follow_pet(uuid,uuid) from authenticated;

-- Preserve the intended new client surface explicitly.
grant execute on function public.send_message_idempotent(uuid,uuid,text,text) to authenticated;
grant execute on function public.set_favorite_pet(uuid,uuid,boolean) to authenticated;
grant execute on function public.set_post_like(uuid,uuid,boolean) to authenticated;
grant execute on function public.set_saved_post(uuid,uuid,boolean) to authenticated;
grant execute on function public.set_follow_pet(uuid,uuid,boolean) to authenticated;
grant execute on function public.get_favorite_pets_page(uuid,integer,timestamptz,uuid) to authenticated;
