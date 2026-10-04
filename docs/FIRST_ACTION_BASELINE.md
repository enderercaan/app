# First Action Baseline — Tailmance

This index is the ordered baseline required before module-by-module execution.

1. **Repo tree** — `docs/REPO_TREE_SNAPSHOT.md`; executable full inventory: `find . -type f | sort`.
2. **Pinned dependency table** — `docs/PINNED_DEPENDENCY_TABLE.md`. Genuine resolved lock remains a release gate; do not fabricate.
3. **MVP / v1.1 / v2 plan** — `docs/MVP_V11_V2_PLAN.md`.
4. **Requirements Ledger v0** — `docs/REQUIREMENTS_LEDGER_V0.md` (126 tracked rows at Module 1 close).
5. **Jurisdiction Matrix v0** — `docs/JURISDICTION_MATRIX_V0.md`; configured-country source review is not equivalent to production launch approval.
6. **Device Matrix** — `docs/DEVICE_MATRIX.md`.
7. **Design System** — `docs/DESIGN_SYSTEM_SPEC.md` + `src/theme.ts`.
8. **Screen inventory** — `docs/SCREEN_INVENTORY.md`.
9. **Owner Launch Runbook** — `docs/OWNER_LAUNCH_RUNBOOK.md`.
10. **Risk register** — `docs/RISK_REGISTER.md`.
11. **Gap register** — `docs/GAP_REGISTER.md`.
12. **Current project state** — `docs/PROJECT_STATE.md`.

## Stack-conflict decision
The authoritative production source is React Native/Expo/Supabase, not Flutter/NestJS. Rewriting a validated 193-migration codebase would violate security/correctness/no-regression priority. The requested architecture properties are enforced through equivalent TypeScript/RN/Supabase boundaries. A Flutter/NestJS rewrite, if explicitly commissioned later, must be a separate migration program with behavior/security/legal parity gates.

## Human-only evidence boundary
Source/static PASS is never used to fabricate real-device, store-console, provider, production secret/KMS, licensed-counsel, trademark-registration or native-speaker evidence.
