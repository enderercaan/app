# Tailmance v19 R8 — Security Final Verification — 2026-09-30

> **Historical snapshot:** This dated 2026-09-30 document is retained for audit lineage only. It is superseded by `release/security-control-applicability-v19.json`, `release/roadmap-implementation-v21.json`, `release/RELEASE_EVIDENCE.json`/current release evidence, and the latest automated source checks. Do not use the counts or “not present” statements below as current repository truth.


Status: **SOURCE-SIDE SECURITY HARDENING VERIFIED; PRODUCTION RELEASE REMAINS FAIL-CLOSED**

## Verified source state

- Security regression: **268/268 PASS**.
- Authenticated RPC session/revocation/MFA boundary: **103/103 PASS**.
- Authenticated RLS/storage session boundary: **4/4 PASS**.
- Configured-market incident routing: **27/27**, fail-closed pending counsel/applicability/tabletop evidence.
- Migrations: **001–106 contiguous PASS**.
- Edge/shared syntax + semantic validation: **31/31 PASS**.
- Runtime i18n: **19 × 1,535**, source-used/dynamic **1,342**, critical non-English **316/316**.
- Legal static/context: **52/52 + 90/90 PASS**.
- Product/retention/trust/monetization: **47/47 PASS**.
- Pending hardening: **107/107 PASS**.
- Repository hygiene: **104/104 app modules reachable; 70/70 maintenance scripts referenced**.
- Project lint: **969 text files PASS** before final packaging.
- Full dependency-resolved `tsc --noEmit`: **not verifiable in this source-only environment** because `node_modules`/Expo base types and a genuine registry-generated `package-lock.json` are absent; this remains an explicit release blocker rather than a synthetic PASS.

## Security controls added or tightened in this security branch

- Active GoTrue session binding plus immediate server-side global revocation, including password-reset revocation and same-second fail-closed handling.
- Complete authenticated RPC/RLS/storage reachability regression for revocation/MFA boundary.
- TOTP + phone MFA/AAL2, native Turnstile auth challenge with CSPRNG state/action binding, and hosted-config evidence gates.
- Apple App Attest + Google Play Integrity source bridge, one-time/action-bound challenge, replay/freshness/counter protection and high-risk action gates.
- RevenueCat webhook Authorization + exact-raw-body HMAC-SHA256 + timestamp replay tolerance + environment/app allowlist + durable idempotency.
- Strict ATS / Android no-cleartext policy, SecureStore-only native auth persistence and release hardening controls.
- Edge CORS exact-origin HTTPS validation with wildcard/malformed origin fail-closed behavior.
- Source-controlled public-web HTTP security header manifest (`web/_headers`) covering CSP/frame-ancestors, clickjacking, nosniff, no-referrer, Permissions-Policy and no-store on auth challenge/config.
- 27-market privacy/security incident operations registry with current/future-law temporal separation and external legal/counsel confirmation retained fail-closed.

## Deliberate non-claims

- WebRTC/SRTP/TURN is not implemented because Tailmance has no voice/video/P2P calling surface.
- Message E2EE is not claimed because current abuse moderation/report evidence relies on server-visible messages; adding E2EE requires a dedicated key/recovery/multi-device/report-evidence architecture.
- SQLCipher/local DB encryption is not claimed because no sensitive SQLite/Room/Realm/MMKV database is present.
- Managed Supabase/RevenueCat certificates are not blindly pinned; pinning is only appropriate for endpoints with a controlled current+backup SPKI lifecycle, rotation drill and recovery path.
- Dependency-resolved `npm run typecheck`, native release build proof and dependency audit are **not verified** because a genuine registry-generated `package-lock.json`/clean dependency installation is absent. No synthetic lockfile is permitted.

## Production gate

`npm run release:check` is intentionally **5/15 PASS, 10 BLOCK / NO-GO**. Remaining blocks require real production/client/server configuration, counsel/legal evidence, store-console evidence, deployed security evidence, observability/Sentry proof, store screenshots/assets and reproducible dependency/build evidence.
