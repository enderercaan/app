# Day-0 operations package: mapping to the real Tailmance stack (2026-10-12)

The "Day-0 operations and final store approval package" that was supplied assumes a Flutter / NestJS / Drift / Firebase stack and the bundle id `com.yektaozel.tailmance`. The owner has registered the Apple App ID `tailmanceapp.wordpress.com`, so that is the identifier used here. Tailmance is Expo SDK 57 / React Native 0.86 with Supabase (Postgres, RLS, Edge Functions), RevenueCat, Sentry and LiveKit, and its bundle id and Android package name are both `tailmanceapp.wordpress.com` (`app.config.ts`, changed from the earlier `com.tailmance.app` on 2026-10-12 at the owner's decision). This file records, item by item, what was applied, what was adapted and what was deliberately not adopted. Secrets and account numbers are not stored in this repository.

## Applied

| Item | Where |
| --- | --- |
| Reviewer notes for App Store Connect / Google Play, matching what the app really does (report, block, in-app deletion, export, restore purchases, Lost Paw alerts, AI-assisted booklet check with "AI can make mistakes, please check.", mating non-involvement) | `docs/compliance/STORE_REVIEW_INSTRUCTIONS.txt` |
| Association files use the real identifiers (`<TeamID>.tailmanceapp.wordpress.com`, `tailmanceapp.wordpress.com`) | `scripts/generate-app-link-associations.mjs`, `docs/DOMAIN_DNS_EMAIL_RUNBOOK_2026-10-05.md` |
| Apple Team ID is supplied through the `APPLE_TEAM_ID` environment variable, never committed | runbook section 3 |
| Server-side Apple identifiers are prefilled from the Team ID | owner kit `gen-server-env.sh` (not part of the repo) |

## Adapted

| Item | Adaptation |
| --- | --- |
| Rate limiting / WAF for `api.tailmance.com` (Nginx) | There is no self-hosted API server. Requests go to Supabase Edge Functions, which already call the `rate_limit(action, limit, window)` RPC and Upstash. If a custom API domain is added later, put the WAF and rate-limit rules in Cloudflare in front of it, not Nginx. |
| Google Cloud client ID | Owner confirmed the supplied ID is the **iOS** type. It maps to `GOOGLE_IOS_URL_SCHEME=com.googleusercontent.apps.<id before ".apps.googleusercontent.com">` (`app.config.ts`). The app additionally reads a separate **Web** client ID from `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (`src/services/config.ts`, `src/services/nativeSocialAuth.ts`), which must be created in Google Cloud and is not yet supplied. Client IDs are public identifiers, but they are set as EAS environment values, not committed. |
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
| AASA `appID` `<TeamID>.com.yektaozel.tailmance` | Wrong bundle id; would break universal links. The generator writes `<TeamID>.tailmanceapp.wordpress.com`. |

## Still open (owner)

The Apple App ID `tailmanceapp.wordpress.com` is already registered by the owner. Confirm it has Sign in with Apple, Push Notifications, Associated Domains and App Attest enabled (`app.config.ts` uses all four; in-app purchase is on by default). The identifier cannot be changed after the app is created in App Store Connect, so create the App Store Connect record, the RevenueCat apps and the Google iOS OAuth client with exactly this ID. The Android package uses the same string; it becomes permanent at the first Play upload, so change it in `app.config.ts`, `fastlane/Appfile`, `fastlane/Fastfile`, `scripts/generate-app-link-associations.mjs` and the release checks before then if a different package name is wanted. Note that the bundle id is only an identifier and is unrelated to where the website is hosted. Create the Google **Web** client ID. Choose the domain; provision the review account and enter it in both consoles; capture real-device screenshots for `store/screenshots/ios` and `store/screenshots/android`; run `npm run release:diagnose` again after each external step.

Decided by the owner on 2026-10-12: no analytics SDK is added.
