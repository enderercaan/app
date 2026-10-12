# Tailmance v19 R8 — Full App Completeness Boundary — 2026-09-30

This document distinguishes genuine missing product/source work from deliberate security, privacy, welfare, and scope decisions. A deliberate non-goal must not be reported as if an unfinished implementation were silently forgotten.

## Encrypted offline mutation replay, not an offline social replica

Tailmance remains freshness-first for discovery, matches, safety state, moderation state, legal eligibility, subscription authority, location-derived discovery, entitlement decisions, health-verification decisions, and signed media. It never stores a persistent browseable replica of nearby users, conversations, moderation decisions, legal state, precise/approximate social-location results, entitlements, or signed media URLs.

For a narrow allowlist of server-idempotent social mutations, the native client now uses an encrypted SQLCipher queue whose encryption key is device-secure-storage bound. Replay is single-flight and is triggered on foreground return, network restoration, and OS background scheduling when available. The queue preserves server client-operation identifiers across response loss, uses revision ownership for desired-state toggles, performs in-place schema upgrades, applies bounded backoff without silently discarding live retry identities, and removes definitive-failure payloads instead of retaining a local error archive. Chat sends, comments, swipe/pass/undo, and feed like/save operations use this path only where the server contract is replay-safe. Payments, subscriptions, legal consent, account deletion, health verification, boosts and super-likes are intentionally excluded from offline replay. Identity/age assurance, account export, security controls, and other high-risk actions are excluded as well. This is an encrypted delivery queue, not a second source of social truth.

## Product analytics

Third-party behavioral/product analytics SDKs are deliberately not mandatory. Tailmance keeps privacy-minimized first-party reliability telemetry that excludes raw error messages/stacks and user identifiers from the client error table. Product analytics may be introduced only with an explicit event taxonomy, data-minimization review, jurisdiction/legal-basis review, retention policy, consent/notice decision, and provider/data-transfer review. No advertising identifier or cross-app tracking is introduced merely to fill an analytics checkbox.

## Mating, lineage and inbreeding claims

Tailmance does not sell animals, broker breeding, set stud fees, arrange mating, or claim that two animals are genetically safe to breed. Owner-arranged mating remains fail-closed behind country/legal/welfare controls. A breed/pedigree text field is not treated as verified kinship evidence. A true inbreeding-prevention claim requires trustworthy lineage/kinship evidence and an appropriate veterinary/welfare model; until then the product must not create a false "safe to breed" badge.

## Commercial breeding / puppy-mill graph detection

Tailmance is not a breeder, puppy-sale, adoption-sale, or pet-commerce marketplace. Commercial sale/breeder content is prohibited at product and moderation boundaries. A speculative "puppy-mill graph detector" is therefore not a release prerequisite and must not be represented as a protection that does not exist. Repeated prohibited commercial behavior can still be handled by moderation, reports, account action, and existing anti-abuse controls.

## Pet-photo liveness / synthetic-media claims

Pet verification currently uses camera-origin capture, privacy-normalized image upload, duplicate-byte fingerprint signals, server/manual review paths, and does not claim biometric pet identity, deepfake detection, or liveness proof. Adding a weak home-grown liveness classifier would increase false confidence. A future liveness/deepfake claim requires validated provider/model quality, adversarial evaluation, privacy review, and an appeal/manual-review path.

## Maps

Pet-friendly places now have a native in-app map. The map intentionally does not display the user's live location. External directions remain an explicit user action. Android production map rendering requires the normal restricted Google Maps API key build configuration.

## Age assurance

The legal policy engine supports both self-attestation and privacy-minimized verified-external age assurance. Where a jurisdiction policy requires verified external assurance, the app can start a provider session and only stores/receives threshold-result evidence and hashed provider references rather than raw identity documents or date of birth.

## Legacy technical identifiers

`tailmance://` is the canonical user-facing callback scheme. It is the only callback scheme. The bundle/application identifier is `tailmanceapp.wordpress.com`.
