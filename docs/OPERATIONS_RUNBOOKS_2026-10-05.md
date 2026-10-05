# Operations runbooks (2026-10-05)

Operator: Yekta Özel (sole proprietor). These runbooks describe how the operator runs the live service. They are plans, not evidence: the matching items in `release/external-legal-evidence.json` and `release/store-compliance-v19.json` stay `not_verified` until the dated live records named under each runbook exist.

## 1. Daily moderation and human review (SLA)
- Owner: operator. Window: every day, reviewing the queue at least once in the morning and once in the evening (Europe/Istanbul).
- Queues: media moderation (`moderate-media`), reports (`reports-admin`), appeals (`moderation-appeals-admin`), health-record checks that were not approved automatically (`health-ai-worker` manual route).
- Targets: child-safety and illegal-content reports first and as soon as seen; other reports within 24 hours; appeals within 7 days; health-record manual reviews within 24 hours.
- Cover: if the operator is unavailable for more than 24 hours, set the queue banner in the admin function and keep automated restrictions in place; note the gap in the log.
- Evidence to keep (outside this repository): a weekly export of queue age percentiles from `/ops-health`, with the date.

## 2. DSA statements of reasons, complaints and out-of-court dispute settlement (EU)
- Every restriction of content or an account records a statement of reasons (facts, legal or terms ground, whether automated means were used, redress options) before or when the user is told. The in-app notice and the moderation-appeals page carry the same text.
- Internal complaints: free, electronic, handled by a person, answered with reasons; the decision is never made by automated means alone.
- Out-of-court bodies: list the certified body that applies in the user's country on the appeals page once the operator has chosen it; until then the page states the user's statutory rights.
- Evidence to keep: the monthly count of statements of reasons and complaints with outcomes; transparency report if and when the service is above the reporting thresholds.

## 3. Personal data breach response
1. Contain: rotate the affected secrets (Supabase service role, worker secrets, provider keys) and disable the affected function.
2. Assess within 24 hours: data categories, number of people, risk to them.
3. Notify the supervisory authority within the legal deadline (72 hours under GDPR; the Turkish Personal Data Protection Board under KVKK without delay and within 72 hours; apply the shorter local deadline in other markets). Notify affected users without undue delay when risk is high.
4. Record: what happened, effects, measures, in a private incident log.
- Contacts to fill in privately: the competent authority for each launched market.

## 4. Child safety and emergency reporting
- Tailmance is for adults. Any report of a minor, sexual exploitation or imminent danger is handled first.
- Steps: remove the content from view, preserve the evidence privately, restrict the account, and report to the competent hotline or authority of the user's country (for example NCMEC CyberTipline for US-connected material, the national hotline or police elsewhere). Do not forward the material itself except through the authorized reporting channel.
- Contact point published on the support page: yektaozel@icloud.com.

## 5. Copyright notices (notice and counter-notice)
- Receive notices through the intellectual-property page, check that they identify the work, the content and the sender, remove or disable access quickly, tell the uploader, accept a counter-notice, and restore after the statutory waiting period unless the claimant shows court action.
- Repeat infringers: terminate the account after repeated valid notices.
- US DMCA agent registration is only needed to rely on the US safe harbor; register at the US Copyright Office before relying on it.

## 6. Sanctions and distribution check
- Do not offer the service in embargoed destinations; keep unconfigured countries disabled (the registry already does this). Review the store distribution country list before each release and after each sanctions update.

## 7. Subscription cancellation and refunds
- Cancellation and refunds are handled by the App Store or Google Play. The app and the subscription page say so, and point to the store's own management page.
- Support asks the user to use the store request flow; the operator answers support requests within 3 business days. Consumer statutory rights (including withdrawal rights where they apply) are preserved by the subscription page text.

## 8. Accessibility
- Before each release: run the screen-reader pass on both platforms (VoiceOver and TalkBack) over onboarding, discovery, chat, health and paywall, plus text scaling to the largest size and reduced motion. Record date, device, findings.
- Accessibility requests arrive through the accessibility page and are answered within 7 days.

## 9. Records and legal requests
- Keep legal acceptance records and moderation decisions as the product already stores them; answer lawful authority requests only through the verified channel, recording requester, legal basis, scope and what was provided. Refuse over-broad requests and tell the user where the law allows.

## 10. Health-record check operations
- The AI-assisted check reads all uploaded pages together and compares them with the schedule for the pet's species, age and the owner-entered breed. It marks a record "checked and approved" only when complete and current; everything else goes to a person within 24 hours.
- Weekly sample: review 20 approved records and 20 non-approved records by hand; log false approvals and false rejections. Any false approval pauses automatic approval until the cause is fixed.
