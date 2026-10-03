# Tailmance Architecture

## Client
Expo SDK 57 / React Native 0.86 application with React Navigation. The client renders pet identity, discovery, social feed, matches, chat, events, health records, Premium and account controls. SecureStore persists authentication material; private media is rendered through signed URLs and cached with `expo-image`.

## Backend
Supabase provides Auth, PostgreSQL, Realtime, Storage and Edge Functions. Public discovery data is separated from private human/account, exact-location and health-document data. Server RPCs own high-risk business rules.

## Offline-first replay boundary
Native iOS/Android builds use a narrowly scoped SQLCipher SQLite queue for replay-safe social mutations: chat messages, comments, pet likes/passes/undo, feed likes and saves. The queue is bound to the currently authenticated account, encrypted with a device-generated key stored through SecureStore/Keychain/Keystore, uses revision-guarded desired-state replacement and exponential retry, and is drained on foreground return, network restoration and OS-scheduled background work. Payments, subscriptions, legal consent, health verification, account deletion, boosts and Super Likes are intentionally never replayed from the offline queue. The server remains authoritative and every queued non-desired-state mutation uses an idempotent RPC contract.

## Payments
StoreKit/App Store on iOS and Google Play Billing on Android are mediated through RevenueCat for cross-platform entitlement synchronization. The server treats verified store entitlement as authoritative.

## Moderation
Uploads and text enter moderation/abuse controls. Reports create reviewable cases; blocks and unmatches immediately restrict interaction. Verification is a trusted operation, never a client-editable profile field.

## Notifications
The database stores in-app notifications. Push dispatch reads server-side category preferences, sends Expo push messages, stores tickets and checks receipts. Invalid device tokens are disabled. Health-reminder generation is deduplicated.

## Account deletion
In-app authenticated deletion hard-deletes the Auth user after durable cleanup preparation. The public web deletion path includes request intake, token-bound processing, independent identity-verification input, account re-check/binding, the same hard-delete engine, and durable external/storage cleanup recovery. Production identity-verification provider operation, endpoint reachability and provider-side erasure remain external release evidence and are never inferred from source code alone.

## Private spatial discovery and Pati Radar
Exact pet coordinates stay in private tables and are never part of public pet JSON. PostgreSQL/PostGIS stores WGS-84 `geography(Point,4326)` values for private pet locations, lost-pet alerts and pet-friendly places, with GiST indexes and `ST_DWithin` for indexed radius filtering. Client-visible discovery distance remains rounded/approximate; exact coordinates are not returned to another account. The location split and server RPC authorization remain the privacy boundary.

## Pet-first marketplace boundary
The public social persona is the pet. Public `Pet` models and `pet_json` do not expose an owner identity/profile object; owner identity verification may appear only as a trust signal. Tailmance is not a pet-sale, adoption/rehoming or breeder marketplace. High-signal sale/commercial-breeding and adoption/rehoming intent is blocked in client preflight and again by server-authoritative database triggers across messages, posts, comments, events, meetups, pet bios and pet prompts. Moderation-provider requests also carry the explicit Tailmance pet-first prohibited-category policy. Mating remains a separate, owner-arranged social connection feature and is fail-closed behind jurisdiction, welfare and health controls; Tailmance does not set prices, broker agreements or process mating payments.

## Verified deep links
Pet-profile sharing supports the existing custom schemes plus production Universal Links/App Links. Incoming links are strictly parsed and cannot bypass bootstrap, pet setup or legal acceptance. Before a shared pet profile is opened, the backend re-checks current visibility, moderation, block/incognito and relationship rules. iOS AASA and Android `assetlinks.json` are generated only from real production domain, Apple Team ID and Android signing-certificate SHA-256 values. Missing deployment identity keeps the release gate blocked instead of generating placeholder association artifacts.

## CI security gate
The repository runs a fail-closed Trivy filesystem scan for HIGH/CRITICAL vulnerabilities, secrets and misconfiguration with read-only checkout permissions. Dependency-resolved build verification remains separately blocked until a genuine package lock and installable dependency graph are available.

## Redis social-read acceleration
Tailmance uses a serverless Redis cache only as a non-authoritative acceleration layer for high-throughput social reads. Feed and Reels cache compact page ordering metadata; the default discovery deck caches only candidate identifiers. Cache keys are SHA-256 derived from user/pet/query context. Every cache hit is rehydrated from current PostgreSQL state before response, so block state, moderation, follow-mode eligibility, engagement counters, saves/likes, profile visibility, and fuzzy distance remain database-authoritative. Filtered or travel-mode discovery bypasses the discovery cache. Redis outages fail open to the same authenticated PostgreSQL RPCs; malformed production Redis configuration is blocked by release checks.
