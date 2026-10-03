# Executed PostgreSQL, Privacy and Client Review — 2026-10-03

Parent source SHA-256: `e4aa36e9449f9de64020e04454c47859330b261d59158c619c2ba14c5817070d` (Tailmance_FINAL_SOURCE_2026-10-02.zip).
Runtime: Node 22.22.2, npm 10.9.7, TypeScript 5.9.3, PostgreSQL 16.15 + PostGIS 3.4.2 + pgvector 0.6.0 + plpgsql_check 2.7.2.

## Why this review mattered

Earlier verification read the 198 SQL migrations as text only. No migration had ever been executed by a PostgreSQL
server and no PL/pgSQL body had been type-checked. This review executed the whole chain on a real server with a
local Supabase platform emulation (`supabase/tests/supabase_platform_stub.sql`) and analysed every PL/pgSQL function.

## Migration chain defects fixed (chain previously stopped at 014)

| Migration | Defect on a real server | Fix |
|---|---|---|
| 014 | `owns_pet(uuid)` ambiguous with the 002 default-argument overload; SQL bodies failed to compile | Drop the unused overload first |
| 021 | Version regex used `\\.` under `standard_conforming_strings`, rejecting `1.0.0` | Single escaped dot |
| 025 | Revoke on an overload already removed | Idempotent `to_regprocedure` guard |
| 026, 114 | `CREATE OR REPLACE` changed a function's result row type | Drop prior signature first |
| 055 | Parameter-name change via `CREATE OR REPLACE`; CASE inside a PL/pgSQL IF condition | Drop first; parenthesize CASE |
| 071, 092 | CASE inside a PL/pgSQL IF condition (syntax error) | Parenthesize CASE |
| 136 | Generated upserts 138–140 omitted the new NOT NULL `public_route_path` | BEFORE trigger derives it |

Result: **200/200 migrations apply** (`npm run verify:database`).

## Runtime defects fixed in migration 199 (each failed on every call)

- Consumable credit grant, refund and refund reversal wrote the text RevenueCat event id into the uuid
  `audit_events.entity_id`: paid Boost/Super Like credits were never granted. Before: `ERROR: column "entity_id" is
  of type uuid`. After (runtime smoke): grant returns true, balance 5, webhook event `processed`.
- Marketing push consent withdrawal wrote a bigint event id into the same uuid column: withdrawal was impossible.
- `get_product_feature_policy()` passed more than PostgreSQL's 100-argument limit to `jsonb_build_object`.
- `service_set_legal_jurisdiction_control_reviews` called the non-existent `jsonb_object_length()`.
- `rerank_discovery_with_match_vectors` could not resolve pgvector `<=>` under `search_path=''`.
- Moderation finalizers compared the `moderation_state` enum with text on idempotent replay.

After 199, plpgsql_check reports 0 errors except four reviewed trigger functions that branch on `TG_TABLE_NAME`.

## Location privacy (migration 200)

Distances shown to other accounts were exact to 0.1 km, enabling trilateration of a pet owner's home. Every
client-visible distance (discovery, cached discovery, Pati Radar) is now computed against the target snapped to a
private ~1 km grid cell and bucketed (≥1 km; whole km <10 km; 5 km steps <50 km; 10 km steps beyond). Discovery
distance filters snap up to whole kilometres. Android mock-location fixes are rejected client-side.

## Client fixes

- Discovery number filters could not accept decimals ("2,5"/"2.5" collapsed to "2"); now locale-aware.
- PrimaryButton ignores a second press within 700 ms (ghost double-submit on slow networks).
- Health documents disclose AI-assisted pre-check and human review in all 19 runtime locales.
- Android themed (monochrome) icon, force-dark disabled for the custom palette, iOS `audio` background mode for
  answered calls; generated-native verification extended accordingly.

## Not claimed

No native compilation, physical-device run, live Supabase/RevenueCat/LiveKit/Sentry/store test, store approval,
counsel approval or native-speaker sign-off. External release gates remain fail-closed by design.
