-- Tailmance v19 R8: OAuth is a sign-in convenience, never a way around the
-- 18+ and pre-registration legal-presentation gate used for account creation.
create or replace function public.guard_oauth_first_account_creation()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_provider text:=lower(coalesce(new.raw_app_meta_data->>'provider',''));
  v_prelegal boolean:=coalesce((new.raw_user_meta_data->>'prelegal_age_attested')::boolean,false);
begin
  if v_provider in ('google','apple') and not v_prelegal then
    raise exception 'oauth_new_account_requires_pre_registration';
  end if;
  return new;
exception when invalid_text_representation then
  if v_provider in ('google','apple') then raise exception 'oauth_new_account_requires_pre_registration'; end if;
  return new;
end $$;

drop trigger if exists guard_oauth_first_account_creation on auth.users;
create trigger guard_oauth_first_account_creation
before insert on auth.users
for each row execute function public.guard_oauth_first_account_creation();

comment on function public.guard_oauth_first_account_creation() is
  'Blocks first-time Apple/Google account creation unless the canonical Tailmance pre-registration age/legal gate was already bound. Existing-account OAuth sign-in does not insert auth.users and remains available.';
