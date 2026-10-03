# Tailmance Store Review Access Runbook

Tailmance store review access uses the same production authentication, authorization, legal, moderation, blocking, privacy, and subscription entitlement code paths as ordinary accounts. There is no reviewer-only authentication bypass, hardcoded password, forced Premium flag, or purchase-success override in the mobile binary.

## Reviewer account preparation

Provision a dedicated review account out of band through the normal backend/admin operating procedure. The account must be 18+ eligible for the selected review jurisdiction, have a complete pet-first profile, and contain only synthetic/non-personal review fixtures. Prepare at least one approved pet profile, approved feed media, an approved Story/Reel, a matched-pet conversation fixture, and health-verification examples sufficient for the reviewer to reach gated screens. Do not use a real customer account or real veterinary document.

Store the current reviewer username and password only in the App Store Connect App Review Information field and the corresponding Google Play App access instructions. Do not commit credentials to this repository, EAS public environment variables, app constants, screenshots, or release notes.

## Purchases

Apple review must exercise StoreKit sandbox behavior and Google review must use Play license-test/test-purchase behavior. Tailmance must continue to resolve Premium from the ordinary RevenueCat/store entitlement pipeline. Never set Premium because an email, build channel, device, IP address, or review flag matches a reviewer.

## Before every submission

1. Sign in to the review account through a store-ready build and verify MFA/age/legal requirements expected for that account.
2. Confirm the seeded pet-first fixtures are still available and all media is moderation-approved.
3. Exercise purchase, restore, renewal/grace/cancel/refund test paths supported by the store sandbox and confirm server entitlements converge idempotently.
4. Verify account deletion/export remain functional for the review account.
5. Put only the current access instructions and credentials into the relevant store console. Do not place secrets in source control.
6. Mark `release/store-review-access-v22.json` evidence statuses verified only after the corresponding real account/console/test evidence has been captured by the release operator.
