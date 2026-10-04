# Tailmance Store Release Checklist

- [ ] Generate `web/config.js` from the real production web endpoint + Turnstile site keys with `npm run web-config:generate`, then require `npm run release:web-config` to PASS on the exact deployed web artifact.
## Product and identity
- [ ] Final app name, icon, splash, screenshots and store copy approved.
- [ ] Bundle/package identifiers match production accounts.
- [ ] Support, privacy, terms, community-guidelines and web deletion URLs use the real production domain.
- [ ] No placeholder IDs, URLs, email addresses or test pets remain in production configuration.

## iOS / App Store
- [ ] Complete the current App Store Connect age-rating questionnaire using the 2026 scale `4+ / 9+ / 13+ / 16+ / 18+`, including the Social Media question. Keep Tailmance's own 18+ account policy separate from the questionnaire result; do not reuse legacy 12+/17+ assumptions.
- [ ] Record the actual App Store Connect age-rating result as external evidence; source code must leave it unknown until the console produces it.
- [ ] Re-check current App Review Guidelines at submission time. As verified 2026-09-25, UGC apps need objectionable-content filtering, in-app reporting, user blocking and published contact information.
- [ ] Apple Developer and App Store Connect app record created.
- [ ] Premium monthly subscription product created and mapped to RevenueCat entitlement `tailmance_premium` and custom package identifier `premium_access`.
- [ ] RevenueCat webhook Authorization, HMAC signing secret and REST API key configured only as server secrets.
- [ ] Purchase, restore, cancellation, renewal, grace period and expiration tested in sandbox.
- [ ] App Privacy answers match the Tailmance data map. For current source behavior, coordinates rounded to three decimals are declared as **Precise Location**; do not mark them coarse merely because Tailmance reduces precision.
- [ ] Dependency-resolved iOS build reviewed for Required Reason APIs; Privacy Manifest merged/validated with only verified Apple-approved reasons.
- [ ] In-app account deletion works and is discoverable from Settings; full account + associated UGC deletion behavior is verified against the current Apple account-deletion guidance.
- [ ] UGC reporting, blocking and moderation paths are demonstrable during review.
- [ ] Review notes explain pet-only identity, Premium behavior, moderation and any reviewer test account.

## Android / Google Play
- [ ] Complete the real Google Play/IARC content-rating questionnaire and retain the console result as evidence. Do not pre-assume Teen, PEGI 12 or PEGI 16.
- [ ] Confirm the generated Android manifest targets API 36 or later. Google Play requires Android 16 / API 36+ for new mobile apps and updates submitted from 2026-08-31. Expo SDK 57 source defaults to targetSdkVersion 36, but the generated native artifact must still be inspected.
- [ ] Play Console app and production signing configured.
- [ ] **Current 2026-09-30:** register the app/package in Google Play Console and retain real console evidence. Play package registration is now current, not a future-only watch item.
- [ ] **Current 2026-09-30 regional enforcement:** for Brazil, Indonesia, Singapore and Thailand, retain real Android developer-verification / package-registration evidence proving the developer identity and package are recognized for certified-device distribution. Do not infer this from source configuration alone.
- [ ] **Upcoming April 2027 watch:** re-check Google Play Technical Quality requirements for Zero-Tap Sign-In Restoration / Restore Credentials before any release crossing that enforcement window. Do not treat the April 2027 requirement as a current 2026-09-30 release blocker, and re-check the exact enforcement date in Google documentation before implementation/release.
- [ ] Premium monthly subscription created and mapped to RevenueCat.
- [ ] Purchase, restore, cancellation and expiration tested with license testers.
- [ ] Data Safety form matches the Tailmance data map. Current Android source requests `ACCESS_COARSE_LOCATION` and blocks `ACCESS_FINE_LOCATION`; location is therefore mapped to **Approximate location**, subject to final generated-manifest verification.
- [ ] In-app account deletion path works.
- [ ] Public web account-deletion request URL is live and entered in Play Console; it can start deletion without requiring the app to be installed or reopened.
- [ ] Web deletion requests are processed end-to-end by a production backend with identity verification independent of app reinstall; pending requests cannot sit indefinitely. Source HTML/Edge code alone is not release evidence.
- [ ] Target SDK and Play policy requirements verified at submission time, including Data Safety, account deletion and current UGC moderation requirements.

## Safety / UGC
- [ ] Apple/Google UGC review demo proves Terms/Guidelines acceptance before posting, objectionable-content filtering/moderation, clearly labeled report actions, clearly labeled block actions, and a staffed published support contact.
- [ ] Report pet, post, comment, message, story and event tested.
- [ ] Block/unblock tested.
- [ ] Unmatch immediately prevents new messages.
- [ ] Moderation queue and administrator procedure tested.
- [ ] Emergency/illegal-content escalation procedure assigned to real operators.
- [ ] Community Guidelines accessible before and after registration.
- [ ] Existing accounts with an old/missing legal version are blocked from UGC until the current Terms/Guidelines are accepted.
- [ ] 18+ policy has a counsel-approved enforcement model; if verified age is claimed, the provider contract must return a verified age/adult result rather than identity status alone.
- [ ] Country/region mating-feature matrix approved by counsel and technically enforced before global launch.

