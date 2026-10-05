# Tailmance v19 R8 — Security Control Coverage Matrix

> **Historical snapshot:** This dated 2026-09-30 document is retained for audit lineage only. It is superseded by `release/security-control-applicability-v19.json`, `release/roadmap-implementation-v21.json`, `release/RELEASE_EVIDENCE.json`/current release evidence, and the latest automated source checks. Do not use the counts or “not present” statements below as current repository truth.


Date: 2026-09-30
Status: **SOURCE-SIDE CONTROLS VERIFIED; PRODUCTION EVIDENCE REMAINS FAIL-CLOSED**
Owner / Creator / Concept / Product Design / Development / Implementation / Overall Project: Yekta Özel

This matrix maps the security/privacy architecture requested for Tailmance to the actual product surface. It deliberately distinguishes **Implemented**, **External Production Evidence**, and **Not Applicable / Not Present**. A control is never marked complete merely because a configuration placeholder or dashboard setting exists.

## 1. Authentication and session security

| Control | Tailmance status | Enforcement / note |
|---|---|---|
| MFA / 2FA | **Implemented** | TOTP authenticator and phone/SMS MFA paths exist; AAL2 is required for protected surfaces. Production SMS-provider effectiveness remains external evidence. |
| OAuth 2.0 / OIDC | **Implemented with fail-closed account policy** | Apple/Google identity paths are supported without bypassing the 18+ / legal onboarding boundary; OAuth is existing-account-safe. |
| Secure token storage | **Implemented** | Auth/session material is persisted through platform-backed SecureStore/Keychain/Keystore semantics; plaintext AsyncStorage/UserDefaults/SharedPreferences auth persistence is regression-rejected. |
| Short-lived access token | **Implemented** | Source policy is 15-minute JWT lifetime. |
| Refresh-token rotation | **Implemented / provider-backed** | Supabase refresh rotation/reuse controls are part of the hosted auth policy; hosted production settings remain external evidence. |
| Immediate session revocation | **Implemented** | Global logout/password-reset security records revoked session IDs server-side; authenticated RPC/Edge paths reject revoked sessions before JWT expiry. Service-role incident response can also revoke every currently known session plus a per-user revocation watermark without trusting client root/debug heuristics. |
| Brute-force / bot protection | **Implemented in source + external deployment gate** | Supabase auth/IP rate limits plus production Turnstile token flow cover email sign-in/sign-up, password reset and phone OTP. Tokens are acquired through a CSP-restricted HTTPS page with native-CSPRNG state and action/state-bound deep-link return. Hosted CAPTCHA settings and physical-device behavior remain external evidence. |

## 2. Network and transport security

| Control | Tailmance status | Enforcement / note |
|---|---|---|
| HTTPS / TLS | **Implemented in source; external endpoint proof required** | Production URLs reject cleartext. TLS 1.2 minimum / TLS 1.3 support and cipher posture must be proven against deployed endpoints by release-time scan. |
| Android cleartext blocking | **Implemented** | Generated Network Security Configuration disables cleartext and does not trust user-installed CAs by default in production. |
| iOS ATS | **Implemented** | Arbitrary loads, local-network, media and WebView exceptions remain disabled. |
| Certificate pinning | **Deliberately not blindly enabled** | Managed Supabase/RevenueCat endpoints are not pinned without a controlled first-party pin lifecycle, current+backup SPKI pins, rotation drill and recovery path. |
| Safe timeouts / retries | **Implemented** | Requests are abortable and bounded; only idempotent GET/HEAD reads receive bounded exponential retry. Mutating requests are not blanket-retried. |
| WebSocket / WebRTC | **WebRTC not present** | Tailmance currently has no voice/video calling surface; SRTP/STUN/TURN hardening becomes mandatory if WebRTC is introduced. |

## 3. In-app purchase and payment security

