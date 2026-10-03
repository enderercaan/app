-- Tailmance v19 R8 security hardening: prevent operator/content URL fields from becoming
-- phishing/SSRF-style localhost, literal-IP, credential-bearing or non-standard-port links.
-- External provider server calls are separately exact-host allowlisted in Edge Functions.

create or replace function public.is_safe_public_https_url(p_url text)
returns boolean
language sql immutable
set search_path=''
as $$
  select p_url is null or (
    char_length(p_url) between 8 and 2048
    and p_url = btrim(p_url)
    and p_url !~ '[[:cntrl:]]'
    and p_url ~ '^https://'
    and split_part(split_part(p_url,'://',2),'/',1) !~ '@'
    and split_part(split_part(p_url,'://',2),'/',1) !~ ':'
    and lower(split_part(split_part(p_url,'://',2),'/',1)) not in ('localhost','localhost.')
    and lower(split_part(split_part(p_url,'://',2),'/',1)) !~ '\.localhost\.?$'
    and lower(split_part(split_part(p_url,'://',2),'/',1)) !~ '\.local\.?$'
    and split_part(split_part(p_url,'://',2),'/',1) !~ '^[0-9]{1,3}(\.[0-9]{1,3}){3}\.?$'
    and split_part(split_part(p_url,'://',2),'/',1) ~ '^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.?$'
  );
$$;
revoke all on function public.is_safe_public_https_url(text) from public,anon,authenticated;
grant execute on function public.is_safe_public_https_url(text) to service_role;

create or replace function public.enforce_safe_operator_external_urls()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_table_name='pet_friendly_places' then
    if not public.is_safe_public_https_url(new.website_url) or not public.is_safe_public_https_url(new.booking_url) then raise exception 'unsafe_external_url'; end if;
  elsif tg_table_name='business_partner_profiles' then
    if not public.is_safe_public_https_url(new.website_url) or not public.is_safe_public_https_url(new.appointment_url) then raise exception 'unsafe_external_url'; end if;
  elsif tg_table_name='event_commercial_offers' then
    if not public.is_safe_public_https_url(new.external_booking_url) then raise exception 'unsafe_external_url'; end if;
  end if;
  return new;
end $$;
revoke all on function public.enforce_safe_operator_external_urls() from public,anon,authenticated;
grant execute on function public.enforce_safe_operator_external_urls() to service_role;

drop trigger if exists trg_safe_external_urls_places on public.pet_friendly_places;
create trigger trg_safe_external_urls_places before insert or update of website_url,booking_url on public.pet_friendly_places
for each row execute function public.enforce_safe_operator_external_urls();

drop trigger if exists trg_safe_external_urls_partners on public.business_partner_profiles;
create trigger trg_safe_external_urls_partners before insert or update of website_url,appointment_url on public.business_partner_profiles
for each row execute function public.enforce_safe_operator_external_urls();

drop trigger if exists trg_safe_external_urls_offers on public.event_commercial_offers;
create trigger trg_safe_external_urls_offers before insert or update of external_booking_url on public.event_commercial_offers
for each row execute function public.enforce_safe_operator_external_urls();
