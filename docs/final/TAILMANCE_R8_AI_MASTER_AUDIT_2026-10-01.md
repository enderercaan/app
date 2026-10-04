# Tailmance v19 R8 — AI / Matchmaking / Health / Observability / Store Review Master Audit

Date: 2026-10-01
Application: Tailmance
Owner/operator attribution: Yekta Özel
Direct source parent: Tailmance-v19-R8-REELS-PRIVACY-RETRY-PET-FIRST-HARDENED-FINAL-SOURCE-2026-10-01.zip
Direct parent SHA-256: ec4fa4102fe2b0c0d4592669f0e7061ab990bd40e5a4a530de3929e47c574512

## Non-negotiable product boundaries preserved

- Pet is the persona; owner account data is not promoted into public pet surfaces.
- Pet sale/commercial trading and adoption/rehoming solicitation remain prohibited and moderation-bound.
- Mating stays owner-arranged/P2P and jurisdiction fail-closed; the platform is not a breeder, sale, or transaction marketplace.
- Existing block/incognito/discoverability/legal/session/MFA/moderation controls remain authoritative before ranking or content presentation.

## New source hardening in this audit

### Migration 181 — pgvector pet matchmaking

- Adds private 40-dimensional deterministic pet compatibility embeddings using PostgreSQL pgvector.
- Adds HNSW cosine indexing.
- Embedding inputs are pet/product signals only: energy, age/weight bands, size, purposes, privacy-safe breed/temperament buckets, health-verification signals, species/profile verification anchors.
- Exact location, owner PII, biography text and raw microchip data are excluded from embedding input.
- Existing discovery authorization/safety/privacy/distance/mating filters execute first; vector similarity only re-ranks already-authorized candidates.
- Current blend is rules-first: 70% established discovery score + 30% cosine compatibility.

### Migration 182 — registry-backed health AI/OCR queue

- Adds private health AI job queue and private inference metadata ledger.
- Adds service-role claim/apply/defer workflow with bounded retries and exponential backoff.
- Strict provider-result schema validation; unknown fields and duplicate signals are rejected at the database boundary.
- Per-signal temporal state is reset independently to prevent timestamp state leakage between signals.
- Confidence policy is fail-closed:
  - below 0.65 or invalid credential integrity: reject;
  - 0.65 through 0.85, unverified credential integrity, or any signal at/below 0.85: manual review;
  - above 0.85 only with valid credential/registry integrity and all signals above 0.85: eligible for automated verification.
- AI confidence alone is not treated as veterinary truth.

### Health AI worker

- Adds authenticated `health-ai-worker` Edge Function with dedicated secret, HTTPS host allowlist and provider configuration.
- Uses short-lived private document access.
- Hashes provider references before persistence.
- Does not persist raw OCR text or raw microchip values in AI telemetry.
- Reuses the existing provenance-bound health attestation authority for verified signals.

### Migration 183 — privacy-minimal frame performance telemetry

- Adds private anonymous aggregate client-performance storage.
- Captures only bounded JS frame-window metrics such as average FPS, slow/frozen-frame ratios, frame count, duration, platform and app version.
- No user ID, pet ID, location, content, URL, message body or free-form payload is accepted.
- Requires an active authenticated session, rate limits ingestion and applies bounded retention.

### Sentry/native performance observability

- Uses low-sampled navigation tracing and native slow/frozen-frame tracking when Sentry is configured.
- Transaction data is scrubbed of user/request identity, query parameters, UUID-like route data and arbitrary span data.
- Network and console breadcrumbs are disabled for the native crash provider.
- First-party aggregate frame telemetry is sampled in a bounded window and rate-limited independently.

### Migration 184 — Health AI privacy lifecycle

- Health-document deletion removes linked AI inference metadata.
- Adds service-role retention purge for inference metadata.
- Account export includes bounded health-AI decision history while excluding provider anti-replay/reference hashes.

### Migration 185 — exact RevenueCat premium contract

