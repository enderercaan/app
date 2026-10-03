# Tailmance Test Plan

## Core flows
- Register, verify email, recover password, sign in/out, global sign-out.
- Verify auth callback allowlisting and PKCE: valid Tailmance code callbacks succeed; unrelated schemes/routes and raw access/refresh-token callback payloads do not create a session.
- Create/edit multiple pets and switch active pet.
- Upload exactly three profile photos; moderation replacement resets approval.
- Discover with every filter combination and empty-state behavior.
- Like, Super Like, pass, favorite, undo, mutual match and unmatch.
- Standard 50 swipes/day and 3 newly initiated conversations/day, Premium unlimited product quota, local-midnight reset, Premium-first permanent unlock, block during conversation.
- Feed post/comment/like/save/follow/story/event flows and reporting.
- Meetup propose/accept/decline/cancel/share/private feedback.
- Vaccination create/edit/delete, document upload, reminder generation.
- Notification read state and category push preferences.
- Purchase/restore/renew/cancel/expire Premium.
- Export data and hard delete account.

## Multi-account authorization
Run all sensitive tests with User A and User B. Attempt to read/write the other user's exact location, private health documents, conversations, push tokens, reports and account records. Every unauthorized request must fail.

## Failure modes
Test offline startup, expired auth token, signed-URL expiry, upload interruption, duplicate webhook delivery, duplicate push worker invocation, database timeout, realtime disconnect/reconnect and forced-update/maintenance mode.


## Worker observability / release health
- Invoke each scheduled worker with valid server authentication in staging and verify `worker_heartbeats.last_started_at` and `last_completed_at` advance without storing payload/PII.
- Invoke `ops-health` from the trusted monitor and verify only aggregate queue counts and heartbeat timestamps are returned.
- Simulate a stale heartbeat and a terminal queue row in staging; verify the configured external alert channel pages the assigned operator, then clear the synthetic condition.
- Verify production EAS build numbering uses the remote source of truth and increments developer-facing build numbers without changing the user-facing semantic version unexpectedly.

## Android debug memory-leak gate

Generated Android debug builds include LeakCanary 2.14 through `plugins/withLeakCanary.cjs` using **debugImplementation only**. Before a release candidate, exercise repeated navigation and lifecycle loops for Discover, Matches, Chat, Feed, image upload, pet switching, login/logout, MFA setup/challenge and background/resume. Investigate retained Activity/Fragment/View/Service reports and rerun until no reproducible app-owned leak remains. Confirm the release dependency graph contains no LeakCanary artifact.
