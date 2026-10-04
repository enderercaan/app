-- Tailmance v19 R8 ultra-deep audit: health write response-loss idempotency.
-- A successful server commit must remain safe when the HTTP response is lost and the
-- exact client intent is retried. New writes continue through the existing validation,
-- rate-limit, audit, upload-intent and moderation contracts.

create or replace function public.upsert_vaccination_idempotent(
  p_pet_id uuid,
  p_vaccination_id uuid,
  p_vaccine_name text,
  p_dose_date date,
  p_next_due_date date,
  p_client_operation_id text
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_op text:=trim(coalesce(p_client_operation_id,''));
  v_name text:=trim(coalesce(p_vaccine_name,''));
  v_hash text;
  v_receipt public.client_mutation_receipts%rowtype;
  v_id uuid;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if v_op !~ '^[A-Za-z0-9_-]{16,96}$' then raise exception 'invalid_client_operation_id'; end if;

  v_hash:=public.client_mutation_hash(jsonb_build_object(
    'petId',p_pet_id,
    'vaccinationId',p_vaccination_id,
    'vaccineName',v_name,
    'doseDate',p_dose_date,
    'nextDueDate',p_next_due_date
  ));

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(auth.uid()::text||':vaccination_upsert:'||v_op,0)
  );

  select * into v_receipt
  from public.client_mutation_receipts
  where user_id=auth.uid() and action='vaccination_upsert' and operation_id=v_op;

  if v_receipt.user_id is not null then
    if v_receipt.request_hash<>v_hash then raise exception 'client_operation_id_reused'; end if;
    return (v_receipt.result->>'id')::uuid;
  end if;

  v_id:=public.upsert_vaccination(
    p_pet_id,p_vaccination_id,v_name,p_dose_date,p_next_due_date
  );

  insert into public.client_mutation_receipts(user_id,action,operation_id,request_hash,result)
  values(auth.uid(),'vaccination_upsert',v_op,v_hash,jsonb_build_object('id',v_id));
  return v_id;
end $$;

-- Deletion is a desired end-state. If an exact retry arrives after the first commit,
-- return success without consuming another rate-limit unit or emitting a duplicate audit row.
create or replace function public.delete_vaccination(p_pet_id uuid,p_vaccination_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_exists boolean;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  perform 1 from public.pets where id=p_pet_id for update;
  select exists(
    select 1 from public.pet_vaccinations
    where id=p_vaccination_id and pet_id=p_pet_id
  ) into v_exists;
  if not v_exists then return; end if;

  perform public.rate_limit('vaccination_delete',30,3600);
  delete from public.pet_vaccinations where id=p_vaccination_id and pet_id=p_pet_id;
  if not found then return; end if;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id)
  values(auth.uid(),p_pet_id,'vaccination_deleted','vaccination',p_vaccination_id);
end $$;

-- Health claims are desired-state writes. Repeating the already-committed value is a no-op.
create or replace function public.update_pet_health_claims(p_pet_id uuid,p_neutered boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v_has_row boolean; v_current boolean;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  perform 1 from public.pets where id=p_pet_id for update;
  select exists(select 1 from public.pet_health_summary where pet_id=p_pet_id),
         (select neutered from public.pet_health_summary where pet_id=p_pet_id)
    into v_has_row,v_current;
  if (v_has_row and v_current is not distinct from p_neutered)
     or (not v_has_row and p_neutered is null) then
    return;
  end if;

  perform public.rate_limit('pet_health_claim_update',40,86400);
  insert into public.pet_health_summary(pet_id,neutered) values(p_pet_id,p_neutered)
  on conflict(pet_id) do update set neutered=excluded.neutered,updated_at=now();
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id)
  values(auth.uid(),p_pet_id,'pet_health_claim_update','pet',p_pet_id);
end $$;

