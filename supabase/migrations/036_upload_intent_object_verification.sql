-- Tailmance TUR 2: an upload intent may be consumed only after the expected Storage object exists.
-- The storage schema is queried read-only; object writes/deletes continue to go through Storage APIs.
create or replace function public.consume_upload_intent(p_pet_id uuid,p_bucket text,p_purpose text,p_path text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_intent public.upload_intents%rowtype;
  v_size_text text;
  v_mime text;
  v_size bigint;
  v_max_bytes bigint;
begin
  select * into v_intent
  from public.upload_intents
  where user_id=auth.uid()
    and pet_id=p_pet_id
    and bucket=p_bucket
    and purpose=p_purpose
    and storage_path=p_path
    and consumed_at is null
    and cancelled_at is null
    and expires_at>now()
  order by created_at desc
  limit 1
  for update;

  if v_intent.id is null then raise exception 'valid_upload_intent_required'; end if;

  v_max_bytes:=case v_intent.bucket
    when 'pet-photos' then 10485760::bigint
    when 'social-media' then 15728640::bigint
    when 'health-documents' then 15728640::bigint
    when 'pet-verification' then 10485760::bigint
    else null end;
  if v_max_bytes is null then raise exception 'invalid_upload_bucket'; end if;

  select o.metadata->>'size',o.metadata->>'mimetype'
  into v_size_text,v_mime
  from storage.objects o
  where o.bucket_id=v_intent.bucket and o.name=v_intent.storage_path
  limit 1;

  if v_size_text is null or v_mime is null then raise exception 'uploaded_object_required'; end if;
  if v_size_text !~ '^[0-9]+$' then raise exception 'invalid_uploaded_object_metadata'; end if;
  v_size:=v_size_text::bigint;
  if v_size<=0 or v_size>v_max_bytes then raise exception 'invalid_uploaded_object_size'; end if;
  if lower(v_mime)<>lower(v_intent.mime_type) then raise exception 'uploaded_object_mime_mismatch'; end if;

  update public.upload_intents set consumed_at=now() where id=v_intent.id;
  return v_intent.id;
end $$;

revoke all on function public.consume_upload_intent(uuid,text,text,text) from public,anon,authenticated;
