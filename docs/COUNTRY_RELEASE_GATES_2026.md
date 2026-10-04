# Tailmance Country Release Gates — 2026-09-28 / v19

## Fail-closed distribution invariant

`release/country-release-gates.json` is the source-controlled market registry. Tailmance must not infer release eligibility from a locale, store-console country checkbox, successful build, IP geolocation, or translated store listing.

**Invariant:** any valid ISO-3166 alpha-2 country that is absent from the configured registry is `BLOCK`. The v19 registry contains exactly 27 named market profiles. There is no implicit “rest of world” allow-list.

A configured market can move to `approved_for_release` only when all of the following are true:

1. `legal_review_required` is explicitly present and the legal review has a dated status;
2. the configured-market source layer has current internal official-source legal approval and internal legal-language QA; external counsel is not a prerequisite for that source decision and no certification claim is made;
3. source review dates/validity windows and one or more attributable `evidence_reference` entries are present, while live operator/store/provider facts remain separate production evidence;
4. each of the 22 canonical controls is independently approved or documented not-applicable **with evidence**; each runtime control review must carry attributable `reviewed_at`, `applicability_checked_at` and `valid_until` evidence and expires fail-closed within a maximum 90-day review window: `privacy`, `consumer`, `age`, `ugc_moderation`, `subscription_iap`, `international_transfer`, `data_localization`, `representative_requirement`, `store_platform_obligations`, `animal_welfare`, `breeding_mating`, `pet_commerce`, `subnational_requirements`, `applicability_effective_dates`, `electronic_marketing_push`, `legal_document_language`, `digital_accessibility`, `operator_identity_tax_invoicing`, `ip_notice_takedown`, `cybersecurity_breach_notification`, `regulatory_recordkeeping`, `sanctions_payments_distribution`;
5. every required product/legal locale is release-ready, not merely declared in the app;
6. jurisdiction-specific `special_gates` are resolved against the actual production provider/data-flow topology;
7. store availability exactly matches the approved `TAILMANCE_TARGET_COUNTRIES` set;
8. store-specific external gates are separately evidenced, including Google Play target audience/minor-access and account-deletion Data Safety declarations, and Apple subscription purchase-option configuration where applicable.

`npm run release:country` enforces source legal/language eligibility for the explicitly declared target-country set and rejects unlisted ISO codes. The current source internally approves the 27 configured markets for the source legal/language layer only. That approval does **not** self-certify live store availability, operator identity/tax registrations, hosted/provider configuration, production age assurance, incident operations, or other genuine external evidence; those remain independently fail-closed.

## Configured v19 markets

AE, AT, AU, BE, BR, CA, CN, DE, ES, FR, GB, ID, IE, IN, IT, JP, KR, NL, PL, RU, SA, SG, TH, TR, TW, US, VN.

Every other ISO country defaults to BLOCK until it receives a full profile and evidence.

## High-priority jurisdiction gates

- **Türkiye:** KVKK notice and explicit consent remain separate. Cross-border transfers require an applicable Article 9 mechanism and provider/subprocessor review. If a standard contract route is used, the applicable notification step/time must be independently verified. VERBİS status is entity/threshold dependent, never assumed. 5651 retention is assessed by service role and log category, not with a blanket “every IP log is two years” rule. Marketing is currently mobile push only; adding e-mail/SMS/calls opens a separate consent/İYS release gate.
- **EU/EEA:** GDPR, Chapter V transfers, processor contracts, rights handling, breach/DPIA scope and DSA service classification are separate checks. UGC notice-and-action, statement-of-reasons, internal complaint/appeal and Article 20 applicability are not treated as automatically satisfied by GDPR compliance.
- **United Kingdom:** UK GDPR and international transfers are separate from Online Safety Act scoping. Tailmance’s 18+ policy does not by itself prove a children’s-access assessment or effective age assurance.
- **Australia:** privacy/overseas disclosure duties and the under-16 social-media-account regime require a scope analysis and evidence of reasonable age-assurance steps. An “18+” label alone is not a release waiver.
- **United States / California:** federal/state privacy and consumer-subscription scope is reviewed from actual data flows. CCPA/CPRA sale/share/targeted-advertising answers must not be inferred. Tailmance must not claim sale/share merely to satisfy a checklist, and must not add an ad-targeting SDK for compliance theatre.
- **India:** DPDP Act / DPDP Rules obligations are tied to their actual commencement dates. The 2025 Rules use phased commencement, so future provisions must not be represented as already mandatory before their effective date.
- **South Korea:** PIPA/current cross-border and privacy duties are separate from Google Play’s Korea-specific subscription conversion/price-change flows and notification evidence.
- **Japan, Brazil, Canada, Vietnam, Indonesia, China, Taiwan, Singapore, Thailand, Saudi Arabia and UAE:** each retains market-specific privacy, transfer, consumer, age/children, UGC and localization/representative gates. The registry’s special gates must be reviewed against the launch architecture rather than copied as generic boilerplate.

## Language is not legal approval

The repository now has source-complete runtime catalogs for all 19 configured UI locales, with 1,568 keys per locale, exact key/placeholder parity, fixed critical-language coverage, localized push copy and native locale metadata. Public legal source packs cover 22 document locales (the 19 runtime locales plus Catalan, Basque and Galician legal-document-only routes) and generate 242 legal documents under automated structural/script/source-hash QA. This source completeness does **not** open a country by itself: the legal country, subnational scope, statutory document-language route, governing bundle, storefront and current presence remain separate dimensions. Where an actual release channel, registration, provider workflow, or jurisdiction-specific production obligation requires external evidence, that evidence remains a separate fail-closed release gate. The source approval itself does not claim certified or sworn translation.

## Required evidence record

A country approval should identify at least the reviewer/counsel, date/effective date, operating entity, jurisdiction, exact production subprocessors, transfer mechanism, applicable representative/localization duties, privacy/terms/community versions, age policy, UGC/moderation process, subscription/consumer disclosures, retention posture and store declarations.

Re-review is required when a processor, data category, international transfer route, age-assurance mechanism, subscription flow, moderation provider, identity/location feature, or target country changes.

This is an engineering release-control document, not a legal opinion or certification.
