-- v19 bridge from content-moderation outcomes into the formal user-facing decision ledger.
alter table public.moderation_decisions add column if not exists source_reference text;
create unique index if not exists moderation_decisions_source_reference_uq
  on public.moderation_decisions(source_reference) where source_reference is not null;

create or replace function public.record_moderation_restriction_decision(
  p_target_type text,
  p_target_id uuid,
  p_source text,
  p_user_visible_reason text,
  p_source_reference text
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_user_id uuid;
  v_formal_target_type text;
  v_id uuid;
  v_pet_id uuid;
  v_post_id uuid;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if p_source not in ('automated','manual') then raise exception 'invalid_decision_source'; end if;
  if p_target_id is null then raise exception 'target_id_required'; end if;
  if p_user_visible_reason is null or char_length(trim(p_user_visible_reason)) not between 3 and 2000 then raise exception 'user_visible_reason_required'; end if;
  if p_source_reference is null or char_length(trim(p_source_reference)) not between 3 and 200 then raise exception 'source_reference_required'; end if;

  select id into v_id from public.moderation_decisions where source_reference=p_source_reference;
  if v_id is not null then return v_id; end if;

  if p_target_type='pet_text' then
    v_formal_target_type:='pet';
    select owner_id into v_user_id from public.pets where id=p_target_id;
  elsif p_target_type='pet_photo' then
    v_formal_target_type:='pet_photo';
    select pet_id into v_pet_id from public.pet_photos where id=p_target_id;
    select owner_id into v_user_id from public.pets where id=v_pet_id;
  elsif p_target_type='post_text' then
    v_formal_target_type:='post';
    select pet_id into v_pet_id from public.posts where id=p_target_id;
    select owner_id into v_user_id from public.pets where id=v_pet_id;
  elsif p_target_type='post_media' then
    v_formal_target_type:='post_media';
    select post_id into v_post_id from public.post_media where id=p_target_id;
    select pet_id into v_pet_id from public.posts where id=v_post_id;
    select owner_id into v_user_id from public.pets where id=v_pet_id;
  elsif p_target_type='comment_text' then
    v_formal_target_type:='comment';
    select pet_id into v_pet_id from public.comments where id=p_target_id;
    select owner_id into v_user_id from public.pets where id=v_pet_id;
  elsif p_target_type='message_text' then
    v_formal_target_type:='message';
    select sender_pet_id into v_pet_id from public.messages where id=p_target_id;
    select owner_id into v_user_id from public.pets where id=v_pet_id;
  elsif p_target_type='story' then
    v_formal_target_type:='story';
    select pet_id into v_pet_id from public.stories where id=p_target_id;
    select owner_id into v_user_id from public.pets where id=v_pet_id;
  elsif p_target_type='event_text' then
    v_formal_target_type:='event';
    select creator_pet_id into v_pet_id from public.pet_events where id=p_target_id;
    select owner_id into v_user_id from public.pets where id=v_pet_id;
  elsif p_target_type='meetup_text' then
    v_formal_target_type:='meetup';
    select proposed_by_pet_id into v_pet_id from public.meetup_requests where id=p_target_id;
    select owner_id into v_user_id from public.pets where id=v_pet_id;
  elsif p_target_type='health_document' then
    v_formal_target_type:='health_document';
    select pet_id into v_pet_id from public.health_documents where id=p_target_id;
    select owner_id into v_user_id from public.pets where id=v_pet_id;
  elsif p_target_type='pet_verification' then
    v_formal_target_type:='pet_verification';
    select owner_id into v_user_id from public.pet_verification_requests where id=p_target_id;
  else
    raise exception 'unsupported_moderation_target_type';
  end if;

  if v_user_id is null then raise exception 'moderation_target_owner_not_found'; end if;
  insert into public.moderation_decisions(
    affected_user_id,target_type,target_id,action,source,user_visible_reason,status,restoration_required,source_reference
  ) values(
    v_user_id,v_formal_target_type,p_target_id,'content_removed',p_source,trim(p_user_visible_reason),'active',true,trim(p_source_reference)
  ) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_moderation_restriction_decision(text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.record_moderation_restriction_decision(text,uuid,text,text,text) to service_role;
