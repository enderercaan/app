# Tailmance v19 R8 — Reels Privacy / Retry / Pet-First Hardening Handoff

Date: 2026-10-01

## Continuation authority

This checkpoint is a direct continuation of:

- `Tailmance-v19-R8-ROADMAP-21-PHASE-SOURCE-HARDENED-FINAL-2026-10-01.zip`
- parent SHA-256: `8c4f46f55879888209c9407d4e6115c87a5d08247112bbda2172163ef2211fc4`

That parent already includes and must preserve the hardening lineage after the older full-app clean checkpoint (`18d91f744f471cde3b500ebf906a2d8abda84c1b149ead21ae3c82ca380d0c4c`), including PostGIS, Redis read acceleration with Postgres re-authorization, Trivy, Universal/App Links, 19-locale rehoming zero-tolerance, SQLCipher offline mutation replay, media/OCR moderation, Fastlane, private typing, Story replies, LiveKit/system-call source integration and the other R8 roadmap hardening. Do not merge or revert to an older R7/R8/intermediate tree.

## Reels / short-video slice completed and hardened

The production-source Reel pipeline is now bound end-to-end as:

1. local video selection with strict MIME, duration, dimensions and 40 MiB limits;
2. private `social-media` upload intent and signed upload URL;
3. pending `post` + pending `post_media` creation through durable client-operation idempotency;
4. provider-neutral moderation with the Tailmance policy contract;
5. required media OCR plus an explicit `pet_first_context:boolean` provider attestation;
6. deterministic server OCR checks for prohibited pet commerce, rehoming/adoption and human-dating misuse;
7. for videos, independently reported 1–60 second duration and allowlisted HTTPS sanitized MP4 derivative;
8. atomic sanitized-path finalization with raw-object garbage collection;
9. publication only after both media and text moderation are approved;
10. direct, Redis-rehydrated and Universal-Link reads all re-authorized against current block/discoverable/incognito rules;
11. signed `social-media` storage reads use the same canonical visibility rule rather than a looser path-only authorization rule;
12. vertical `expo-video` UI with foreground/focus playback gating, bounded mounted window, measured viewport snapping and bounded signed-URL recovery;
13. desired-state like/save mutations reuse the encrypted replay-safe offline queue;
14. approved comment counts never optimistically include moderation-pending comments;
15. upload/submit/remove, like/save/report/share, pagination and playback recovery paths use synchronous single-flight guards where same-render double actions would otherwise race;
16. all runtime copy remains in the complete 19-locale catalog.

## New canonical migrations

- `179_social_media_storage_visibility_parity.sql`
  - signed social-media access now mirrors current canonical social visibility, moderation and block state.
- `180_reel_idempotent_retry_rate_limit_order.sql`
  - exact durable `create_reel` response-loss replays are resolved from the existing mutation receipt before the daily create rate limit is consumed.

Canonical migration chain: `001–180`, contiguous.

## Current source verification snapshot

After the above changes and source/evidence resynchronization:

- Domain: `18/18 PASS`
- Security: `382/382 PASS`
- Authenticated RPC boundary: `122/122 PASS`
- Authenticated RLS/storage boundary: `4/4 PASS`
- Product / retention / trust / monetization / pet-first: `86/86 PASS`
- Accessibility: `215 Pressables + 45 TextInputs + 2 Switches + 14 Modals PASS`
- Backend contracts: `165 RPCs`, `10` invoked Edge Functions, `28` Edge Function directories
- Edge syntax + semantic checks: `39 + 39 PASS`
- Runtime i18n: `19/19` locales, `1,639` keys each; `316/316` critical keys localized in every non-English runtime locale
- Legal static: `57/57 PASS`; legal context: `91/91 PASS`
- Configured legal/language source scope: `27/27 PASS`; worldwide unconfigured jurisdictions remain fail-closed
- Source SHA manifest is regenerated at final packaging time after this handoff is included.

## Roadmap truth boundary

All 21 roadmap phases are explicitly classified. Current source gaps are `0`. Four phases retain explicit partial/external verification boundaries rather than being mislabeled as source defects:

- certificate/SPKI pinning: production-host ownership, backup-pin rotation and managed-provider compatibility decision/evidence;
- WebRTC/system calls: real LiveKit/TURN/APNs VoIP, scheduler/monitoring and representative physical-device killed/background-state evidence;
- on-device AI: real production model artifacts, provenance/license, representative accuracy/bias/safety and device latency/memory evidence;
- Fastlane screenshots: genuine release-candidate multi-device screenshot capture/store evidence.

## Reproducibility and production boundary

A genuine dependency-resolved `package-lock.json` is still absent. No synthetic lockfile is permitted. Attempts to resolve a package-lock in the available environment did not complete, so dependency-resolved `tsc --noEmit` / native release reproducibility is not claimed. The repository's offline syntax, semantic and static/regression suites remain the source-verification boundary.

Real production/store/device/provider/hosted-config/observability/legal-operator evidence remains fail-closed and must not be converted into PASS by source code alone. The final archive hash and clean-extraction result are recorded in the external packaging verification artifact generated after the ZIP is built.
