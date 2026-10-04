# Tailmance Security Standard

Tailmance assumes the mobile client can be modified, automated, inspected, or hostile. UI state, local device checks, and client-side purchase state are therefore **not trust boundaries**. Authorization, entitlement, moderation, account-state, MFA-sensitive actions, and destructive operations are enforced server-side.

## 1. Authentication and session security

- Supabase Auth is the identity authority; public social identity remains the pet, never a human profile.
- Mobile auth persistence uses `expo-secure-store`, backed by iOS Keychain / Android Keystore semantics. Tokens must never be persisted in plain AsyncStorage/UserDefaults/SharedPreferences.
- Source-controlled production Auth policy uses a **15-minute JWT**, refresh-token rotation, a bounded reuse interval, confirmed email, secure password changes, 12-character minimum passwords, and explicit Auth endpoint rate limits.
- **TOTP authenticator and SMS/phone MFA factors are supported.** An account with any verified MFA factor must satisfy **AAL2** before entering the authenticated product surface. Account deletion and export independently enforce the same requirement server-side. Phone MFA still depends on the production SMS provider and hosted Supabase Auth configuration, which remain external release evidence.
- MFA enrollment secrets are screen-capture protected and are never automatically copied to the clipboard. Abandoned Tailmance-created unverified factors are cleaned up best-effort.
- Mobile auth redirects use PKCE authorization-code exchange. Only approved Tailmance callback routes are accepted; raw access/refresh-token deep-link injection is rejected.
- Password recovery is isolated as a recovery session and requires a new password before normal product access.
- Global logout serializes push-token disable/rollback behavior so a stale registration cannot resurrect a token after logout.
- Apple/Google OAuth/OIDC sign-in is supported only for identities already linked to an existing Tailmance account. New accounts must still complete Tailmance's 18+ and legal-acceptance onboarding first. OAuth uses Supabase's PKCE/OIDC flow; Tailmance never parses provider identity tokens client-side to grant product authorization. Linking an identity does not bypass MFA, legal acceptance, account state, or country gates.

### Bot and brute-force protection

Supabase Auth rate limits are the baseline. A production native anti-bot/CAPTCHA flow is a separate release-blocking item because enabling a dashboard CAPTCHA without a working mobile challenge/token path can break legitimate sign-in. The final challenge provider, keys, accessibility behavior, fallback, and staging abuse tests must be evidenced before release. Account-level lockouts must not be added casually because they can be weaponized for denial-of-service against legitimate accounts.

## 2. Network and transport security

- All production endpoints must use HTTPS/WSS. The client rejects non-HTTPS production configuration.
- Android generated network security configuration disables cleartext traffic and trusts system roots only.
- iOS ATS keeps arbitrary, media, WebView, and local-network exceptions disabled.
- The Supabase client uses a 45-second abortable network timeout.
- Generic automatic retries are intentionally **not** applied to non-idempotent mutations such as messages, likes, purchases, reports, or destructive actions. Endpoint-specific idempotency/retry policy is required instead.
- Certificate pinning is not applied to managed Supabase/RevenueCat endpoints. Blind pinning to third-party certificate chains can brick healthy clients during certificate rotation. Pinning may be introduced only for Tailmance-controlled first-party hosts with backup pins, rotation drills, expiry monitoring, and a recovery plan.
- Tailmance currently has no WebRTC voice/video feature. SRTP/STUN/TURN requirements are therefore not applicable today. If WebRTC is added, `wss://` signaling, SRTP, TURN relay/privacy policy, abuse controls, and IP-leak testing become release requirements.

## 3. Payments and subscription integrity

- The mobile client cannot grant itself Premium.
- RevenueCat SDK handles store purchase UX while Tailmance server reconciliation re-reads current RevenueCat subscriber state before applying entitlement changes. RevenueCat → Tailmance webhooks require both the operator-configured Authorization secret and RevenueCat HMAC-SHA256 signature over the raw body with a five-minute timestamp replay window, then enforce environment and app-id allowlists before any ledger mutation.
- Webhooks require configured authorization plus HMAC validation, replay-window controls, durable idempotency/claim handling, and server reconciliation.
- Account deletion queues RevenueCat customer erasure before local auth hard deletion and retains a durable retry path for provider cleanup.
- Apple App Store Server Notifications and Google Play RTDN/Pub/Sub are **external release gates**. Their live dashboard connection and recent/test delivery timestamps must be evidenced.
- Purchase, restore, renewal, cancellation, expiration, refund/revocation, grace/billing-retry, and account-transfer cases must be tested on both store sandbox/test tracks before release.

## 4. Mobile client hardening and app integrity