## Privacy / health / location
- [ ] Exact coordinates never appear in public API payloads.
- [ ] Health documents remain private and signed access expires.
- [ ] Verification fields cannot be self-awarded.
- [ ] Data export includes all account-linked categories.
- [ ] Hard account deletion removes Auth user, database records and owned storage objects.
- [ ] Retention schedule for operational/audit data approved by counsel and implemented.

## Reliability
- [ ] `npm run verify:offline` passes.
- [ ] Dependency installation completes, `npx expo install --check`/`npx expo-doctor` are clean, and a generated lockfile is committed before the final store build.
- [ ] `npm run typecheck` passes after `npm install`/`npm ci`.
- [ ] Staging migrations apply from zero and from prior release.
- [ ] Realtime reconnect/offline behavior tested.
- [ ] Push delivery and Expo receipt worker tested; invalid tokens are disabled.
- [ ] Notification category preferences suppress push at the server.
- [ ] Runtime maintenance mode and forced-update flow tested.
- [ ] Crash/error monitoring configured with sensitive-data scrubbing.
- [ ] App Store phased release / Google Play staged rollout plan is configured and a release-health owner is assigned.
- [ ] Rollback drill confirms a bad binary can be halted and a last-known-good/fixed build can be shipped while server/database changes remain backward compatible.
- [ ] `OPS_HEALTH_SECRET` is configured server-side; `ops-health` is polled from a trusted monitor and a synthetic stale/queue alert reaches the assigned operator.
- [ ] Production alert routing is tested for billing, moderation, deletion, push, worker and backend failures.
- [ ] EAS remote build-version state is initialized/synced to the existing App Store/Play build numbers before the first production build; production `autoIncrement` is verified.
- [ ] Backup and restore procedure tested for production database.

## Release decision
Release only when every blocking item is complete, `npm run release:country`, `npm run release:store-compliance`, `npm run release:external-legal`, and the external-security gate are green, and production secrets/accounts are controlled by the operating entity. Unknown/unlisted ISO markets remain blocked.

## 2026 security addendum
- [ ] `npm run release:country` passes for every distribution country; UI translation alone is never treated as legal approval.
- [ ] `npm run release:external-security` passes with dated evidence references rather than manually bypassed statuses.
- [ ] Apple App Attest capability and backend verification are exercised on supported physical iOS hardware; unsupported-device fallback is documented and does not bypass ordinary server authorization.
- [ ] Google Play Integrity Standard requests are exercised from a Play-distributed build and the backend verifies the verdict/request binding before high-risk operations.
- [ ] App Store Server Notifications are connected to RevenueCat for production and sandbox and a recent/test delivery is confirmed.
- [ ] Google Play RTDN/Pub/Sub is connected to RevenueCat and Play Console test notification / recent delivery is confirmed.
- [ ] RevenueCat webhook to Tailmance is tested with Authorization + HMAC, duplicate delivery, stale/replay delivery and current-entitlement reconciliation.
- [ ] Sentry native crash/ANR monitoring receives a controlled release crash with correct source-map/native-symbol resolution; privacy review confirms no user/message/health/location payloads or screenshots/view hierarchy are attached.
- [ ] `SENTRY_AUTH_TOKEN` exists only in protected build secrets; it is absent from mobile public configuration, repository and release evidence.
- [ ] Native auth anti-bot challenge is tested for accessibility, legitimate failure/retry, rate limits and automation resistance before CAPTCHA is enabled in production.
- [ ] Camera-selected/user images are verified on native builds to be uploaded as normalized bounded JPEGs without original EXIF/GPS metadata.

- [ ] External TLS scan on production Supabase/functions/public-web endpoints confirms valid chain/hostname, no cleartext/downgrade path, TLS 1.2 minimum, TLS 1.3 where supported, modern ciphers, and HSTS on Tailmance-controlled public web hosts where applicable.
- [ ] The dependency-resolved iOS archive is inspected for merged `PrivacyInfo.xcprivacy`, third-party SDK privacy manifests/signatures and Required Reason API declarations; declared reasons match actual use and App Privacy answers.
- [ ] Exact store-ready Android AAB and iOS archive pass binary-hardening inspection: production signing only, no debuggable/test flags or embedded secrets, Android R8/resource shrink actually applied with mapping retained privately, iOS shipped symbols stripped as appropriate with dSYM/source maps uploaded privately, least-privilege permissions/entitlements, and generated transport/privacy settings verified.

- [ ] RevenueCat production webhook proves Authorization + `X-RevenueCat-Webhook-Signature` HMAC validation, replay rejection, PRODUCTION environment binding, allowed app-id binding and duplicate-event idempotency.

## Premium storefront price and tax parity
- [ ] Verify the live monthly Premium product is configured with the intended USD 14.99 base price in App Store Connect and the corresponding Google Play base-price configuration; retain dated console evidence.
- [ ] Verify RevenueCat resolves the correct production product/entitlement and `product.priceString` matches the customer-visible localized storefront price in representative configured markets.
- [ ] Verify the native Apple/Google purchase sheet shows the final localized customer price, billing period, renewal terms, and applicable tax/VAT/KDV treatment for each tested storefront.
- [ ] Confirm the app performs **no client-side tax/VAT/KDV arithmetic** and never concatenates a hardcoded "$14.99 + tax" customer charge; the storefront-localized price is authoritative.
- [ ] Reconcile App Store Connect, Play Console, RevenueCat, and the in-app paywall before production release; unresolved price/tax parity remains fail-closed.
