# Tailmance Surgical Dead-Code, Dependency, Asset & Import Cleanup

Date: 2026-10-01
Owner / publisher: Yekta Özel
App: Tailmance™
Direct parent checkpoint: `Tailmance-v19-R8-MODULE-01-CORE-AUTH-AGE-OAUTH195-HARDENED-FINAL-SOURCE-2026-10-01.zip`
Parent SHA-256: `5af9064d3c512d9f86ed9a04c1403de27f0e08f558351359519dd64ce8ee8202`

## Scope and safety rule

This cleanup is forward-only. Nothing was removed from naming or intuition alone. A deletion or visibility reduction was accepted only when static reachability, source usage, build/config usage, compatibility boundaries, or byte identity proved it safe. Runtime compatibility RPCs, webhook/worker Edge Functions, native infrastructure dependencies, dynamic i18n keys, migrations, legal evidence, security controls, RevenueCat flows, offline replay, PostGIS/pgvector logic, and the asymmetric messaging unlock rule were explicitly protected.

The authoritative repository is React Native / Expo + Supabase / Edge Functions. Flutter, NestJS and Go files do not exist in this checkpoint and were not fabricated for the cleanup.

## Exact removals

### Superseded repository-root artifacts removed (12)

- `TAILMANCE_R8_CURRENT_EXACT_HANDOFF_2026-09-30.md`
- `TAILMANCE_R8_DEEP_BLIND_SPOT_AUDIT_FINAL_HANDOFF_2026-09-30.md`
- `TAILMANCE_R8_DEEP_REAUDIT_CONTINUATION_FINAL_HANDOFF_2026-09-30.md`
- `TAILMANCE_R8_FULL_APP_GAP_AUDIT_FINAL_HANDOFF_2026-09-30.md`
- `TAILMANCE_R8_PRODUCT_STRATEGY_FINAL_HANDOFF_2026-09-30.md`
- `TAILMANCE_R8_SECURITY_FINAL_EXACT_HANDOFF_2026-09-30.md`
- `TAILMANCE_R8_SECURITY_FULL_REAUDIT_HANDOFF_2026-09-30.md`
- `Tailmance-v19-R8-DEEP-BLIND-SPOT-AUDIT-FINAL-VERIFICATION-2026-09-30.txt`
- `Tailmance-v19-R8-DEEP-REAUDIT-CONTINUATION-FINAL-VERIFICATION-2026-09-30.txt`
- `Tailmance-v19-R8-FULL-APP-GAP-AUDIT-FINAL-VERIFICATION-2026-09-30.txt`
- `Tailmance-v19-R8-PRODUCT-STRATEGY-FINAL-VERIFICATION-2026-09-30.txt`
- `Tailmance-v19-R8-SECURITY-FULL-REAUDIT-VERIFICATION-2026-09-30.txt`

The two boundary documents used by current regression gates remain in place.

### Duplicate asset removed (1)

`assets/splash.png` was SHA-256 byte-identical to `assets/icon.png`. The splash configuration now references `assets/icon.png`, and the duplicate file was deleted.

Static asset footprint changed from 5 files / 20,958 bytes to 4 files / 13,004 bytes: **7,954 bytes removed with zero visual-content loss**.

### Dead source/API surface removed or narrowed

- Removed 49 compiler-detectable unused imports, locals, destructured values, and parameters.
- Removed dead frontend wrapper `getMeetupRequests()`; active paginated API remains. The legacy backend RPC is retained for backward compatibility.
- Removed unused MFA wrappers: `listTotpFactors`, `cancelTotpEnrollment`, `unenrollTotp`.
- Removed unused helpers / types: `getFormattingLocale`, `hasStoreRatingDestination`, `OfflineMutationQueueStatus`, `getOfflineMutationQueueStatus`, `getTranslationCoverage`, `FREE_OUTGOING_MESSAGE_LIMIT`, `MAX_POST_CAPTION_LENGTH`, `ContentSafetyWarningCode`.
- Converted internal-only exported functions/constants/types to private module symbols instead of exposing unnecessary public API surface.
- Merged duplicate imports; duplicate import declarations are now a permanent hygiene failure.

No database migration, public compatibility RPC, Edge webhook/worker endpoint, native module, security control, or user-facing route was removed.

## Dependency audit

Production dependency count after audit: **50/50 accounted for**.

Safely removable production dependencies: **0**.

Three packages without direct application-source imports are retained as documented native infrastructure dependencies rather than misclassified as unused:

- `react-native-screens` — native screen infrastructure required by React Navigation native stack.
- `@livekit/react-native-webrtc` — native WebRTC dependency required by LiveKit React Native.
- `react-native-nitro-modules` — Nitro runtime required by native Nitro modules.

A permanent `test:dependency-purity` gate now fails CI when a production dependency lacks runtime/build evidence and is not one of the documented native-infrastructure dependencies. Wildcard/latest/git/http/file/link production dependency specifications are rejected.

## Import and static-analysis purity

