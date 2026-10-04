# Tailmance mobile transport security decision

Review date: **2026-09-30**

Tailmance production mobile traffic is HTTPS-only. iOS App Transport Security has no arbitrary-load, media, WebView, or local-network exception. Android disables cleartext traffic, trusts only the platform system trust store, and Android 16/API 36 builds explicitly opt in to Certificate Transparency.

## Certificate/public-key pinning decision

Tailmance does **not** hard-code brittle certificate or SPKI pins for managed third-party endpoints whose TLS key and CA rotation Tailmance does not control, including managed Supabase, Apple, Google, RevenueCat, and Sentry endpoints. This avoids turning legitimate managed-certificate rotation into a production outage.

Before production release, `production_mobile_transport_pinning_decision` must inventory every actual endpoint from the release binary. A future Tailmance-controlled API gateway may enable public-key pinning only when all of the following are true:

- Tailmance controls the server TLS key lifecycle and emergency rotation process.
- At least one independent backup SPKI pin is shipped and tested before activation.
- Pin expiry/update and emergency app-update recovery are documented and exercised.
- Both iOS and Android release binaries are tested against primary and backup keys.
- The decision is re-reviewed whenever the endpoint, CA, CDN, or key-management model changes.

Until that evidence exists, the secure baseline is strict platform certificate validation, Certificate Transparency where declaratively supported, HTTPS-only endpoint validation, and an external production TLS/header scan. Source configuration is not treated as proof of deployed TLS posture.
