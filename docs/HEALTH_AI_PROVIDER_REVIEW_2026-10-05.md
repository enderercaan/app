# Health-record check: provider selection and contract review (2026-10-05)

Operator: Yekta Özel (sole proprietor, Türkiye). This is an internal review of publicly available terms and pricing, written without outside counsel. It is not legal advice, it is not a signed contract, and the contract itself can only be accepted by the operator in the provider console. Facts below come from the provider's public pages read on 2026-10-05 and must be re-read at the moment of acceptance.

## 1. What the check does now

- The owner uploads every filled page of the vaccination booklet. A booklet is checked once, 3 minutes after the last page is uploaded (the timer restarts for each new page).
- `supabase/functions/health-ai-worker` sends the pages (images, never links) to **Google Cloud Vision, document text detection, EU endpoint** (`eu-vision.googleapis.com`), reconstructs table rows from word positions and applies the schedule in `supabase/functions/_shared/healthBookletCheck.ts` (`tailmance-booklet-schedule-2026-10`).
- Result: **approved** (every required entry present and current), **manual review** (anything unclear, ambiguous, missing, overdue, unsupported species or age), or **rejected** (text unreadable, OCR confidence under 0.65).
- Approval is stored as a `vaccination_complete` attestation that **expires on the earliest due date found**. When it expires the in-app "checked and approved" label and the effective vaccination state lapse by themselves.
- No veterinarian, clinic, registry or credential is read, looked up, named or confirmed anywhere. The species, the date of birth and the dated entries are the only inputs. Breed and other care entries are not checked. Microchip is not checked by the AI.
- The raw OCR text is never stored; only the decision, a reason code, a confidence number and a hash of the page set are written.

### Schedule rules (reviewed against current public guidance)
| Item | Rule | Basis |
|---|---|---|
| Species | dog and cat only; anything else goes to a person | product scope |
| Age | under 4 months: never approved by the check (primary series still running) | WSAVA 2024: final puppy/kitten core dose at 16 weeks or older |
| Rabies | dated entry; due date stated in the booklet is used (max 3 years + 1 month after the dose); without a stated due date the entry is current for 12 months only; given before 12 weeks of age is not accepted | WSAVA 2024 (rabies vaccines with 1- or 3-year duration of immunity); legal requirements differ by country, so the conservative reading is used |
| Core vaccine | dog: distemper/adenovirus/parvovirus combination; cat: FPV/FCV/FHV combination; same due-date rule; under 12 months at least two dated doses and the last one at 16 weeks or older | WSAVA 2024 core vaccines |
| Internal parasite treatment | latest dated treatment within 92 days (35 days under 6 months of age) | ESCCAP Guideline 01 (worm control): at least four treatments a year |
| External parasite treatment | latest dated treatment within 92 days (35 days under 6 months) | ESCCAP Guideline 03 (ectoparasites): protection must cover the whole risk period |
| Dates | numeric or named-month dates; day-first/month-first is taken from proof inside the booklet, otherwise every reading must give the same result; lot, expiry and manufacturing dates are ignored; future dates or dates before birth go to a person | safety rule |

The constants are in one file and are the first thing to review whenever WSAVA or ESCCAP publish a new edition. They are a document-completeness rule, not veterinary advice.

## 2. Why this provider, and what was rejected

Requirements: reads photographed, handwritten, stamped, multilingual booklet pages; free at the start; no training on submitted images; a data processing agreement; a data-residency option; one HTTPS call that the worker can allow-list.

| Option | Finding (public pages, 2026-10-05) | Decision |
|---|---|---|
| **Google Cloud Vision, document text detection** | First 1,000 units each month free (one unit = one page per feature), then USD 1.50 per 1,000; handwriting and dense documents supported; EU-only processing when `eu-vision.googleapis.com` is used; online requests are processed in memory and not persisted; content is not used to train Vision models; processor terms through the Cloud Data Processing Addendum | **Chosen** |
| Azure AI Document Intelligence (free tier F0) | 500 pages a month, but only the first two pages of any request, 4 MB limit, intended for evaluation | Rejected: booklets have many pages |
| Self-hosted open-source OCR | No third-party processor, but needs a server that is not free and accuracy on handwriting is lower | Rejected for now |
| Large-language-model vision APIs | Better with messy handwriting, but not free; free tiers of such services commonly allow submitted content to be used to improve the product (verify per provider) | Possible later upgrade; would replace only the OCR step |

Google Cloud Vision does **not** return vaccination fields. Tailmance's own rule engine reads the words and applies the schedule. That is why the result is a document check and why anything ambiguous goes to a person.

## 3. Contract review of the provider terms

