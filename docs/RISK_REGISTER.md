# Risk Register

| ID | Risk | Severity | Mitigation / gate |
|---|---|---:|---|
| R-001 | Destructive stack rewrite loses 193 migrations/security/legal controls | Critical | Preserve authoritative RN/Expo source; separate migration program only if explicitly ordered later |
| R-002 | Legacy package IDs renamed without store ownership check | Critical | VERIFY store records before identifier change |
| R-003 | False health assurance wording creates user/animal safety risk | Critical | document-verified vocabulary; no disease-free/healthy claims; human review for ambiguous health AI |
| R-004 | Mating used as commerce/breeding marketplace | Critical | zero fee/sale/rehoming rules + country policy gate + moderation |
| R-005 | Exact location inference/trilateration | Critical | private PostGIS, coarse/fuzzy output, stable viewer-pet jitter, query limits |
| R-006 | UGC abuse/animal cruelty/rehoming content | Critical | pre-publish and post-publish moderation, report/block, SLA, appeals |
| R-007 | Auth/social-login bypasses age/legal gate | Critical | existing-account-only social sign-in until gated account exists; server-side legal/age evidence |
| R-008 | Dependency/supply-chain non-reproducibility | High | genuine lockfile + SBOM/signed builds required before production |
| R-009 | Store metadata/privacy declarations drift from code | High | generated inventory, release gates, final console reconciliation |
| R-010 | Localization semantic/legal errors across 19 locales | High | automated parity/LQA + native-speaker sign-off recommended |
| R-011 | Legal applicability changes after review | High | jurisdiction matrix, temporal watchlist, country fail-closed, counsel evidence |
| R-012 | Reviewer access broken | High | real review account instructions, no production backdoor, sandbox store billing |
| R-013 | Offline replay duplicates destructive/payment/social actions | High | durable idempotency receipts and ownership binding |
| R-014 | Media leaks EXIF/GPS or health docs | High | private upload intents, sanitize/re-encode, signed URLs, lifecycle deletion |
| R-015 | Reels/calls cause memory/battery instability | High | controller/session cleanup, bounded image memory, background teardown, device evidence |
| R-016 | AI/provider runaway spend | High | migration 193 atomic minute/hour provider budgets and external cloud budgets |
| R-017 | AI moderation false positives/negatives | High | deterministic policy layers + human review + appeals; provider evidence gate |
| R-018 | Accessibility regressions | High | semantic/static gates + device/assistive-tech human run |
| R-019 | Account deletion leaves processor/provider remnants | Critical | durable deletion queues, external processor deletion, audit/retry workers |
| R-020 | Trademark/name conflict | High | use ™ only; VERIFY clearance/registration before asserting registered rights |
| R-021 | OAuth provider token revocation fails, expires, or becomes unreadable after key rotation at deletion time | Critical | Source mitigation complete through migrations 194–195: encrypted service-only AES-256-GCM vault, Google offline-consent refresh-token request, Apple/Google revoke adapters, durable retry, bounded previous-key keyring with progressive re-wrap, and localized manual fallback on every deletion surface, exact Apple native/browser client-ID binding, and production env validation for provider code exchange. Live provider sandbox/revoke evidence remains required before release. |
