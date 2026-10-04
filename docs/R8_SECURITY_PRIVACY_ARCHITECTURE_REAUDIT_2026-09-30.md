# Tailmance v19 R8 — Security, Privacy & Architecture Re-audit

Date: 2026-09-30
Status: **SOURCE-SIDE SECURITY HARDENING VERIFIED; PRODUCTION RELEASE FAIL-CLOSED**
Owner / Creator / Concept / Product Design / Development / Implementation / Overall Project: Yekta Ozel

## Scope

This re-audit continues only from the product-final parent checkpoint `61add56fe075988c40eb41ebe7e8ac21047ff527e449d9d7be21103f928d26bd`. R7 and superseded/intermediate R8 trees are excluded.

The review covers Tailmance-relevant authentication/session security, network transport, purchase/webhook integrity, mobile client hardening, application attestation, data privacy/storage, social/UGC safety, performance/observability, API/RLS boundaries, incident response and configured-market security/privacy incident routing. Controls that do not exist in the product surface are not fabricated merely to satisfy a checklist.

## Verified source-side security posture

- Security regression suite: **268/268 PASS**.
- Effective authenticated RPC session/revocation boundary: **103/103 PASS**.
- Domain invariants: **18/18 PASS**.
- Product/retention/trust/monetization invariants: **47/47 PASS**.
- Pending canonical hardening: **107/107 PASS**.
- Canonical migrations: **001–106 contiguous**.
- Edge/shared TypeScript syntax + semantic checks: **31/31 PASS**.
- Repository hygiene: **104/104 app source modules reachable; 70/70 maintenance scripts referenced**.
- Runtime localization: **19/19 locales × 1,535 keys** with **1,342 source-used/dynamic keys covered** and **316/316 critical keys localized** for every non-English runtime locale.
- Legal/static controls: **52/52 PASS**; legal context: **90/90 PASS**.
- Legal document/public route coverage: **22 locales × 11 document families = 242/242**.
- Configured-market incident routing: **27/27** structurally covered and fail-closed.
- Canonical legal evidence: **594/594 topic cells**, **594/594 runtime-control evidence cells**, **432/432 critical legal subdimensions**.
- Worldwide country inventory remains explicit: **249/249 = 27 configured + 222 unconfigured BLOCK**.

## Authentication, MFA and immediate session revocation

- Native auth persistence is SecureStore-only and backed by platform Keychain/Keystore semantics; plaintext AsyncStorage/UserDefaults/SharedPreferences auth/session persistence is prohibited by regression tests.
- JWT lifetime is source-controlled at **15 minutes**, refresh-token rotation is enabled and reuse is bounded.
- Password policy requires 12 characters plus lower/upper/digit/symbol classes.
- Confirmed email, secure password change, explicit auth endpoint rate limits and PKCE callback allowlisting are source-enforced.
- TOTP authenticator and SMS/phone MFA are supported. A verified MFA factor requires AAL2 for protected authenticated surfaces.
- Global logout and password-reset security do not rely solely on provider refresh-token revocation. Tailmance records session IDs/revocation state server-side and authenticated SECURITY DEFINER RPC/Edge paths reject a revoked session even while an already-issued access JWT would otherwise remain cryptographically valid until `exp`.
- The effective authenticated RPC call graph is statically checked so future SECURITY DEFINER functions cannot silently bypass the session/MFA boundary.
- Native adaptive anti-bot/CAPTCHA is **implemented in source and remains an external deployment-evidence gate**. Tailmance now has auth rate limits, Turnstile-enabled Auth config, a CSP-restricted hosted challenge, OS-CSPRNG state binding, exact action/state callback validation and captchaToken wiring for email sign-in/sign-up, password reset and phone OTP. Hosted keys/configuration, accessibility and physical-device behavior must still be evidenced before production release.

## Network and transport

- Production configuration rejects non-HTTPS endpoints.
- Android generated Network Security Configuration disables cleartext and excludes user-installed CA roots from the default production trust set.
- iOS ATS arbitrary/media/WebView/local-network exceptions remain disabled.
- Client networking uses bounded abortable timeouts. Non-idempotent mutations are not given unsafe blanket retries.
- Managed Supabase/RevenueCat certificate chains are not blindly pinned. Tailmance will only introduce pinning for Tailmance-controlled first-party hosts after real current + backup SPKI pins, rotation drills, expiry monitoring and recovery procedures exist.
- Tailmance currently has no WebRTC voice/video feature; SRTP/STUN/TURN is therefore out of scope until such a feature is introduced.

## Purchase and webhook integrity

- Premium/consumable authority is server-side; the mobile client cannot self-grant entitlement or credits.
- RevenueCat webhook processing requires both operator Authorization and RevenueCat HMAC-SHA256 verification over the **raw request body**.
- Signature parsing validates timestamp + `v1`, uses constant-time comparison and a **5-minute replay window**.
- Webhook environment is fail-closed and must match the configured production/sandbox environment.
- App IDs are allowlisted; a valid SANDBOX delivery cannot mutate a production ledger.
- Durable event claims/idempotency prevent duplicate webhook deliveries from duplicating state/credits.
- Server-side RevenueCat subscriber reconciliation remains authoritative for entitlement state.
- Live App Store Server Notifications / Google RTDN / RevenueCat dashboard delivery exercises remain external release evidence.