- Removes the historical database default from `subscriptions.entitlement_id`.
- New subscription writes must carry the exact provider entitlement rather than silently inheriting a stale fallback.
- Production configuration gates require `tailmance_premium`; client package configuration requires `premium_access`.

### Migration 186 — context-bound health passport SHA-256 fingerprint

- Adds a non-secret SHA-256 fingerprint for current valid veterinarian attestations.
- Fingerprint is context-bound to attestation, pet, signal, clinic/provider reference hash and verification timestamps rather than exposing the provider reference directly.
- Trust Pill consumes the returned `passportSignatureSha256` field.

### Migration 187 — manual-review SLA and operations visibility

- Adds an explicit manual-review due timestamp capped at 23 hours from health-AI job creation, leaving operational margin under the product's 24-hour review target.
- Adds service-role-only due-order queue access and aggregate overdue/worker-liveness snapshot.
- Source enforcement makes the SLA measurable but does not fabricate real staffing evidence.

### Migration 188 — stale health-AI lease recovery

- Recovers worker claims left in `processing` for more than ten minutes.
- Stale claims consume a bounded attempt and eventually fail safe into manual review rather than remaining permanently stuck.
- Exhausted stale work is surfaced into the protected moderation queue.

### Migration 189 — worker heartbeat and ops-snapshot parity

- Expands the private worker-heartbeat CHECK constraint to all eight scheduled workers, including `health-ai-worker` and `livekit-room-reaper`.
- Extends the aggregate operations snapshot with health-AI overdue/stuck counters and LiveKit teardown overdue/stuck counters.
- Regression checks require every scheduled worker to be present in the database heartbeat allowlist.

### Migration 190 — pgvector Boost priority preservation

- Keeps active Boost priority as the primary ordering class after pgvector adoption.
- Hybrid cosine/rules compatibility only ranks pets within the same Boost class, preserving the pre-existing monetization/product contract without weakening safety or privacy filters.

### Migration 191 — canonical health-document type boundary

- New health-document writes accept only the product-supported `health_record` class.
- Arbitrary user-controlled document labels are never forwarded to the external health-AI provider.
- Historical/legacy rows with unsupported document classes are preserved but routed directly to manual review instead of automated provider processing.

### Migration 192 — Redis/pgvector discovery parity

- Redis discovery remains an identifier cache only; cached pets are rehydrated through current authorization, privacy, safety, pass/match and account-state gates.
- Cache-hit discovery is then passed through the same pgvector hybrid reranker as cache-miss discovery.
- Boost-first ordering from migration 190 is preserved in both paths.

### Migration 193 — AI provider cost-budget circuit breaker

- Adds private service-role-only provider budgets and atomic minute/hour usage windows.
- Moderation and health-AI workers must consume the appropriate budget before any external provider call.
- Budget exhaustion fails closed before paid provider execution; clients cannot inspect or mutate counters.
- Adds bounded retention cleanup for cost windows.
- This is a cost/abuse circuit breaker layered on top of existing authenticated rate limits, queue claim bounds and retry backoff.

### Store review access

- No hardcoded reviewer password, hidden premium entitlement bypass, device/IP bypass or review-only authorization backdoor is present.
- Review access is documented as a dedicated real review account through the ordinary production auth path.
- Apple review billing must use StoreKit sandbox and Google review billing must use Play license-test mechanisms.
- Credentials belong in the relevant store-review console fields, not the application binary/source tree.

### Edge AI release evidence

- Existing native CoreML/Vision and Android MediaPipe/TFLite runtime remains source-implemented.
- Production release evidence now requires approved model provenance, quality/safety evaluation and representative physical-device warm-inference p95 at or below 30 ms.
- Source presence does not fabricate model/device performance evidence.

### Force update

- Existing runtime force-update engine remains fail-closed for production verification failure.
- Cached configuration can only satisfy the production gate when it is fresh, structurally valid and itself requires maintenance/force-update; a stale/benign cache cannot silently bypass a failed production verification.
- Runtime-cache read/write failures now emit privacy-safe operational signals rather than being silently swallowed.