- Tailmance now has source-side **Google Play Integrity Standard requests** and **Apple App Attest** integration. Challenges are one-time, short-lived and action-bound. Android verdicts are decoded server-side and bound to the expected package name, request hash, signing-certificate allowlist, version-code allowlist, app-recognition verdict, device-integrity verdict and licensing policy. iOS attestation/assertion verification is delegated to a Tailmance-controlled HTTPS verifier and App Attest assertion counters are monotonic to reject replay.
- High-risk actions are protected twice: client/Edge preflight and database-side write gates. Lost-pet alerts, event creation, meetup creation, Boost, Travel Mode and Super Like cannot bypass integrity policy merely by calling a database path directly when policy is in `step_up`/`enforce`. source policy now defaults to `enforce`; `observe` is permitted only through a short, audited service-role relaxation window. Production verifier/device effectiveness still requires external evidence.
- App-attestation keys/verdicts are never treated as substitutes for RLS, MFA, authorization, rate limits or moderation. They are additional device/app-integrity signals.

- Android production targets API 36, enables R8 minification and resource shrinking, and blocks cleartext networking.
- Release binaries must be signed only by controlled production signing identities; debug artifacts are never production artifacts.
- Tailmance does not treat local root/jailbreak/debugger/emulator heuristics as authorization. These checks are bypassable and can create false positives.
- Negative Apple/Google platform-attestation verdicts are retained as bounded server-side audit evidence. Provider outages, verifier misconfiguration and transient verification failures remain fail-closed 503-class operational failures rather than being mislabeled as device tampering.
- A service-role incident-response path can revoke every currently known GoTrue session ID for a user and advance the per-user revocation watermark immediately. Local client heuristics never trigger this revocation automatically.
- The production integrity boundary is **server-verified Apple App Attest and Google Play Integrity**. The complete physical-device and backend verification flow remains a fail-closed external release gate until evidence exists.
- Sensitive MFA, chat/health/verification surfaces use screen-capture protection where platform capabilities allow. iOS cannot provide an absolute screenshot-prevention guarantee, so server authorization and data minimization remain primary controls.
- Sensitive secrets/tokens are never intentionally copied to the clipboard.
- No secret, service-role key, provider private key, webhook signing secret, or Sentry auth token may live in an `EXPO_PUBLIC_*` variable.

## 5. Data privacy, storage and lifecycle

- Native Tailmance uses a narrowly scoped SQLCipher SQLite queue only for replay-safe offline social mutations. The key is generated from the native OS CSPRNG, stored in this-device-only SecureStore/Keychain, and the queue is account-bound. Payments, legal consent, account deletion, health verification, boosts and super-likes are excluded from offline replay. The queue is not a local social-data replica.
- Supabase RLS is enabled; direct table grants are minimized and high-risk writes use constrained RPCs/Edge Functions.
- Exact coordinates are isolated from public pet data and public responses use privacy-preserving location/distance behavior.
- Pet/social/verification images are re-encoded into a fresh JPEG before upload, capped at a 2400px longest edge. This drops source-container metadata such as EXIF/GPS in the normal image path and reduces oversized-image memory/storage pressure. PDFs are not rewritten and remain private.
- Health documents are private, signed access expires, and verification status cannot be self-awarded by owners.
- Production console logging may not contain passwords, tokens, message bodies, health content, precise location, or raw provider errors.
- Account deletion and data export are reachable in-app and implemented server-side. Deletion inventories database, storage, provider cleanup, billing references, moderation/audit orphans, notifications, and Auth deletion through bounded/claim-protected flows.
- Market distribution is fail-closed. Translation availability alone is not legal approval. The configured 27 have current internal official-source legal + legal-language source approval, while live store/provider/operator/privacy/registration facts remain separate production evidence and unconfigured countries remain blocked.

## 6. Social interaction and content safety

- Messaging requires an active unblocked match; free-message quotas are enforced server-side.
- Blocking severs relevant social/match paths and prevents further messaging. Reporting exists for supported UGC surfaces.
- Private media uses signed URLs and moderation state. Moderation has automated-provider, retry, queue, admin, and escalation paths.
- User input is validated at server/RPC boundaries; direct client text is never interpolated into SQL.
- End-to-end encrypted messaging is **not currently enabled**. Tailmance’s current abuse-reporting/moderation architecture requires server-visible message data. E2EE may only be introduced with a redesigned abuse-reporting, key-management, device migration, recovery, legal-retention, and moderation model rather than bolted on superficially.

## 7. Performance, crash prevention and observability

- Heavy network/file/image work is asynchronous; state writes are generation-guarded so stale active-pet requests cannot overwrite current pet data, including A→B→A switch races.
- Push registration/lifecycle mutations are serialized and epoch-guarded across pet switch and logout.
- Images use Expo Image/ImageManipulator paths rather than holding original full-resolution source metadata indefinitely.
- Native crash/ANR reporting is source-wired with Sentry. Production activation requires a real DSN, org/project, secret source-map upload token, and a controlled native-crash symbolication/privacy test.
- Sentry defaults are privacy-minimal: `sendDefaultPii=false`, screenshot/view-hierarchy attachment disabled, logs disabled, and performance tracing disabled until separately reviewed.
- Product analytics is not a security requirement and is intentionally optional; Tailmance may ship in privacy-minimal mode without behavioral analytics.
- Worker heartbeats and a secret-protected ops-health surface cover push, moderation, deletion, storage GC and reminder workers.

