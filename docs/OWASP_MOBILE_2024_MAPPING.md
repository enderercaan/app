# Tailmance OWASP Mobile Top 10 2024 / MASVS Mapping

Review date: **2026-09-30**

OWASP’s current Mobile Top 10 final release is the **2024** list. Tailmance also uses the OWASP MASVS control groups as the more verification-oriented baseline. OWASP MASWE v1.0.0 was released in August 2026; its weaknesses include non-reproducible builds and device-compromise/resilience concerns, so Tailmance keeps the missing lockfile and release-binary/integrity evidence as explicit blockers rather than treating source checks as certification.

| OWASP Mobile Top 10 2024 | Tailmance controls | Remaining release evidence |
|---|---|---|
| M1 Improper Credential Usage | SecureStore token persistence; server secrets excluded from public env; secret scan/release config gates; Sentry auth token build-secret only | Production secret ownership/rotation evidence |
| M2 Inadequate Supply Chain Security | Pinned Expo/RN ecosystem versions; release structure requires `package-lock.json`; migrations/evidence manifests/checksums | **Current working tree is blocked until a real registry-generated lockfile exists**; dependency audit and signed build provenance required |
| M3 Insecure Authentication/Authorization | Confirmed email/phone, 12-char mixed-class passwords, 15m JWT, refresh rotation, TOTP/phone MFA/AAL2, native Turnstile anti-bot flow, server RLS/RPC/Edge authorization, active-session binding and global logout/session revocation | Hosted Auth settings + physical-device MFA evidence |
| M4 Insufficient Input/Output Validation | RPC/Edge validation, MIME/size bounds, rate limiting, private signed media, sanitized provider/database errors, no client SQL interpolation | Dynamic abuse/fuzz tests on deployed endpoints |
| M5 Insecure Communication | HTTPS production config, Android cleartext off, strict iOS ATS, explicit-origin CORS, bounded network timeout | Native artifact/network proxy verification; first-party pinning only if a managed rotation design exists |
| M6 Inadequate Privacy Controls | Exact-location isolation, least privilege permissions, media EXIF/GPS normalization, private health docs, export/delete, fail-closed country gate, privacy-minimal crash config | Store privacy/data-safety forms, processor DPAs, transfer mechanisms, counsel approvals |
| M7 Insufficient Binary Protections | Android R8/resource shrinking, production signing requirement, platform attestation design | App Attest + Play Integrity server-verification evidence; binary reverse-engineering/tamper test |
| M8 Security Misconfiguration | Source-controlled Auth policy, CORS, ATS/network security, no wildcard production origin, production env gates, external evidence gates | Deployed dashboard/config diff verification |
| M9 Insecure Data Storage | No local SQLite/Realm/Room; auth tokens in SecureStore; private buckets; short-lived signed access | Native Keychain/Keystore behavior and backup/restore test |
| M10 Insufficient Cryptography | TLS platform stack, store/platform crypto, webhook HMAC, App Attest/Play Integrity design; no custom home-grown crypto | Provider key rotation and attestation verification evidence |

## MASVS control groups

Tailmance treats MASVS-STORAGE, CRYPTO, AUTH, NETWORK, PLATFORM, CODE, RESILIENCE and PRIVACY as continuing audit categories rather than a one-time badge. Passing repository checks is not a claim of formal third-party MASVS certification. Dynamic MASTG-style testing on release binaries and deployed services remains part of the final evidence set.

## Current OWASP references

- Mobile Top 10: https://owasp.org/projects/mobile-top-10
- MASVS: https://mas.owasp.org/MASVS/
- MASWE: https://mas.owasp.org/MASWE/
