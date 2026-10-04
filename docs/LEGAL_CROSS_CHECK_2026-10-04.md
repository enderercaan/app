# Legal cross-check of the 27 configured markets (2026-10-04)

Method: official-source sites were not reachable from the build environment (policy-denied hosts), so the time-sensitive claims in `release/official-source-review-v19.json` were cross-checked against independent secondary sources (law-firm alerts, regulator news coverage, press). This is a consistency check, not a substitute for the official text. The registry itself remains the official-source record.

Result: every one of the 27 markets has at least one claim checked, and the table lists them all. All checked claims matched the registry except one that could not be confirmed (Italy). One new watch item was added (Germany).

| Market | Claim checked | Result |
|---|---|---|
| EU | AI Omnibus Reg. (EU) 2026/1744 published 2026-07-24, high-risk duties deferred; EU KIDS Act proposed 2026-09-17 (age 15 / limited accounts from 13); Digital Fairness Act planned end 2026 | Matches (AI Omnibus recorded in `docs/AI_TRANSPARENCY_AND_AI_ACT_APPLICABILITY_2026-10-03.md`) |
| AE | Decree-Law 26/2025 child digital safety in force 2026-01-01, one-year compliance window | Matches |
| AT | AVMS draft under-14 ban, in review since 2026-07-27, planned commencement 2027-01-01, not enacted | Matches |
| AU | Social Media Minimum Age since 2025-12-10; Children's Online Privacy Code must be registered by 2026-12-10 | Matches |
| BE | Flemish government decision of 2026-04-03 on a minimum age of 13 is a draft | Matches |
| BR | ECA Digital (Law 15.211/2025) in force 2026-03-17; Decrees 12.880 to 12.882/2026 | Matches |
| CA | Bill C-34 at second reading | Matches |
| CN | Network trading platform rules 2026-02-01; Internet platform price conduct rules 2026-04-10 (auto-renewal notices) | Matches |
| DE | JMStV Sixth Amendment in force 2025-12-01 | Matches. New: operating-system youth-protection duties start one year after KJM designates systems (designation due by 2026-12-01). Added as a future watch note. |
| ES | Under-16 ban announced 2026-02-03, bill still in Congress | Matches |
| FR | Law 2026-813, Article 1 (under-15 ban) censured 2026-08-14 | Matches |
| GB | Under-16 restriction announced 2026-06-15, measures expected spring 2027; DMCC subscription regime now expected spring 2027 | Matches (registry says uncommenced duties are not current) |
| ID | PP 17/2025 (PP TUNAS), Permenkomdigi 9/2026, staged from 2026-03-28 | Matches |
| IE | First Online Safety Code investigation opened 2026-09-08 (age assurance) | Matches |
| IN | DPDP Rules phases: 2025-11-13, 2026-11-13, 2027-05-13 | Matches |
| IT | Legislative Decree 30/2026 amending the Consumer Code (live animals as goods) | NOT CONFIRMED. No independent source found. Needs verification on Normattiva / Gazzetta Ufficiale. |
| JP | APPI amendment promulgated 2026-07-17; main provisions by Cabinet Order within two years | Matches |
| KR | PIPA amendment promulgated 2026-03-10, effective 2026-09-11 | Matches |
| NL | Cabinet backs an EU-wide minimum age of 15 (2026-09-11) | Matches |
| PL | Animal protection amendment signed 2026-07-24, in force one year after publication | Matches |
| RU | Platform economy Law 289-FZ in force 2026-10-01 | Matches |
| SA | CST digital content platform notification (100,000+ users); Shura Council called for under-16 age verification | Matches |
| SG | Online Safety (Relief and Accountability) Act in force 2026-06-29 | Matches |
| TH | No minimum age in force; under-16 ban studied; draft Child Protection Act (2026-05-11) | Matches |
| TR | Advertising regulation amendment published 2026-07-01, effective 2026-08-01, profiling-based ads to children banned | Matches |
| TW | Only proposals and TikTok-specific measures, no enacted age law | Matches |
| US | CA AB 1043 operative 2027-01-01; TX SB 2420 in force 2026-06-04; UT effective 2027-05-06; LA delayed to 2027-07-01 | Matches |
| VN | Law 91/2025/QH15 and Decree 356/2025 from 2026-01-01 | Matches |

Also confirmed: Google Android developer verification mandatory from 2026-09-30 in BR, ID, SG and TH.

Open follow-ups:
1. Italy D.Lgs. 30/2026: confirm the citation and content on Normattiva, or correct the registry note.
2. Germany OS age-signal duties: confirm against the official Länder / KJM text.
3. Re-run this check before each release and at the registry `refresh_due_at` date.
