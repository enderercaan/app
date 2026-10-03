# Requirements Ledger v0

Status: planned / built / tested / audited. External proof never becomes PASS from source presence alone.

| ID | Requirement | Module | Status | Evidence |
|---|---|---|---|---|
| GOV-001 | Pet is the persona; human owner remains accountable | Core | tested | pet-first migrations; profile/feed/chat UI; security tests |
| GOV-002 | Owner/publisher is Yekta Özel | Core | tested | centralized `brand.ts`, Settings ownership surface, app config metadata, Module 1 gate |
| GOV-003 | Zero pet sales | Moderation | tested | 159/162 migrations; content safety tests |
| GOV-004 | Zero adoption/rehoming | Moderation | tested | 159 migration; moderation policy tests |
| GOV-005 | No stud/breeding fees or user payment links | Moderation | built | content safety policy; country runtime policy |
| GOV-006 | Mating P2P only; platform not transaction facilitator | Deck/Legal | built | terms + mating runtime gates |
| GOV-007 | 18+ account holders | Core+Auth | tested | prelegal age attestation + legal gate |
| GOV-008 | Dogs/cats default product scope | Pet Profile | tested | domain model and pet-first checks |
| GOV-009 | Multiple pets with switcher | Pet Profile | built | ProfileScreen + AppData state |
| GOV-010 | No fake profiles/bots/seeded public fake content | Launch | audited | review access runbook; release checks |
| GOV-011 | Document-verified wording; never healthy/disease-free | Health/LQA | audited | 19 runtime locales + 19 store locales enforced by `test:product-language`; health-document review wording only |
| GOV-012 | Fuzzy location and no exact-location disclosure | Deck/Privacy | tested | PostGIS private spatial migrations + location client |
| GOV-013 | In-person meetup safety guidance | Safety | built | meetup/safety screens and copy |
| GOV-014 | Country rules fail closed | Legal | tested | 27 configured + worldwide BLOCK registry |
| GOV-015 | Tailmance app/product IP ownership notice preserves user UGC and third-party licenses | Core/Legal | tested | `NOTICE.md`; `Tailmance™`; no unverified `®`; Module 1 gate |
| AUTH-001 | Apple sign-in equivalent option | Core+Auth | built | app.config usesAppleSignIn; AuthScreen social provider |
| AUTH-002 | Google sign-in | Core+Auth | built | AuthScreen/startLinkedSocialSignIn |
| AUTH-003 | Email/password fallback | Core+Auth | tested | signUp/signIn + verified-email requirement |
| AUTH-004 | Phone OTP fallback | Core+Auth | tested | OTP signup/login + verified phone |
| AUTH-005 | Social auth cannot bypass age/legal pre-registration | Core+Auth | tested | existing-account-only social auth; security checks |
| AUTH-006 | Session revocation boundary | Core+Auth | tested | revocation migrations + 123/123 RPC boundary |
| AUTH-007 | MFA/AAL2 protected surfaces | Core+Auth | tested | AuthContext/MFA service + auth boundary tests |
| AUTH-008 | Secure native token/session storage | Core+Auth | tested | SecureStore session persistence |
| AUTH-009 | App Attest server verification | Security | built | device-integrity function; live evidence pending |
| AUTH-010 | Play Integrity server verification | Security | built | device-integrity function; live evidence pending |
| AUTH-011 | Root/jailbreak/debugger signals are risk inputs | Security | tested | security-checks.mjs |
| AUTH-012 | Global sign-out and password reset revoke sessions | Core+Auth | tested | session revocation RPCs; auth tests |
| AUTH-013 | Offline queue bound to authenticated user | Core+Auth | tested | AuthContext + offline sync tests |
| AUTH-014 | Bootstrap network failure cannot misroute existing user to onboarding | Core+Auth | tested | bootstrapStatus error gate |
| AUTH-015 | CAPTCHA/anti-abuse challenge on auth | Core+Auth | built | authChallenge service/web challenge |
| AUTH-016 | No reviewer auth/IAP backdoor | Store | tested | store-review access and critical-journey checks |
| AUTH-017 | OAuth-provider token revocation on account deletion | Auth/Privacy | tested | migration 194 encrypted service-only credential vault; authenticated/device-integrity capture; Apple/Google revoke adapter; durable external deletion retry; 19-locale manual fallback; `test:oauth-revocation` PASS; live provider proof external |
| AUTH-018 | Dedicated Core/Auth/Age regression gate | Core+Auth | tested | `scripts/module1-core-auth-age-checks.mjs`; 19/19 ownership locale coverage PASS |
| AUTH-019 | OAuth revocation credential encryption supports safe key rotation | Auth/Security | tested | bounded previous-key keyring + scheduled progressive re-wrap in external deletion worker |
| AUTH-020 | Failed synchronous provider revocation preserves durable retry and surfaces localized manual fallback on every deletion surface | Auth/Privacy | tested | accountDeletion helper + Settings/Paused/Suspended deletion surfaces + `test:oauth-revocation` |
| AUTH-021 | OAuth revocation uses the exact provider client identifier that minted the token | Auth/Privacy | tested | migration 195 `provider_client_id`; Apple native/browser binding; release env gate; `test:oauth-revocation` |
| AUTH-022 | Native Apple/Google social-auth adapter is part of the reachable production auth graph | Core+Auth | tested | static import in `auth.ts`; repository reachability 126/126; source semantics PASS |
| DATA-001 | PostgreSQL production schema | Data | tested | 001-198 contiguous migrations |
| DATA-002 | PostGIS SRID 4326 spatial queries | Data | tested | 157 migration |
| DATA-003 | pgvector hybrid matchmaking | Deck | tested | 181/190/192 migrations |
| DATA-004 | Private precise/coarse location separation | Privacy | tested | schema + spatial migrations |
| DATA-005 | Redis deck/feed/reel caches with privacy parity | Data | tested | 169/175/192 + redis tests |
| DATA-006 | Cursor pagination | Backend | tested | RPC/feed contract checks |
| DATA-007 | Durable idempotency keys/receipts | Backend | tested | 121-130 and later migrations |
| DATA-008 | Direct-to-private-storage upload intents | Media | tested | upload contracts |
| DATA-009 | Server sanitized media derivative | Media | tested | reel/media moderation pipeline |
| DATA-010 | Strip EXIF/GPS before distribution | Media | built | media processing contract; provider evidence external |
| DATA-011 | Private health document storage | Health | tested | private storage policies and deletion lifecycle |
| DATA-012 | Retention/deletion jobs | Privacy | tested | storage GC/external deletion workers |
| DATA-013 | Admin/support RBAC | Operations | built | moderation/reports admin functions; operator config external |
| DATA-014 | Versioned legal documents and acceptance records | Legal | tested | legal bundles/acceptance migrations |
| HEALTH-001 | Health upload/status state machine | Health | built | Health/Verification screens |
| HEALTH-002 | OCR/provider strict-schema pipeline | Health | tested | 182+ health AI checks |
| HEALTH-003 | Confidence thresholds with human review | Health | tested | 182/187/188 |
| HEALTH-004 | Auto-verify only with credential/registry integrity | Health | tested | health AI guardrails |
| HEALTH-005 | Microchip format validation where applicable | Health | built | health AI/rules; registry applicability VERIFY |
| HEALTH-006 | Fraud/duplicate/template signals | Health | built | moderation/provider contract; calibration external |
| HEALTH-007 | Trust Pill with public fingerprint, no raw docs | Health | tested | 186 + verification surfaces |
| HEALTH-008 | Expiry downgrade/reminders | Health | tested | 132/143 + reminders worker |
| HEALTH-009 | Health AI export/erasure lifecycle | Health | tested | 184 |
| HEALTH-010 | Not veterinary/emergency service notice | Health/Safety | built | health/safety/legal copy |
| SOC-001 | Swipe deck | Deck | built | Discover screens/domain |
| SOC-002 | Verified-only default filter ON | Deck | tested | `defaultDiscoveryFilters()` sets `profileVerifiedOnly:true`; Standard users may toggle it without Premium gating; product-retention + 19-locale i18n gates |
| SOC-003 | Standard 50 swipes/day default, server-authoritative and remote-configurable | Deck | audited | migrations 196-197; active window freezes configured limit until local-midnight reset; Discover quota UI; `test:daily-product-quota` |
| SOC-004 | Premium unlimited swipes | Deck | built | premium/discovery gating |
| SOC-005 | Standard 3 new conversations/day default, server-authoritative and remote-configurable | Chat | audited | migrations 196-197; first-message transactional consumption; active window limit freeze; `test:daily-product-quota` |
| SOC-006 | Premium initiator unlock persists for Standard recipient | Chat | audited | migration 196 transactional first-message unlock + migration 197 remote-quota compatibility + quota regression gate |
| SOC-007 | Block closes relationship/thread access | Chat/Safety | tested | block serialization/match closure |
| SOC-008 | Typing/read receipts with privacy controls | Chat | built | private realtime chat; preference review scheduled |
| SOC-009 | Push privacy/no exact location | Notifications | tested | push copy/data boundaries |
| SOC-010 | Grid/feed posts | Social | built | Feed/Post surfaces |
| SOC-011 | 24h Stories | Social | built | story tables/reply/TTL operations |
| SOC-012 | Vertical Reels feed | Reels | tested | 167-180 + Reels tests |
| SOC-013 | Pati Radar approximate-radius alerts | Safety | built | lost alert surfaces/PostGIS |
| SOC-014 | Matched-pet LiveKit calls | Calls | tested | 170+ migrations + checks |
| SOC-015 | Universal/App Links pet/reel/story | Deep Links | built | 174 + association generator; hosted evidence pending |
| SOC-016 | Block/report on all UGC surfaces | Safety | tested | moderation/report checks |
| PAY-001 | RevenueCat entitlement tailmance_premium | Billing | tested | 185 + config/security tests |
| PAY-002 | RevenueCat package premium_access | Billing | tested | 185 + package selection tests |
| PAY-003 | Store-localized price only | Billing | built | Purchases service |
| PAY-004 | Restore purchases | Billing | built | PremiumScreen/purchases |
| PAY-005 | Server-authoritative entitlement | Billing | tested | subscription sync/webhook |
| PAY-006 | Webhook replay/idempotency | Billing | tested | billing webhook ledger/tests |
| PAY-007 | No dark patterns + precontract disclosure | Billing/Legal | tested | precontract migrations/UI |
| PAY-008 | Regional billing programs configurable/fail-closed | Billing/Legal | tested | migration 198 service-only evidence-bound country config; absent/stale approval disables alternative billing/external links; client remains RevenueCat/native-store only; `test:regional-billing` |
| UX-001 | Light/dark design tokens | Design | tested | src/theme.ts + UX checks |
| UX-002 | 48dp targets and semantics | Design | tested | accessibility baseline |
| UX-003 | Reduced-motion respect | Design | built | screen hooks/media UI |
| UX-004 | Loading/empty/error/offline states | Design | built | screen patterns; inventory audit pending |
| UX-005 | Safe-area/cutout handling | Design | built | SafeAreaView/Provider |
| UX-006 | Tablet support | Design | built | supportsTablet; real-device evidence pending |
| UX-007 | Foldable/window-size validation | Design | planned | device matrix / physical test |
| UX-008 | One-token-system/no raw style drift | Design | tested | semantic theme tokens centralize modal/glass/media/call colors; `test:design-tokens` rejects raw TSX color literals; existing UX/theme checks cover themed StyleSheets |
| I18N-001 | 19 runtime locale catalogs | i18n | tested | 19 locale baseline |
| I18N-002 | Arabic RTL | i18n | tested | RTL runtime + checks |
| I18N-003 | Placeholder parity | i18n | tested | i18n release checks |
| I18N-004 | Push/native metadata localization | i18n | tested | i18n checks |
| I18N-005 | Legal localization routes | i18n/Legal | tested | 22 legal locales/route matrices |
| I18N-006 | Native-speaker sign-off | i18n | planned | external sign-off recommended |
| PRIV-001 | In-app account deletion | Privacy | tested | Settings + delete-account function |
| PRIV-002 | External web account deletion | Privacy | tested | web/delete-account + release checks |
| PRIV-003 | DSAR export | Privacy | tested | export functions |
| PRIV-004 | Consent records/re-consent | Legal/Privacy | tested | legal context/bundle migrations |
| PRIV-005 | ATT only if tracking | Privacy | built | privacy manifest tracking false; re-evaluate if SDKs change |
| PRIV-006 | Privacy manifest/data inventory consistency | Privacy/Store | built | app config + privacy data map; console check external |
| LEGAL-001 | Terms | Legal | tested | localized legal pipeline |
| LEGAL-002 | Privacy Policy + KVKK | Legal | tested | legal pipeline + country supplements |
| LEGAL-003 | Community Guidelines | Legal | tested | legal pipeline |
| LEGAL-004 | Moderation & Appeals policy | Legal | tested | legal pipeline + moderation statements |
| LEGAL-005 | IP/DMCA notice | Legal | tested | intellectual-property document |
| LEGAL-006 | Subscription/consumer terms | Legal | tested | subscription-consumer docs |
| LEGAL-007 | Unsupported jurisdictions blocked | Legal | tested | worldwide registry |
| LEGAL-008 | Licensed counsel launch review | Legal | planned | external evidence gate |
| STORE-001 | Reviewer access without production bypass | Store | tested | store review runbook + gate |
| STORE-002 | Google Data Safety reconciliation | Store | planned | console evidence external |
| STORE-003 | Apple privacy labels reconciliation | Store | planned | console evidence external |
| STORE-004 | Force/minimum-version gate | Store | tested | RuntimeGate/release config |
| STORE-005 | Fastlane automation | Store | tested | fastlane checks |
| REL-001 | Sentry crash reporting | Observability | built | Sentry wrapper/config; live DSN/symbol evidence external |
| REL-002 | Privacy-minimal frame telemetry | Observability | tested | 183 + observability checks |
| REL-003 | GitHub Actions/security scanning | CI/CD | built | .github workflows / release checks |
| REL-004 | Trivy/supply-chain scan | CI/CD | built | workflow config; live run evidence external |
| REL-005 | Critical journey automation | QA | tested | Maestro/source contract; real-device execution external |
| REL-006 | Genuine reproducible dependency lock | CI/CD | planned | package-lock absent; generate online only |
| REL-007 | AI provider cost budget | FinOps | tested | 193 + ai cost tests |
| REL-008 | Production KMS/data-at-rest evidence | Security | planned | external evidence gate |
| REL-009 | Incident response/breach playbook | Operations | built | docs/SECURITY_INCIDENT_RESPONSE.md |
| REL-010 | Post-launch SLO/on-call/store-policy cadence | Operations | built | operations runbook; staffing external |
