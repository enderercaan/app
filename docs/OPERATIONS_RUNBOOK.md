# Tailmance Operations Runbook

## Daily
- Review moderation queue, safety reports and rejected/uncertain automated decisions.
- Check push failure rates, webhook failures and subscription-sync errors.
- Review account-deletion requests and verify requester identity before external-request processing.

## Weekly
- Review abuse/rate-limit anomalies and blocked content patterns.
- Check database/storage growth, backup status and restore-point health.
- Review upcoming vaccination-reminder worker execution and duplicate rates.

## Safety escalation
Prioritize credible threats, animal harm, illegal content, harassment, doxxing and repeated evasion of blocks. Preserve evidence with restricted access; suspend features/accounts when necessary. Escalation decisions should be documented in audit metadata.

## Web deletion requests
The public form records a request without disclosing whether an email has an account. Operations must verify account ownership through an approved support process before destructive action. Completed requests should be marked resolved and retained only as long as legally/operationally necessary.

## Subscription incidents
Do not manually grant Premium from the mobile client. Verify store/RevenueCat state, replay or reconcile webhook events, and keep entitlement corrections auditable.

## Private storage garbage collection

Run `storage-gc` from a trusted scheduler with `Authorization: Bearer $STORAGE_GC_SECRET`. Database triggers queue an old object after its application record is deleted or its storage path is replaced. The worker waits at least one hour, re-checks that no live database record references the object, then removes it from the private bucket. Failures use bounded exponential backoff. Alert if the queue grows continuously or rows approach 8 attempts.

## RevenueCat entitlement reconciliation

Set the RevenueCat server configuration: a high-entropy `REVENUECAT_WEBHOOK_AUTH`, `REVENUECAT_WEBHOOK_SIGNING_SECRET`, `REVENUECAT_REST_API_KEY`, exact `REVENUECAT_WEBHOOK_ENVIRONMENT` (`PRODUCTION` in production), and `REVENUECAT_ALLOWED_APP_IDS_JSON`. Configure RevenueCat to send the dashboard Authorization header and enable webhook HMAC signing. Verify `X-RevenueCat-Webhook-Signature` against the exact raw request body and timestamp before parsing JSON, enforce the replay window, then apply environment/app allowlists. A verified webhook is only a trigger. The handler re-reads current Customer Info from RevenueCat before changing `users.tier`, so cancellation/grace periods, refunds, restores, and transfers do not rely on a single event's semantics. `billing_webhook_events` is the private idempotency/retry ledger. Alert on rows that remain `failed`.

## Production observability and privacy-safe logging

- Production client/server logs must not contain message bodies, profile bios, health details, precise/coarsened coordinates, email addresses, push tokens, storage signed URLs, RevenueCat secrets/events, verification-provider payloads, or raw authentication tokens.
- Prefer stable error/event codes over raw provider/database error text. Correlation identifiers must be short-lived and access-controlled; do not expose them to end users unless they are explicitly designed as support references.
- A production crash/error monitoring provider is still a release prerequisite. Configure it only after the launch data map, processor/DPA review, retention window and data-scrubbing rules are approved. Native crashes, unhandled JS errors and release health must be visible before store rollout.
- Alerts must cover at minimum: elevated crash/error rate, authentication failures, database/storage saturation, failed billing reconciliation, stuck deletion queues, stuck moderation queues, push dispatch/receipt failure, worker scheduler failure and backup/restore health.

### Source-controlled worker health endpoint

The scheduled workers write metadata-only start/completion heartbeats to the private `worker_heartbeats` table. The `ops-health` Edge Function exposes only aggregate queue counts and worker timestamps through the service-role-only `get_ops_health_snapshot()` RPC. Invoke it only from a trusted monitor with `Authorization: Bearer $OPS_HEALTH_SECRET`; never expose this secret to the mobile bundle.

Expected maximum completion ages encoded in the health snapshot are: push dispatch 5 minutes, push receipts 15 minutes, moderation 5 minutes, health AI 5 minutes, LiveKit room reaper 5 minutes, Storage GC 30 minutes, external deletion 30 minutes and vaccination reminders 26 hours. The database heartbeat allowlist is regression-bound to these eight scheduled workers so a new worker cannot silently fail its heartbeat because of an older CHECK constraint. A production monitor should alert when any worker is stale, or when terminal/stuck queue counters such as failed push, exhausted Storage GC, exhausted external deletion, manual moderation review, overdue health-AI manual review, stale health-AI processing leases, stuck LiveKit room teardown, failed billing events or stuck billing processing are non-zero beyond the operating team's approved threshold.

The endpoint proves only that source-controlled liveness/queue signals exist. A real paging destination, on-call ownership, scheduler configuration and test alert remain external production release gates.

## Release rollout and rollback

1. Build only after a genuine dependency lockfile has been resolved, reviewed and committed, and use a tagged source revision. Tailmance uses EAS remote developer-facing version numbers (`cli.appVersionSource=remote`) with production `autoIncrement=true`; sync the existing store build numbers to EAS before the first production build. Record the user-facing app version, resulting native build numbers, migration revision, Edge Function revision and RevenueCat/store product configuration used for the release.
2. Apply backward-compatible database changes to staging first, then run migration-from-zero and upgrade-from-previous-release tests. Do not couple a mobile release to a destructive schema change that older supported clients cannot tolerate.
3. Complete the native/device/store-sandbox checklist before production rollout. Keep runtime maintenance and minimum-version controls verified but do not use them as a substitute for store rollback capability.
4. Use App Store phased release / Google Play staged rollout rather than immediately exposing a new binary to the entire audience. Apple’s phased update schedule expands over seven days (1%, 2%, 5%, 10%, 20%, 50%, 100%) for eligible automatic updates and can be paused; manual App Store downloads remain possible. Google Play update releases should start at an approved staged percentage and expand only after release-health review.
5. Pause/halt rollout if release-health, billing, moderation, deletion, authentication or backend error signals regress. If containment is required, use maintenance/feature controls and stop further rollout while a fixed build is prepared.
6. Platform rollback semantics differ. Apple does not provide a direct App Store revert to a prior binary, so pause the phased release and submit a corrected build. Google Play can halt staged rollouts and, when eligible, can halt a fully rolled-out release so a previous compliant version is served again. The first release on a Play track has no previous version to fall back to. Database and server changes must therefore remain backward compatible across the supported client window on both platforms.
7. Tailmance does not currently source-control an EAS Update / OTA rollback runtime, so do not claim OTA binary rollback. Any future OTA capability must use a compatible runtime-version policy and its own staged rollout/rollback tests before production use.
8. After any emergency forced update, verify the **platform-specific** minimum-version values, store destination URLs and review/store availability before blocking older clients. Do not raise the minimum version for one platform merely because the other platform’s fixed build is approved.

The repository does not prove that store phased-release controls, production alert routing, crash monitoring or a real rollback drill are configured. Those remain external release gates.

## Backup and restore drill

- Verify automated production backups/PITR are enabled under the operating entity's Supabase plan and access is least-privilege.
- On a schedule, restore a recent backup into an isolated environment and verify Auth-linked application rows, private Storage references, subscription state, moderation queues and deletion queues can be reconciled without exposing production data to unauthorized staff.
- Record restore-point timestamp, restore duration, integrity checks and discrepancies. A backup that has never been restored is not considered a verified recovery control.
