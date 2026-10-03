# Tailmance

Tailmance is a pet-first social discovery and matching app for iOS and Android. Humans own and secure accounts, but the visible social identity is always a pet profile.

## Product scope

- Tailmance is pet-first, not a human dating product and not an animal-sales marketplace. The discovery proposition is a local digital dog park: help dogs find compatible nearby playmates and meet more safely in public places.
- Cats remain part of the pet-only social feed, profiles and health/social surfaces, but are excluded from discovery/matching.
- Dog discovery uses granular filters and approximate distance while exact coordinates stay private. New neighborhoods remain waitlisted until local density is useful and an operator explicitly opens them.
- Pet-to-pet likes, Super Likes, passes, favorites, mutual matches and unmatch/block/report controls are supported. Chat still requires an active mutual match.
- Standard accounts retain the free self-initiated message quota; when a Premium participant has already messaged, the matched Standard participant receives the server-authoritative courtesy-reply path so the Premium conversation is not stranded.
- Paw Feed, Local / For You / Following modes, follows, posts, comments, saves, stories, Premium-hosted events, weekly walks, Lost Paw alerts, pet-friendly places and public-place meetup planning create recurring utility after the initial match.
- Lost Paw alerts and safety utilities remain free. Meetup plans can be shared with a trusted person and nearby pet-friendly public places can be selected directly in the meetup composer.
- Vaccinations, health documents, microchip/veterinarian verification signals and visible pet/owner trust indicators are supported. Phone verification plus Apple/Google identity paths strengthen account trust without bypassing the 18+ legal gate.
- Tailmance Plus includes likes-you/unlimited product likes subject to anti-abuse limits, incognito, advanced filters, multiple pets, Travel Mode, Boost and server-ledger consumables. Store-localized price strings remain the purchase display source.
- Business monetization supports disclosed pet-friendly/veterinary/groomer/trainer/brand partnerships, monthly entitlement-controlled promoted visibility, appointment/referral links, event sponsorship/samples and external ticket referrals. Data sales, aggressive ads, insurance/e-commerce affiliate and sitter-marketplace features remain disabled/fail-closed unless intentionally launched later.
- Pet sales, puppy listings and commercial-breeding marketplace behavior are prohibited. Owner-arranged mating is not brokered or priced by Tailmance and remains dog-only plus jurisdiction/legal/welfare/kinship fail-closed.
- Human-dating intent disguised through a pet profile is prohibited and enforced in client preflight plus server/database moderation paths.
- Private account layer includes verified authentication, optional TOTP MFA/AAL2, password recovery, secure session storage, access export and hard deletion.
- App Store / Google Play subscription architecture uses RevenueCat while the stores remain the source of purchase truth; consumable credits are applied idempotently to the server ledger.

## Architecture

- Expo SDK 57 / React Native 0.86 / TypeScript
- Supabase Auth, Postgres, Storage, Realtime, Row Level Security and Edge Functions
- RevenueCat for cross-store entitlement synchronization
- Expo Notifications with ticket + receipt processing
- Private media buckets with short-lived signed URLs and single-use 15-minute upload intents
- Default-deny database access with security-sensitive mutations behind RPCs
- Native SQLCipher offline queue for replay-safe social mutations, with foreground/network/background drain and high-risk actions explicitly excluded
- Private PostGIS/GiST spatial indexing for proximity queries while exact coordinates stay server-private

See `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `release/security-control-applicability-v19.json`, `release/roadmap-implementation-v21.json`, `docs/PRIVACY_DATA_MAP.md` and `docs/OPERATIONS_RUNBOOK.md` for the current detailed model. Dated R8 verification documents are retained only as historical audit snapshots and are not current-truth artifacts.

## Local setup

1. Copy `.env.example` to `.env` and fill development values.
2. Install the committed registry-resolved dependencies with `npm ci --ignore-scripts`. The lockfile is now present. Production remains blocked while required live/device/store evidence and the high-severity dependency advisory are unresolved.
3. Start with `npm run start`.
4. For real in-app purchase tests use a development build, not Expo Go.
5. Apply Supabase migrations in numeric order and deploy the Edge Functions from `supabase/functions`.

Demo mode is intentionally opt-in. It works only outside production when `EXPO_PUBLIC_ENABLE_DEMO=true` and the backend is not configured. A production build does not silently fall back to demo data.

## Verification

- `npm run verify:offline`: syntax, domain rules, security regressions, accessibility checks and repository lint without installing native modules.
- `npm run verify:database`: applies the full migration chain to a real PostgreSQL server (PostGIS + pgvector + plpgsql_check required; `TAILMANCE_PG_HOST`/`TAILMANCE_PG_USER`), fails on any PL/pgSQL runtime type error and runs runtime smoke checks. Fail-closed when no server is reachable.
- `npm run typecheck`: full TypeScript typecheck after dependencies are installed.
- `npm run typecheck:evidence`: executes that check and records a source-bound log; `npm run test:typecheck-evidence` rejects stale source/log records.
- `TAILMANCE_PREBUILD_DIR=/path/to/generated/project npm run native:verify-prebuild`: validates actual generated native configuration, including microphone permission surviving plugin merging. This does not compile or launch the app.
- `npm run release:check`: fail-closed aggregate gate for production client/server configuration, country/legal approvals, external security evidence and release structure; it rejects placeholders and unverified required evidence.
- `npm run release:structure`: validates native assets, package identifiers, EAS production mode, legal/support pages and the migration chain.
- `npm run test:ux`: checks contrast, minimum coded text size, assets and key UX invariants.
- `npm run verify`: full typecheck plus automated tests.

A release should not be submitted until the real staging project passes the native-device and store-sandbox checks in `docs/STORE_RELEASE_CHECKLIST.md` and `docs/TEST_PLAN.md`.

## Web policy and deletion pages

The `web/` folder includes Terms, Privacy, KVKK notice, Community Guidelines, marketing-push consent, subscription/consumer information, moderation/appeals, support, and an external account-deletion request page. The source flow exists, but production business/operator/address/tax details, deployed support/contact evidence, and the real deletion endpoint + identity-verification flow remain fail-closed external release evidence. Configure `web/config.js` only with the verified production `request-account-deletion` endpoint.

## Production secrets

Never commit service-role, webhook, moderation-provider or worker secrets. Store server secrets only in the Supabase secrets manager and store EAS build secrets in the platform's secret store. Only explicitly public `EXPO_PUBLIC_*` values belong in the mobile bundle.
