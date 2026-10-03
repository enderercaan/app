-- Tailmance TUR 2: private storage reads require the requester to retain current product access.
create or replace function public.can_read_storage_object(p_bucket text,p_name text)
returns boolean language sql stable security definer set search_path='' as $$
  select public.current_user_has_product_access() and case
    when p_bucket='pet-photos' then exists(
      select 1
      from public.pet_photos ph
      join public.pets p on p.id=ph.pet_id
      join public.users u on u.id=p.owner_id
      where ph.storage_path=p_name
        and (
          p.owner_id=auth.uid()
          or (
            ph.moderation_status='approved'
            and p.moderation_status='approved'
            and u.suspended_at is null and u.paused_at is null
            and not exists(
              select 1 from public.pets mine
              where mine.owner_id=auth.uid() and public.is_blocked(mine.id,p.id)
            )
          )
        )
    )
    when p_bucket='health-documents' then exists(
      select 1 from public.health_documents h join public.pets p on p.id=h.pet_id
      where h.storage_path=p_name and p.owner_id=auth.uid()
    )
    when p_bucket='pet-verification' then exists(
      select 1 from public.pet_verification_requests r
      where r.storage_path=p_name and r.owner_id=auth.uid()
    )
    when p_bucket='social-media' then exists(
      select 1
      from public.post_media pm
      join public.posts po on po.id=pm.post_id
      join public.pets p on p.id=po.pet_id
      join public.users u on u.id=p.owner_id
      where pm.storage_path=p_name
        and (
          p.owner_id=auth.uid()
          or (
            pm.moderation_status='approved'
            and po.moderation_status='approved'
            and po.deleted_at is null
            and p.moderation_status='approved'
            and u.suspended_at is null and u.paused_at is null
            and not exists(
              select 1 from public.pets mine
              where mine.owner_id=auth.uid() and public.is_blocked(mine.id,p.id)
            )
          )
        )
    ) or exists(
      select 1
      from public.stories s
      join public.pets p on p.id=s.pet_id
      join public.users u on u.id=p.owner_id
      where s.storage_path=p_name
        and (
          p.owner_id=auth.uid()
          or (
            s.moderation_status='approved'
            and s.expires_at>now()
            and p.moderation_status='approved'
            and u.suspended_at is null and u.paused_at is null
            and exists(
              select 1 from public.pets mine
              where mine.owner_id=auth.uid()
                and not public.is_blocked(mine.id,p.id)
                and exists(select 1 from public.follows f where f.from_pet_id=mine.id and f.to_pet_id=p.id)
            )
          )
        )
    )
    else false
  end;
$$;
revoke all on function public.can_read_storage_object(text,text) from public,anon;
grant execute on function public.can_read_storage_object(text,text) to authenticated;