## Critical journey / visual QA source contract

- Added Maestro flows for onboarding entry and the profile → verification → premium/paywall reviewer journey.
- Stable `testID` selectors are bound to the real production UI surfaces rather than a hidden review-only navigation path.
- E2E credentials are environment-injected only; no reviewer email/password is embedded in source or binary.
- The release gate intentionally remains blocked until real iOS/Android release-candidate runs, screenshots/run logs, and visual-golden evidence are supplied.
- Static source checks do not claim physical-device or perceptual UI evidence.

## Verified source state

- Canonical migrations: 001–193 contiguous.
- Domain: 18/18 PASS.
- Security: 382/382 PASS.
- Authenticated RPC session/MFA boundary: 123/123 PASS.
- Authenticated RLS/storage session/MFA boundary: 4/4 PASS.
- Security-control applicability: 49/49 classified.
- Product/retention/trust/monetization/pet-first: 87/87 PASS.
- Pending hardening: 107/107 PASS.
- Accessibility: 216 Pressables + 45 TextInputs + 2 Switches + 15 Modals PASS.
- Backend contracts: 171 RPCs, 10 invoked Edge Functions, 29 function directories.
- Edge/shared TypeScript syntax/semantic: 40/40 PASS.
- UX static checks: 57 TSX files plus contrast/assets/journeys PASS.
- Runtime i18n: 19/19 locales, 1,639 keys each; critical non-English localization 316/316 per locale.
- Legal static: 57/57 PASS.
- Legal Context: 91/91 PASS.
- Country/control source evidence: 594/594.
- Critical legal subdimensions: 432/432.
- Configured-market source legal/language review: 27/27 PASS; 222 unconfigured countries remain out of scope/BLOCK.
- Store metadata: 19/19 locale sets; 266 localized text fields PASS.
- Repository hygiene: 125/125 application source modules reachable; 108/108 maintenance scripts referenced.
- Executable-source empty catch blocks after remediation: 0.
- Project lint is regenerated from the final source tree before packaging; the authoritative count is recorded in `RELEASE_EVIDENCE.json` and `docs/final/SOURCE_VERIFICATION_2026-09-30.txt`.
- Roadmap implementation classification: 21/21; source gaps=0; four phases retain explicit external verification boundaries.

## Production release boundary

The repository is intentionally fail-closed. Source/static completion does not equal a store-ready production release without real environment and operational evidence.

Current release diagnosis: 7/22 gates PASS, 15 BLOCK. Outstanding categories are genuine external/runtime inputs, including:

- production client/server/web secrets and provider configuration;
- genuine `package-lock.json` and dependency-resolved reproducible native build state; an isolated `npm install --package-lock-only --offline` probe failed with `ENOTCACHED` for `@config-plugins/react-native-webrtc`, so no synthetic lockfile was created;
- hosted Universal/App Link domain association and real signing/team identifiers;
- store-console compliance evidence, review-account evidence and store screenshots;
- real iOS/Android critical-journey and visual-golden execution evidence;
- real Sentry DSN/symbolication/source-map upload evidence;
- real Edge-AI model artifacts/provenance/quality/device latency-memory-offline evidence;
- real health-AI provider contract, veterinary registry coverage, calibration, manual-review staffing and production privacy/deletion exercise;
- live App Attest/Play Integrity, TLS/binary/device/provider/notification/IAP evidence;
- production legal/operator/tax/store facts that cannot be truthfully inferred from source code.

No synthetic production secret, store approval, reviewer credential, model result, counsel approval, device benchmark or dependency lock is created to turn these gates green.

## UI/UX conclusion

All current automated accessibility, contrast, asset and journey gates pass. A literal 100/100 delight score is not asserted from static source analysis because delight, motion smoothness across device classes, Dynamic Island/notch behavior, 120 Hz rendering, haptics and usability require representative physical-device and human usability evidence. The source is structured so those remaining measurements can be performed without weakening production safety gates.
