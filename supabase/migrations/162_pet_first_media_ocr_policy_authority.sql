-- Tailmance v19 R8 — deterministic pet-first moderation authority for OCR/media provider output.
-- Provider AI is a signal, never the sole policy authority. Service-role workers can ask the
-- canonical database policy helpers to classify OCR text; end-user roles cannot invoke them.

create or replace function public.contains_prohibited_pet_commerce_intent(p_text text)
returns boolean
language plpgsql
immutable
set search_path=''
as $$
declare v text:=lower(trim(coalesce(p_text,'')));
begin
  if v='' then return false; end if;
  return
    v ~ '(puppy|kitten|dog|cat|pet)[[:space:]]+(for[[:space:]]+sale|for[[:space:]]+purchase)'
    or v ~ '(sell|selling)[[:space:]]+(my[[:space:]]+)?(puppy|kitten|dog|cat|pet)'
    or v ~ '(breeder|breeding)[[:space:]]+(service|business|listing|offer)'
    or v ~ 'stud[[:space:]]+fee'
    or v ~ '(satılık|satilik)[[:space:]]+(yavru|köpek|kopek|kedi|pet)'
    or v ~ '(yavru|köpek|kopek|kedi)[[:space:]]+(satışı|satisi|satılık|satilik)'
    or v ~ '(damızlık|damizlik)[[:space:]]+(ücret|ucret|ilan|hizmet)'
    or v ~ '(chiot|chaton)[[:space:]]+à[[:space:]]+vendre'
    or v ~ '(welpe|kätzchen|katzenbaby)[[:space:]]+zu[[:space:]]+verkaufen'
    or v ~ '(cucciolo|gattino)[[:space:]]+in[[:space:]]+vendita'
    or p_text ~ '(出售|售卖|售賣).{0,8}(幼犬|小狗|幼猫|幼貓|猫|貓)'
    or p_text ~ '(子犬|子猫).{0,8}(販売|売ります)'
    or p_text ~ '(강아지|고양이).{0,8}(판매|팝니다)'
    or p_text ~ 'ขาย.{0,8}(ลูกสุนัข|ลูกแมว)'
    or v ~ 'jual[[:space:]]+(anak[[:space:]]+anjing|anak[[:space:]]+kucing)'
    or v ~ '(vendo|vender)[[:space:]]+(filhote|cachorro|gato)';
end $$;
revoke all on function public.contains_prohibited_pet_commerce_intent(text) from public,anon,authenticated;
grant execute on function public.contains_prohibited_pet_commerce_intent(text) to service_role;

grant execute on function public.contains_prohibited_pet_rehoming_intent(text) to service_role;
grant execute on function public.contains_prohibited_human_dating_intent(text) to service_role;

-- Keep the cross-surface trigger on the same canonical commerce/dating helpers used by media OCR.
create or replace function public.reject_pet_commerce_ugc()
returns trigger language plpgsql set search_path='' as $$
declare v_text text:='';
begin
  if tg_table_name='messages' then v_text:=coalesce(new.body,'');
  elsif tg_table_name='posts' then v_text:=coalesce(new.caption,'');
  elsif tg_table_name='comments' then v_text:=coalesce(new.body,'');
  elsif tg_table_name='pet_events' then v_text:=concat_ws(' ',coalesce(new.title,''),coalesce(new.description,''));
  elsif tg_table_name='meetup_requests' then v_text:=concat_ws(' ',coalesce(new.public_place_label,''),coalesce(new.note,''));
  elsif tg_table_name='pets' then v_text:=coalesce(new.bio,'');
  elsif tg_table_name='pet_prompts' then v_text:=coalesce(new.answer,'');
  end if;
  if public.contains_prohibited_pet_commerce_intent(v_text) then raise exception 'pet_commerce_prohibited'; end if;
  if public.contains_prohibited_human_dating_intent(v_text) then raise exception 'human_dating_prohibited'; end if;
  return new;
end $$;
revoke all on function public.reject_pet_commerce_ugc() from public,anon,authenticated;