## 8. Backend/API security

- Supabase RLS, least-privilege grants, constrained RPCs, Edge Function auth, server-side validation and endpoint-specific rate limits are primary controls.
- Edge CORS is explicit-origin rather than wildcard. CORS is not treated as an authentication control.
- Tailmance currently embeds no WebView and has no browser-rendered authenticated application surface, so CSP is not a mobile API authorization substitute. Public web support/deletion pages remain separately hardened.
- Destructive operations use bounded pagination/chunking, durable claims/idempotency, and sanitized error responses.
- Security tests continuously assert authorization boundaries, moderation/storage privacy, subscription reconciliation, MFA, transport configuration, image metadata normalization, country fail-closed behavior, and external-evidence release gates.

## 9. External evidence that source code cannot prove

`npm run release:external-security` reads `release/external-security-evidence.json` and blocks production until real evidence exists for:

- Apple App Attest server verification,
- Google Play Integrity server verification,
- native crash/ANR symbolication and privacy,
- Apple server notifications and Google RTDN into RevenueCat,
- RevenueCat → Tailmance webhook verification,
- full store sandbox subscription lifecycle,
- native authentication anti-bot challenge behavior,
- representative physical-device security smoke tests,
- an external production TLS endpoint scan,
- the dependency-resolved iOS merged Privacy Manifest / Required Reason API audit,
- inspection of the actual store-ready Android/iOS release binaries for signing, debug flags, shrinking/symbol handling, entitlements/permissions, secrets and generated network/privacy configuration,
- production moderation-provider quality plus manual-review/report-response staffing and SLA evidence.

Never mark one of these `verified` merely to pass CI.

## 10. Incident response

Tailmance maintains a service-only incident ledger and a separate jurisdiction-decision ledger. Incident ownership defaults operationally to **Yekta Özel**. Evidence may be placed on hold so automated integrity-evidence cleanup cannot destroy material needed for an unresolved incident. The operational country matrix is generated from `release/official-source-review-v19.json` into `release/security-incident-obligations-v19.json`; it covers all 27 configured launch markets but remains **fail-closed** and never constitutes legal approval.

Internal response begins immediately. Privacy/legal escalation has a target of **within 60 minutes of incident classification**, but external legal clocks are jurisdiction-specific and may start on awareness, detection, determination or another statutory event. Tailmance must never assume a universal “72 hours” rule. Examples include Türkiye 72 hours after learning of the breach, Australia a 30-calendar-day suspected-breach assessment maximum followed by notification as soon as practicable, Singapore three calendar days after determining a breach is notifiable, and separate conditional cybersecurity clocks such as India CERT-In six hours. Country/subnational applicability must still be confirmed.

1. Triage severity, affected accounts/data/features and attack window.
2. Contain using runtime maintenance/minimum-version gates, provider revocation, feature disablement, rate limits or store rollout halt as appropriate.
3. Rotate compromised credentials and invalidate affected sessions/tokens.
4. Preserve minimal necessary audit evidence with least-privilege access.
5. Patch in staging and run security/regression/migration tests.
6. Deploy backward-compatible server/database containment first when possible, then staged/phased client rollout.
7. Notify users, stores, processors and regulators when applicable jurisdiction rules require it.
8. Perform post-incident review and add a regression test/control.

## Pre-release security gate

Before every production release run the complete offline suite, dependency/type checks with installed dependencies, migration checks, country gate, external evidence gate, store-metadata/assets checks, physical-device tests and store sandbox lifecycle tests. `release:check` is deliberately expected to fail when a production secret, external legal approval, dashboard connection, crash-symbolication proof, integrity proof, or device test is missing.

No product can truthfully be guaranteed “unhackable.” Tailmance’s standard is layered prevention, least privilege, verification, detection, containment, recovery, and evidence-backed release decisions.
For the current end-to-end control-by-control status, including deliberate N/A decisions and production-evidence blockers, see `SECURITY_CONTROL_COVERAGE_2026-09-30.md`.



## Native auth anti-bot challenge

- Production email sign-in/sign-up, password reset and phone OTP request a Cloudflare Turnstile token before calling Supabase Auth.
- The app generates a 192-bit state with the native OS CSPRNG, opens only the configured HTTPS challenge page, and accepts only `tailmance://auth-challenge` callbacks whose action and state exactly match the pending request.
- The challenge page is CSP-restricted, uses the configured Turnstile site key, and returns the short-lived token only to the app callback.
- Supabase Auth validates `captchaToken`; source config mirrors Turnstile CAPTCHA locally. Hosted Auth CAPTCHA configuration and physical-device behavior remain release evidence and fail closed.
- The static challenge also carries defense-in-depth meta CSP, but production hosting must send security headers at the HTTP layer. In particular, `frame-ancestors` must be enforced by the response header; this remains part of the production TLS/header evidence gate.
- OAuth remains provider-mediated; the Tailmance CAPTCHA flow does not attempt to wrap Apple/Google OAuth redirects.
