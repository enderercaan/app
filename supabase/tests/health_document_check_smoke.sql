\set ON_ERROR_STOP 0
\pset tuples_only on
begin;
set local session_replication_role=replica;
insert into auth.users(id,email,email_confirmed_at) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','hc@example.test',now());
insert into public.users(id) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into auth.sessions(id,user_id,aal) values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aal1');
insert into public.pets(id,owner_id,name,species,breed,sex,birth_date,size,city,district) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Rex','dog','Mixed','male','2022-01-10','medium','Istanbul','Kadikoy');
insert into public.pet_health_summary(pet_id) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.health_documents(id,pet_id,document_type,storage_path) values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','health_record','hc/smoke-1.jpg');
insert into public.health_documents(id,pet_id,document_type,storage_path) values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','health_record','hc/smoke-2.jpg');
insert into public.health_ai_jobs(health_document_id,status) values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','processing'),('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','processing');
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select 'HC_BEFORE', public.effective_vaccination_complete('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select 'HC_APPROVED', (public.service_apply_health_ai_result('cccccccc-cccc-4ccc-8ccc-cccccccccccc','google_cloud_vision',repeat('a',64),'google_cloud_vision/document_text_detection+test',0.93,'approved','all_required_entries_current',
  jsonb_build_array(jsonb_build_object('signal','vaccination_complete','confidence',0.92,'verifiedAt',now()-interval '1 minute','expiresAt',now()+interval '30 days')),1200))->>'decision';
select 'HC_DOC', verification_status from public.health_documents where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
select 'HC_SUMMARY', vaccination_status from public.pet_health_summary where pet_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select 'HC_ATTESTATION', signal, method, provider_code from public.health_verification_attestations where health_document_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
select 'HC_CURRENT', public.has_current_vaccination_check('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), public.effective_vaccination_complete('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select 'HC_LOG', system_name, decision from public.ai_inference_logs where target_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
-- a low-confidence signal can never approve: the database downgrades it to manual review
select 'HC_DOWNGRADE', (public.service_apply_health_ai_result('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','google_cloud_vision',repeat('b',64),'google_cloud_vision/document_text_detection+test',0.9,'approved','all_required_entries_current',
  jsonb_build_array(jsonb_build_object('signal','vaccination_complete','confidence',0.8,'verifiedAt',now()-interval '1 minute','expiresAt',now()+interval '30 days')),900))->>'decision';
-- product-access gating (legal acceptance, age gate) is not under test here; the override is rolled back with the transaction
create or replace function public.current_user_has_product_access() returns boolean language sql stable as $$ select true $$;
-- the owner sees the check result, the public JSON shows the effective vaccination state, nothing mentions a veterinarian
select set_config('request.jwt.claims','{"role":"authenticated","sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","session_id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","aal":"aal1","iat":'||extract(epoch from now())::bigint||'}',true);
select 'HC_DETAILS', public.get_pet_health_details('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')->'summary'->'documentCheck'->>'approved';
select 'HC_NO_VET_FIELDS', not (public.get_pet_health_details('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')::text ~* 'veterinarian|clinic|integrity|trust') and not (public.pet_json('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')::text ~* 'veterinarian|clinic|trust');
select 'HC_PET_JSON', public.pet_json('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')->'health'->>'vaccinationStatus';
-- when the check expires the approval and the effective vaccination state lapse
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update public.health_verification_attestations set verified_at=now()-interval '10 days',expires_at=now()-interval '1 day' where health_document_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
select 'HC_EXPIRED', public.has_current_vaccination_check('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), public.effective_vaccination_complete('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select 'HC_PET_JSON_EXPIRED', public.pet_json('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')->'health'->>'vaccinationStatus';
-- the AI may only set the vaccination signal; the free-tier guard blocks the 901st unit and takes refunds
do $$ begin
  begin
    perform public.service_apply_health_verification_attestation('cccccccc-cccc-4ccc-8ccc-cccccccccccc','neutered','ai_document_check','google_cloud_vision',repeat('c',64),now(),null);
    raise notice 'HC_AI_NEUTERED_ALLOWED';
  exception when others then raise notice 'HC_AI_NEUTERED_BLOCKED %',sqlerrm; end;
  for i in 1..14 loop perform public.service_consume_health_ai_units(64,900); end loop;
  perform public.service_consume_health_ai_units(4,900);
  begin
    perform public.service_consume_health_ai_units(1,900);
    raise notice 'HC_UNITS_NOT_BLOCKED';
  exception when others then raise notice 'HC_UNITS_BLOCKED %',sqlerrm; end;
  perform public.service_consume_health_ai_units(-5,900);
  perform public.service_consume_health_ai_units(5,900);
  raise notice 'HC_UNITS_REFUND_OK';
end $$;
rollback;
