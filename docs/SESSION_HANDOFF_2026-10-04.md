# Session handoff (2026-10-04)

Read this first in a new session. Branch: `claude/determined-cerf-m1od2d` (latest commit contains all work below). Default branch `main` already holds everything up to the previous merge.

## Working rule (from the owner)
- The current branch head is the only baseline. Never go back to older files or old zips. After every meaningful change: regenerate evidence, commit, push, update this note and hand over a fresh zip (`git archive --format=zip --prefix=tailmance/ HEAD`).

## Identity and rules
- App: Tailmance, id `com.tailmance.app`, owner / creator / rights holder Yekta Özel (individual, no company). Public contact: yektaozel@icloud.com.
- The postal address is private. Never write it in the repo, legal pages, store listing or chat output.
- Never paste or print keys. Secrets live only in the cloud environment settings (names listed below). Do not change Claude, Claude Code, repo or GitHub identity.
- Never weaken a test or mark a release gate verified without real evidence.
- No `node_modules` inside the repo root (hygiene test). Install deps outside, move in only for typecheck/expo commands. Helper: regeneration chain = typecheck:evidence, current-truth:sync, evidence:generate, current-truth:sync, source-manifest:generate, verify:offline, release:diagnose.

## Product decisions made this session
- AI never detects breed. Breed is owner-entered only (breed model role, UI, i18n keys and evidence items removed).
- Health AI reads only the pet health record. A complete, consistent record (microchip, vaccinations, internal and external parasite treatments, no errors) may be marked verified; incomplete, unclear or inconsistent goes to human review (policy in `supabase/functions/health-ai-worker/index.ts`, guarded by `scripts/health-ai-checks.mjs`).
- Every legal surface (22 legal languages, 594 country supplements, Turkish static pages, 19 app locales) says: AI can make mistakes, check important information, verified label is not veterinary advice, certification or guarantee. Guard: `npm run test:health-ai-disclaimer`.
- On-device AI is only the photo safety pre-filter; it stays off until real model files and evidence exist.

## State
- tsc 0 errors, `verify:offline` passes, Android release build verified earlier, `release:diagnose` 9/23 PASS, 14 BLOCK (all need external evidence or real keys; list in the scratchpad checklist `Tailmance_14_KAPI_KONTROL_LISTESI.md` and `npm run release:diagnose`).
- EAS builds were NOT started: the earlier session had no `EXPO_TOKEN`.

## EAS variables (important)
- EAS cloud builds read variables from EAS servers, not from the Claude environment. The Claude environment only needs `EXPO_TOKEN` (plus store keys for local helpers). Put the app/server values in EAS: `eas env:create --name NAME --value VALUE --environment production --visibility sensitive` (or plaintext for non-secret `EXPO_PUBLIC_*`, `secret` for server-only). Files such as `google-services.json` go in as file variables (`GOOGLE_SERVICES_JSON`). `eas.json` build profiles now set `environment` (development/preview/production).
- Google Play: upload the service account JSON to EAS credentials (`eas credentials --platform android`), submit profile `production` uses track `internal`, draft. Apple: set up the App Store Connect API key via `eas credentials --platform ios`, then put the Apple ID of the app in `submit.production.ios.ascAppId` of `eas.json`.
- Individual Apple accounts: only the Account Holder can generate signing credentials.

## iOS native notes
- Swift cannot be compiled in the cloud container. The CallKit/PushKit coordinator (created at launch via an app-delegate subscriber), the single-resume Vision continuation, the memoized model hash and the Caches-backed compiled model are verified only by source checks. First real check: the EAS iOS build, then a VoIP push to a terminated app on a physical iPhone.

## Owner decisions recorded on 2026-10-05
- Owner declaration dated 2026-10-05: sole proprietor, Apple and Google identity verification done, Apple DSA Trader and Play payments profile done, Turkish tax registration active (details private), income only via the stores, EU representative not required. Recorded as three dated `owner-attestation:` evidence items (operator identity / address-tax / market operator disclosures) in `release/external-legal-evidence.json`; the owner explicitly approved this category. The boundary and legal-policy checks accept it only for the operator-identity boundary class with a dated attestation reference; 56 external items remain pending.
- Legal content review passed (no untranslated text, placeholders or whitespace defects in 22 legal languages and 594 country supplements); not a lawyer or certified-translator sign-off.
- Phone, postal address, tax number: private file only, never in the repo.
- Still needed from the owner: a domain name, then web publication, EAS variables, store forms.

## Final audit notes (2026-10-05)
- Owner name is `Yekta Özel` everywhere (the ASCII spelling in support documents and podspecs was fixed).
- Privacy notice data categories now match the store-form answers in all 22 languages.
- Dependencies: `expo-font` added (peer of expo-symbols); `expo-modules-core` and `@expo/config-plugins` are no longer direct dependencies (imports go through `expo` and `expo/config-plugins`).
- Not set on purpose, owner decision needed before the first iOS upload: `ITSAppUsesNonExemptEncryption` (export-compliance declaration). The app uses TLS, SQLCipher and WebRTC; answer Apple's encryption questionnaire accurately.
- iPad: `supportsTablet` is true, so App Store Connect requires iPad screenshots (or set it to false).
- A new cloud session building the app must check out branch `claude/determined-cerf-m1od2d` (or `main` after the owner merges it); `main` alone does not contain this work.

## Next steps
1. User adds environment secrets (names only): `EXPO_TOKEN`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64`, `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY_CONTENT_BASE64`, `APPLE_TEAM_ID`, then the app values from `.env.example` and `supabase/.env.example`. The App Store Connect key that was shared in chat earlier must be revoked and a new one created.
2. In the new session: list env var NAMES only, run `npm run release:diagnose`, then `npx eas-cli build -p android --profile production --non-interactive` and `-p ios`, fix build errors in code.
3. Still open and user-side: domain with `apple-app-site-association` / `assetlinks.json`, store forms, review account, device evidence, operator tax/EU-representative questions, health AI provider contract, real on-device safety model files, GitHub account `yektaozel` and repo transfer, Italy D.Lgs. 30/2026 and German OS age-signal items in `docs/LEGAL_CROSS_CHECK_2026-10-04.md`.