-- Reconcile an already-attached document before consuming the one-shot upload intent again.
create or replace function public.attach_health_document(p_pet_id uuid,p_document_type text,p_storage_path text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_id uuid;
  v_existing_type text;
  v_type text:=trim(coalesce(p_document_type,''));
  v_path text:=coalesce(p_storage_path,'');
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if char_length(v_type) not between 1 and 80 then raise exception 'invalid_document_type'; end if;
  perform 1 from public.pets where id=p_pet_id for update;

  select id,document_type into v_id,v_existing_type
  from public.health_documents
  where pet_id=p_pet_id and storage_path=v_path
  order by created_at desc,id desc limit 1;
  if v_id is not null then
    if v_existing_type is distinct from v_type then raise exception 'storage_path_already_attached'; end if;
    return v_id;
  end if;

  perform public.rate_limit('health_document_attach',10,3600);
  perform public.consume_upload_intent(p_pet_id,'health-documents','health_document',v_path);
  insert into public.health_documents(pet_id,document_type,storage_path,verification_status)
  values(p_pet_id,v_type,v_path,'pending') returning id into v_id;
  insert into public.moderation_items(
    target_type,target_id,status,manual_review_required,next_attempt_at,last_error_code
  ) values(
    'health_document',v_id,'pending',true,null,'manual_health_review_required'
  )
  on conflict(target_type,target_id) do update set
    status='pending',reason=null,reviewed_at=null,manual_review_required=true,
    next_attempt_at=null,last_error_code='manual_health_review_required';
  return v_id;
end $$;

-- Reconcile an already-committed profile-photo slot before consuming its upload intent again.
create or replace function public.attach_pet_photo(p_pet_id uuid,p_storage_path text,p_sort_order smallint)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_id uuid;
  v_existing_path text;
  v_purpose text;
  v_path text:=coalesce(p_storage_path,'');
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_sort_order not between 1 and 3 then raise exception 'invalid_photo_slot'; end if;
  perform 1 from public.pets where id=p_pet_id for update;

  select id,storage_path into v_id,v_existing_path
  from public.pet_photos where pet_id=p_pet_id and sort_order=p_sort_order;
  if v_id is not null and v_existing_path=v_path then return v_id; end if;

  perform public.rate_limit('photo_attach',20,3600);
  v_purpose:='pet_photo_'||p_sort_order::text;
  perform public.consume_upload_intent(p_pet_id,'pet-photos',v_purpose,v_path);
  perform public.cancel_pending_pet_verification(p_pet_id,'profile_photo_changed');

  insert into public.pet_photos(pet_id,storage_path,sort_order,moderation_status)
  values(p_pet_id,v_path,p_sort_order,'pending')
  on conflict(pet_id,sort_order) do update
    set storage_path=excluded.storage_path,moderation_status='pending',moderation_reason=null,updated_at=now()
  returning id into v_id;
  update public.pets set profile_verified=false where id=p_pet_id;
  insert into public.moderation_items(target_type,target_id,status)
  values('pet_photo',v_id,'pending')
  on conflict(target_type,target_id) do update set status='pending',reason=null,reviewed_at=null;
  return v_id;
end $$;

-- The normal signed-in client may only use the receipt-backed vaccination write surface.
revoke all on function public.upsert_vaccination(uuid,uuid,text,date,date) from public,anon,authenticated;
revoke all on function public.upsert_vaccination_idempotent(uuid,uuid,text,date,date,text) from public,anon;
grant execute on function public.upsert_vaccination_idempotent(uuid,uuid,text,date,date,text) to authenticated;

revoke all on function public.delete_vaccination(uuid,uuid) from public,anon;
grant execute on function public.delete_vaccination(uuid,uuid) to authenticated;
revoke all on function public.update_pet_health_claims(uuid,boolean) from public,anon;
grant execute on function public.update_pet_health_claims(uuid,boolean) to authenticated;
revoke all on function public.attach_health_document(uuid,text,text) from public,anon;
grant execute on function public.attach_health_document(uuid,text,text) to authenticated;
revoke all on function public.attach_pet_photo(uuid,text,smallint) from public,anon;
grant execute on function public.attach_pet_photo(uuid,text,smallint) to authenticated;
