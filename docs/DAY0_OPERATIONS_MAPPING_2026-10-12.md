# Day-0 operations package: mapping to the real Tailmance stack (2026-10-12)

The "Day-0 operations and final store approval package" that was supplied assumes a Flutter / NestJS / Drift / Firebase stack and the bundle id `com.yektaozel.tailmance`. Tailmance is Expo SDK 57 / React Native 0.86 with Supabase (Postgres, RLS, Edge Functions), RevenueCat, Sentry and LiveKit, and its bundle id / package name is `com.tailmance.app` (`app.config.ts`). This file records, item by item, what was applied, what was adapted and what was deliberately not adopted. Secrets and account numbers are not stored in this repository.

## Applied

| Item | Where |
| --- | --- |
| Reviewer notes for App Store Connect / Google Play, matching what the app really does (report, block, in-app deletion, export, restore purchases, Lost Paw alerts, AI-assisted booklet check with "AI can make mistakes, please check.", mating non-involvement) | `docs/compliance/STORE_REVIEW_INSTRUCTIONS.txt` |
| Association files use the real identifiers (`<TeamID>.com.tailmance.app`, `com.tailmance.app`) | `scripts/generate-app-link-associations.mjs`, `docs/DOMAIN_DNS_EMAIL_RUNBOOK_2026-10-05.md` |
| Apple Team ID is supplied through the `APPLE_TEAM_ID` environment variable, never committed | runbook section 3 |
| Server-side Apple identifiers are prefilled from the Team ID | owner kit `gen-server-env.sh` (not part of the repo) |

## Adapted

| Item | Adaptation |
| --- | --- |
| Rate limiting / WAF for `api.tailmance.com` (Nginx) | There is no self-hosted API server. Requests go to Supabase Edge Functions, which already call the `rate_limit(action, limit, window)` RPC and Upstash. If a custom API domain is added later, put the WAF and rate-limit rules in Cloudflare in front of it, not Nginx. |
| Google Cloud client ID | The app reads a **Web** client ID from `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (`src/services/config.ts`, `src/services/nativeSocialAuth.ts`) and an iOS URL scheme from `GOOGLE_IOS_URL_SCHEME` (`com.googleusercontent.apps.<iOS client id prefix>`, `app.config.ts`). Which type the supplied ID is must be confirmed in Google Cloud Console before it is mapped to either variable. Client IDs are public identifiers, but they are set as EAS environment values, not committed. |
| App Store Connect "Developer ID" `8891c71a-...` | This is a UUID of the Issuer ID kind (App Store Connect API key, Users and Access > Integrations). It is used only with an API key held as an EAS secret. |
| Google Play developer account number | Needed only for Play Console links and the service-account invitation; not used in code. |

## Deliberately not adopted

| Item | Reason |
| --- | --- |
| Review credentials and a static "2FA bypass code" inside the repository | `release/store-review-access-v22.json` and `scripts/store-review-access-checks.mjs` forbid credentials in source control and any special security bypass. Credentials go only into the store consoles. Two-step verification is optional in the app, so a review account without it needs no code. |
| Firebase Analytics service | The privacy documents and store forms promise no behavioral analytics or advertising identifiers (`docs/PRIVACY_DATA_MAP.md`: adding them is a release-blocking privacy change). Adding any analytics SDK is a separate decision that must first update privacy policy, Apple privacy answers and Google Data Safety. |
| NestJS, Drift, Flutter and `flutter-reviewer` instructions | Not this stack. |
| `setup_adc.sh` fetched from a remote host | Executing a script downloaded from an unknown host is unsafe. Google Cloud Vision uses a restricted API key held as a Supabase secret (see `docs/HEALTH_AI_PROVIDER_REVIEW_2026-10-05.md`). |
| "Production seal", "registered trademark" wording, "app was not created by AI" statements | These are not facts the repository can establish. Store and legal text must not claim a trademark registration or origin that has not been verified. |
| AASA `appID` `<TeamID>.com.yektaozel.tailmance` | Wrong bundle id; would break universal links. |

## Still open (owner)

Confirm the Apple App ID (`com.tailmance.app`) is the one registered in the developer account; choose the domain; provision the review account and enter it in both consoles; capture real-device screenshots for `store/screenshots/ios` and `store/screenshots/android`; run `npm run release:diagnose` again after each external step.
