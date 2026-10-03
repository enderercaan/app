# Tailmance v19 R8 — AI Master Final Handoff

**Date:** 2026-10-01  
**Owner / operator metadata:** Yekta Özel  
**Application:** Tailmance  
**Direct authoritative parent:** `Tailmance-v19-R8-REELS-PRIVACY-RETRY-PET-FIRST-HARDENED-FINAL-SOURCE-2026-10-01.zip`  
**Direct parent SHA-256:** `ec4fa4102fe2b0c0d4592669f0e7061ab990bd40e5a4a530de3929e47c574512`

This handoff is a forward-only continuation of the direct parent above. It does not merge or restore R7, older R8, or superseded/intermediate trees.

## Source-hardening delta in this continuation

### 181 — Deterministic pgvector pet matchmaking
- Added private 40-dimensional pet-only compatibility embeddings.
- Added HNSW cosine indexing and hybrid reranking.
- Existing privacy, safety, distance, pass/match and mating eligibility gates execute before vector reranking.
- Owner PII, exact location, raw microchip and freeform biography are excluded from the embedding.

### 182 — Health AI OCR + registry guardrails
- Added private health-AI job and inference ledgers.
- Confidence bands are fail-closed: `<0.65` reject; `0.65–0.85` manual review; `>0.85` can auto-verify only when verified registry/credential integrity and all required signals exceed threshold.
- AI confidence alone cannot establish veterinary truth.
- Raw OCR values and raw microchip identifiers are not persisted in AI telemetry.

### 183 — Privacy-minimal performance telemetry and image-memory guard
- Added authenticated, rate-limited client performance event ingestion with no pet/user content payload.
- Added sampled frame-window telemetry in production.
- Added iOS `expo-image` 100 MB memory cache ceiling and bounded cache counts, plus background/memory-pressure cleanup.
- Sentry remains privacy-scrubbed and source-map/de-obfuscation ready when real production credentials are supplied.

### 184 — Health AI privacy lifecycle
- Health-document erasure also removes linked AI decision metadata.
- Account export exposes bounded decision history without provider anti-replay/reference secrets.
- Service-role retention purge support added.

### 185 — Exact RevenueCat entitlement/package contract
- Canonical entitlement: `tailmance_premium`.
- Canonical package identifier: `premium_access`.
- Client/server release gates and purchase selection enforce the same mapping.
- Legacy implicit `premium` default removed without rewriting historical migrations.

### 186 — Public Health Passport SHA-256 fingerprint
- Trust Pill exposes a selectable SHA-256 public passport fingerprint derived from attestation context.
- Raw provider references and private veterinary documents remain hidden.

### 187 — Health AI manual-review SLA
- Manual-review due time is bounded to less than 24 hours from job creation.
- Service-only due queue and operational snapshot added.
- Source instrumentation does not fabricate real reviewer staffing or provider SLA evidence.

### 188 — Health AI stale-claim recovery
- Stale processing leases are recoverable with bounded attempts.
- Exhausted jobs fail closed into protected manual moderation flow.

### 189 — Worker heartbeat / ops parity
- Operational heartbeat allowlist includes all eight scheduled workers.
- Health-AI and LiveKit stale/overdue metrics are included in the operational snapshot.

### 190 — Preserve Boost priority under pgvector reranking
- Vector compatibility cannot erase paid Boost priority.
- Reranking occurs inside the appropriate Boost priority class.

### 191 — Canonical health-document type enforcement
- New client-facing health-document writes accept canonical `health_record` only.
- Legacy or unsupported document types are routed to manual review and are not transmitted to the AI provider.
- Prevents user-controlled document-class injection into the health AI contract.

### 192 — Redis discovery / pgvector parity
- Redis remains an identifier cache, never an authorization cache.
- Cache hits are rehydrated through current authorization, privacy, safety, pass/match and account rules.
- Cache-hit and cache-miss paths use the same pgvector hybrid reranking and Boost priority behavior.