## Apple App Attest and Google Play Integrity

- iOS uses App Attest native key generation, server challenge binding, attestation and action assertions.
- Assertion counters are monotonic server-side to reject replay.
- Android uses Play Integrity Standard requests with request hash binding.
- Server verification binds Android verdicts to expected package, request hash, signing-certificate allowlist, version-code allowlist, app recognition, device integrity and licensing policy.
- High-risk actions have both client/Edge preflight and database-side integrity gates so direct RPC/database invocation cannot trivially bypass the policy.
- App integrity is additive. It never replaces RLS, authorization, MFA, rate limiting or moderation.
- Source policy defaults to `enforce`. `observe` is allowed only through a short, audited service-role relaxation window; deployed verifier/device effectiveness still cannot be claimed from static code alone.

## Mobile client hardening

- Android release configuration enables R8 minification/resource shrinking and API 36 targeting.
- Debug-only LeakCanary is separated from release builds.
- Sensitive MFA, password recovery, health/chat/verification surfaces use screen-capture protection where platform APIs allow it.
- Clipboard APIs are not used for secrets/session material; regression checks reject sensitive clipboard behavior.
- Production console logging of secrets/PII is prohibited by source checks.
- Local root/jailbreak/debugger/emulator heuristics are deliberately not authorization gates because they are bypassable and can false-positive. Server-verified App Attest / Play Integrity are the security boundary.
- This historical review originally recorded no local database. The current authoritative source supersedes that state with a narrowly scoped SQLCipher queue for replay-safe offline social mutations; it remains encrypted, account-bound, non-authoritative and excludes high-risk/payment/legal/health/delete operations.

## Data privacy and lifecycle

- Supabase RLS/default-deny assumptions, constrained RPC/Edge writes and service-role separation are regression-tested.
- Exact location is isolated from public pet surfaces; public discovery responses use privacy-preserving location/distance behavior.
- Image upload paths re-encode normal images and reduce EXIF/GPS leakage; private documents remain access-controlled.
- Account deletion and export are reachable in-app and backed by server workflows, with MFA/integrity checks where applicable.
- Provider cleanup, storage/database deletion, billing references, moderation/audit exceptions and hard Auth deletion are separately accounted for rather than hidden behind a client-only delete button.

## Social/UGC safety

- Messaging requires a valid unblocked match and server-side quota/permission rules.
- Block/report/unmatch/moderation paths are server-enforced.
- No-sale and pet-first/no-human-dating invariants remain enforced at UGC/database boundaries.
- E2EE is not enabled today. This is deliberate because Tailmance's current abuse reporting/moderation architecture requires server-visible messages. E2EE would require a redesigned key-management, recovery, device migration and report-evidence model.

## Incident response and configured-market routing

- Tailmance has a service-only incident ledger, jurisdiction-decision records and evidence holds.
- The generated security/privacy incident matrix covers all **27 configured launch markets** and remains fail-closed pending real applicability/counsel/tabletop evidence.
- The system does not assume a universal 72-hour breach rule. Country/sector clocks are tracked from attributable sources and temporal status is explicit.
- India current CERT-In cyber reporting/log-retention requirements are temporally separated from future-effect DPDP obligations; South Korea current effective law is separately pinned.
- Internal escalation begins immediately; external notification timing is determined by applicable law and counsel, not by a hard-coded universal timer.

## Current Google Play platform-security status — 2026-09-30

- Google Play package registration is **current-effective** as of 2026-09-30. Tailmance must retain real Play Console proof that its package is registered; source configuration alone is not release evidence.
- Android developer verification / package-registration enforcement is **current** for certified-device distribution through participating stores in **Brazil, Indonesia, Singapore and Thailand**. Real developer-identity/package proof remains an external release gate.
- Google Play Zero-Tap Sign-In Restoration / Restore Credentials is an **upcoming April 2027** technical-quality requirement for apps with sign-in. It is tracked as a future requirement and is not falsely treated as a 2026-09-30 blocker. Exact enforcement details must be re-checked before any release crossing that window.
- Tailmance does not use the September 30, 2026 Block Store grandfathering path as a substitute for future Restore Credentials work unless real production evidence proves that qualifying integration existed by the cutoff.

## Controls intentionally not represented as complete

The following remain external/deployed-environment requirements and must not be converted to PASS from source code alone:

- production App Attest verifier/device evidence;
- production Play Integrity service-account/verdict/device evidence;
- hosted Supabase Auth effective settings and production SMS provider;
- production-native adaptive anti-bot/CAPTCHA flow;
- RevenueCat/App Store/Google billing dashboard notifications and end-to-end sandbox lifecycle;
- real production TLS endpoint scan;
- real store-ready binary signing/debug/shrinking/entitlement/privacy-manifest inspection;
- production Sentry DSN/symbolication/ANR proof;
- live moderation provider quality/human-review SLA;
- 27-market incident tabletop and counsel applicability confirmation;
- store-console privacy/age/data-safety declarations;
- a genuine reproducible dependency lockfile;
- store screenshots and remaining external legal/country approvals.

## Release truth

`npm run verify:offline` and `npm run evidence:check` pass in this source tree. The real production release gate remains **5/15 PASS, 10 BLOCK / NO-GO**. That is intentional and correct: source hardening is verified, but external production/store/counsel evidence has not been fabricated.

