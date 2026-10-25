-- Tailmance migration 203: Spec v5.0 care tracking, support centre and communities (2026-10-25).
--
-- Spec v5.0 5.3 + 33.3 (weight log with rapid-change advisory, allergy and sensitivity card, owner-defined
-- medication/vitamin/grooming reminders), 36.4 (support request with ticket number, status tracking, replies),
-- 4.4 + 32.2 + 36.3 (regional/breed communities: rules, owner and moderator pets, membership requests,
-- community feed and community events).
--
-- Design notes
-- * RPC-only tables: RLS on, no table grants, SECURITY DEFINER functions with an empty search_path.
-- * Care data is visible to the pet owner only. The app never suggests a medicine or a dose: reminders hold
--   only what the owner entered from their veterinarian (spec 5.3).
-- * The weight advisory is a neutral "talk to your vet" flag for a change of 10 % or more within 31 days.
-- * Community names, descriptions and rules pass the platform's commerce/rehoming/dating text filters; community
--   rules may add to platform rules but never relax them (spec 4.4). Reports use the existing report flow.

-- ---------------------------------------------------------------------------------------------------------
-- 1. Weight log
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.pet_weight_logs(
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  weight_kg numeric(5,2) not null check (weight_kg between 0.1 and 120),
  measured_on date not null,
  created_at timestamptz not null default now(),
  unique(pet_id,measured_on)
);
alter table public.pet_weight_logs enable row level security;
revoke all on public.pet_weight_logs from public,anon,authenticated;

create or replace function public.get_pet_weight_history(p_pet_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_entries jsonb; v_last record; v_prev record; v_advisory boolean:=false; v_change numeric;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'weightKg',w.weight_kg,'measuredOn',w.measured_on) order by w.measured_on),'[]'::jsonb)
    into v_entries from public.pet_weight_logs w where w.pet_id=p_pet_id;
  select weight_kg,measured_on into v_last from public.pet_weight_logs where pet_id=p_pet_id order by measured_on desc limit 1;
  if v_last.measured_on is not null then
    select weight_kg,measured_on into v_prev from public.pet_weight_logs
    where pet_id=p_pet_id and measured_on<v_last.measured_on and measured_on>=v_last.measured_on-31
    order by measured_on asc limit 1;
    if v_prev.measured_on is not null and v_prev.weight_kg>0 then
      v_change:=round((v_last.weight_kg-v_prev.weight_kg)/v_prev.weight_kg*100,1);
      v_advisory:=abs(v_change)>=10;
    end if;
  end if;
  return jsonb_build_object('entries',v_entries,'changePercent31d',v_change,'vetAdvisory',v_advisory);
end $$;
revoke all on function public.get_pet_weight_history(uuid) from public,anon;
grant execute on function public.get_pet_weight_history(uuid) to authenticated,service_role;

create or replace function public.log_pet_weight(p_pet_id uuid,p_weight_kg numeric,p_measured_on date)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_weight_kg is null or p_weight_kg<0.1 or p_weight_kg>120 then raise exception 'invalid_weight'; end if;
  if p_measured_on is null or p_measured_on>current_date+1 or p_measured_on<current_date-3650 then raise exception 'invalid_measurement_date'; end if;
  perform public.rate_limit('pet_weight_log',60,86400);
  insert into public.pet_weight_logs(pet_id,weight_kg,measured_on) values(p_pet_id,round(p_weight_kg,2),p_measured_on)
  on conflict(pet_id,measured_on) do update set weight_kg=excluded.weight_kg,created_at=now();
  update public.pets set weight_kg=(select w.weight_kg from public.pet_weight_logs w where w.pet_id=p_pet_id order by w.measured_on desc limit 1),updated_at=now()
  where id=p_pet_id;
  return public.get_pet_weight_history(p_pet_id);
end $$;
revoke all on function public.log_pet_weight(uuid,numeric,date) from public,anon;
grant execute on function public.log_pet_weight(uuid,numeric,date) to authenticated,service_role;

create or replace function public.delete_pet_weight_log(p_pet_id uuid,p_log_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  delete from public.pet_weight_logs where id=p_log_id and pet_id=p_pet_id;
  return found;
end $$;
revoke all on function public.delete_pet_weight_log(uuid,uuid) from public,anon;
grant execute on function public.delete_pet_weight_log(uuid,uuid) to authenticated,service_role;

-- ---------------------------------------------------------------------------------------------------------
-- 2. Allergy and sensitivity card
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.pet_allergies(
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  allergen text not null check (char_length(trim(allergen)) between 1 and 80),
  category text not null check (category in ('food','environmental','medication','insect','other')),
  severity text not null default 'unknown' check (severity in ('mild','moderate','severe','unknown')),
  notes text not null default '' check (char_length(notes)<=300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists pet_allergies_unique_allergen on public.pet_allergies(pet_id,lower(allergen));
alter table public.pet_allergies enable row level security;
revoke all on public.pet_allergies from public,anon,authenticated;

create or replace function public.get_pet_allergies(p_pet_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'allergen',a.allergen,'category',a.category,'severity',a.severity,'notes',a.notes,'updatedAt',a.updated_at)
    order by case a.severity when 'severe' then 0 when 'moderate' then 1 when 'mild' then 2 else 3 end,a.allergen) from public.pet_allergies a where a.pet_id=p_pet_id),'[]'::jsonb);