### 193 — AI provider cost-budget hardening
- Added private service-role-only atomic minute/hour budget windows for paid external AI providers.
- `content_moderation` and `health_ai` provider calls consume budget before outbound requests.
- Budget exhaustion fails closed; clients cannot read or mutate budget controls.
- Added bounded retention cleanup for cost windows.

### Critical journey / visual QA source contract
- Added Maestro source flows for onboarding entry and profile → verification → premium/paywall.
- Added deterministic production UI selectors required by those flows.
- Credentials remain environment-injected only; no reviewer password, hidden Premium grant, or IAP bypass is stored in the repository.
- Real device execution, screenshots/run logs, and approved visual-golden matrices remain external release evidence and fail closed.

## Multi-modal pet-first moderation hardening
- Video provider contract requires explicit `pet_first_context` and explicit `audio_transcript` field.
- OCR text and audio transcript both pass deterministic server-side Tailmance text policy checks.
- Commercial pet trading, price-sale intent and adoption/rehoming content remain zero-tolerance.
- Provider classification alone is insufficient; deterministic policy and sanitized derivative requirements remain in the approval conjunction.

## Store review architecture
- No reviewer password, Premium entitlement grant or IAP bypass is embedded in the application binary/source.
- Review access uses ordinary production authentication with credentials supplied only through App Store Connect / Google Play review-access surfaces.
- Purchases remain real StoreKit sandbox / Google Play test-purchase flows during review.
- Production EAS profiles do not enable demo-mode bypasses.

## Current measured source state
- Canonical migrations: **001–193 contiguous PASS**
- Domain: **18/18 PASS**
- Security: **382/382 PASS**
- Authenticated RPC session/MFA boundary: **123/123 PASS**
- Authenticated RLS/storage boundary: **4/4 PASS**
- Security applicability: **49/49 PASS**
- Product / Retention / Trust / Monetization / Pet-first: **87/87 PASS**
- Pending hardening: **107/107 PASS**
- Accessibility: **216 Pressables + 45 TextInputs + 2 Switches + 15 Modals PASS**
- Backend contracts: **171 RPCs; 10 invoked Edge Functions; 29 function directories**
- Edge/shared TypeScript: **40 syntax + 40 semantic PASS**
- TypeScript source semantics: **127 files; 0 high-signal diagnostics**
- Repository hygiene: **125/125 app modules reachable; 108/108 scripts referenced**
- UX: **57 TSX PASS**
- Runtime i18n: **19/19 locales × 1,639 keys**
- Critical non-English localization: **316/316 per non-English locale**
- Legal static: **57/57 PASS**
- Legal Context: **91/91 PASS**
- Configured markets: **27/27 source legal/language PASS**
- Country × topic official-source matrix: **594/594**
- Country × runtime-control evidence: **594/594**
- Critical legal subdimensions: **432/432**
- Store metadata: **19/19 locale sets; 266 localized text fields PASS**
- Roadmap: **21/21 classified; source gaps=0; 4 external-only phase evidence gates**
- Project lint at final source-truth sync: **2,341 text files PASS**

## Reproducible dependency boundary
A genuine `package-lock.json` remains absent. A fresh isolated non-mutating attempt using:

`npm install --package-lock-only --ignore-scripts --offline --no-audit --no-fund`

failed with npm `ENOTCACHED` for `@config-plugins/react-native-webrtc`. No synthetic lockfile was generated and no dependency-resolved native-build proof is claimed.

## Release posture
Latest release diagnosis before final packaging: **7/22 PASS, 15 BLOCK**.

The blocked gates are genuine production/external evidence rather than hidden source-remediable defects, including real production client/server/web configuration and secrets, hosted Universal/App Link identities, store-console compliance/reviewer access evidence, real App Attest/Play Integrity/device/provider/model evidence, production health-AI provider/registry calibration and staffing proof, external legal/operator/store facts, production Sentry credentials + symbolication proof, real store screenshot assets, real critical-journey/device/golden evidence, and the genuine dependency-resolved lockfile/build state.

**Source-remediable pending findings identified by this audit: 0.**

This does not convert external release gates into PASS and does not claim a literal human-perceived “100/100 UI/UX delight” score without physical-device and human usability evidence.
