# Tailmance v19 R8 — Security Dependency Hardening — 2026-09-30

## Authority

Direct parent source checkpoint:
`Tailmance-v19-R8-SECURITY-FINAL-SOURCE-2026-09-30.zip`

Parent SHA-256:
`30371b85398c5cd92f40f9541cce4292c7ca694ea617551819a4a6b26c323327`

No R7 or superseded/intermediate R8 tree was merged.

## Dependency source corrections

1. `expo-status-bar` was corrected from unpublished/incompatible `~57.0.4` to Expo SDK 57's published compatible line `~57.0.1`.
2. The Expo/Xcode transitive UUID advisory boundary is mitigated with a narrow npm override only for `xcode > uuid`, pinned to patched `11.1.1`.
3. Two permanent security regressions assert these dependency-policy decisions. Security regression count is now 270/270 PASS.

## Reverification

- `npm run verify:offline`: PASS.
- Edge/shared syntax: 31/31 PASS.
- Edge/shared semantic: 31/31 PASS.
- repository hygiene: 104/104 app source modules; 70/70 maintenance scripts.
- domain: 18/18 PASS.
- security: 270/270 PASS.
- authenticated RPC boundary: 103/103 PASS.
- authenticated RLS/storage boundary: 4/4 PASS.
- security incident matrix: 27/27 configured markets PASS, fail-closed.
- security applicability: 36/36 PASS.
- product/retention/trust/monetization: 47/47 PASS.
- pending hardening: 107/107 PASS.
- project lint: PASS after this dependency hardening.

## Honest release boundary

A genuine registry-generated `package-lock.json`, clean `npm ci`, `npm audit --audit-level=moderate`, dependency-resolved `tsc --noEmit`, Metro/Hermes bundling, native release builds and physical-device evidence are NOT marked PASS in this checkpoint unless actually produced. During this continuation the execution environment could not resolve npm registry DNS, so synthetic dependency evidence was not created.

The source mitigation is present and regression-locked, but reproducible dependency/build proof remains fail-closed until registry access and real dependency resolution are available.
