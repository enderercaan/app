# Tailmance Privacy Data Map

| Data | Purpose | Public? | Storage / handling |
|---|---|---:|---|
| Email / auth ID | Login, security, account ownership | No | Supabase Auth / private user record |
| Pet profile | Discovery and social identity | Selected fields | PostgreSQL through controlled RPCs |
| Pet photos | Profile and social features | Approved profile media only | Device-side privacy re-encode (fresh JPEG, max edge 2400 px) before Private Storage + signed URLs |
| Coordinates rounded to 3 decimal places before upload | Distance filtering | No | Private pet-location table; server-side rounding must be present in the production migration chain. Apple App Privacy classification is **Precise Location** for this source behavior; Android requests only coarse location and Google Data Safety is **Approximate location**. |
| City / district / neighborhood | Discovery context | Yes, subject to privacy settings | Pet profile |
| Messages | Matched-pet communication | Participants only | Database, active-match authorization |
| Health/aşı data | Trust, reminders, pet-care context | Verification signals only | Private tables; documents in private bucket; uploaded images are privacy re-encoded before transfer |
| Health verification attestation metadata | Explain and audit trusted health signals | Only safe trust fields are public; raw provider references are never public | Private evidence table; user export omits provider-reference hashes and includes method, clinic public ID, provider code, integrity state and lifecycle timestamps |
| Microchip details | Verification | No | Private pet data; only verification signal public |
| Owner identity-verification session metadata | Trust signal | No | Private session metadata; raw provider identifiers are forbidden and only optional SHA-256 provider-reference hashes are retained; Tailmance does not store raw government-ID images |
| Age-assurance session/result metadata | Jurisdiction-specific 18+ / minimum-age assurance | No | Privacy-minimized threshold/status/expiry/revocation evidence; provider/evidence identifiers are persisted only as SHA-256 references and raw DOB, ID images or biometric material are not stored by Tailmance |
| Payment entitlement | Premium access | No | Store + RevenueCat + server subscription state |
| Redacted billing processing activity | Entitlement reconciliation / billing support | No | Private server ledger; provider event IDs, claim tokens and internal errors are excluded from user export |
| Push token | Device notifications | No | Private push-token table |
| Reports / blocks | Safety and moderation | No | Private safety records |
| Audit/security events | Abuse prevention / incident response | No | Restricted operational records |
| Web account-deletion request email + abuse-prevention hashes | Account deletion when the app is unavailable | No | Restricted service-role-only deletion-request queue |

Production privacy disclosures must be reviewed against the exact analytics, crash-reporting and moderation providers enabled at launch.

## Release disclosure notes

- Platform taxonomy is authoritative for store declarations: Tailmance must not translate its user-facing “approximate/coarsened location” wording into an Apple `Coarse Location` declaration. The source-controlled v19 store matrix classifies iOS as `Precise Location` and Android/Google Data Safety as `Approximate location`.
- Store age/content ratings are questionnaire outputs. Tailmance remains an 18+ product, but Apple App Store Connect and Google/IARC results must be taken from the current console questionnaires and must not be prefilled from the product policy.
- The production Privacy Policy, Apple App Privacy answers and Google Play Data Safety form must be generated from the actual launch configuration, including every enabled moderation, identity-verification, billing, analytics and crash-reporting provider.
- Tailmance's recovered source does not prove a completed iOS Privacy Manifest. Required Reason API usage must be audited from a dependency-resolved native build before App Store submission; approved reason codes must not be guessed.
- Tailmance keeps 18+ self-attestation only where the active jurisdiction policy permits it. Where the policy requires `verified_external`, the source implements a separate provider-backed age-assurance session/result flow with threshold, expiry and revocation semantics. Raw date of birth, government-ID images, biometric material and raw external evidence identifiers are not persisted by Tailmance; provider/evidence references are SHA-256 minimized. Production provider quality/retention configuration remains a release gate, but the source flow itself is implemented.
- Retention periods for audit/security, billing webhook, deletion-request and moderation operational records are not finalized in source. A documented retention schedule and deletion/anonymization jobs require legal approval and staging verification.
- Country/region eligibility for the mating feature requires a counsel-approved launch matrix and technical enforcement where the feature must be disabled or altered.

## Account export boundary

The user-facing account export includes user-owned profile/social/health data, including redacted health-verification attestation lifecycle metadata, versioned legal acceptances, redacted device/push delivery history, redacted moderation outcomes, and redacted billing-processing timestamps/statuses. It intentionally excludes global configuration, worker heartbeats, ephemeral deletion/export claim tokens, raw anti-abuse rate-limit counters, raw moderation-provider references/errors, raw identity/age provider identifiers, raw push-provider identifiers, and other service-only secrets or queue internals. Privacy-minimized owner/age verification session states and SHA-256 provider-reference hashes are included where attributable to the account. Anonymous client-error telemetry is not linked to a user ID in the recovered schema and therefore cannot be attributed back into an account export.

## Media metadata minimization

Tailmance re-encodes user-selected/captured images into a fresh JPEG cache file before upload and caps the longest edge at 2400 px. The upload path never intentionally forwards the source image container, which reduces the risk of embedded source EXIF/GPS metadata being carried into pet/social/verification/health image objects. PDFs are not rewritten and remain subject to the private health-document access model. This control must be verified on native iOS/Android builds before release.

## Crash and reliability telemetry

Tailmance uses privacy-minimal first-party error fingerprints and has source integration for native Sentry crash/ANR reporting. Production Sentry configuration must keep default PII collection disabled and must not attach screenshots or view hierarchy. Tailmance does not intentionally add account identifiers, message bodies, health documents, exact coordinates, auth headers/cookies, or request bodies to Sentry events. A controlled release crash and provider-side privacy inspection is a release-blocking external evidence item.

## Market and international-transfer gate

Language availability is not distribution approval. `release/country-release-gates.json` is the engineering source of truth for market enablement and defaults every unknown/unreviewed jurisdiction to blocked. A market can move to `approved_for_release` only after dated jurisdiction review covers controller/processor roles, privacy notice, data-subject rights, international transfer mechanism, age/children rules, subscriptions/consumer law, breach duties, store disclosures, and processor contracts. Transfer mechanism and processor/subprocessor changes must be re-reviewed when hosting or provider topology changes.
## Tracking and cookie consent boundary

- Native source declares `NSPrivacyTracking=false`, contains no advertising identifier/cross-app tracking SDK, and does not request ATT solely to manufacture a consent flow.
- Public Tailmance legal pages do not set application-owned browser cookies or load behavioral advertising/analytics tags. Therefore a tracking/cookie consent banner is not shown merely for appearance when there is nothing consent-requiring to accept.
- Any future advertising identifier, cross-app tracking, non-essential cookie, behavioral analytics, or comparable technology is a **release-blocking privacy change** until data-map classification, legal-basis/consent analysis, jurisdiction-specific notice/choice, Apple ATT applicability, store declarations, retention, processor/transfer review and withdrawal behavior are implemented and evidenced.
- Essential security/session storage, if introduced on a future web surface, must be separately classified from optional tracking and must not be bundled into a false all-or-nothing consent control.

