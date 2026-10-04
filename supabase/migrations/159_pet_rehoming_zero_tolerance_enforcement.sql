-- Tailmance v19 R8: zero-tolerance pet rehoming/adoption UGC enforcement.
-- Tailmance is a social connector, never a pet-sales or adoption/rehoming marketplace.

create or replace function public.contains_prohibited_pet_rehoming_intent(p_text text)
returns boolean language plpgsql immutable set search_path='' as $$
declare v text:=lower(trim(coalesce(p_text,'')));
begin
  if v='' then return false; end if;
  return
    v ~ '\m(dog|cat|pet|puppy|kitten)[[:space:]]+(for[[:space:]]+adoption|needs?[[:space:]]+a[[:space:]]+new[[:space:]]+home|looking[[:space:]]+for[[:space:]]+a[[:space:]]+new[[:space:]]+home|to[[:space:]]+rehome)\M'
    or v ~ '\m(rehome|rehoming|re-home|adopt[[:space:]]+out)[[:space:]]+(my[[:space:]]+)?(dog|cat|pet|puppy|kitten)\M'
    or v ~ '\m(dog|cat|pet|puppy|kitten)[[:space:]]+free[[:space:]]+to[[:space:]]+(a[[:space:]]+)?good[[:space:]]+home\M'
    or v ~ '(perro|gato|cachorro|mascota).{0,20}(en[[:space:]]+adopción|en[[:space:]]+adopcion|busca[[:space:]]+hogar|nuevo[[:space:]]+hogar)'
    or v ~ '(doy|dar)[[:space:]]+en[[:space:]]+adopci(ó|o)n.{0,20}(perro|gato|cachorro|mascota)'
    or v ~ '(cachorro|gato|filhote|pet).{0,20}(para[[:space:]]+adoção|para[[:space:]]+adocao|novo[[:space:]]+lar|doação|doacao)'
    or v ~ '(chien|chat|chiot|chaton).{0,20}(à[[:space:]]+adopter|a[[:space:]]+adopter|cherche[[:space:]]+une[[:space:]]+famille|nouveau[[:space:]]+foyer)'
    or v ~ '(hund|katze|welpe|kätzchen).{0,20}(zur[[:space:]]+adoption|zu[[:space:]]+vermitteln|neues[[:space:]]+zuhause)'
    or v ~ '(cane|gatto|cucciolo).{0,20}(in[[:space:]]+adozione|cerca[[:space:]]+casa|nuova[[:space:]]+casa)'
    or v ~ '(отдам|пристрою).{0,20}(собаку|кошку|щенка|котенка)'
    or v ~ '(собака|кошка|щенок|котенок).{0,20}(ищет[[:space:]]+дом|в[[:space:]]+добрые[[:space:]]+руки)'
    or v ~ '(köpek|kopek|köpeğimi|kopeğimi|kopegimi|kedi|kedimi|yavru).{0,24}(sahiplendir(iyorum|iyoruz|ilecek|mek)?|yuva[[:space:]]+arıyor|yuva[[:space:]]+ariyor|ücretsiz[[:space:]]+sahiplendirme|ucretsiz[[:space:]]+sahiplendirme)'
    or v ~ '(sahiplendiriyorum|sahiplendiriyoruz|sahiplendirilecek|yeni[[:space:]]+yuva[[:space:]]+arıyorum|yeni[[:space:]]+yuva[[:space:]]+ariyorum).{0,24}(köpek|kopek|köpeğimi|kopegimi|kedi|kedimi|yavru)'
    or p_text ~ '(كلب|قطة|جرو|قط).{0,20}(للتبني|للتبنّي|يبحث عن منزل|يبحث عن بيت)'
    or p_text ~ '(कुत्ता|कुत्ते|बिल्ली|पिल्ला).{0,20}(गोद लेने|गोद देना|नया घर)'
    or v ~ '(anjing|kucing|anak[[:space:]]+anjing|anak[[:space:]]+kucing).{0,20}(adopsi|cari[[:space:]]+rumah[[:space:]]+baru|hibah)'
    or p_text ~ '(犬|猫|子犬|子猫).{0,12}(里親募集|譲渡|新しい家族)'
    or p_text ~ '(강아지|고양이).{0,12}(입양|분양|새[[:space:]]*가족)'
    or p_text ~ '(狗|犬|猫|貓|幼犬|幼猫|幼貓).{0,12}(领养|領養|送养|送養|找新家)'
    or v ~ '(hond|kat|puppy|kitten).{0,20}(ter[[:space:]]+adoptie|herplaatsen|nieuw[[:space:]]+thuis)'
    or v ~ '(pies|kot|szczeniak|kociak).{0,20}(do[[:space:]]+adopcji|szuka[[:space:]]+domu|nowy[[:space:]]+dom)'
    or p_text ~ '(สุนัข|แมว|ลูกสุนัข|ลูกแมว).{0,20}(หาบ้าน|รับเลี้ยง|หาคนรับเลี้ยง)'
    or v ~ '(chó|cho|mèo|meo).{0,20}(nhận[[:space:]]+nuôi|nhan[[:space:]]+nuoi|tìm[[:space:]]+nhà[[:space:]]+mới|tim[[:space:]]+nha[[:space:]]+moi)';
end $$;
revoke all on function public.contains_prohibited_pet_rehoming_intent(text) from public,anon,authenticated;

create or replace function public.reject_pet_rehoming_ugc()
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
  if public.contains_prohibited_pet_rehoming_intent(v_text) then raise exception 'pet_rehoming_prohibited'; end if;
  return new;
end $$;
revoke all on function public.reject_pet_rehoming_ugc() from public,anon,authenticated;

do $$
declare v_table text;
begin
  foreach v_table in array array['messages','posts','comments','pet_events','meetup_requests','pets','pet_prompts'] loop
    execute format('drop trigger if exists trg_no_pet_rehoming_%I on public.%I',v_table,v_table);
    execute format('create trigger trg_no_pet_rehoming_%I before insert or update on public.%I for each row execute function public.reject_pet_rehoming_ugc()',v_table,v_table);
  end loop;
end $$;

create or replace function public.set_report_sla()
returns trigger language plpgsql set search_path='' as $$
begin
  new.priority:=case
    when lower(new.reason) in ('physical_safety','minor_safety','animal_welfare','credible_threat','lost_pet_abuse') then 'urgent'
    when lower(new.reason) in ('harassment','impersonation','pet_sale','pet_rehoming','commercial_breeding','scam','human_dating_misuse') then 'high'
    else coalesce(new.priority,'standard')
  end;
  new.assigned_operator:='Yekta Özel';
  new.triage_due_at:=coalesce(new.triage_due_at,new.created_at + case when new.priority='urgent' then interval '15 minutes' when new.priority='high' then interval '4 hours' else interval '24 hours' end);
  new.resolution_target_at:=coalesce(new.resolution_target_at,new.created_at + case when new.priority='urgent' then interval '4 hours' when new.priority='high' then interval '24 hours' else interval '48 hours' end);
  return new;
end $$;
