-- Tailmance is a pet-first social network, not a human dating service.
-- Explicit romantic/hook-up solicitation through pet profiles or UGC is prohibited.
-- Owner friendship in a pet/activity context remains allowed.

create or replace function public.contains_prohibited_human_dating_intent(p_text text)
returns boolean language plpgsql immutable set search_path='' as $$
declare v text:=lower(trim(coalesce(p_text,'')));
begin
  if v='' then return false; end if;
  return
    v ~ '\m(looking|searching)[[:space:]]+for[[:space:]]+(a[[:space:]]+)?(girlfriend|boyfriend|romantic[[:space:]]+partner|date|hookup)\M'
    or v ~ '\mhere[[:space:]]+to[[:space:]]+(date|hook[[:space:]]*up)[[:space:]]+(people|humans|owners|men|women)\M'
    or v ~ '\msingle[[:space:]]+(man|woman|guy|girl)[[:space:]]+(looking|seeking)[[:space:]]+for\M'
    or v ~ '\m(sevgili|flört|flort)[[:space:]]+arıyorum\M'
    or v ~ '\m(insan|sahip)[[:space:]]+(date|flört|flort)[[:space:]]+(arıyorum|icin|için)\M'
    or v ~ '\mbusco[[:space:]]+(novio|novia|pareja[[:space:]]+romántica|cita)\M'
    or v ~ '\mprocuro[[:space:]]+(namorado|namorada|parceiro[[:space:]]+romântico|parceira[[:space:]]+romântica)\M'
    or v ~ '\mje[[:space:]]+cherche[[:space:]]+(un[[:space:]]+copain|une[[:space:]]+copine|un[[:space:]]+partenaire[[:space:]]+romantique|une[[:space:]]+relation)\M'
    or v ~ '\m(suche|suche[[:space:]]+nach)[[:space:]]+(freundin|freund|romantischem[[:space:]]+partner|date)\M'
    or v ~ '\mcerco[[:space:]]+(fidanzato|fidanzata|partner[[:space:]]+romantico|partner[[:space:]]+romantica)\M'
    or v ~ '(ищу[[:space:]]+(парня|девушку|романтического[[:space:]]+партнера|отношения))'
    or p_text ~ '(找男朋友|找女朋友|找对象|找對象|約會對象|约会对象)'
    or p_text ~ '(恋人募集|彼氏募集|彼女募集|出会い目的)'
    or p_text ~ '(남자친구[[:space:]]*구해|여자친구[[:space:]]*구해|연애[[:space:]]*상대[[:space:]]*찾)'
    or p_text ~ '(أبحث عن حبيب|أبحث عن حبيبة|أبحث عن شريك رومانسي)'
    or p_text ~ '(बॉयफ्रेंड ढूंढ|गर्लफ्रेंड ढूंढ|रोमांटिक पार्टनर ढूंढ)'
    or v ~ '\mcari[[:space:]]+(pacar|kekasih|pasangan[[:space:]]+romantis)\M'
    or v ~ '\mik[[:space:]]+zoek[[:space:]]+(een[[:space:]]+vriendje|een[[:space:]]+vriendin|romantische[[:space:]]+partner)\M'
    or v ~ '\mszukam[[:space:]]+(chłopaka|dziewczyny|partnera[[:space:]]+romantycznego|partnerki[[:space:]]+romantycznej)\M'
    or p_text ~ '(หาแฟน|หาคนคุยเชิงรัก|หาคู่รัก)'
    or v ~ '\m(tìm|tim)[[:space:]]+(bạn[[:space:]]+trai|ban[[:space:]]+trai|bạn[[:space:]]+gái|ban[[:space:]]+gai|người[[:space:]]+yêu|nguoi[[:space:]]+yeu)\M';
end $$;
revoke all on function public.contains_prohibited_human_dating_intent(text) from public,anon,authenticated;

-- Extend the existing cross-surface UGC trigger with pet-first enforcement while retaining no-sale rules.
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

  if lower(v_text) ~ '(puppy|kitten|dog|cat|pet)[[:space:]]+(for[[:space:]]+sale|for[[:space:]]+purchase)'
     or lower(v_text) ~ '(sell|selling)[[:space:]]+(my[[:space:]]+)?(puppy|kitten|dog|cat|pet)'
     or lower(v_text) ~ '(breeder|breeding)[[:space:]]+(service|business|listing|offer)'
     or lower(v_text) ~ 'stud[[:space:]]+fee'
     or lower(v_text) ~ '(satılık|satilik)[[:space:]]+(yavru|köpek|kopek|kedi|pet)'
     or lower(v_text) ~ '(yavru|köpek|kopek|kedi)[[:space:]]+(satışı|satisi|satılık|satilik)'
     or lower(v_text) ~ '(damızlık|damizlik)[[:space:]]+(ücret|ucret|ilan|hizmet)'
     or lower(v_text) ~ '(chiot|chaton)[[:space:]]+à[[:space:]]+vendre'
     or lower(v_text) ~ '(welpe|kätzchen|katzenbaby)[[:space:]]+zu[[:space:]]+verkaufen'
     or lower(v_text) ~ '(cucciolo|gattino)[[:space:]]+in[[:space:]]+vendita'
     or v_text ~ '(出售|售卖|售賣).{0,8}(幼犬|小狗|幼猫|幼貓|猫|貓)'
     or v_text ~ '(子犬|子猫).{0,8}(販売|売ります)'
     or v_text ~ '(강아지|고양이).{0,8}(판매|팝니다)'
     or v_text ~ 'ขาย.{0,8}(ลูกสุนัข|ลูกแมว)'
     or lower(v_text) ~ 'jual[[:space:]]+(anak[[:space:]]+anjing|anak[[:space:]]+kucing)'
     or lower(v_text) ~ '(vendo|vender)[[:space:]]+(filhote|cachorro|gato)'
  then raise exception 'pet_commerce_prohibited';
  end if;

  if public.contains_prohibited_human_dating_intent(v_text) then raise exception 'human_dating_prohibited'; end if;
  return new;
end $$;
revoke all on function public.reject_pet_commerce_ugc() from public,anon,authenticated;

create or replace function public.set_report_sla()
returns trigger language plpgsql set search_path='' as $$
begin
  new.priority:=case
    when lower(new.reason) in ('physical_safety','minor_safety','animal_welfare','credible_threat','lost_pet_abuse') then 'urgent'
    when lower(new.reason) in ('harassment','impersonation','pet_sale','commercial_breeding','scam','human_dating_misuse') then 'high'
    else coalesce(new.priority,'standard')
  end;
  new.assigned_operator:='Yekta Özel';
  new.triage_due_at:=coalesce(new.triage_due_at,new.created_at + case when new.priority='urgent' then interval '15 minutes' when new.priority='high' then interval '4 hours' else interval '24 hours' end);
  new.resolution_target_at:=coalesce(new.resolution_target_at,new.created_at + case when new.priority='urgent' then interval '4 hours' when new.priority='high' then interval '24 hours' else interval '48 hours' end);
  return new;
end $$;
