# Tailmance Production Supabase Auth Verification Checklist

Status: **RELEASE BLOCKER UNTIL VERIFIED AGAINST THE DEPLOYED PRODUCTION PROJECT**

Owner / Creator / Concept / Product Design / Development / Implementation / Overall Project: **Yekta Özel**

This checklist is deliberately separate from source-code checks. `supabase/config.toml` and client-side guards do not prove the effective settings of the hosted production Supabase Auth project. Do not mark these items PASS from source inspection alone.

## 1. Email identity verification

- [ ] Production Supabase Auth **Confirm Email** is enabled.
- [ ] New email/password signup cannot obtain product access before completing the verification email flow.
- [ ] Verified-session behavior is tested on a real production-equivalent project.
- [ ] Email-change confirmation policy is reviewed and tested.
- [ ] Password-reset/recovery redirect allowlist contains only approved Tailmance callback destinations.

Source-side defense: Tailmance rejects sessions whose `email_confirmed_at` is absent and the database product-access gate requires a confirmed Auth identity. This is defense in depth only. A hosted configuration that implicitly marks emails confirmed must still be rejected by the release process rather than assumed safe.

## 2. Password policy

- [ ] Minimum password length is explicitly selected for production and documented.
- [ ] Required character policy is explicitly selected and documented.
- [ ] Leaked-password protection is enabled where supported by the selected Supabase plan/configuration.
- [ ] Password-change / sensitive-operation reauthentication behavior is tested.
- [ ] Password reset does not reveal whether an email address is registered.

## 3. Abuse / automated signup protection

- [ ] Production Auth rate limits are reviewed for signup, password recovery, OTP/email and token-refresh endpoints.
- [ ] CAPTCHA / bot protection is configured where appropriate for public authentication flows.
- [ ] Rate-limit behavior is tested with controlled staging traffic before release.
- [ ] Support/recovery workflows cannot bypass the normal identity-verification requirement.

## 4. Redirects, SMTP and mail delivery

- [ ] Site URL and every allowed redirect URL are production-approved and use the intended Tailmance callback paths.
- [ ] No staging, localhost, abandoned or broad wildcard redirect remains in the production allowlist unless explicitly justified.
- [ ] Production SMTP is configured and deliverability tested across representative providers/regions.
- [ ] Verification, recovery and security-email templates display the Tailmance brand and do not contain placeholder/legal-draft text.
- [ ] Email links expire and fail safely when replayed or malformed.

## 5. Session controls

- [ ] Refresh-token/session lifetime settings are reviewed for the product risk model.
- [ ] Sign-out-all-devices behavior is tested with at least two physical devices/accounts.
- [ ] Session invalidation propagates to RevenueCat identity and push-token lifecycle without leaving the old account active on the device.
- [ ] Account suspension/pause/current-legal-version gates remain fail-closed after refresh and app resume.

## 6. Evidence required to close this blocker

Store an evidence record with the release candidate containing:

- production project identifier/reference (non-secret),
- verification date/time,
- reviewer/operator identity,
- screenshots or exported effective Auth configuration with secrets redacted,
- controlled test results for unconfirmed signup, confirmed signup, password recovery, redirect rejection, rate limiting and session invalidation,
- any approved exceptions and the accountable owner.

Never place Supabase service-role keys, SMTP passwords, CAPTCHA secrets, management access tokens or other credentials in the repository or release evidence.

## Release status

Until the effective hosted settings above are independently verified, record:

`DOĞRULANAMADI_HOSTED_AUTH_SETTINGS`

This is a release blocker, not a source-code failure.

## 7. Source-controlled baseline added in v18

The repository now pins the intended hosted baseline in `supabase/config.toml`: 15-minute JWT expiry, refresh-token rotation with bounded reuse, confirmed email, secure password change, 12-character password minimum, explicit Auth rate limits, TOTP enrollment/verification enabled, and phone/WebAuthn/passkey factors disabled until separately designed. `supabase config push` or an equivalent reviewed deployment process must still be used against the intended project; source presence is not proof of hosted effect.

For TOTP specifically verify on two physical devices/accounts that: enrollment raises the session to AAL2, relaunch requires the expected challenge, a stale AAL1 session cannot call product access or delete/export, factor removal requires AAL2, and recovery/support cannot silently bypass MFA.

Do **not** enable Supabase CAPTCHA in the hosted dashboard until the native challenge UI/token path is implemented and tested. Tailmance keeps this in `release/external-security-evidence.json` because a provider toggle alone would make authentication fail rather than make it safer.

## Tailmance session-revocation boundary

- [ ] Hosted migrations through 102 are deployed before release.
- [ ] Global sign-out and password reset are smoke-tested to prove previously issued access tokens cannot call authenticated Tailmance RPC/Edge paths after revocation.
- [ ] MFA-enrolled accounts prove AAL2 gating on authenticated product paths after a fresh login.
