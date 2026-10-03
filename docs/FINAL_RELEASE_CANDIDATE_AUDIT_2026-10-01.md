# Tailmance Final Release Candidate Audit — 2026-10-01

## Authority

- Owner/publisher: **Yekta Özel**
- Product: **Tailmance™**
- Forward-only parent: surgical-cleanup checkpoint SHA-256 `20d90c0680ea2c143321ec70c1004d89c535377288e97cbd877e62388cfe0643`
- This candidate preserves all parent hardening and adds migrations 196–198 plus the associated client, i18n, store-copy, UX-token, billing-policy and regression gates.

## Source-complete changes in this candidate

1. Standard quota defaults are server-authoritative **50 swipes/day + 3 new conversations/day**.
2. Quota limits are bounded and remotely configurable; the active daily window freezes its configured limit until the next verified-local-midnight reset.
3. Premium has no product quota, while anti-abuse/security rate limits remain independent and enforceable.
4. A Premium first-message permanently unlocks that conversation for the Standard recipient; subsequent replies in an existing thread do not consume another new-conversation slot.
5. The historical two-free-message authorization model is no longer authoritative.
6. Verified-only discovery defaults ON and is not a Premium-only filter.
7. Runtime and store copy across all 19 locales uses **document verification / health-document review** wording, including the approved-state signal, and rejects misleading “healthy”, “disease-free”, verified-health, historical Plus and two-message product wording.
8. Tailmance Premium naming is consistent across runtime and store copy.
9. Raw TSX colors are rejected by the design-token purity gate; semantic colors remain centralized.
10. Regional/alternative billing is service-only, evidence-bound and fail-closed; the shipped client remains RevenueCat/native-store only.
11. The persisted regional billing policy table is explicitly covered by security/RLS classification.
12. Generated source truth, blocker inventory and release evidence are synchronized to the current tree.

## Measured source verification

- Canonical migrations: **001–198 contiguous**
- Source semantic diagnostics: **0 high-signal diagnostics across 128 TypeScript source files**
- Repository hygiene: **126/126 app modules reachable; 116/116 maintenance scripts command-reachable**
- Production dependencies: **50/50 accounted for**
- Security: **382/382 PASS**
- Authenticated RPC boundary: **125/125 PASS**
- Authenticated RLS/storage boundary: **4/4 PASS**
- Domain: **18/18 PASS**
- Product/retention/trust/monetization: **90/90 PASS**
- Pending hardening: **107/107 PASS**
- Accessibility static gate: **217 Pressables + 45 TextInputs + 2 Switches + 15 Modals PASS**
- Backend contracts: **174 RPCs; 11 invoked Edge Functions; 30 function directories**
- Runtime i18n: **19/19 × 1,651 keys** with placeholder/key parity
- Critical non-English localization: **316/316 per non-English locale**
- Product-language contract: **19/19 runtime + 19/19 store locales PASS**
- Store metadata: **19/19 localized sets PASS**
- Legal static: **57/57 PASS**
- Legal Context: **91/91 PASS**
- Configured-market source legal/language: **27/27 PASS**
- Canonical legal source/control evidence: **594/594 + 594/594 PASS**
- Critical legal subdimensions: **432/432 PASS**
- Daily quota regression: **11/11 PASS**
- Design-token purity: **PASS, 0 raw TSX colors**
- Regional billing policy: **PASS, fail-closed when evidence is absent/stale/unapproved**

## UX and review-quality boundary

Source/static UX gates are clean: semantic design tokens, accessibility coverage, 19-locale product wording, error/quota copy, no historical Plus branding, no misleading health claims, and server-authoritative quota projection are regression-bound.

A literal **100/100 UX score**, guaranteed five-star user reviews, physical 60/120 Hz smoothness, notch/foldable clipping, VoiceOver/TalkBack quality, haptic feel, store screenshot accuracy, and real-device first-run timing cannot be truthfully certified from source-only execution. Those remain mandatory physical-device/device-farm/UAT evidence gates. The source contains the executable journey/device plans and fails closed on missing external proof.

## Release diagnosis boundary

`release:diagnose` reports **7/22 PASS, 15 BLOCK**. The 15 blocked families are external/production evidence rather than hidden source-remediable defects, including production client/server secrets, hosted link associations, live store-console declarations/review access, device/visual evidence, App Attest/Play Integrity/provider/KMS proof, production Health AI/provider/registry calibration, observability credentials/symbolication, store screenshots and a genuine dependency-resolved `package-lock.json`.

Source-remediable legal/language pending: **0**.

## Honesty statements

- No synthetic dependency lock was created.
- No production secret, store approval, screenshot, provider result, KMS proof, counsel approval, native-speaker approval or physical-device result was fabricated.
- Tailmance uses **document-verified** terminology and does not claim an animal is healthy or disease-free.
- `Tailmance™` is used; `®` is not used without independent registration evidence.
- Licensed counsel review is recommended before launch for legal deliverables.
- Native-speaker sign-off is recommended before launch for localized copy.

## Source release conclusion

**SOURCE-READY / EXTERNAL-GATES-PENDING.**

The source tree is suitable to freeze as the current authoritative release candidate once generated evidence is resynchronized after this document and the SHA manifest is regenerated as the final source mutation. Production/store release must remain fail-closed until the explicit external gates are satisfied with real evidence.
