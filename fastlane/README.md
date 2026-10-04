# Tailmance Fastlane release automation

Tailmance uses EAS Build as the default native build/signing authority. Fastlane consumes already signed release artifacts so signing responsibility is not duplicated.

## iOS

- `fastlane ios testflight` uploads the EAS-produced IPA to TestFlight without external distribution.
- `fastlane ios app_store_candidate` uploads the IPA to App Store Connect but never auto-submits it for review or auto-releases it.
- `fastlane ios sync_signing` performs read-only `match` synchronization only when an existing private Match repository is explicitly configured. It does not create or revoke certificates/profiles.

Required environment values are `TAILMANCE_IOS_IPA_PATH`, `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, and base64-encoded `APP_STORE_CONNECT_KEY_CONTENT_BASE64`. Match additionally requires `MATCH_GIT_URL` and `MATCH_PASSWORD`.

## Android

- `fastlane android internal` uploads an EAS-produced AAB to the Internal track as a draft.
- `fastlane android production_candidate` requires an explicit `TAILMANCE_GOOGLE_PRODUCTION_ROLLOUT` between 0 and 1 and creates an in-progress staged rollout. It never assumes a 100% rollout.

Required environment values are `TAILMANCE_ANDROID_AAB_PATH` and base64-encoded `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64` containing `client_email` and `private_key`.

Store screenshots remain a separate release gate because they must be generated and visually approved from the actual release-candidate UI/device matrix. No synthetic screenshots are accepted as release evidence.
