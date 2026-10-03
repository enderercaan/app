# Tailmance External Security Release Evidence

Source inspection cannot prove dashboard, signing, store-notification, physical-device, or third-party production behavior. Tailmance therefore keeps these controls in a separate **fail-closed evidence gate**.

The source of truth is `release/external-security-evidence.json`; `npm run release:external-security` fails until every required item is marked `verified` with an evidence reference and timestamp. Never flip a field merely to make a build green.

Server-side encryption at rest is an external deployment property. The required `production_data_at_rest_encryption_and_key_management` evidence must cover the deployed database, object storage, backups/replicas, KMS/key custody and rotation/revocation behavior. Local SQLCipher, private buckets, or source policy do not substitute for that proof.

Evidence references should point to controlled release records, redacted screenshots/exports, CI build IDs, provider delivery timestamps, or signed test reports. They must not contain secrets, tokens, raw user data, message bodies, health documents, precise location, or authentication credentials.

The current required set covers App Attest, Play Integrity, native crash symbolication/privacy, Apple and Google store notifications through RevenueCat, Tailmance's RevenueCat webhook, complete sandbox purchase lifecycle, native authentication anti-bot challenge behavior, physical-device security smoke tests, an external production TLS endpoint scan, production Google Maps Android API-key application/API restrictions, production APNs/FCM V1/EAS push credentials and end-to-end delivery, a dependency-resolved iOS merged Privacy Manifest / Required Reason API audit, inspection of the actual store-ready release binaries, and live moderation-provider / staffed response-SLA validation.

The TLS evidence must verify at minimum: no unintended HTTP cleartext listener or downgrade path; valid certificate chain and hostname; TLS 1.2 as the minimum accepted protocol with TLS 1.3 supported where the provider/platform offers it; modern cipher configuration; and HSTS on Tailmance-controlled public web hosts where applicable. A scan result is evidence for the deployed endpoint, not a substitute for client-side ATS/Android cleartext policy.

The binary-hardening evidence must come from the exact release candidate artifacts. Inspect the Android App Bundle and iOS archive for production signing, absence of debuggable/test flags and embedded secrets, generated release network/privacy configuration, least-privilege permissions/entitlements, Android R8/resource shrinking and retained private mapping, and iOS symbol/dSYM/source-map handling. Source configuration alone cannot prove what was shipped.

The moderation evidence must use the exact production provider, model/policy version and thresholds. Test representative English/Turkish and planned-market abuse classes for text and image content, sample both false negatives and false positives, prove provider-outage/manual-review fallback, identify the staffed report queue owner, and record response/escalation targets including illegal-content/emergency handling. A provider API key or a successful happy-path request is not sufficient evidence.

The moderation evidence must cover the exact production provider and policy configuration, representative English/Turkish text and image cases plus market-relevant samples, false-positive/false-negative spot checks, manual-review fallback, report/block escalation, staffed support/contact ownership, and a measured response/escalation SLA. A configured API key or successful health check is not moderation-quality evidence.