end $$;
revoke all on function public.get_pet_allergies(uuid) from public,anon;
grant execute on function public.get_pet_allergies(uuid) to authenticated,service_role;

create or replace function public.upsert_pet_allergy(p_pet_id uuid,p_allergy_id uuid,p_allergen text,p_category text,p_severity text,p_notes text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_allergen text:=trim(coalesce(p_allergen,'')); v_notes text:=trim(coalesce(p_notes,''));
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if char_length(v_allergen) not between 1 and 80 or char_length(v_notes)>300 then raise exception 'invalid_allergy'; end if;
  if p_category not in ('food','environmental','medication','insect','other') then raise exception 'invalid_allergy_category'; end if;
  if coalesce(p_severity,'unknown') not in ('mild','moderate','severe','unknown') then raise exception 'invalid_allergy_severity'; end if;
  perform public.rate_limit('pet_allergy_write',60,86400);
  begin
    if p_allergy_id is null then
      insert into public.pet_allergies(pet_id,allergen,category,severity,notes) values(p_pet_id,v_allergen,p_category,coalesce(p_severity,'unknown'),v_notes) returning id into v_id;
    else
      update public.pet_allergies set allergen=v_allergen,category=p_category,severity=coalesce(p_severity,'unknown'),notes=v_notes,updated_at=now()
      where id=p_allergy_id and pet_id=p_pet_id returning id into v_id;
      if v_id is null then raise exception 'not_found'; end if;
    end if;
  exception when unique_violation then raise exception 'allergy_already_recorded';
  end;
  return v_id;
end $$;
revoke all on function public.upsert_pet_allergy(uuid,uuid,text,text,text,text) from public,anon;
grant execute on function public.upsert_pet_allergy(uuid,uuid,text,text,text,text) to authenticated,service_role;

create or replace function public.delete_pet_allergy(p_pet_id uuid,p_allergy_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  delete from public.pet_allergies where id=p_allergy_id and pet_id=p_pet_id;
  return found;
end $$;
revoke all on function public.delete_pet_allergy(uuid,uuid) from public,anon;
grant execute on function public.delete_pet_allergy(uuid,uuid) to authenticated,service_role;

-- ---------------------------------------------------------------------------------------------------------
-- 3. Care reminders (owner-defined; never a dosing suggestion)
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.pet_care_reminders(
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  kind text not null check (kind in ('medication','vitamin','grooming','nail_trim','teeth','bath','other')),
  title text not null check (char_length(trim(title)) between 1 and 80),
  every_days integer not null check (every_days between 1 and 365),
  time_of_day time not null,
  time_zone text not null,
  next_due_at timestamptz not null,
  last_done_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pet_care_reminders_due_idx on public.pet_care_reminders(next_due_at) where active;
alter table public.pet_care_reminders enable row level security;
revoke all on public.pet_care_reminders from public,anon,authenticated;

create or replace function public.care_reminder_next_due(p_time_of_day time,p_time_zone text,p_after timestamptz,p_every_days integer)
returns timestamptz language sql stable set search_path='' as $$
  -- First local occurrence of the time of day after p_after, then whole-day steps of p_every_days.
  select case when first_at>p_after then first_at else first_at+make_interval(days=>p_every_days) end
  from (select ((pg_catalog.date_trunc('day',p_after at time zone p_time_zone)+p_time_of_day) at time zone p_time_zone) first_at) s;
$$;
revoke all on function public.care_reminder_next_due(time,text,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.care_reminder_next_due(time,text,timestamptz,integer) to service_role;

create or replace function public.get_pet_care_reminders(p_pet_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,'title',r.title,'everyDays',r.every_days,'timeOfDay',to_char(r.time_of_day,'HH24:MI'),
    'timeZone',r.time_zone,'nextDueAt',r.next_due_at,'lastDoneAt',r.last_done_at,'active',r.active) order by r.active desc,r.next_due_at)
    from public.pet_care_reminders r where r.pet_id=p_pet_id),'[]'::jsonb);
end $$;
revoke all on function public.get_pet_care_reminders(uuid) from public,anon;
grant execute on function public.get_pet_care_reminders(uuid) to authenticated,service_role;

create or replace function public.upsert_pet_care_reminder(p_pet_id uuid,p_reminder_id uuid,p_kind text,p_title text,p_every_days integer,
  p_time_of_day text,p_time_zone text,p_active boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_title text:=trim(coalesce(p_title,'')); v_time time; v_next timestamptz;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_kind not in ('medication','vitamin','grooming','nail_trim','teeth','bath','other') then raise exception 'invalid_reminder_kind'; end if;
  if char_length(v_title) not between 1 and 80 then raise exception 'invalid_reminder_title'; end if;
  if p_every_days is null or p_every_days not between 1 and 365 then raise exception 'invalid_reminder_interval'; end if;
  if p_time_of_day is null or p_time_of_day !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'invalid_reminder_time'; end if;
  if p_time_zone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_time_zone) then raise exception 'invalid_time_zone'; end if;
  if public.contains_prohibited_pet_commerce_intent(v_title) then raise exception 'reminder_title_not_allowed'; end if;
  perform public.rate_limit('pet_care_reminder_write',60,86400);
  v_time:=p_time_of_day::time;
  v_next:=public.care_reminder_next_due(v_time,p_time_zone,now(),1);
  if p_reminder_id is null then
    if (select count(*) from public.pet_care_reminders where pet_id=p_pet_id)>=30 then raise exception 'reminder_limit_reached'; end if;
    insert into public.pet_care_reminders(pet_id,kind,title,every_days,time_of_day,time_zone,next_due_at,active)
    values(p_pet_id,p_kind,v_title,p_every_days,v_time,p_time_zone,v_next,coalesce(p_active,true)) returning id into v_id;
  else
    update public.pet_care_reminders set kind=p_kind,title=v_title,every_days=p_every_days,time_of_day=v_time,time_zone=p_time_zone,
      next_due_at=v_next,active=coalesce(p_active,true),updated_at=now()
    where id=p_reminder_id and pet_id=p_pet_id returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
  end if;
  return v_id;
end $$;
revoke all on function public.upsert_pet_care_reminder(uuid,uuid,text,text,integer,text,text,boolean) from public,anon;
grant execute on function public.upsert_pet_care_reminder(uuid,uuid,text,text,integer,text,text,boolean) to authenticated,service_role;

create or replace function public.mark_pet_care_reminder_done(p_pet_id uuid,p_reminder_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.pet_care_reminders;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  update public.pet_care_reminders
  set last_done_at=now(),next_due_at=public.care_reminder_next_due(time_of_day,time_zone,now(),every_days),updated_at=now()
  where id=p_reminder_id and pet_id=p_pet_id returning * into r;
  if r.id is null then raise exception 'not_found'; end if;
  return jsonb_build_object('id',r.id,'lastDoneAt',r.last_done_at,'nextDueAt',r.next_due_at);
end $$;
revoke all on function public.mark_pet_care_reminder_done(uuid,uuid) from public,anon;
grant execute on function public.mark_pet_care_reminder_done(uuid,uuid) to authenticated,service_role;

create or replace function public.delete_pet_care_reminder(p_pet_id uuid,p_reminder_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  delete from public.pet_care_reminders where id=p_reminder_id and pet_id=p_pet_id;
  return found;
end $$;
revoke all on function public.delete_pet_care_reminder(uuid,uuid) from public,anon;
grant execute on function public.delete_pet_care_reminder(uuid,uuid) to authenticated,service_role;

-- Due reminders become health notifications (owner preference "health" applies in push-dispatch), then
-- move to their next occurrence. Missed occurrences are not replayed one by one.
create or replace function public.run_care_reminders()
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  with due as (
    select r.* from public.pet_care_reminders r
    join public.pets p on p.id=r.pet_id join public.users u on u.id=p.owner_id
    where r.active and r.next_due_at<=now() and u.suspended_at is null
    for update of r skip locked
  ), notified as (
    insert into public.notifications(user_id,type,title,body,entity_id,dedupe_key,template_key,template_params,recipient_pet_id)
    select p.owner_id,'health','Care reminder',d.title,d.id,format('care_reminder:%s:%s',d.id,extract(epoch from d.next_due_at)::bigint),'care_reminder',
           jsonb_build_object('petName',p.name,'reminderTitle',d.title,'kind',d.kind),d.pet_id
    from due d join public.pets p on p.id=d.pet_id
    on conflict (dedupe_key) where dedupe_key is not null do nothing
    returning 1
  )
  update public.pet_care_reminders r set next_due_at=public.care_reminder_next_due(r.time_of_day,r.time_zone,now(),r.every_days)
  from due where r.id=due.id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.run_care_reminders() from public,anon,authenticated;
grant execute on function public.run_care_reminders() to service_role;

-- ---------------------------------------------------------------------------------------------------------
-- 4. Support centre
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.support_tickets(
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique check (ticket_number ~ '^TM-[0-9]{8}-[0-9A-F]{6}$'),
  user_id uuid not null references public.users(id) on delete cascade,
  category text not null check (category in ('account','billing','safety','bug','privacy','lost_pet','other')),
  subject text not null check (char_length(trim(subject)) between 3 and 120),
  status text not null default 'open' check (status in ('open','in_progress','waiting_user','resolved','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_tickets_user_idx on public.support_tickets(user_id,updated_at desc);
create index if not exists support_tickets_queue_idx on public.support_tickets(status,updated_at) where status in ('open','in_progress');
alter table public.support_tickets enable row level security;
revoke all on public.support_tickets from public,anon,authenticated;

create table if not exists public.support_ticket_messages(
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author text not null check (author in ('user','staff')),
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists support_ticket_messages_ticket_idx on public.support_ticket_messages(ticket_id,created_at);
alter table public.support_ticket_messages enable row level security;
revoke all on public.support_ticket_messages from public,anon,authenticated;

create or replace function public.create_support_ticket(p_category text,p_subject text,p_body text,p_client_operation_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_subject text:=trim(coalesce(p_subject,'')); v_body text:=trim(coalesce(p_body,'')); v_op text:=trim(coalesce(p_client_operation_id,''));
  v_hash text; v_receipt public.client_mutation_receipts%rowtype; v_id uuid; v_number text; v_result jsonb;
begin
  -- Support must stay reachable even when product access is limited (billing or legal problems), so only an
  -- authenticated, non-anonymous session is required here.
  if auth.uid() is null or not exists(select 1 from public.users where id=auth.uid()) then raise exception 'authentication_required'; end if;
  if v_op !~ '^[A-Za-z0-9_-]{16,96}$' then raise exception 'invalid_client_operation_id'; end if;
  if p_category not in ('account','billing','safety','bug','privacy','lost_pet','other') then raise exception 'invalid_support_category'; end if;
  if char_length(v_subject) not between 3 and 120 or char_length(v_body) not between 10 and 4000 then raise exception 'invalid_support_request'; end if;
  v_hash:=public.client_mutation_hash(jsonb_build_object('category',p_category,'subject',v_subject,'body',v_body));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':support_ticket:'||v_op,0));
  select * into v_receipt from public.client_mutation_receipts where user_id=auth.uid() and action='support_ticket' and operation_id=v_op;
  if v_receipt.user_id is not null then
    if v_receipt.request_hash<>v_hash then raise exception 'client_operation_id_reused'; end if;
    return v_receipt.result;
  end if;
  perform public.rate_limit('support_ticket',10,86400);
  loop
    v_number:='TM-'||to_char(now() at time zone 'UTC','YYYYMMDD')||'-'||upper(substr(encode(extensions.gen_random_bytes(3),'hex'),1,6));
    exit when not exists(select 1 from public.support_tickets where ticket_number=v_number);
  end loop;
  insert into public.support_tickets(ticket_number,user_id,category,subject) values(v_number,auth.uid(),p_category,v_subject) returning id into v_id;
  insert into public.support_ticket_messages(ticket_id,author,body) values(v_id,'user',v_body);
  v_result:=jsonb_build_object('id',v_id,'ticketNumber',v_number,'status','open');
  insert into public.client_mutation_receipts(user_id,action,operation_id,request_hash,result) values(auth.uid(),'support_ticket',v_op,v_hash,v_result);
  insert into public.audit_events(user_id,action,entity_type,entity_id) values(auth.uid(),'support_ticket_created','support_ticket',v_id);
  return v_result;
end $$;
revoke all on function public.create_support_ticket(text,text,text,text) from public,anon;
grant execute on function public.create_support_ticket(text,text,text,text) to authenticated,service_role;

create or replace function public.get_my_support_tickets()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'ticketNumber',t.ticket_number,'category',t.category,'subject',t.subject,'status',t.status,
    'createdAt',t.created_at,'updatedAt',t.updated_at) order by t.updated_at desc) from public.support_tickets t where t.user_id=auth.uid()),'[]'::jsonb);
end $$;
revoke all on function public.get_my_support_tickets() from public,anon;
grant execute on function public.get_my_support_tickets() to authenticated,service_role;

create or replace function public.get_support_ticket(p_ticket_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t public.support_tickets;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  select * into t from public.support_tickets where id=p_ticket_id and user_id=auth.uid();
  if t.id is null then raise exception 'not_found'; end if;
  return jsonb_build_object('id',t.id,'ticketNumber',t.ticket_number,'category',t.category,'subject',t.subject,'status',t.status,'createdAt',t.created_at,'updatedAt',t.updated_at,
    'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'author',m.author,'body',m.body,'createdAt',m.created_at) order by m.created_at)
      from public.support_ticket_messages m where m.ticket_id=t.id),'[]'::jsonb));
end $$;
revoke all on function public.get_support_ticket(uuid) from public,anon;
grant execute on function public.get_support_ticket(uuid) to authenticated,service_role;

create or replace function public.add_support_ticket_message(p_ticket_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.support_tickets; v_body text:=trim(coalesce(p_body,''));
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if char_length(v_body) not between 1 and 4000 then raise exception 'invalid_support_message'; end if;
  select * into t from public.support_tickets where id=p_ticket_id and user_id=auth.uid() for update;
  if t.id is null then raise exception 'not_found'; end if;
  if t.status='closed' then raise exception 'support_ticket_closed'; end if;
  perform public.rate_limit('support_ticket_message',60,86400);
  insert into public.support_ticket_messages(ticket_id,author,body) values(t.id,'user',v_body);
  update public.support_tickets set status=case when status in ('waiting_user','resolved') then 'open' else status end,updated_at=now() where id=t.id;
  return public.get_support_ticket(t.id);
end $$;
revoke all on function public.add_support_ticket_message(uuid,text) from public,anon;
grant execute on function public.add_support_ticket_message(uuid,text) to authenticated,service_role;

-- Staff reply (service role only; used by an admin tool or Edge function behind an admin secret).
create or replace function public.staff_reply_support_ticket(p_ticket_id uuid,p_body text,p_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.support_tickets; v_body text:=nullif(trim(coalesce(p_body,'')),'');
begin
  if coalesce(p_status,'') not in ('open','in_progress','waiting_user','resolved','closed') then raise exception 'invalid_support_status'; end if;
  select * into t from public.support_tickets where id=p_ticket_id for update;
  if t.id is null then raise exception 'not_found'; end if;
  if v_body is not null then
    if char_length(v_body)>4000 then raise exception 'invalid_support_message'; end if;
    insert into public.support_ticket_messages(ticket_id,author,body) values(t.id,'staff',v_body);
  end if;
  update public.support_tickets set status=p_status,updated_at=now() where id=t.id;
  insert into public.notifications(user_id,type,title,body,entity_id,dedupe_key,template_key,template_params)
  values(t.user_id,'system','Support request updated','Your support request has an update.',t.id,
         format('support_ticket_update:%s:%s',t.id,extract(epoch from clock_timestamp())::bigint),'support_ticket_update',
         jsonb_build_object('ticketNumber',t.ticket_number,'status',p_status))
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return jsonb_build_object('id',t.id,'ticketNumber',t.ticket_number,'status',p_status);
end $$;
revoke all on function public.staff_reply_support_ticket(uuid,text,text) from public,anon,authenticated;
grant execute on function public.staff_reply_support_ticket(uuid,text,text) to service_role;

-- ---------------------------------------------------------------------------------------------------------
-- 5. Communities
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.communities(
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'),
  name text not null check (char_length(trim(name)) between 3 and 60),
  description text not null default '' check (char_length(description)<=1000),
  rules text not null default '' check (char_length(rules)<=2000),
  kind text not null check (kind in ('regional','breed')),
  city text check (city is null or char_length(trim(city)) between 1 and 80),
  breed text check (breed is null or char_length(trim(breed)) between 1 and 80),
  requires_approval boolean not null default false,
  created_by_pet_id uuid references public.pets(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint communities_kind_fields_check check ((kind='regional' and city is not null) or (kind='breed' and breed is not null))
);
alter table public.communities enable row level security;
revoke all on public.communities from public,anon,authenticated;

create table if not exists public.community_members(
  community_id uuid not null references public.communities(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','moderator','member')),
  joined_at timestamptz not null default now(),
  primary key(community_id,pet_id)
);
create index if not exists community_members_pet_idx on public.community_members(pet_id);
create unique index if not exists community_members_one_owner on public.community_members(community_id) where role='owner';
alter table public.community_members enable row level security;
revoke all on public.community_members from public,anon,authenticated;

create table if not exists public.community_join_requests(
  community_id uuid not null references public.communities(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(community_id,pet_id)
);
alter table public.community_join_requests enable row level security;
revoke all on public.community_join_requests from public,anon,authenticated;

alter table public.posts add column if not exists community_id uuid references public.communities(id) on delete set null;
create index if not exists posts_community_idx on public.posts(community_id,created_at desc) where community_id is not null and deleted_at is null;
alter table public.pet_events add column if not exists community_id uuid references public.communities(id) on delete set null;
create index if not exists pet_events_community_idx on public.pet_events(community_id,starts_at) where community_id is not null;

create or replace function public.community_role(p_community_id uuid,p_pet_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select role from public.community_members where community_id=p_community_id and pet_id=p_pet_id;
$$;
revoke all on function public.community_role(uuid,uuid) from public,anon,authenticated;
grant execute on function public.community_role(uuid,uuid) to service_role;

create or replace function public.community_text_allowed(p_text text)
returns boolean language sql stable security definer set search_path='' as $$
  select not (public.contains_prohibited_pet_commerce_intent(p_text) or public.contains_prohibited_human_dating_intent(p_text));
$$;
revoke all on function public.community_text_allowed(text) from public,anon,authenticated;
grant execute on function public.community_text_allowed(text) to service_role;

create or replace function public.community_json(p_community_id uuid,p_viewer_pet_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',c.id,'slug',c.slug,'name',c.name,'description',c.description,'rules',c.rules,'kind',c.kind,'city',c.city,'breed',c.breed,
    'requiresApproval',c.requires_approval,'createdAt',c.created_at,
    'memberCount',(select count(*) from public.community_members m join public.pets mp on mp.id=m.pet_id join public.users mu on mu.id=mp.owner_id
                   where m.community_id=c.id and mu.suspended_at is null),
    'myRole',public.community_role(c.id,p_viewer_pet_id),
    'joinRequested',exists(select 1 from public.community_join_requests r where r.community_id=c.id and r.pet_id=p_viewer_pet_id))
  from public.communities c where c.id=p_community_id;
$$;
revoke all on function public.community_json(uuid,uuid) from public,anon,authenticated;
grant execute on function public.community_json(uuid,uuid) to service_role;

create or replace function public.create_community(p_pet_id uuid,p_name text,p_slug text,p_kind text,p_city text,p_breed text,
  p_description text,p_rules text,p_requires_approval boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_name text:=trim(coalesce(p_name,'')); v_slug text:=lower(trim(coalesce(p_slug,'')));
  v_description text:=trim(coalesce(p_description,'')); v_rules text:=trim(coalesce(p_rules,''));
begin
  perform public.require_active_authenticated_session();
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_kind not in ('regional','breed') then raise exception 'invalid_community_kind'; end if;
  if char_length(v_name) not between 3 and 60 or v_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'
     or char_length(v_description)>1000 or char_length(v_rules)>2000 then raise exception 'invalid_community'; end if;
  if (p_kind='regional' and nullif(trim(coalesce(p_city,'')),'') is null) or (p_kind='breed' and nullif(trim(coalesce(p_breed,'')),'') is null) then
    raise exception 'invalid_community';
  end if;
  if not public.community_text_allowed(v_name||' '||v_description||' '||v_rules) then raise exception 'community_text_not_allowed'; end if;
  perform public.rate_limit('community_create',3,86400);
  begin
    insert into public.communities(slug,name,description,rules,kind,city,breed,requires_approval,created_by_pet_id)
    values(v_slug,v_name,v_description,v_rules,p_kind,
      case when p_kind='regional' then trim(p_city) else nullif(trim(coalesce(p_city,'')),'') end,
      case when p_kind='breed' then trim(p_breed) else nullif(trim(coalesce(p_breed,'')),'') end,
      coalesce(p_requires_approval,false),p_pet_id)
    returning id into v_id;
  exception when unique_violation then raise exception 'community_slug_taken';
  end;
  insert into public.community_members(community_id,pet_id,role) values(v_id,p_pet_id,'owner');
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id) values(auth.uid(),p_pet_id,'community_created','community',v_id);
  return public.community_json(v_id,p_pet_id);
end $$;
revoke all on function public.create_community(uuid,text,text,text,text,text,text,text,boolean) from public,anon;
grant execute on function public.create_community(uuid,text,text,text,text,text,text,text,boolean) to authenticated,service_role;

create or replace function public.update_community(p_pet_id uuid,p_community_id uuid,p_description text,p_rules text,p_requires_approval boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_description text:=trim(coalesce(p_description,'')); v_rules text:=trim(coalesce(p_rules,''));
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if coalesce(public.community_role(p_community_id,p_pet_id),'') not in ('owner','moderator') then raise exception 'forbidden'; end if;
  if char_length(v_description)>1000 or char_length(v_rules)>2000 then raise exception 'invalid_community'; end if;
  if not public.community_text_allowed(v_description||' '||v_rules) then raise exception 'community_text_not_allowed'; end if;
  update public.communities set description=v_description,rules=v_rules,requires_approval=coalesce(p_requires_approval,requires_approval)
  where id=p_community_id and archived_at is null;
  if not found then raise exception 'not_found'; end if;
  return public.community_json(p_community_id,p_pet_id);
end $$;
revoke all on function public.update_community(uuid,uuid,text,text,boolean) from public,anon;
grant execute on function public.update_community(uuid,uuid,text,text,boolean) to authenticated,service_role;

create or replace function public.search_communities(p_pet_id uuid,p_query text,p_kind text,p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_query text:=public.normalize_search_text(coalesce(p_query,''));
begin
  perform public.require_active_authenticated_session();
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_kind is not null and p_kind not in ('regional','breed') then raise exception 'invalid_community_kind'; end if;
  return coalesce((select jsonb_agg(public.community_json(x.id,p_pet_id) order by x.mine desc,x.name) from (
    select c.id,c.name,exists(select 1 from public.community_members m where m.community_id=c.id and m.pet_id=p_pet_id) mine
    from public.communities c
    where c.archived_at is null and (p_kind is null or c.kind=p_kind)
      and (v_query='' or public.normalize_search_text(c.name||' '||coalesce(c.city,'')||' '||coalesce(c.breed,'')) like '%'||v_query||'%')
    order by mine desc,c.name limit least(greatest(coalesce(p_limit,30),1),50)
  ) x),'[]'::jsonb);
end $$;
revoke all on function public.search_communities(uuid,text,text,integer) from public,anon;
grant execute on function public.search_communities(uuid,text,text,integer) to authenticated,service_role;

create or replace function public.join_community(p_pet_id uuid,p_community_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.communities; v_owner uuid;
begin
  perform public.require_active_authenticated_session();
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  select * into c from public.communities where id=p_community_id and archived_at is null;
  if c.id is null then raise exception 'not_found'; end if;
  if exists(select 1 from public.community_members m where m.community_id=c.id and m.role in ('owner','moderator') and public.is_blocked(p_pet_id,m.pet_id)) then
    raise exception 'not_found';
  end if;
  if public.community_role(c.id,p_pet_id) is not null then return jsonb_build_object('status','member'); end if;
  perform public.rate_limit('community_join',30,86400);
  if c.requires_approval then
    insert into public.community_join_requests(community_id,pet_id) values(c.id,p_pet_id) on conflict do nothing;
    return jsonb_build_object('status','requested');
  end if;
  insert into public.community_members(community_id,pet_id) values(c.id,p_pet_id) on conflict do nothing;
  return jsonb_build_object('status','member');
end $$;
revoke all on function public.join_community(uuid,uuid) from public,anon;
grant execute on function public.join_community(uuid,uuid) to authenticated,service_role;

create or replace function public.leave_community(p_pet_id uuid,p_community_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if public.community_role(p_community_id,p_pet_id)='owner' then raise exception 'owner_must_transfer_first'; end if;
  delete from public.community_join_requests where community_id=p_community_id and pet_id=p_pet_id;
  delete from public.community_members where community_id=p_community_id and pet_id=p_pet_id;
  return found;
end $$;
revoke all on function public.leave_community(uuid,uuid) from public,anon;
grant execute on function public.leave_community(uuid,uuid) to authenticated,service_role;

create or replace function public.get_community_join_requests(p_pet_id uuid,p_community_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if coalesce(public.community_role(p_community_id,p_pet_id),'') not in ('owner','moderator') then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('pet',public.pet_json(r.pet_id,p_pet_id),'createdAt',r.created_at) order by r.created_at)
    from public.community_join_requests r where r.community_id=p_community_id and not public.is_blocked(p_pet_id,r.pet_id)),'[]'::jsonb);
end $$;
revoke all on function public.get_community_join_requests(uuid,uuid) from public,anon;
grant execute on function public.get_community_join_requests(uuid,uuid) to authenticated,service_role;

create or replace function public.respond_community_join_request(p_pet_id uuid,p_community_id uuid,p_requester_pet_id uuid,p_accept boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if coalesce(public.community_role(p_community_id,p_pet_id),'') not in ('owner','moderator') then raise exception 'forbidden'; end if;
  delete from public.community_join_requests where community_id=p_community_id and pet_id=p_requester_pet_id;
  if not found then raise exception 'not_found'; end if;
  if coalesce(p_accept,false) then
    insert into public.community_members(community_id,pet_id) values(p_community_id,p_requester_pet_id) on conflict do nothing;
    return jsonb_build_object('status','accepted');
  end if;
  return jsonb_build_object('status','declined');
end $$;
revoke all on function public.respond_community_join_request(uuid,uuid,uuid,boolean) from public,anon;
grant execute on function public.respond_community_join_request(uuid,uuid,uuid,boolean) to authenticated,service_role;

-- Owner manages moderators, removes members and transfers ownership; moderators may remove plain members.
create or replace function public.set_community_member_role(p_pet_id uuid,p_community_id uuid,p_member_pet_id uuid,p_role text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor text; v_target text;
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_role not in ('owner','moderator','member','removed') then raise exception 'invalid_community_role'; end if;
  perform 1 from public.communities where id=p_community_id for update;
  v_actor:=public.community_role(p_community_id,p_pet_id);
  v_target:=public.community_role(p_community_id,p_member_pet_id);
  if v_target is null or p_member_pet_id=p_pet_id then raise exception 'not_found'; end if;
  if v_actor='moderator' and not (p_role='removed' and v_target='member') then raise exception 'forbidden'; end if;
  if coalesce(v_actor,'') not in ('owner','moderator') then raise exception 'forbidden'; end if;
  if p_role='removed' then
    delete from public.community_members where community_id=p_community_id and pet_id=p_member_pet_id;
  elsif p_role='owner' then
    update public.community_members set role='moderator' where community_id=p_community_id and pet_id=p_pet_id;
    update public.community_members set role='owner' where community_id=p_community_id and pet_id=p_member_pet_id;
  else
    update public.community_members set role=p_role where community_id=p_community_id and pet_id=p_member_pet_id;
  end if;
  insert into public.audit_events(user_id,pet_id,action,entity_type,entity_id) values(auth.uid(),p_pet_id,'community_role_'||p_role,'community',p_community_id);
  return jsonb_build_object('petId',p_member_pet_id,'role',p_role);
end $$;
revoke all on function public.set_community_member_role(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.set_community_member_role(uuid,uuid,uuid,text) to authenticated,service_role;

create or replace function public.get_community_members(p_pet_id uuid,p_community_id uuid,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.require_active_authenticated_session();
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.communities where id=p_community_id and archived_at is null) then raise exception 'not_found'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('pet',public.pet_json(x.pet_id,p_pet_id),'role',x.role,'joinedAt',x.joined_at)
    order by case x.role when 'owner' then 0 when 'moderator' then 1 else 2 end,x.joined_at) from (
      select m.* from public.community_members m join public.pets p on p.id=m.pet_id join public.users u on u.id=p.owner_id
      where m.community_id=p_community_id and u.suspended_at is null and p.moderation_status='approved'
        and not public.is_blocked(p_pet_id,m.pet_id)
        and (m.role in ('owner','moderator') or public.social_content_visible_to_viewer(p_pet_id,m.pet_id) or p.owner_id=auth.uid())
      order by case m.role when 'owner' then 0 when 'moderator' then 1 else 2 end,m.joined_at
      limit least(greatest(coalesce(p_limit,50),1),100)) x),'[]'::jsonb);
end $$;
revoke all on function public.get_community_members(uuid,uuid,integer) from public,anon;
grant execute on function public.get_community_members(uuid,uuid,integer) to authenticated,service_role;

-- A member shares one of their own approved posts to the community feed (or removes it with null).
create or replace function public.set_post_community(p_pet_id uuid,p_post_id uuid,p_community_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_community_id is not null and public.community_role(p_community_id,p_pet_id) is null then raise exception 'community_membership_required'; end if;
  update public.posts set community_id=p_community_id where id=p_post_id and pet_id=p_pet_id and deleted_at is null;
  if not found then raise exception 'not_found'; end if;
  return true;
end $$;
revoke all on function public.set_post_community(uuid,uuid,uuid) from public,anon;
grant execute on function public.set_post_community(uuid,uuid,uuid) to authenticated,service_role;

-- Moderators can take a post off the community feed (the post itself stays on the author's profile).
create or replace function public.remove_post_from_community(p_pet_id uuid,p_community_id uuid,p_post_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if coalesce(public.community_role(p_community_id,p_pet_id),'') not in ('owner','moderator') then raise exception 'forbidden'; end if;
  update public.posts set community_id=null where id=p_post_id and community_id=p_community_id;
  return found;
end $$;
revoke all on function public.remove_post_from_community(uuid,uuid,uuid) from public,anon;
grant execute on function public.remove_post_from_community(uuid,uuid,uuid) to authenticated,service_role;

create or replace function public.get_community_feed(p_pet_id uuid,p_community_id uuid,p_limit integer default 20,p_before_created_at timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.require_active_authenticated_session();
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.communities where id=p_community_id and archived_at is null) then raise exception 'not_found'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'pet',public.pet_json(x.pet_id,p_pet_id),'caption',x.caption,'contentType',x.content_type,'createdAt',x.created_at,
      'media',coalesce((select jsonb_agg(jsonb_build_object('path',m.storage_path,'kind',m.media_kind,'mimeType',m.mime_type,'durationMs',m.duration_ms) order by m.sort_order)
                        from public.post_media m where m.post_id=x.id and m.moderation_status='approved'),'[]'::jsonb),
      'likeCount',(select count(*) from public.post_likes l where l.post_id=x.id),
      'likedByMe',exists(select 1 from public.post_likes l where l.post_id=x.id and l.pet_id=p_pet_id))
    order by x.created_at desc,x.id desc) from (
      select po.* from public.posts po
      join public.community_members cm on cm.community_id=po.community_id and cm.pet_id=po.pet_id
      where po.community_id=p_community_id and po.deleted_at is null and po.moderation_status='approved'
        and not public.is_blocked(p_pet_id,po.pet_id)
        and public.social_content_visible_to_viewer(p_pet_id,po.pet_id)
        and not public.pet_is_muted_by(p_pet_id,po.pet_id)
        and (p_before_created_at is null or (po.created_at,po.id)<(p_before_created_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
      order by po.created_at desc,po.id desc limit least(greatest(coalesce(p_limit,20),1),50)) x),'[]'::jsonb);
end $$;
revoke all on function public.get_community_feed(uuid,uuid,integer,timestamptz,uuid) from public,anon;
grant execute on function public.get_community_feed(uuid,uuid,integer,timestamptz,uuid) to authenticated,service_role;

-- Owners and moderators attach their own upcoming events to the community calendar.
create or replace function public.set_event_community(p_pet_id uuid,p_event_id uuid,p_community_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  if p_community_id is not null and coalesce(public.community_role(p_community_id,p_pet_id),'') not in ('owner','moderator') then raise exception 'forbidden'; end if;
  update public.pet_events set community_id=p_community_id where id=p_event_id and creator_pet_id=p_pet_id and starts_at>now();
  if not found then raise exception 'not_found'; end if;
  return true;
end $$;
revoke all on function public.set_event_community(uuid,uuid,uuid) from public,anon;
grant execute on function public.set_event_community(uuid,uuid,uuid) to authenticated,service_role;

create or replace function public.get_community_events(p_pet_id uuid,p_community_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.require_active_authenticated_session();
  if not public.owns_pet(p_pet_id) then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'startsAt',e.starts_at,'endsAt',e.ends_at,'city',e.city,'district',e.district,
      'capacity',e.capacity,'goingCount',(select count(*) from public.event_attendees a where a.event_id=e.id and a.status='going'),
      'myStatus',(select a.status from public.event_attendees a where a.event_id=e.id and a.pet_id=p_pet_id)) order by e.starts_at)
    from public.pet_events e
    where e.community_id=p_community_id and e.moderation_status='approved' and e.cancelled_at is null and e.starts_at>now()
      and not public.is_blocked(p_pet_id,e.creator_pet_id)),'[]'::jsonb);
end $$;
revoke all on function public.get_community_events(uuid,uuid) from public,anon;
grant execute on function public.get_community_events(uuid,uuid) to authenticated,service_role;

select cron.schedule('tailmance-care-reminders','*/5 * * * *','select public.run_care_reminders()');
