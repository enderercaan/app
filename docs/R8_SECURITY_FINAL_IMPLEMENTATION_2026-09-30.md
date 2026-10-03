# Tailmance v19 R8 — Security Final Implementation Report — 2026-09-30

## Authoritative parent

This security-hardened tree continues only from `Tailmance-v19-R8-PRODUCT-FINAL-SOURCE-2026-09-30.zip`, parent SHA-256 `61add56fe075988c40eb41ebe7e8ac21047ff527e449d9d7be21103f928d26bd`. R7 and superseded/intermediate R8 trees were not merged.

## Verified repository-side security state

- Security regression: **268/268 PASS**.
- Authenticated RPC session boundary: **103/103 PASS** plus **4/4 authenticated RLS/storage policies** reaching revocation/MFA enforcement.
- Canonical migrations: **001–106 contiguous**.
- Edge/shared TypeScript syntax + semantic checks: **31/31 PASS**.
- Domain: **18/18 PASS**.
- Product/retention/trust/monetization: **47/47 PASS**.
- Pending hardening: **107/107 PASS**.
- Runtime i18n: **19/19 × 1,535 keys**; **1,342 source-used/dynamic keys covered**; critical localization **316/316** per non-English runtime locale.
- Legal/static: **52/52 PASS**; legal context: **90/90 PASS**.
- Security/privacy incident obligations: **27/27 configured markets structurally covered and fail-closed**.
- Worldwide country inventory: **249/249 explicit = 27 configured + 222 unconfigured BLOCK**.
- Repository hygiene: **104/104 source modules reachable; 70/70 maintenance scripts referenced**.

## Security architecture completed in source

1. **Auth/session**: 15-minute access tokens, refresh rotation, native SecureStore, TOTP/phone MFA, global session revocation, active `auth.sessions` binding, revoked-session/user state, same-second fail-closed revocation handling, password-reset global logout, strong password policy and session timebox/inactivity controls.
2. **Native auth anti-bot**: Turnstile source integration for email sign-in/sign-up, password reset and phone OTP, native CSPRNG state, HTTPS challenge, action/state callback binding, timeout/cancel fail-closed, Supabase `captchaToken`, hosted-config evidence gate.
3. **OAuth/legal**: Apple/Google first-account creation cannot bypass the 18+ and exact pre-registration legal bundle/hash/route-revision binding; regression coverage pins this boundary.
4. **Device/app integrity**: Apple App Attest and Google Play Integrity source bridges, one-time server challenge, action binding, replay/freshness protection, monotonic App Attest counters and fail-closed high-risk-action policy.
5. **IAP/webhook**: RevenueCat Authorization + raw-body HMAC-SHA256 signature + timestamp replay window + environment/app allowlist + durable idempotent server ledger. Purchase authority remains server-side.
6. **Transport/platform**: Android cleartext disabled, production trust excludes user-installed CAs, backup/device transfer disabled; iOS ATS has no arbitrary-load exceptions; release Android R8/resource shrinking enabled.
7. **Sensitive client surfaces**: device-only secure storage, capture protection on sensitive screens, no plaintext client DB for secrets, no clipboard handling for sensitive data, least-privilege permissions.
8. **Backend/API**: RLS, session/MFA boundary, server validation, rate limits, immutable/append-only evidence where required, signed media URLs, Edge secret/config gates, HTTPS-only exact-origin CORS validation, and source-controlled HTTP security headers (`web/_headers`) with CSP `frame-ancestors`, clickjacking, MIME, referrer and permissions protections.
9. **UGC/trust & safety**: report/block, moderation queue/provider boundary, no-sale/no-human-dating enforcement, 18+ policy, owner-arranged mating fail-closed by legal/welfare/kinship gates.
10. **Incident response**: configured 27-market security/privacy incident matrix with current/future-law separation and counsel confirmation required before release.
11. **OWASP**: Mobile Top 10 2024 / MASVS mapping maintained with source controls and external-evidence boundaries.

## Deliberate scope decisions

- No WebRTC/audio/video feature exists, so SRTP/TURN/P2P code is not introduced.
- Message E2EE is not claimed or enabled. Current moderation/report evidence architecture requires server-visible messages; E2EE would require a separate key/recovery/multi-device/abuse-evidence architecture.
- Blind certificate pinning is not added for managed Supabase/RevenueCat hosts without an operational current+backup pin rotation lifecycle. HTTPS-only transport and external production TLS/header scanning remain mandatory.
- Static meta CSP is defense-in-depth. Sensitive web surfaces must prove security headers from the production HTTP response; `frame-ancestors` in particular is a response-header control.

## Honest release state

`npm run release:check` remains **5/15 PASS, 10 BLOCK / NO-GO**. Blocked gates are client production config, server production config, country/counsel release, legal gap release, store compliance, external security, external legal, observability, store assets and reproducible release structure. These are intentionally not converted to PASS without real evidence.

The source is security-hardened and regression-verified. It is **not** represented as production-approved until the named external/deployed evidence exists.
