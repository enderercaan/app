# Owner Launch Runbook — Yekta Özel

This is the human-only launch path. Source work must never wait on these steps.

1. **Apple Developer + Google Play Console identity** — verify the publisher/seller identity is Yekta Özel (or the exact legally chosen entity), complete developer verification, tax and banking. `VERIFY` current account-type requirements in the official consoles.
2. **Bundle/package identity** — the app identifier is `com.tailmance.app`. Create the App Store Connect and Play Console app records, Firebase apps and RevenueCat apps with exactly this ID. If a record already exists under legacy `com.pawlink.app`, stop and decide before submitting: changing IDs creates a separate app. Use `app.config.ts`, `eas.json`, `fastlane/Appfile` as source inputs.
3. **RevenueCat** — create/link iOS and Android products; entitlement must be `tailmance_premium`, package identifier `premium_access`. Use store-localized pricing; do not hard-code `$14.99` in purchase logic.
4. **Push** — configure APNs and Firebase/FCM credentials in the release secret manager, never the repository. Validate delivery and revocation on both platforms.
5. **AI/observability/maps/calls** — create production Google Cloud Vision (or approved alternative), Sentry, maps/geocoding and LiveKit accounts; restrict keys by app/server identity; record provider evidence in release evidence files.
6. **Domain/DNS/email** — configure production HTTPS domain, SPF/DKIM/DMARC, support inbox, privacy/terms/support/delete-account pages, AASA and `assetlinks.json` generated from real signing identity.
7. **Cloud provisioning** — apply the provided infrastructure/runbooks, secrets, database, private storage and CDN configuration. Verify backups, restore, KMS and least-privilege access.
8. **Store forms** — complete age rating, privacy labels/Data Safety, export/encryption, UGC and account-deletion forms from the repository data inventory and release checklists. Reconcile every answer with the shipped SDK set.
9. **Metadata/assets** — upload localized listings/screenshots/release notes through Fastlane where supported. Do not upload mock or fabricated screenshots.
10. **Beta** — TestFlight + Play closed testing, device-farm runs, crash-free and critical-journey gates, moderation/verification operational rehearsal.
11. **Professional sign-off** — licensed counsel review recommended before launch; native-speaker sign-off recommended before launch. Record dated evidence rather than editing a status flag manually.
12. **Go live** — staged rollout, alerting/on-call, support macros, moderation SLA monitoring, rollback/hotfix path, store-policy/legal review cadence.
