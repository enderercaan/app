# Tailmance v19 R8 — Release Gate Classification

Date: 2026-09-30
Status: SOURCE/STATIC PASS FOR CONFIGURED SCOPE; PRODUCTION/LEGAL/STORE RELEASE NO-GO

## Source/static gates that pass

- Canonical migrations: 001–106 contiguous; no pending executable SQL.
- Runtime i18n: 19/19 locales × 1,535 keys; 316/316 fixed critical keys localized in every non-English locale; exact key/placeholder parity.
- Store metadata: 19/19 localized sets.
- Public legal localization: 22/22 legal-document locales × 11 route documents = 242 generated documents; exact manifest/file/hash coverage.
- Legal static: 52/52.
- Legal context: 90/90.
- Canonical country×topic source presence: 594/594.
- Runtime country×control evidence synchronization: 594/594.
- Critical legal subdimensions: 432/432.
- Worldwide ISO manifest: 249/249 explicit; 27 configured markets, 222 unconfigured markets explicitly BLOCK.
- Country×document-locale source-route coverage: 27/27 across 22 legal-document locales.
- Adversarial evidence audit: PASS; 80/80 external-evidence items classified; 0 source-remediable pending items hidden as external.

## Gates intentionally blocked by real external evidence

- `release:legal-gaps`: BLOCK. Source-presence gaps are zero, but 27/27 subnational counsel reviews and 27/27 statutory-language scope approvals remain unresolved.
- `release:country`: BLOCK without an explicit production target-country set and attributable approved country records. No country is auto-approved by source screening.
- `release:external-legal`: BLOCK. 78 genuine external legal/store/operational evidence items remain `not_verified`.
- `release:external-security`: BLOCK. 21 real production/staging/device/provider/security/incident-response evidence items remain `not_verified`.
- `release:store-compliance`: BLOCK at real App Store / Google Play Console evidence, beginning with Apple age-rating evidence.
- `release:observability`: BLOCK without a real production Sentry DSN/native crash-symbolication evidence.
- `release:store-assets`: BLOCK because real iOS/Android release screenshots are absent.
- `release:structure`: BLOCK because a genuine reproducible `package-lock.json` is absent. No synthetic lockfile is permitted.
- Main `release:check`: therefore remains NO-GO/fail-closed and must not be forced green with fabricated environment variables or evidence.

## Legal truth boundary

A populated official-source cell proves source-screening presence, not legal applicability or legal approval. The repository is not worldwide legally complete: only 27 markets are configured for country-specific screening, while 222 other ISO alpha-2 jurisdictions are explicitly blocked. Likewise, 19 runtime locales and 22 legal-document locales are the configured supported language set, not all languages worldwide.