### Legal
- **Roles:** Tailmance is controller, Google is processor (Cloud Data Processing Addendum, section 4.1). Google may process customer data only to provide the service and on the customer's instructions; it may not use it for AI model training or advertising (section 5.2 as read; confirm the wording at acceptance).
- **Acceptance:** Google Cloud console → IAM & Admin page → section "Cloud Data Processing Addendum" → Review and Accept. The addendum takes effect on the day of acceptance. **Do not enable the live check before this is done**; the privacy notice already says the pages are processed under a data processing agreement.
- **Sub-processors and changes:** Google may use sub-processors and must give notice of changes with a right to object (section 11). Keep the notice e-mail address monitored.
- **Deletion:** online requests are not persisted; metadata (time, size) is logged temporarily. At the end of the term Google deletes remaining customer data within the periods in section 6. Nothing to delete per user from the provider side, which fits the account-deletion promise.
- **Security incidents:** Google notifies "promptly and without undue delay" (no fixed hour count). Tailmance's own duty to notify the authority within 72 hours (GDPR) is therefore decided by Tailmance on receipt; keep the incident runbook ready.
- **Audit:** no right to audit directly beyond the addendum's route (certifications, SOC reports); acceptable for this volume.
- **International transfers:**
  - EU/EEA users: the EU endpoint keeps processing in the EU, so no third-country transfer for them.
  - Türkiye (KVKK): sending Turkish users' pages to a processor abroad is a transfer under article 9 of Law 6698 (as amended in 2024). The addendum has a Türkiye-specific part (Appendix 3) that applies when the customer accepts Google's additional terms for transfers under Law 6698 and the billing address is in Türkiye. **Accept those terms, and check on the Authority's current pages whether the standard-contract notification (within five business days of signing) applies to this arrangement and make it if so.** This is the single legal step that cannot be settled from the repository.
  - Other markets: follow the same addendum; no separate filing is known for the configured 27 markets, which matches the existing international-transfer section of the privacy notice.
- **Governing law and liability:** the Google Cloud terms are governed by California law for ordinary business customers and cap each side's liability at the fees paid in the previous 12 months (free services: USD 5,000 for Google). With a free tier the practical recourse is small; the mitigation is that nothing here is irreversible and every non-approved result goes to a person.
- **Acceptable use:** pages contain pets' vaccination data and may contain an owner's name or phone number written by a clinic. The privacy notice already asks owners to avoid third-party data. No special-category human health data is intended.

### Financial
- Free until 1,000 pages a month. A booklet is 2 to 12 pages (the worker reads at most 12). Roughly 100 to 400 booklets a month fit the free tier.
- **The worker stops by itself at 900 pages a month** (`FREE_TIER_MONTHLY_UNITS`, table `health_ai_monthly_units`); later booklets wait for a person. Units are returned when a provider call fails.
- A billing account is required even for the free tier. **Budget alerts do not stop spending**; therefore also lower the per-day limits offered in the console (APIs & Services → Cloud Vision API → Quotas) to a level that cannot add up to more than 1,000 units in a month, so that Google itself blocks any overrun, and add a budget alert at USD 1.
- Above the free tier: USD 1.50 per 1,000 pages (about USD 0.009 for a six-page booklet). Turkish VAT/KDV or other tax may be added to Google's invoice for a Turkish customer; the operator's accountant should confirm how a sole proprietor records it.

### Operational
- Create a **separate Google Cloud project** only for this key. Enable only the Cloud Vision API. Create an API key restricted to "Cloud Vision API". Supabase Edge Functions have no fixed outbound IP, so IP restriction is not possible; rotate the key every 6 months and on any suspicion.
- Supabase secrets to set (names already in `supabase/.env.example`):
  - `HEALTH_AI_API_URL=https://eu-vision.googleapis.com/v1/images:annotate`
  - `HEALTH_AI_ALLOWED_HOSTS_JSON=["eu-vision.googleapis.com"]`
  - `HEALTH_AI_PROVIDER_CODE=google_cloud_vision`
  - `HEALTH_AI_API_KEY=<restricted key>`; `HEALTH_AI_WORKER_SECRET=<32+ random characters>`
- Schedule the worker (existing cron/worker mechanism) every 5 minutes. If the provider is down the job is retried with growing delays and goes to a person after 8 attempts.
- Accuracy will be lowest on handwriting and unusual layouts. Expect many booklets to go to a person at first; this is the safe direction. Review 20 approved and 20 non-approved records a week (see `OPERATIONS_RUNBOOKS_2026-10-05.md`, section 10) and pause automatic approval if any false approval is found (set the budget row `health_ai` to disabled in `ai_provider_cost_budgets`).
- Dependence on one provider: the OCR call is isolated in one function. Replacing the provider changes only `toPage` and the request in the worker; the rules, database and screens stay.

### What the contract does not cover
- Google does not verify veterinarians, vaccines or the truth of a booklet. A forged booklet that is well formed can be approved; that is why the label says only that entries were found, not that the pet is healthy, and why the owner is told to check.
- No SLA is assumed.

## 4. Release evidence this review does not close
`release/health-ai-provider-evidence-v22.json` stays `not_verified` until the operator has: accepted the addendum (screenshot), created the restricted key, set the per-day quota and budget alert, made the KVKK step, run a deletion exercise with synthetic pages, measured false approvals on at least 300 labelled pages in the supported languages, and staffed the 24-hour review queue.
