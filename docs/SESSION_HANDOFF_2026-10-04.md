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
- Owner decision 2026-10-05: the health-record AI check is NOT switched off. The owner is asked to upload every filled page of the vaccination booklet; after upload all pages are read together and compared, within the required date ranges, with the vaccinations, internal and external parasite treatments and care that apply to the pet's species, age and owner-entered breed. A complete, current record is marked "checked and approved"; the note says this is not a statement that the pet is healthy. Every AI-given piece of information and guidance carries "AI can make mistakes, please check". The provider contract is still needed before this can run in production (see `4_AI_SAGLAYICI_VE_MODEL_DOSYASI.md`); `docs/OPERATIONS_RUNBOOKS_2026-10-05.md` holds the operating plans.

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
- Branch note (updated 2026-10-12): `main` contains everything up to pull request 15 (the health check, veterinarian removal, mating texts). Later work (domain readiness and anything after it) lives on branch `claude/determined-cerf-m1od2d` until the owner merges it; a new cloud session must check out that branch.

## Next steps
1. User adds environment secrets (names only): `EXPO_TOKEN`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64`, `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY_CONTENT_BASE64`, `APPLE_TEAM_ID`, then the app values from `.env.example` and `supabase/.env.example`. The App Store Connect key that was shared in chat earlier must be revoked and a new one created.
2. In the new session: list env var NAMES only, run `npm run release:diagnose`, then `npx eas-cli build -p android --profile production --non-interactive` and `-p ios`, fix build errors in code.
3. Still open and user-side: domain with `apple-app-site-association` / `assetlinks.json`, store forms, review account, device evidence, operator tax/EU-representative questions, health AI provider contract, real on-device safety model files, GitHub account `yektaozel` and repo transfer, Italy D.Lgs. 30/2026 and German OS age-signal items in `docs/LEGAL_CROSS_CHECK_2026-10-04.md`.

## Decision 2026-10-05 (evening): on-device AI disabled in v1
- Operator delegated the choice; recorded in `release/edge-ai-model-evidence-v21.json` (`v1_scope_decision`). No on-device model ships; `prefilterImageSafety` returns `unavailable` and server moderation (`moderate-media`) decides every upload. `release:edge-ai` passes with that decision; `EXPO_PUBLIC_EDGE_AI_MODEL_MANIFEST_*` are no longer required by `release:config`. To re-enable: set the decision to `enabled`, supply manifest and complete the six evidence items. No store text or legal page may claim on-device screening.
- Gates after this change: 10/23 PASS, 13 BLOCK (all need real keys, domain, console forms, device evidence, provider contract).
- Health-record AI provider research (2026-10-05, public pricing pages): Google Cloud Vision OCR has 1,000 free units per month per feature; Azure Document Intelligence F0 returns only the first two pages per request and is evaluation-only. Neither returns the strict worker schema or checks a veterinary registry, so an adapter is still required and, without a registry source, results must stay in manual review. The provider contract (DPA, no-training, deletion, region) can only be accepted by the operator in the provider console.

## Decision 2026-10-05 (night): the health check involves no veterinarian; Google Cloud Vision does the reading
- Everything that modelled a veterinarian, clinic, registry or credential is gone: migration 201 (signal, `clinic_public_id`, `integrity_status`, `pet_health_summary.veterinarian_verified`, trust badge payload, discovery filter, mating condition, match-vector slot), the `health-verification-webhook` function and its secret, client types/screens/filters/strings in 19 locales. Mating eligibility now uses the current vaccination check instead.
- `health-ai-worker` calls Google Cloud Vision (document text detection, `eu-vision.googleapis.com`) and applies `supabase/functions/_shared/healthBookletCheck.ts` (schedule version `tailmance-booklet-schedule-2026-10`). One check per booklet, 3 minutes after the last page; approval expires at the earliest due date; at most 900 pages a month (free tier); unclear -> person, unreadable -> rejected.
- The text says what is actually checked: vaccinations and internal/external parasite treatments, from species and date of birth. Breed and "other care" are NOT checked (no measurable standard exists), and all 19 catalogs, 22 legal languages, 594 supplements and the Turkish pages were rewritten to say so. The on-device model sentence was removed from the privacy notice (the model is not shipped).
- New in the app: an explicit agreement dialog before the first page is sent to the provider (`health.uploadConsent*`).
- Provider review, costs, KVKK step and setup: `docs/HEALTH_AI_PROVIDER_REVIEW_2026-10-05.md`. The operator must accept the Google Cloud Data Processing Addendum before the live check is switched on.
- Tests added: `health-booklet-check-tests` (25 rule scenarios), `health-ai-worker-simulation` (7 scenarios, real worker source), `supabase/tests/health_document_check_smoke.sql` (real PostgreSQL: approval, expiry, downgrade, restriction, free-tier guard).

## State on 2026-10-12: domain readiness, Apple identity, Supabase project
- Domain readiness is in the repository: `web/index.html` (site root), JSON headers for the two `.well-known` files in `web/_headers`, `web/favicon.png`, `npm run verify:domain -- <domain> [dkim-selector]` (read-only live check) and `docs/DOMAIN_DNS_EMAIL_RUNBOOK_2026-10-05.md` (hosting on Cloudflare Pages with a dependency-free build command, DNS/e-mail staging, store URLs, and the list of items from a generic deep-link guide that were deliberately not adopted). The domain name itself is not chosen yet (recommendation: `tailmance.com`, availability not checked from the sandbox).
- Apple: the owner is enrolled as an Individual in the Apple Developer Program; the 10-character Team ID was given in chat and must be supplied as the environment variable `APPLE_TEAM_ID` (never committed). The Android App Signing certificate SHA-256 only exists after the first upload to Play Console (`ANDROID_APP_LINK_CERT_SHA256`). With the domain these three values let `generate-app-link-associations.mjs` produce the association files.
- Supabase project `tailmance-prod` (ref `fskxcneajoujvnjxsbqi`, Frankfurt) exists but is NOT migrated. A trial through the connector left a partial state: migration history rows `m001_schema`, `m002a_security_and_rpcs_part1`, `m002b_discover_like_pass_fav`, 33 public tables, 13 public functions, the three storage buckets, the trigger `on_auth_user_created` and a leftover schema `tmp_setup`. The project has 0 users and 0 files. The connector cannot finish the job: large DDL calls time out after 60 seconds and destructive statements hang until they time out, so migrations 003-201 and the clean-up must be run by the owner.
  1. Supabase dashboard -> SQL Editor: run the reset script below once (confirm the destructive-statement warning). It was tested on a local copy of the full chain database (121 tables, 372 functions, 13 types, 3 auth triggers -> all dropped, `public` schema kept) and migrations 001-003 then applied cleanly from zero.
  2. On a machine with the repository: `npx supabase login`, `npx supabase link --project-ref fskxcneajoujvnjxsbqi`, `npx supabase db push` (asks for the database password, reset it in Dashboard -> Project Settings -> Database). Optionally `npx supabase config push` afterwards to apply the `[auth]` settings in `supabase/config.toml` (read the diff it prints first).
  3. Then `npx supabase functions deploy` and `npx supabase secrets set --env-file <server env file>` (names in `supabase/.env.example`).
  4. In a session with network access to the project: compare the remote against the local database fingerprints (functions, columns, constraints, indexes, triggers, policies, types, grants, legal supplement hashes) and run the Supabase advisors.

```sql
-- Tailmance: reset the partial test state on tailmance-prod (0 users, 0 files).
-- Keeps the public schema and its default privileges, the storage buckets and every Supabase-managed object.
drop trigger if exists on_auth_user_created on auth.users;
do $$
declare r record;
begin
  for r in select format('%I.%I', schemaname, tablename) as obj from pg_tables where schemaname = 'public' loop
    execute 'drop table if exists ' || r.obj || ' cascade';
  end loop;
  for r in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as obj
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute 'drop function if exists ' || r.obj || ' cascade';
  end loop;
  for r in
    select format('%I.%I', n.nspname, t.typname) as obj
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype in ('e', 'd')
  loop
    execute 'drop type if exists ' || r.obj || ' cascade';
  end loop;
end $$;
drop schema if exists tmp_setup cascade;
delete from supabase_migrations.schema_migrations;
```
