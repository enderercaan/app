-- Tailmance migration 206 (2026-10-25).
--
-- 1. The AI document check may now attest the microchip number it read from the booklet (ISO 11784 structure,
--    consistent across pages, matching the owner-entered number when one exists). The signal carries no expiry.
-- 2. The pet-friendly places directory and the partner profiles no longer have a health-service category.
-- 3. The server-side vaccination reminder text no longer refers to anyone's plan; it points to the booklet.

create or replace function public.tm206_patch_function(p_signature regprocedure,p_anchor text,p_replacement text)
returns void language plpgsql set search_path='' as $$
declare v_def text:=pg_catalog.pg_get_functiondef(p_signature); v_count int;
begin
  v_count:=(length(v_def)-length(replace(v_def,p_anchor,'')))/greatest(length(p_anchor),1);
  if v_count<>1 then raise exception 'tm206_patch_anchor_count %:% for %',v_count,left(p_anchor,60),p_signature; end if;
  execute replace(v_def,p_anchor,p_replacement);
end $$;
revoke all on function public.tm206_patch_function(regprocedure,text,text) from public,anon,authenticated;

-- 1. Microchip signal from the AI document check -------------------------------------------------------------
select public.tm206_patch_function('public.service_apply_health_verification_attestation(uuid,text,text,text,text,timestamptz,timestamptz)'::regprocedure,
  $a$if p_signal not in ('vaccination_complete') then raise exception 'ai_document_check_signal_not_allowed'; end if;$a$,
  $b$if p_signal not in ('vaccination_complete','microchip_verified') then raise exception 'ai_document_check_signal_not_allowed'; end if;$b$);

select public.tm206_patch_function('public.service_apply_health_ai_result(uuid,text,text,text,numeric,text,text,jsonb,integer)'::regprocedure,
  $a$if v_signal_name<>'vaccination_complete' or v_signal_conf is null$a$,
  $b$if v_signal_name not in ('vaccination_complete','microchip_verified') or v_signal_conf is null$b$);

-- 2. No health-service category in places and partner profiles -----------------------------------------------
delete from public.business_partner_profiles where business_type='veterinary';
delete from public.pet_friendly_places where category='veterinary';

do $$ declare c record; begin
  for c in select conrelid::regclass as tbl, conname from pg_constraint
           where contype='c' and conrelid in ('public.pet_friendly_places'::regclass,'public.business_partner_profiles'::regclass)
             and pg_get_constraintdef(oid) like '%veterinary%' loop
    execute format('alter table %s drop constraint %I',c.tbl,c.conname);
  end loop;
end $$;
alter table public.pet_friendly_places add constraint pet_friendly_places_category_check
  check (category in ('park','cafe','restaurant','groomer','trainer','hotel','shop','other'));
alter table public.business_partner_profiles add constraint business_partner_profiles_business_type_check
  check (business_type in ('pet_friendly_place','groomer','trainer','brand'));

select public.tm206_patch_function('public.get_pet_friendly_places(uuid,text,integer)'::regprocedure,
  $a$'restaurant','veterinary','groomer'$a$,
  $b$'restaurant','groomer'$b$);

-- 3. Vaccination reminder text ---------------------------------------------------------------------------------
select public.tm206_patch_function('public.enqueue_vaccination_reminders()'::regprocedure,
  $a$ Check your veterinarian''s plan.$a$,
  $b$ Check your vaccination booklet.$b$);

drop function public.tm206_patch_function(regprocedure,text,text);
