-- Tailmance v19 R8: canonicalize health-document type before AI/OCR processing.
-- The current mobile product intentionally exposes one private health-document upload class:
-- health_record. Do not pass arbitrary user-controlled labels to the external AI provider.
-- Existing historical rows are preserved; an unsupported legacy row fails safe to manual review.

create or replace function public.attach_health_document(p_pet_id uuid,p_document_type text,p_storage_path text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_id uuid;
  v_existing_type text;
  v_type text:=trim(coalesce(p_document_type,''));
  v_path text:=coalesce(p_storage_path,'');
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if v_type<>'health_record' then raise exception 'unsupported_health_document_type'; end if;
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

create or replace function public.service_route_health_ai_manual_review(
  p_health_document_id uuid,
  p_error_code text default 'health_ai_manual_review_required'
)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_code text:=left(coalesce(nullif(trim(p_error_code),''),'health_ai_manual_review_required'),120);
begin
  perform 1 from public.health_ai_jobs where health_document_id=p_health_document_id for update;
  if not found then return; end if;

  update public.health_ai_jobs set
    status='manual_review',claimed_at=null,completed_at=now(),not_before=now(),
    last_error_code=v_code,updated_at=now()
  where health_document_id=p_health_document_id;

  update public.moderation_items set
    status='pending',manual_review_required=true,reviewed_at=null,next_attempt_at=null,
    last_error_code=v_code,reason=null
  where target_type='health_document' and target_id=p_health_document_id;
end $$;
revoke all on function public.service_route_health_ai_manual_review(uuid,text) from public,anon,authenticated;
grant execute on function public.service_route_health_ai_manual_review(uuid,text) to service_role;
