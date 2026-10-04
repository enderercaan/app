-- Tailmance v19 R8: bind stored Apple revocation credentials to the client ID that
-- issued them. Native Sign in with Apple codes are issued to the App ID while the
-- browser OAuth flow can use a Services ID; deletion-time revocation must use the
-- same client identifier instead of guessing.

alter table public.oauth_revocation_credentials
  add column if not exists provider_client_id text;

alter table public.oauth_revocation_credentials
  drop constraint if exists oauth_revocation_credentials_provider_client_id_check;
alter table public.oauth_revocation_credentials
  add constraint oauth_revocation_credentials_provider_client_id_check
  check(provider_client_id is null or (length(provider_client_id) between 3 and 255 and provider_client_id !~ '[[:cntrl:]]'));

comment on column public.oauth_revocation_credentials.provider_client_id is
  'Non-secret OAuth client identifier associated with the encrypted provider token. Required for exact Apple token revocation after native vs browser sign-in; legacy null rows fall back to the configured browser client ID.';