| Control | Tailmance status | Enforcement / note |
|---|---|---|
| Server-authoritative entitlement | **Implemented** | Client cannot self-grant Premium or consumable credits; RevenueCat/server reconciliation is authoritative. |
| Webhook authentication | **Implemented** | RevenueCat webhook requires operator Authorization plus raw-body HMAC-SHA256 signature verification, timestamp replay window and constant-time comparison. |
| Environment/app binding | **Implemented** | Production/sandbox environment and allowed app IDs are fail-closed. |
| Idempotency | **Implemented** | Durable event claims prevent duplicate webhook deliveries from duplicating entitlement/credits. |
| Store notifications / lifecycle | **External Production Evidence** | Real App Store / Google Play / RevenueCat dashboard notification and refund/renewal/cancel sandbox lifecycle must be exercised before release. |
| Store SDK currency | **Source-integrated, release verification external** | Store/RevenueCat SDK integration exists; exact release candidate dependency/billing versions require resolved lockfile and native build inspection. |

## 4. Mobile client and reverse-engineering resistance

| Control | Tailmance status | Enforcement / note |
|---|---|---|
| Android shrinking / obfuscation | **Implemented in release config** | R8/resource shrinking is enabled; final AAB inspection remains external evidence. |
| iOS release binary hardening | **Implemented in release config** | Release testability is disabled, shipped-product/dead-code stripping is enabled, and dSYM remains separate for Sentry symbolication; final IPA inspection remains external evidence. |
| Apple App Attest | **Implemented in source; external production proof required** | Action-bound challenges, server verification and replay-resistant counters exist. Production verifier/device evidence is required before enforcement is claimed. |
| Google Play Integrity | **Implemented in source; external production proof required** | Standard requests bind request hash/package/app/device/licensing/signing/version verdicts. Production service-account/device evidence is required. |
| Root/jailbreak/debugger/emulator signals | **Defense-in-depth telemetry only** | Local heuristics exist but are intentionally not authorization gates because they are bypassable and can false-positive. Server-verified App Attest/Play Integrity is authoritative. |
| Sensitive screen capture protection | **Implemented where platform APIs permit** | MFA/password-recovery/health/chat/verification-sensitive surfaces use capture protection/obscuring behavior. |
| Clipboard protection | **Implemented** | Secret/session/TOTP material is not exposed through clipboard helper paths; regression tests guard this. |
| Binary hardening proof | **External Production Evidence** | Exact release AAB/IPA must be inspected for signing, debug flags, secrets, entitlements/permissions, R8, symbols and privacy manifest. |

## 5. Data privacy, storage and user rights

| Control | Tailmance status | Enforcement / note |
|---|---|---|
| Local sensitive database encryption | **Not Applicable today** | Tailmance currently has no client SQLite/Room/Realm/MMKV sensitive database. Introducing one triggers a new at-rest encryption/SQLCipher threat model. |
| Secure local auth storage | **Implemented** | Platform-backed SecureStore/Keychain/Keystore path. |
| Logging hygiene | **Implemented in source** | Production secret/PII logging patterns are prohibited by regression checks; production Sentry privacy/symbolication remains external evidence. |
| Least-privilege permissions | **Implemented in source** | Camera/photo/location capabilities are contextual; final release permissions/entitlements require binary inspection. |
| Account deletion | **Implemented** | In-app and web-request flows exist; server deletion workflow accounts for Auth, database/storage, billing and provider cleanup. |
| Data export | **Implemented** | Server-side paginated/streamed export covers current personal-data domains. |
| Location privacy | **Implemented** | Exact location is separated from public pet surfaces; public discovery uses privacy-preserving/approximate distance behavior. |

## 6. Social interaction and content safety

