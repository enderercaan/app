-- Tailmance v19 pre-legal age-attestation authority boundary.
-- A signup checkbox is a user self-attestation transport signal, never authoritative legal acceptance.
-- Binding users.age_18_confirmed remains written only by the exact current legal-presentation acceptance flow.

create table if not exists public.prelegal_age_attestations (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  age_threshold smallint not null default 18 check (age_threshold=18),
  statement_version text not null check (char_length(trim(statement_version)) between 3 and 80),
  ui_locale text not null check (char_length(trim(ui_locale)) between 2 and 16 and ui_locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$'),
  source text not null check (source in ('signup_checkbox','legacy_signup_checkbox_backfill')),
  attested_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(user_id,statement_version)
);
create index if not exists prelegal_age_attestations_user_idx on public.prelegal_age_attestations(user_id,attested_at desc,id desc);
alter table public.prelegal_age_attestations enable row level security;
revoke all on table public.prelegal_age_attestations from public,anon,authenticated;
grant select,insert on table public.prelegal_age_attestations to service_role;

drop trigger if exists trg_prelegal_age_attestations_append_only on public.prelegal_age_attestations;
create trigger trg_prelegal_age_attestations_append_only
before update or delete on public.prelegal_age_attestations
for each row execute function public.prevent_append_only_legal_event_update();

-- Existing signup metadata is converted once into non-authoritative self-attestation evidence.
-- It is not copied into users.age_18_confirmed or users.legal_version.
insert into public.prelegal_age_attestations(user_id,age_threshold,statement_version,ui_locale,source,attested_at)
select au.id,18,'tailmance_age18_signup_v1',
  case
    when coalesce(au.raw_user_meta_data->>'prelegal_age_attestation_locale','') ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$' then au.raw_user_meta_data->>'prelegal_age_attestation_locale'
    else 'en'
  end,
  'legacy_signup_checkbox_backfill',coalesce(au.created_at,now())
from auth.users au
where lower(coalesce(au.raw_user_meta_data->>'prelegal_age_attested',au.raw_user_meta_data->>'age_18_confirmed','false')) in ('true','1','yes')
on conflict(user_id,statement_version) do nothing;

-- Remove metadata-only authoritative state. Users with an actual legal-acceptance event keep their
-- historical age confirmation; current product access still requires the exact current bundle/presentation.
update public.users u
set age_18_confirmed=false,legal_version=null,updated_at=now()
where (u.age_18_confirmed=true or u.legal_version is not null)
  and not exists(select 1 from public.legal_acceptances a where a.user_id=u.id);

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_locale text;v_attested boolean;
begin
  insert into public.users(id,age_18_confirmed,legal_version)
  values(new.id,false,null)
  on conflict(id) do nothing;

  v_attested:=lower(coalesce(new.raw_user_meta_data->>'prelegal_age_attested',new.raw_user_meta_data->>'age_18_confirmed','false')) in ('true','1','yes');
  if v_attested then
    v_locale:=coalesce(new.raw_user_meta_data->>'prelegal_age_attestation_locale','en');
    if v_locale !~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$' or char_length(v_locale) not between 2 and 16 then v_locale:='en'; end if;
    insert into public.prelegal_age_attestations(user_id,age_threshold,statement_version,ui_locale,source,attested_at)
    values(new.id,18,'tailmance_age18_signup_v1',v_locale,'signup_checkbox',now())
    on conflict(user_id,statement_version) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.handle_new_auth_user() from public,anon,authenticated;

-- Self-attestation mode may use the dedicated pre-legal event solely to let the user reach the exact
-- legal presentation. It does not itself confer product access or write users.age_18_confirmed.
create or replace function public.current_legal_age_assurance_satisfied(p_user_id uuid,p_country text,p_subnational text)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((
    select case p.age_assurance_mode
      when 'self_attestation' then p.minimum_user_age=18 and (
        exists(select 1 from public.users u where u.id=p_user_id and u.age_18_confirmed=true)
        or exists(select 1 from public.prelegal_age_attestations a where a.user_id=p_user_id and a.age_threshold>=18)
      )
      when 'verified_external' then exists(
        select 1 from public.legal_age_assurance_events e
        where e.user_id=p_user_id and e.legal_country_code=p.legal_country_code
          and coalesce(e.legal_subnational_code,'')=case when p.subnational_review_required then coalesce(p_subnational,'') else '' end
          and e.result='passed' and e.age_threshold>=p.minimum_user_age
          and e.verified_at<=now() and (e.expires_at is null or e.expires_at>now())
          and jsonb_array_length(e.evidence_reference)>0
          and not exists(
            select 1 from public.legal_age_assurance_events r
            where r.user_id=e.user_id and r.legal_country_code=e.legal_country_code
              and coalesce(r.legal_subnational_code,'')=coalesce(e.legal_subnational_code,'')
              and r.result='revoked' and (r.created_at>e.created_at or (r.created_at=e.created_at and r.id>e.id))
          )
      ) else false end
    from public.legal_jurisdiction_policies p
    where p.legal_country_code=upper(trim(coalesce(p_country,''))) and p.release_status='approved'
      and p.legal_review_status='approved_by_external_counsel' and p.language_review_status='approved'
      and p.legal_reviewed_at is not null and p.legal_reviewed_at<=now() and p.next_review_due_at is not null and p.next_review_due_at>now()
      and p.effective_at is not null and p.effective_at<=now() and (p.expires_at is null or p.expires_at>now())
  ),false);
$$;
revoke all on function public.current_legal_age_assurance_satisfied(uuid,text,text) from public,anon,authenticated;
