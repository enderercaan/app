# Module 1 — Core + Auth + Age Gate

## Scope
Bootstrapping, auth/session integrity, verified contact, adult gate, pre-registration legal context, Apple/Google linkage, email/phone fallback, MFA, secure storage, offline-queue account binding, error/offline states, ownership/IP core metadata.

## Locked decisions
- Existing-account-only Apple/Google social login remains intentional so a social provider cannot create an account before the adult/legal pre-registration gate. New users first complete the 18+ declaration and pre-registration legal presentation, then may link Apple/Google.
- Self-attested 18+ metadata is not authoritative age assurance. Jurisdictions requiring stronger assurance remain fail-closed until provider evidence is verified.
- Root/jailbreak/debugger signals are risk inputs; only verified high-risk integrity evidence may restrict sensitive actions.
- Reviewer access uses real auth/test accounts and sandbox billing, never a hidden production bypass.

## Baseline evidence
- Dedicated Module 1 gate: PASS (`node scripts/module1-core-auth-age-checks.mjs`)
- TypeScript syntax: PASS
- Authenticated RPC session/MFA boundary: 123/123 PASS
- Authenticated RLS/storage boundary: 4/4 PASS
- Security regression: 382/382 PASS
- Runtime i18n: 19/19 × 1,646 keys PASS
- OAuth provider revocation: migrations 194–195 + encrypted credential capture + exact native/browser client-ID binding + durable Apple/Google retry + manual fallback PASS

## Eight-hat sign-off
| Hat | Result | Evidence / note |
|---|---|---|
| Architect | PASS | AuthProvider has explicit bootstrap/error state, session verification, purchase identity and offline queue binding. |
| Security | PASS | verified contact, revocation, MFA, CAPTCHA, secure storage and server legal/age boundary. |
| UX/Visual Director | PASS SOURCE | explicit loading/error/retry/accessibility states; physical golden evidence remains external. |
| Compliance/Legal | PASS SOURCE | fail-closed pre-registration legal context; licensed counsel review recommended before launch. |
| Linguist | PASS AUTOMATED | 19-locale parity enforced; native-speaker sign-off recommended before launch. |
| QA | PASS SOURCE | syntax/auth/session/security/i18n regression baseline green; real-device OAuth run remains external. |
| Performance | PASS SOURCE | bootstrap uses epochs/mounted guards; no unbounded auth listeners. |
| Store Release Manager | PASS SOURCE | Apple/Google paths and deletion routes exist; current console/reviewer evidence remains external. |

## Ownership/IP hardening
- Centralized metadata: `brand.ts` → Tailmance / Yekta Özel / Tailmance™ / © 2026 Yekta Özel.
- Settings renders localized ownership/copyright/trademark copy in every one of the 19 runtime locales.
- `NOTICE.md` preserves third-party/open-source rights and explicitly leaves user-generated content ownership with users under the Terms license.
- `®` is prohibited until trademark registration is independently verified.
- OAuth deletion credentials use AES-256-GCM with context-bound AAD; key rotation supports a bounded previous-key keyring and scheduled progressive re-wrap.

## Current official-policy verification
- Apple App Review Guidelines 4.8 currently requires an equivalent privacy-preserving login option when qualifying third-party/social login is used: https://developer.apple.com/app-store/review/guidelines/
- Apple account-deletion guidance currently says Sign in with Apple integrations should revoke user tokens using the Sign in with Apple REST API: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- Google Play currently requires account deletion both in-app and through an external web resource for apps that create accounts: https://support.google.com/googleplay/android-developer/answer/13327111

## Gap scan
Gap scans were run repeatedly until zero new source items remained. `GAP-016` closed the missing OAuth provider-revocation source path; `GAP-017` closed encryption-key rotation durability; `GAP-018` closed the post-hard-delete notification hole when a synchronous provider revoke fails. All three are implemented and regression-bound. `GAP-019` closed exact Apple native/browser client-ID binding and production env validation; `GAP-020` closed a missing static integration import that left the native social-auth module outside the reachable app graph. The final Module-1 scan returned **0 new source gaps**. Live Apple/Google sandbox revoke, real-device OAuth, store-console and provider credentials remain external release evidence, not source-completion claims.

## Exact verification commands
```bash
node scripts/module1-core-auth-age-checks.mjs
node scripts/oauth-revocation-checks.mjs
node scripts/server-env-template-check.mjs
node scripts/auth-session-boundary-checks.mjs
node scripts/store-review-access-checks.mjs
node scripts/security-checks.mjs
node scripts/security-control-applicability-checks.mjs
node scripts/domain-tests.mjs
node scripts/i18n-source-usage-checks.mjs
node scripts/i18n-checks.mjs
node scripts/runtime-language-quality-checks.mjs
node scripts/accessibility-checks.mjs
node scripts/source-semantic-local-check.mjs
node scripts/repository-hygiene-checks.mjs
node scripts/project-lint.mjs
```

## Module 1 final sign-off
| Hat | Sign-off |
|---|---|
| Architect | PASS — existing validated RN/Expo/Supabase architecture preserved; age/legal/auth boundaries remain layered and server-authoritative. |
| Security | PASS SOURCE — 382/382 security, 123/123 auth RPC, 4/4 RLS/storage; OAuth-provider revocation is now source-implemented through migrations 194–195 with exact provider-client binding and live provider proof left external. |
| UX/Visual Director | PASS SOURCE — accessible auth/error/loading/legal/ownership surfaces; real-device visual proof remains external. |
| Compliance/Legal | PASS SOURCE — age/legal pre-registration fail-closed; Apple/Google current deletion/login requirements recorded and provider revocation implemented; licensed counsel review recommended before launch. |
| Linguist | PASS AUTOMATED — 19×1646 key parity and ownership copy; native-speaker sign-off recommended before launch. |
| QA | PASS — dedicated Module 1 + OAuth revocation regression plus security/domain/i18n/a11y/hygiene gates passed. |
| Performance | PASS SOURCE — bounded bootstrap/listener lifecycle, no unbounded auth retry loop found. |
| Store Release Manager | PASS SOURCE — Sign in with Apple capability, reviewer no-backdoor gate, in-app deletion path; live OAuth/store console evidence remains external. |