| Control | Tailmance status | Enforcement / note |
|---|---|---|
| Automated + manual moderation | **Implemented in architecture; production quality external** | Moderation queues, provider integration hooks, manual review and appeal/report paths exist. Provider accuracy/SLA must be evidenced in production. |
| Block / report / unmatch | **Implemented server-side** | Relationship state, content/message visibility and report flows are enforced at backend boundaries. |
| No-sale / pet-first | **Implemented** | Animal-sale/puppy-listing and human-dating intent are prohibited across UGC/database paths. |
| E2EE messaging | **Deliberately not enabled** | Current abuse-reporting/moderation architecture requires server-visible messages. E2EE would require a separate key-management, recovery, multi-device and abuse-evidence design. |
| P2P IP privacy | **Not Applicable today** | No WebRTC/P2P calling feature exists. If introduced, TURN relay/privacy policy becomes mandatory. |

## 7. Performance, resilience and crash prevention

| Control | Tailmance status | Enforcement / note |
|---|---|---|
| Crash / error monitoring | **Source integrated; production evidence required** | Sentry wiring exists; production DSN, symbolication, ANR/native crash proof and privacy redaction remain release evidence. |
| UI-thread safety | **Implemented by architecture** | Network/database/crypto work is asynchronous; expensive work is not intentionally placed on render/UI hot paths. |
| Image memory/privacy handling | **Implemented** | User images are re-encoded, resized and metadata-reduced before upload; media URLs are short-lived. |
| Leak detection | **Development-only control** | LeakCanary/debug diagnostics are separated from release builds. |
| Network resilience | **Implemented** | Timeouts, cancellation and idempotent-only bounded exponential backoff are in place. |

## 8. Backend and API security

| Control | Tailmance status | Enforcement / note |
|---|---|---|
| RLS / default deny | **Implemented** | Sensitive tables are RLS/default-deny; direct grants are restricted and service-role operations are separated. |
| Input validation / sanitization | **Implemented across RPC/Edge boundaries** | Server validates identifiers, lengths, enum/domain values and ownership rather than trusting client forms. Parameterized SQL/RPCs avoid client-built SQL. |
| Rate limiting / throttling | **Implemented** | Server rate-limit functions and worker/action-specific throttles protect abuse-prone surfaces. |
| CORS / CSP | **Implemented where applicable** | Edge/web paths use controlled headers; public legal/deletion web pages are CSP-tested. |
| OWASP MASVS / mobile threat model | **Implemented as verification framework** | Tailmance maps controls to OWASP mobile guidance and keeps deployment-only evidence separate from static source claims. |
| Authenticated RPC session boundary | **Implemented and regression-checked** | 103/103 effective authenticated RPCs reach revocation/MFA session enforcement; active GoTrue session binding and same-second global-revocation ambiguity are fail-closed. |

## Configured-market security/privacy incident handling

- The generated incident-obligation registry covers **27/27 configured launch markets** and is deliberately fail-closed for counsel/applicability/tabletop evidence.
- Tailmance does **not** hard-code a universal 72-hour notification rule. Country/sector clocks, triggering conditions and temporal status are tracked separately.
- India current CERT-In requirements are separated from future-effect DPDP obligations; South Korea current effective law is pinned to the current temporal state; Indonesia/Taiwan/Thailand/UAE entries use attributable official-source evidence without inventing a deadline where the law/source does not specify one.
- The worldwide launch manifest remains **249/249 explicit = 27 configured + 222 unconfigured BLOCK**. An unconfigured country is never silently treated as approved.

## Production blockers that correctly remain BLOCK

The following cannot be truthfully completed from source code alone: deployed App Attest/Play Integrity evidence, hosted Supabase Auth/CAPTCHA/SMS settings, physical-device tests, live RevenueCat/App Store/Google lifecycle notifications, production TLS scan, exact release binary inspection, Sentry symbolication/ANR proof, moderation-provider quality/SLA, incident tabletop/counsel confirmation, store-console declarations/assets and a genuine reproducible dependency lockfile.

These are release requirements, not source-code TODOs. They must remain fail-closed until real dated evidence exists.
