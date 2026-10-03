-- Tailmance v18: close residual authenticated SECURITY DEFINER paths that could otherwise
-- return or act on user data with an AAL1 session after the user enrolled verified MFA.
-- Product-data paths use the full product gate; account-control/history paths that must
-- remain available while paused use the narrower MFA-if-enrolled gate.

create or replace function public.can_upload_storage_object(p_bucket text,p_name text)
returns boolean language sql stable security definer set search_path='' as $$
  select public.current_user_has_product_access() and exists(
    select 1 from public.upload_intents i
    where i.user_id=auth.uid() and i.bucket=p_bucket and i.storage_path=p_name
      and i.consumed_at is null and i.cancelled_at is null and i.expires_at>now()
  );
$$;
revoke all on function public.can_upload_storage_object(text,text) from public,anon;
grant execute on function public.can_upload_storage_object(text,text) to authenticated;

create or replace function public.cancel_upload_intent(p_intent_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v public.upload_intents;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not public.current_session_satisfies_mfa_if_enrolled() then raise exception 'mfa_required'; end if;
  select * into v from public.upload_intents where id=p_intent_id and user_id=auth.uid() for update;
  if v.id is null then return; end if;
  if v.consumed_at is null and v.cancelled_at is null then
    update public.upload_intents set cancelled_at=now() where id=v.id;
    insert into public.storage_gc_queue(bucket,storage_path,queued_at,not_before,attempts,last_error)
    values(v.bucket,v.storage_path,now(),now()+interval '15 minutes',0,null)
    on conflict(bucket,storage_path) do update set queued_at=excluded.queued_at,not_before=excluded.not_before,attempts=0,last_error=null;
  end if;
end $$;
revoke all on function public.cancel_upload_intent(uuid) from public,anon;
grant execute on function public.cancel_upload_intent(uuid) to authenticated;

create or replace function public.get_conversation_messages(p_conversation_id uuid,p_limit integer default 100)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'conversationId',x.conversation_id,'senderPetId',x.sender_pet_id,'body',x.body,
    'createdAt',x.created_at,'readAt',x.read_at,'moderationStatus',x.moderation_status
  ) order by x.created_at),'[]'::jsonb)
  from (
    select msg.*
    from public.messages msg
    join public.conversations c on c.id=msg.conversation_id
    join public.pet_matches m on m.id=c.match_id
    where public.current_user_has_product_access()
      and msg.conversation_id=p_conversation_id
      and m.unmatched_at is null
      and not public.is_blocked(m.pet_low_id,m.pet_high_id)
      and exists(select 1 from public.pets p where p.owner_id=auth.uid() and p.id in(m.pet_low_id,m.pet_high_id))
      and (msg.moderation_status='approved' or exists(select 1 from public.pets sp where sp.id=msg.sender_pet_id and sp.owner_id=auth.uid()))
    order by msg.created_at desc,msg.id desc
    limit least(greatest(p_limit,1),200)
  ) x;
$$;
revoke all on function public.get_conversation_messages(uuid,integer) from public,anon;
grant execute on function public.get_conversation_messages(uuid,integer) to authenticated;

create or replace function public.get_conversation_messages_page(p_conversation_id uuid,p_limit integer default 40,p_before_created_at timestamptz default null,p_before_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'conversationId',x.conversation_id,'senderPetId',x.sender_pet_id,'body',x.body,
    'createdAt',x.created_at,'readAt',x.read_at,'moderationStatus',x.moderation_status
  ) order by x.created_at,x.id),'[]'::jsonb)
  from (
    select msg.*
    from public.messages msg
    join public.conversations c on c.id=msg.conversation_id
    join public.pet_matches m on m.id=c.match_id
    where public.current_user_has_product_access()
      and msg.conversation_id=p_conversation_id
      and m.unmatched_at is null
      and not public.is_blocked(m.pet_low_id,m.pet_high_id)
      and exists(select 1 from public.pets p where p.owner_id=auth.uid() and p.id in(m.pet_low_id,m.pet_high_id))
      and (msg.moderation_status='approved' or exists(select 1 from public.pets sp where sp.id=msg.sender_pet_id and sp.owner_id=auth.uid()))
      and (p_before_created_at is null or (msg.created_at,msg.id)<(p_before_created_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by msg.created_at desc,msg.id desc
    limit least(greatest(p_limit,1),100)
  ) x;
$$;
revoke all on function public.get_conversation_messages_page(uuid,integer,timestamptz,uuid) from public,anon;
grant execute on function public.get_conversation_messages_page(uuid,integer,timestamptz,uuid) to authenticated;

create or replace function public.get_my_reports(p_limit integer default 100)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.current_session_satisfies_mfa_if_enrolled() then
    coalesce(jsonb_agg(jsonb_build_object(
      'id',r.id,'targetType',r.target_type,'targetId',r.target_id,'reason',r.reason,
      'details',r.details,'status',r.status,'createdAt',r.created_at
    ) order by r.created_at desc),'[]'::jsonb)
  else '[]'::jsonb end
  from (select * from public.reports where reporter_user_id=auth.uid() order by created_at desc limit least(greatest(p_limit,1),200)) r;
$$;
revoke all on function public.get_my_reports(integer) from public,anon;
grant execute on function public.get_my_reports(integer) to authenticated;

create or replace function public.get_my_reports_page(
  p_limit integer default 40,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
) returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.current_session_satisfies_mfa_if_enrolled() then
    coalesce(jsonb_agg(jsonb_build_object(
      'id',r.id,'targetType',r.target_type,'targetId',r.target_id,'reason',r.reason,
      'details',r.details,'status',r.status,'createdAt',r.created_at
    ) order by r.created_at desc,r.id desc),'[]'::jsonb)
  else '[]'::jsonb end
  from (
    select * from public.reports
    where reporter_user_id=auth.uid()
      and (p_before_created_at is null or (created_at,id)<(p_before_created_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by created_at desc,id desc
    limit least(greatest(p_limit,1),100)
  ) r;
$$;
revoke all on function public.get_my_reports_page(integer,timestamptz,uuid) from public,anon;
grant execute on function public.get_my_reports_page(integer,timestamptz,uuid) to authenticated;

-- Preserve the legacy RPC for backwards compatibility, but make it obey the same product/MFA
-- boundary as the paginated replacement used by current clients.
create or replace function public.get_notifications(p_limit integer default 100)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.current_user_has_product_access() then
    coalesce(jsonb_agg(jsonb_build_object(
      'id',n.id,'type',n.type,'title',n.title,'body',n.body,'createdAt',n.created_at,'readAt',n.read_at,'entityId',n.entity_id
    ) order by n.created_at desc),'[]'::jsonb)
  else '[]'::jsonb end
  from (
    select * from public.notifications
    where user_id=auth.uid()
    order by created_at desc
    limit least(greatest(p_limit,1),200)
  ) n;
$$;
revoke all on function public.get_notifications(integer) from public,anon;
grant execute on function public.get_notifications(integer) to authenticated;
