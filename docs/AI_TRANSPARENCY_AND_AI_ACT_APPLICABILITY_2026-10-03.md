# AI use inventory, transparency and EU AI Act applicability (2026-10-03)

Status: engineering review for a sole-proprietor operator (no company). This is not legal advice.
Dates for the EU AI Omnibus below come from secondary sources and must be confirmed against the Official Journal before release.

## 1. Where Tailmance uses AI or automated decisions

| Surface | What it does | Where | User-facing disclosure |
|---|---|---|---|
| Photo safety pre-filter | Not shipped in the first release (operator decision 2026-10-05; see `release/edge-ai-model-evidence-v21.json`). Every upload is decided by server moderation. Breed is never inferred by AI | `src/services/edgeAi.ts`, `uploads.ts` | None may claim on-device screening; checked by `health-ai-disclaimer-checks` |
| Health document check | The owner is asked to upload every filled page of the vaccination booklet. AI-assisted text recognition reads all pages together and compares the dated entries, within the required date ranges, with the vaccinations and internal and external parasite treatments that apply to the pet according to its species and date of birth (Google Cloud Vision, EU endpoint; rules in `_shared/healthBookletCheck.ts`; see `docs/HEALTH_AI_PROVIDER_REVIEW_2026-10-05.md`). Breed and other care entries are not checked, and no veterinarian, clinic or register takes part. A complete, current record is marked "checked and approved" until the earliest due date; any other record is not approved automatically and may be reviewed by a person. The mark is not a statement about the pet's health, not veterinary advice and not a guarantee. AI never determines breed from images and never diagnoses | `supabase/functions/health-ai-worker`, `HealthScreen` | `health.uploadDocumentBody`, `health.automatedReviewNotice`, `health.documentCheckApproved` and `health.documentCheckNote` in 19 locales + a dedicated health-AI paragraph in the Terms, Privacy Notice (sections 7 and 14), Community Guidelines, Support, the Turkish KVKK page and all 594 country supplements, in all 22 legal languages. Every text says AI can make mistakes and users should check; the notice applies to all information and guidance given by AI |
| Media moderation | Automated safety review with appeal path | `supabase/functions/moderate-media`, `moderation-appeals-admin` | Privacy notice section on automated systems; moderation appeals screen |
| Match ranking | Algorithmic recommendations | `src/domain/matching.ts`, pgvector migrations | Privacy notice section on automated systems |
| AI chatbot / AI veterinary diagnosis | Not offered. `aiVeterinaryDiagnosisEnabled=false` in the product feature policy | migrations 196/197 | Privacy notice states it is not offered |

The on-device safety model is disabled in the first release by operator decision (`release/edge-ai-model-evidence-v21.json`). The health AI provider terms are reviewed but not yet accepted by the operator (`release/health-ai-provider-evidence-v22.json`, `docs/HEALTH_AI_PROVIDER_REVIEW_2026-10-05.md`). Before the first upload the app asks for an explicit in-app agreement to send the pages to the text-recognition provider (`health.uploadConsent*`), which is the disclosure and permission Apple guideline 5.1.2(i) asks for when personal data may be shared with third-party AI.

## 2. EU AI Act applicability (Regulation (EU) 2024/1689)

| Provision | Applies? | Reason |
|---|---|---|
| Art. 5 prohibited practices | No | No manipulation, social scoring, emotion inference or biometric categorisation of people. |
| Annex III high-risk | No | Pet-photo, document OCR, moderation and ranking are outside the listed areas. Owner identity verification is 1:1 verification by an external provider, which Annex III excludes from remote biometric identification. Provider terms still need review. |
| Art. 50 transparency | Not today | No chatbot, no synthetic or AI-generated content, no emotion recognition. If an AI assistant or generated media is ever added, a persistent "you are talking to an AI" notice and content marking become mandatory before it ships. |
| Art. 4 AI literacy | Yes, minimal | The operator is a deployer of third-party AI tools. Keep this document and the moderation / health review procedures as the literacy record. |

Secondary sources report that the AI Omnibus (Regulation (EU) 2026/1744, published 24 July 2026, in force 27 July 2026) moved Annex III high-risk obligations to 2 December 2027 and Annex I to 2 August 2028, while prohibited practices, AI literacy and transparency duties keep their schedule. Confirm on EUR-Lex.

## 3. Related duties already covered

- GDPR Art. 22 / KVKK / LGPD automated-decision safeguards: human review and appeal are described in the privacy notice and implemented in the moderation appeals flow.
- DSA statements of reasons and appeals: `moderation_appeals` legal document and the in-app appeals screen.
- Apple 5.1.2(i): sharing personal data with a third-party AI provider needs explicit disclosure and consent. Revisit when the health AI provider is contracted.

## 4. Before enabling any new AI feature

1. Add it to the table above with its disclosure text in all 19 app locales and 22 legal languages.
2. Re-run `npm run test:i18n`, `npm run test:legal-web-localizations` and `npm run verify:offline`.
3. Update the store privacy declarations (App Privacy, Data Safety) if data leaves the device.
