# Tailmance Security & Privacy Incident Response

Review date: **2026-09-30**

This runbook is operational security documentation, not a legal opinion. Country source-screening is not country approval. When an incident occurs, Tailmance uses the shortest *confirmed applicable* clock while legal/applicability review runs in parallel.

## Ownership and first hour

- Operational incident owner: **Yekta Özel**.
- Start containment, evidence preservation, impact triage and account/data scoping immediately.
- Escalate privacy/legal analysis within **60 minutes of incident classification**.
- Do not wait for complete forensics before determining whether a legal reporting clock may already have started.
- Put relevant evidence on hold before destructive cleanup where doing so is safe.
- Never use a universal 72-hour assumption. Legal clocks differ by market, sector, subnational law and the event that starts the clock.

## Evidence and decision integrity

Migrations 097–101 provide service-only integrity and incident records. `security_incidents` stores severity, containment/resolution state, affected data categories, evidence-hold state and operational notes. `security_incident_jurisdictions` stores per-country/subnational applicability and notification decisions. RLS denies normal authenticated users access. A cleanup RPC can purge expired integrity challenges/assessments, but refuses to proceed while an unresolved incident has an evidence hold.

Each regulator or data-subject notification decision must preserve:

1. incident discovery/detection/awareness/determination timestamps;
2. affected systems, accounts, data types and approximate population;
3. containment and remediation actions;
4. controller/processor/network-operator/sector role analysis;
5. countries and subnational/special jurisdictions potentially implicated;
6. applicable notification trigger and legal-clock start event;
7. regulator/authority route and data-subject route;
8. notification or non-notification decision and evidence supporting it;
9. actual filings/notices, timestamps and versions;
10. post-incident actions and regression controls.

## 27 configured launch markets

`release/security-incident-obligations-v19.json` is generated from the canonical official-source review and must cover all 27 configured markets exactly once. `npm run test:security-country` rejects drift, noncanonical source URLs, missing routes/deadlines/recordkeeping, loss of fail-closed counsel requirements, and regression of selected high-confidence timing rules.

The matrix intentionally distinguishes privacy-breach duties from cybersecurity/sector reporting. Examples include:

- **Türkiye:** KVKK Board Decision 2019/10 interprets the Authority-notification requirement as no later than 72 hours after learning of the qualifying breach.
- **Australia:** suspected eligible breaches require a reasonable, expeditious assessment with all reasonable steps to complete it within 30 calendar days; confirmed eligible breaches are notified as soon as practicable.
- **Canada:** the federal PIPEDA layer requires breach records for 24 months from determination, but provincial overlays remain separate.
- **Brazil:** qualifying incidents use the current ANPD regime and incident records are retained for at least five years.
- **China:** PIPL personal-information duties coexist with the 2025 cybersecurity-incident reporting regime; the four-hour route is conditional, not universal.
- **India:** CERT-In enumerated cyber incidents have a six-hour reporting clock for in-scope entities.
- **Japan:** qualifying leakage reporting uses a prompt preliminary report, generally about 3–5 days, followed by the applicable final report period.
- **South Korea:** current 2026 PIPA Enforcement Decree rules use 72-hour clocks for specified breach notice/report scenarios.
- **Saudi Arabia:** qualifying PDPL incidents are reported to the competent authority within 72 hours of awareness.
- **Singapore:** once a breach is determined notifiable, the PDPC must be notified as soon as practicable and no later than three calendar days.
- **Taiwan:** the one-hour cybersecurity incident rule is conditional on designation/scope as a specific non-government agency; it is not treated as a universal personal-data deadline.
- **United States:** regulator/data-subject timing is state/territory/sector specific; no fictional nationwide Tailmance deadline is used.
- **Vietnam:** current 2026 screening uses Law 91/2025/QH15 and Decree 356/2025/ND-CP, not superseded Decree 13/2023; special location/biometric breach rules include 72-hour affected-person timing and five-year incident-record retention after remediation.

Every row keeps `counsel_confirmation_required=true` and a blocking release effect until the approved applicability matrix exists.

## Exercises and release evidence

Source code and a desk matrix do not prove operational readiness. Production release remains blocked until `security_incident_response_tabletop_27_markets` in `release/external-security-evidence.json` contains dated evidence of a tabletop exercise covering all 27 configured markets, subnational escalation, designated legal/privacy escalation contacts, immutable records, phased notices, and awareness/detection/determination clock handling.