- `tsconfig.json` now enforces `noUnusedLocals` and `noUnusedParameters`.
- App/source semantic gate includes unused-symbol diagnostics.
- Edge semantic gate runs with unused locals and parameters enabled.
- Duplicate module imports are rejected by repository hygiene checks.
- App source reachability is enforced from real production entry points.
- Maintenance script reachability is enforced from actual `package.json` commands, preventing orphan script cycles.

Measured before final evidence regeneration:

- App modules reachable: **126/126**.
- Maintenance scripts command-reachable: **112/112**.
- Edge/shared TypeScript no-unused semantic: **42/42 PASS**.
- High-signal app semantic diagnostics: **0**.

## Asset/resource audit

All four remaining static assets have active config/runtime/release usage:

- `assets/icon.png`
- `assets/adaptive-foreground.png`
- `assets/notification-icon.png`
- `assets/favicon.png`

A SHA-256 duplicate-static-asset guard is now part of `test:assets`.

Custom native modules were retained because all are reachable from production services and covered by release/security gates:

- `tailmance-device-integrity`
- `tailmance-edge-ai`
- `tailmance-system-calls`

## Localization audit

No locale key was deleted solely because a raw source-string search did not see it. Apparent unused keys were traced to runtime-generated permission/status keys, plural-category lookups, or dynamic prompts. Deleting them would create silent runtime translation regressions.

**Safely removable locale keys: 0.**

All 19 runtime locale catalogs remain aligned. Dynamic and plural lookup coverage remains protected by i18n regression tests.

## Repository delta before this report / regenerated evidence

Compared with the direct parent extraction at the cleanup point:

- 13 files removed: 12 superseded root artifacts + 1 duplicate asset.
- 1 new permanent dependency-purity test script.
- 63 existing files surgically changed for import/export/static-analysis/asset cleanup.
- Source-tree byte delta at that point: **-44,860 bytes**.

Generated evidence/report/manifest files added or updated after this measurement are expected to change the final archive size and are not runtime bloat.

## Protected production pillars

The cleanup explicitly preserves and regression-tests:

- authentication, 18+ gate, provider revocation, MFA and session revocation;
- offline mutation queue, durable idempotency and retry behavior;
- PostGIS / pgvector discovery and privacy boundaries;
- MASVS/security regression controls;
- RevenueCat entitlement `tailmance_premium` and package `premium_access`;
- server-authoritative chat quota and asymmetric unlock behavior;
- UGC moderation, zero-commerce / zero-rehoming policy and animal-safety controls;
- Reels, Stories, private realtime chat, LiveKit/system-call native integrations;
- 19-locale runtime and legal/store localization;
- legal-country runtime separation and fail-closed unsupported jurisdictions.

## Reproducible dependency boundary

A real isolated `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` resolution probe did not complete in the available environment and produced no `package-lock.json`.

No synthetic lockfile was fabricated. Reproducible dependency-resolved release proof therefore remains fail-closed until a genuine npm resolution succeeds in a networked release environment.

## Final verification policy

This document does not itself declare the cleanup checkpoint authoritative. The checkpoint is authoritative only after all of the following pass on the finalized tree and again after clean extraction:

1. syntax + source/Edge semantics;
2. hygiene + dependency purity + duplicate-asset gate;
3. domain/social/offline/realtime/AI/security/auth/product/accessibility/backend/UX/i18n/legal/store regression chains;
4. release evidence / blocker inventory / current-source truth synchronization;
5. internal SHA-256 manifest validation;
6. ZIP integrity;
7. frozen-source versus clean-extraction byte comparison with added=0, removed=0, changed=0.

## Final measured cleanup state

After the complete cleanup and regression pass:

- App source reachability: **126/126 PASS**.
- Maintenance scripts reachable from real package commands: **112/112 PASS**.
- Production dependencies: **50/50 accounted for**; safely removable dependency count **0**.
- Source semantic scan: **128 TypeScript files**, **0 high-signal diagnostics**.
- Edge/shared TypeScript: **42/42 syntax + 42/42 semantic/no-unused PASS**.
- Security: **382/382 PASS**.
- Auth/session boundary: **123/123 authenticated RPCs + 4/4 RLS/storage policies PASS**.
- Product/retention/trust/monetization: **87/87 PASS**.
- Pending hardening: **107/107 PASS**.
- Accessibility: **216 Pressables + 45 TextInputs + 2 Switches + 15 Modals PASS**.
- Backend contracts: **173 RPCs; 11 invoked Edge Functions; 30 function directories**.
- UX static gate: **57 TSX PASS**.
- Runtime i18n: **19/19 locales × 1,646 keys**; critical non-English localization **316/316** per locale.
- Legal source matrix: **27/27 configured markets; 594/594 source cells + 594/594 runtime-control cells; 432/432 critical subdimensions PASS**.
- Project lint: **2,363 text files PASS**.
- Canonical migrations: **001–195 contiguous PASS**.
- Static assets: **4 files / 13,004 bytes** after byte-identical splash deduplication.

Release diagnosis after cleanup remains **7/22 PASS, 15 BLOCK** by design. The blocked gates require genuine production/store/provider/device/hosted/KMS/visual evidence and/or a real dependency lock. Source-remediable pending remains zero in the release blocker inventory. This cleanup does not claim that those external facts have been verified.
