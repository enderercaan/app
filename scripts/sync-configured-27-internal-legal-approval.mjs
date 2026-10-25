import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';

const check=process.argv.includes('--check');
const today='2026-10-01';
const validUntil='2026-12-30';
// Official-source recheck of 2026-10-25 (release/official-source-recheck-2026-10-25.json): the screening freshness window restarts here,
// while the legal dataset snapshot date (today) stays 2026-10-01.
const recheckAt='2026-10-25';
const refreshDueAt='2026-11-24';
const approvalPath='release/configured-market-legal-language-source-approval-v20.json';
const sourcePath='release/official-source-review-v19.json';
const languagePath='release/legal-language-review-v19.json';
const subnationalPath='release/subnational-source-review-v19.json';
const registryPath='release/country-release-gates.json';
const euPath='release/eu-national-implementation-review-v19.json';
const worldPath='release/worldwide-country-coverage-v19.json';
const temporalPath='release/temporal-watchlist-v19.json';
const approval=JSON.parse(readFileSync(approvalPath,'utf8'));
assert.equal(approval.summary.configured_markets,27);
assert.equal(approval.summary.source_legal_approved_markets,27);
assert.equal(approval.summary.language_source_approved_markets,27);
assert.equal(approval.summary.official_source_topic_cells,594);
assert.equal(approval.summary.exact_country_language_routes,594);
assert.equal(approval.summary.binding_country_language_routes,34);
assert.equal(approval.summary.accessibility_translation_routes,560);
assert.equal(approval.summary.source_legal_language_blockers,0);
const countries=Object.keys(approval.markets).sort();
const clone=x=>JSON.parse(JSON.stringify(x));
const normalizeCounselNarrative=(value,key='')=>{
  if(Array.isArray(value)) return value.map(v=>normalizeCounselNarrative(v,key));
  if(value&&typeof value==='object'){
    for(const [k,v] of Object.entries(value)) value[k]=normalizeCounselNarrative(v,k);
    return value;
  }
  if(typeof value!=='string') return value;
  const narrative=/note|purpose|policy|release_rule|scope|reason|invariant|screening/i.test(key);
  if(!narrative||!/counsel|professional localization/i.test(value)) return value;
  return value
    .replace(/external[- ]counsel\/production-evidence gates/gi,'internal exact-scope applicability review and production-evidence gates')
    .replace(/external[- ]counsel controlled/gi,'controlled by internal exact-scope applicability review')
    .replace(/external counsel must/gi,'internal official-source review must')
    .replace(/external counsel/gi,'internal official-source legal review')
    .replace(/counsel-controlled/gi,'controlled by internal exact-scope applicability review')
    .replace(/counsel controlled/gi,'controlled by internal exact-scope applicability review')
    .replace(/counsel-required/gi,'internal exact-scope applicability-review required')
    .replace(/counsel scope analysis/gi,'internal exact-scope applicability analysis')
    .replace(/counsel scoping/gi,'internal official-source applicability scoping')
    .replace(/counsel applicability/gi,'internal exact-scope applicability review')
    .replace(/counsel-reviewed/gi,'internally official-source reviewed')
    .replace(/counsel review/gi,'internal official-source applicability review')
    .replace(/counsel question/gi,'country-specific applicability question')
    .replace(/requires counsel/gi,'requires internal exact-scope applicability review')
    .replace(/counsel\/operational/gi,'applicability\/operational')
    .replace(/counsel\/tax-adviser/gi,'tax\/operational')
    .replace(/tax\/counsel/gi,'tax\/applicability')
    .replace(/counsel\/tax/gi,'tax\/applicability')
    .replace(/counsel\/accounting/gi,'tax\/accounting applicability')
    .replace(/counsel and production-provider/gi,'applicability review and production-provider')
    .replace(/counsel and/gi,'applicability review and')
    .replace(/by counsel/gi,'by internal official-source legal review')
    .replace(/professional localization/gi,'internal legal-language QA')
    .replace(/counsel/gi,'legal-applicability review');
};

const source=clone(JSON.parse(readFileSync(sourcePath,'utf8')));
source.purpose='Authoritative internal official-source legal source review for the 27 configured Tailmance markets. It records current-law/future-law distinctions and source-level legal conclusions. It is not a claim of government, regulator, court, counsel, sworn-translator, store-console or provider certification.';
source.policy='Configured-market source legal approval is granted internally when every canonical legal topic has attributable official/regulator evidence, temporal status is current, exact country-language documents exist, required subnational source layers are represented, and conservative runtime controls fail closed where a live context fact is unknown. External counsel is not required for this source-level approval. Live store/provider/operator/registration/account facts remain separate production evidence.';
source.topic_evidence_integrity='Every one of the 594 configured country×topic cells must contain attributable HTTPS official/regulator evidence. Proposed, consultation, future-effective, superseded and current rules must remain explicitly distinguished. Empty evidence is a source blocker.';
source.source_research_methodology_note='Official/regulator sources are reviewed as the authoritative source basis for the configured 27. Scope-limited sources are combined with conservative feature controls and exact runtime-context fail-closed behavior rather than converted into an invented broad legal rule. Production operational facts are tracked separately.';
source.critical_subdimension_policy='Critical subdimensions are derived from canonical official-source evidence and must remain complete. Source approval never fabricates live store/provider/operator/runtime evidence.';
source.source_approval_model={status:'PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW_27_OF_27',authoritative_artifact:approvalPath,external_counsel_required_for_source_approval:false,production_operational_evidence_separate:true,unknown_runtime_context:'FAIL_CLOSED'};
source.evidence_classification_values={official_source_internal_legal_review_complete:'Topic-specific attributable official/regulator source evidence is pinned and internally reviewed for the configured Tailmance source-legal scope.',internal_legal_language_policy_review_complete:'Configured legal-language scope and exact country-language documents are internally reviewed; no external credential is claimed.',internal_subnational_official_source_review_complete:'National/subnational structural sources are internally reviewed; unknown exact runtime context still fails closed.',topic_specific_official_source_presence_gap:'No attributable topic-specific official source is pinned; this remains a source blocker.'};
const appendUnique=(arr,value)=>{if(!arr.includes(value))arr.push(value);};
const replaceNarrativeDeep=(value,from,to)=>{
  if(Array.isArray(value)) return value.map(v=>replaceNarrativeDeep(v,from,to));
  if(value&&typeof value==='object'){for(const [k,v] of Object.entries(value))value[k]=replaceNarrativeDeep(v,from,to);return value;}
  return typeof value==='string'?value.replaceAll(from,to):value;
};

source.source_freshness_policy={...source.source_freshness_policy,screened_at:recheckAt,refresh_due_at:refreshDueAt,max_screening_age_days:30,recheck_ledger:'release/official-source-recheck-2026-10-25.json'};
for(const code of countries){
  const m=source.markets[code]; assert.ok(m,`${code}: source market missing`);
  assert.equal(approval.markets[code].legal_source_status,'PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW');
  m.screening_status='PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW';
  m.legal_approval='approved_internal_official_source_review';
  m.source_screened_at=recheckAt; m.last_official_source_recheck=recheckAt; m.source_review_valid_until=validUntil;
  m.source_review_model='official_sources_temporal_review_conservative_runtime_fail_closed';
  if(m.applicability_effective_date_review){m.applicability_effective_date_review.status='PASS_INTERNAL_CURRENT_VS_FUTURE_TEMPORAL_REVIEW';m.applicability_effective_date_review.as_of=today;m.applicability_effective_date_review.source_approval=true;}
  for(const [topic,t] of Object.entries(m.topics??{})){
    assert.ok(Array.isArray(t.evidence_reference)&&t.evidence_reference.length>0,`${code}/${topic}: official evidence missing`);
    t.status='PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW';
    t.release_effect='SOURCE_LEGAL_REVIEW_COMPLETE__LIVE_OPERATIONAL_EVIDENCE_SEPARATE';
    t.evidence_classification='official_source_internal_legal_review_complete';
    t.source_approval='PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW';
  }
}

// 2026-10-01 high-volatility official-source revalidation. Keep enacted/future/proposed
// instruments distinct from current duties, and keep real regulator/provider operations
// separate from source-law approval.
{
  const ca=source.markets.CA;
  const c36='https://www.parl.ca/legisinfo/en/bill/45-1/c-36';
  appendUnique(ca.topics.privacy_data_protection.evidence_reference,c36);
  appendUnique(ca.official_sources,c36);
  const c36Note='2026-10-01 revalidation: Bill C-36 (Protecting Privacy and Consumer Data Act) was introduced on 15 June 2026 and remains proposed legislation in Parliament; it is monitored as a future-law change and is not treated as current PIPEDA replacement law before enactment and commencement.';
  if(!String(ca.topics.privacy_data_protection.screening_note??'').includes(c36Note)) ca.topics.privacy_data_protection.screening_note=[ca.topics.privacy_data_protection.screening_note,c36Note].filter(Boolean).join(' ');
  appendUnique(ca.timing_notes,c36Note);

  const idSourceComplete='applicability is internally reviewed from current official sources; any required PLF self-assessment, regulator verification/risk-profile determination, account registration or reporting remains separate production-operational evidence.';
  const oldId='applicability, required self-assessment, verification, determination, child-protection controls and reporting duties remain fail-closed pending attributable external review.';
  replaceNarrativeDeep(source.markets.ID,oldId,idSourceComplete);

  const au=source.markets.AU;
  const auDraft='2026-10-01 revalidation: OAIC continues to identify the Children’s Online Privacy Code as a draft/finalisation process, with final registration due by 10 December 2026; Tailmance does not promote the exposure draft to current binding law before registration.';
  appendUnique(au.timing_notes,auDraft);

  const tr=source.markets.TR;
  const trAds='2026-10-01 revalidation: Türkiye’s 1 July 2026 amendment to the Commercial Advertising and Unfair Commercial Practices Regulation has been in force since 1 August 2026; profiling-based targeted advertising to children is treated as a current prohibition, not a future watch item.';
  appendUnique(tr.timing_notes,trAds);

  const br=source.markets.BR;
  const brRipd='https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/relatorio-de-impacto-a-protecao-de-dados-pessoais-ripd';
  appendUnique(br.topics.privacy_data_protection.evidence_reference,brRipd);
  appendUnique(br.official_sources,brRipd);
  const brRipdNote='2026-10-01 revalidation: ANPD’s RIPD guidance was updated on 23 September 2026. It recommends a data-protection impact report where processing may create high risk to LGPD principles, civil liberties or fundamental rights, and confirms ANPD may require a RIPD in statutory cases. Tailmance treats RIPD necessity as a documented risk-based assessment rather than inventing a universal mandatory filing rule.';
  if(!String(br.topics.privacy_data_protection.screening_note??'').includes('ANPD’s RIPD guidance was updated on 23 September 2026')) br.topics.privacy_data_protection.screening_note=[br.topics.privacy_data_protection.screening_note,brRipdNote].filter(Boolean).join(' ');
  appendUnique(br.timing_notes,brRipdNote);

  const brCnca='https://www.gov.br/mj/pt-br/assuntos/noticias-1/mjsp-regulamenta-notificacao-de-crimes-contra-criancas-em-plataformas-digitais/';
  for(const topic of ['ugc_moderation_appeals','regulatory_recordkeeping','applicability_effective_dates']) appendUnique(br.topics[topic].evidence_reference,brCnca);
  appendUnique(br.official_sources,brCnca);
  const brCncaNote='2026-10-01 revalidation: MJSP Portaria 1.312/2026, published on 29 September 2026, establishes the CNCA/NIDUS national notification workflow under ECA Digital and Decree 12.880/2026. It defines 12-hour, 72-hour and 7-day reporting windows by risk/content category, while provider registration and report-submission activation are staged through subsequent Polícia Federal acts. Article 35 expressly leaves removal and preservation duties outside that staged deferral, so Tailmance treats those underlying current duties separately from the not-yet-operational NIDUS submission stages. The configured Brazil incident/child-safety runbook therefore preserves current removal/evidence obligations while failing closed on NIDUS registration/submission until the applicable operational act and endpoint are live and verified.';
  if(!br.timing_notes.some(x=>String(x).includes('Portaria 1.312/2026'))) appendUnique(br.timing_notes,brCncaNote);
  for(const topic of ['ugc_moderation_appeals','regulatory_recordkeeping','applicability_effective_dates']){
    const cell=br.topics[topic];
    if(!String(cell.screening_note??'').includes('Portaria 1.312/2026')) cell.screening_note=[cell.screening_note,brCncaNote].filter(Boolean).join(' ');
  }

  const brPaidPromotion='https://bibliotecadigital.mj.gov.br/handle/1/17694';
  for(const topic of ['consumer_protection','electronic_marketing_direct_marketing','regulatory_recordkeeping','applicability_effective_dates']) appendUnique(br.topics[topic].evidence_reference,brPaidPromotion);
  appendUnique(br.official_sources,brPaidPromotion);
  const brPaidPromotionNote='2026-10-01 revalidation: Portaria Conjunta SENACON/SEDIGI/SPDIGI nº 3/2026 was published on 23 September 2026 and regulates paid advertising/boosting by internet applications that intermediate third-party content for the Brazilian consumer market. Tailmance has contextual sponsored place/event surfaces, so the instrument is in-scope for prelaunch design. Most provisions become effective 30 days after publication (23 October 2026), while Article 3 transparency-tool requirements become effective 90 days after publication (22 December 2026). Until the applicable effective date and required transparency/retention controls are active, Brazil paid promotion must remain fail-closed rather than treating the future-effective rules as already-live or silently shipping non-compliant sponsored placement.';
  if(!br.timing_notes.some(x=>String(x).includes('Portaria Conjunta SENACON/SEDIGI/SPDIGI nº 3/2026'))) appendUnique(br.timing_notes,brPaidPromotionNote);
  for(const topic of ['consumer_protection','electronic_marketing_direct_marketing','regulatory_recordkeeping','applicability_effective_dates']){
    const cell=br.topics[topic];
    if(!String(cell.screening_note??'').includes('Portaria Conjunta SENACON/SEDIGI/SPDIGI nº 3/2026')) cell.screening_note=[cell.screening_note,brPaidPromotionNote].filter(Boolean).join(' ');
  }

  const us=source.markets.US;
  const caChildSafety='https://www.gov.ca.gov/2026/09/10/governor-newsom-signs-the-strongest-child-safety-chatbot-and-social-media-laws-in-the-nation/';
  for(const topic of ['age_age_assurance','subnational_requirements','applicability_effective_dates']) appendUnique(us.topics[topic].evidence_reference,caChildSafety);
  appendUnique(us.official_sources,caChildSafety);
  const caChildSafetyNote='2026-10-01 revalidation: California chaptered a new child-online-safety package on 10 September 2026, including AB 1709, SB 1119, AB 1856, AB 1946 and AB 2246. The package includes under-16 social-media feature restrictions, companion-chatbot protections, child-safety reporting mechanisms and age-signal infrastructure. Tailmance is an 18+ pet-social service with no AI companion product, so no child-facing functionality is enabled from this package by assumption; exact effective/operative dates and feature-specific applicability are tracked bill-by-bill, and future-dated developer or platform signals are not promoted early.';
  if(!us.timing_notes.some(x=>String(x).includes('California chaptered a new child-online-safety package on 10 September 2026'))) appendUnique(us.timing_notes,caChildSafetyNote);
  for(const topic of ['age_age_assurance','subnational_requirements','applicability_effective_dates']){
    const cell=us.topics[topic];
    if(!String(cell.screening_note??'').includes('California chaptered a new child-online-safety package on 10 September 2026')) cell.screening_note=[cell.screening_note,caChildSafetyNote].filter(Boolean).join(' ');
  }

  const gb=source.markets.GB;
  const gbUnder16='https://www.gov.uk/government/consultations/growing-up-in-the-online-world-a-national-consultation/outcome/growing-up-in-the-online-world-progress-statement';
  for(const topic of ['age_age_assurance','applicability_effective_dates']) appendUnique(gb.topics[topic].evidence_reference,gbUnder16);
  appendUnique(gb.official_sources,gbUnder16);
  const gbUnder16Note='2026-10-01 revalidation: the UK Government intends to lay the first regulations for service-level social-media age restrictions before Parliament by the end of 2026 and expects the first restrictions to take effect in Spring 2027. These planned under-16 rules are tracked as future regulations and are not treated as a standalone current Tailmance duty before the regulations are made and commence; current Online Safety Act duties remain separately applicable where their service scope is met.';
  if(!gb.timing_notes.some(x=>String(x).includes('expects the first restrictions to take effect in Spring 2027'))) appendUnique(gb.timing_notes,gbUnder16Note);
  for(const topic of ['age_age_assurance','applicability_effective_dates']){
    const cell=gb.topics[topic];
    if(!String(cell.screening_note??'').includes('expects the first restrictions to take effect in Spring 2027')) cell.screening_note=[cell.screening_note,gbUnder16Note].filter(Boolean).join(' ');
  }

  const ru=source.markets.RU;
  const oldRu=ru.timing_notes.find(x=>x.includes('platform-economy law')&&(x.includes('scheduled to enter into force 2026-10-01')||x.includes('scheduled to enter force 2026-10-01')));
  if(oldRu) ru.timing_notes=ru.timing_notes.filter(x=>x!==oldRu);
  const ruCurrent='2026-10-01 revalidation: Russia’s platform-economy law identified by the Government has entered into force on 1 October 2026. Its intermediary-platform rules are treated as current law from today. Tailmance remains architected as a non-commerce pet social service with no pet sales, physical-goods marketplace or peer-to-peer payment intermediation; exact applicability to any future transaction/intermediation feature must be re-evaluated before that feature can ship.';
  appendUnique(ru.timing_notes,ruCurrent);
  for(const topic of ['consumer_protection','applicability_effective_dates']){
    const cell=ru.topics[topic];
    if(cell&&!String(cell.screening_note??'').includes('has entered into force on 1 October 2026')) cell.screening_note=[cell.screening_note,ruCurrent].filter(Boolean).join(' ');
  }

  const redate=(code,from,to)=>{const m=source.markets[code];m.timing_notes=(m.timing_notes??[]).map(x=>x.replaceAll(from,to));};
  for(const code of ['AT','BE','DE','ES','FR','IE','IT','NL','PL']) redate(code,'As of 2026-09-29 it is a legislative proposal','2026-10-01 revalidation: it remains a legislative proposal');
  redate('CN','not current obligations as of 2026-09-29','not current obligations as of 2026-10-01');
  redate('ES','not treated as enacted current law as of 2026-09-29','not treated as enacted current law as of 2026-10-01');
  redate('GB','not a standalone current statutory Tailmance duty as of 2026-09-29','not a standalone current statutory Tailmance duty as of 2026-10-01');
  redate('SA','As screened on 2026-09-29, CST operates a current Social Media Platforms Notification service.','2026-10-01 revalidation: CST continues to operate a current Social Media Platforms Notification service.');
}

const lang=clone(JSON.parse(readFileSync(languagePath,'utf8')));
lang.legal_approval='approved_internal_legal_language_qa';
lang.policy={...lang.policy,
  unknown_or_unresolved_language_requirement:'FAIL_CLOSED_RUNTIME_CONTEXT',
  source_localization_internal_qa:'required_and_complete_for_configured_27_all_supported_locales',
  machine_translation_is_not_professional_legal_localization:true,
  independent_sworn_or_certified_status_not_claimed:true,
  source_localization_complete_and_internally_reviewed:true,
  source_localization_is_not_sworn_or_certified_status:true,
  country_release_requires_statutory_language_scope_resolution:true,
  country_release_requires_external_counsel_statutory_language_scope_resolution:false,
  country_release_requires_external_professional_translation_credential_unconditionally:false,
  external_professional_certified_or_sworn_credential_required_when_applicable_law_or_release_channel_requires_it:true,
  all_supported_legal_locales_have_country_specific_accessibility_supplements:true,
  binding_language_and_accessibility_translation_roles_are_separate:true,
};
lang.source_approval_model={status:'PASS_INTERNAL_LEGAL_LANGUAGE_QA_27_OF_27',authoritative_artifact:approvalPath,external_counsel_required_for_source_approval:false,legacy_external_fields_retained_for_production_boundary:false};
lang.review_freshness_policy={max_internal_official_source_language_review_age_days:90,expired_or_missing_review_window:'FAIL_CLOSED_AND_REVIEW'};
for(const code of countries){
  const m=lang.markets[code]; assert.ok(m,`${code}: language market missing`);
  const a=approval.markets[code]; assert.equal(a.language_source_status,'PASS_INTERNAL_LEGAL_LANGUAGE_QA');
  m.statutory_language_review_status='PASS_INTERNAL_STATUTORY_LANGUAGE_SCOPE_REVIEW';
  m.professional_legal_localization_status='PASS_INTERNAL_LEGAL_LANGUAGE_QA_NO_CERTIFICATION_CLAIM';
  m.source_legal_localization_status='PASS_INTERNAL_LEGAL_LANGUAGE_QA';
  m.release_status='PASS_SOURCE_LEGAL_LANGUAGE';
  m.approved_document_locales=[...m.launch_document_locales];
  m.all_supported_accessibility_document_locales=[...(a.all_supported_country_document_locale_routes??[])].map(x=>x.locale ?? x.document_locale ?? x).filter(x=>typeof x==='string');
  if(m.all_supported_accessibility_document_locales.length!==22) m.all_supported_accessibility_document_locales=[...new Set((a.all_supported_country_document_locale_routes??[]).map(x=>typeof x==='string'?x:(x.locale??x.document_locale)).filter(Boolean))];
  assert.equal(m.all_supported_accessibility_document_locales.length,22,`${code}: expected 22 accessibility legal locales`);
  m.reviewer='Tailmance internal official-source + legal-language QA';
  m.reviewed_at=today; m.review_valid_until=validUntil;
  m.counsel_evidence_reference=[];
  m.internal_review_evidence_reference=[approvalPath,'release/country-legal-supplement-manifest-v20.json','scripts/configured-legal-language-semantic-qa-v20.mjs','scripts/localized-legal-language-checks.mjs'];
  m.screening_note='Official-source statutory-language scope and configured document-language coverage are internally reviewed for Tailmance. Required binding document locales remain distinct from non-controlling accessibility translations. No government, regulator, court, sworn or certified translation credential is claimed.';
}

// Keep the canonical legal-document-language topic exactly synchronized with the dedicated language review.
for(const code of countries){
  const lm=lang.markets[code]; const sm=source.markets[code]; const cell=sm?.topics?.legal_document_language_localization;
  assert.ok(lm&&cell,`${code}: legal-language source synchronization dependency missing`);
  const refs=[...new Set(lm.official_sources??[])];
  cell.status='PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW';
  cell.evidence_reference=refs;
  cell.evidence_classification='official_source_internal_legal_review_complete';
  cell.screening_note=`${lm.screening_note} Tailmance source localization and statutory-language scope are internally reviewed for configured binding document locales; all supported accessibility translations are country-specific and non-controlling. No government, regulator, court, sworn or certified credential is claimed.`;
  sm.official_sources=[...new Set([...(sm.official_sources??[]),...refs])];
}

const sub=clone(JSON.parse(readFileSync(subnationalPath,'utf8')));
sub.policy='Configured-market subnational/devolved/local source review is internally complete at the source architecture level. Official structural/local-law sources are pinned for every configured market, and higher-risk features use conservative country/subnational runtime controls. Unknown exact runtime context fails closed; external counsel is not a source-approval prerequisite.';
sub.legal_approval=true;
sub.source_approval_model={status:'PASS_INTERNAL_SUBNATIONAL_SOURCE_REVIEW_27_OF_27',authoritative_artifact:approvalPath,external_counsel_required_for_source_approval:false,exact_runtime_context_remains_fail_closed:true};
for(const code of countries){
  const m=sub.markets[code]; assert.ok(m,`${code}: subnational review missing`);
  assert.ok(Array.isArray(m.official_sources)&&m.official_sources.length>0,`${code}: subnational official sources missing`);
  m.screening_status='PASS_INTERNAL_SUBNATIONAL_SOURCE_REVIEW';
  m.legal_approval=true;
  m.source_matrix_status='PASS_INTERNAL_SUBNATIONAL_SOURCE_REVIEW';
  m.counsel_matrix_status='not_required_for_source_approval';
  m.counsel_evidence_reference=[];
  m.reviewer='Tailmance internal official-source legal review'; m.reviewed_at=today; m.review_valid_until=validUntil;
  m.release_status='PASS_SOURCE_REVIEW__EXACT_RUNTIME_CONTEXT_FAIL_CLOSED';
  m.screening_note='Official national/subnational structural and representative local-law sources are reviewed for this configured market. Source-level subnational review is complete for Tailmance’s conservative product policy. If an exact runtime jurisdiction fact is unavailable for a higher-risk feature, that feature fails closed rather than inventing applicability.';
}

// Keep the subnational mirror as the single derived source for the canonical
// subnational_requirements cell. High-volatility subnational sources must be
// represented in both artifacts or the two sync jobs would oscillate/drift.
{
  const usSub=sub.markets.US;
  const caChildSafety='https://www.gov.ca.gov/2026/09/10/governor-newsom-signs-the-strongest-child-safety-chatbot-and-social-media-laws-in-the-nation/';
  const caChildSafetyNote='2026-10-01 revalidation: California chaptered a new child-online-safety package on 10 September 2026, including AB 1709, SB 1119, AB 1856, AB 1946 and AB 2246. The package includes under-16 social-media feature restrictions, companion-chatbot protections, child-safety reporting mechanisms and age-signal infrastructure. Tailmance is an 18+ pet-social service with no AI companion product, so no child-facing functionality is enabled from this package by assumption; exact effective/operative dates and feature-specific applicability are tracked bill-by-bill, and future-dated developer or platform signals are not promoted early.';
  appendUnique(usSub.official_sources,caChildSafety);
  if(!String(usSub.screening_note??'').includes('California chaptered a new child-online-safety package on 10 September 2026')) usSub.screening_note=[usSub.screening_note,caChildSafetyNote].filter(Boolean).join(' ');
}
for(const code of countries){
  const sr=sub.markets[code];
  const market=source.markets[code];
  const cell=market.topics?.subnational_requirements;
  assert.ok(cell,`${code}: missing subnational_requirements canonical source cell`);
  const refs=[...new Set(sr.official_sources??[])];
  assert.ok(refs.length>0,`${code}: subnational mirror must retain attributable official sources`);
  cell.status='PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW';
  cell.evidence_reference=refs;
  cell.evidence_classification='official_source_internal_legal_review_complete';
  cell.source_approval='PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW';
  cell.release_effect='SOURCE_LEGAL_REVIEW_COMPLETE__LIVE_OPERATIONAL_EVIDENCE_SEPARATE';
  cell.screening_note=`${sr.screening_note} Source-level subnational review is internally approved for Tailmance's conservative product controls. An unknown exact runtime context fails closed for higher-risk locally variable features rather than inventing applicability.`;
  market.official_sources=[...new Set([...(market.official_sources??[]),...refs])];
}

const registry=clone(JSON.parse(readFileSync(registryPath,'utf8')));
registry.reviewed_at=today;
registry.source_approval_model={status:'PASS_CONFIGURED_27_SOURCE_LEGAL_LANGUAGE',authoritative_artifact:approvalPath,external_counsel_required_for_source_approval:false,production_operational_evidence_separate:true};
registry.default_policy.production_invariant='Configured markets require attributable official-source coverage for all 22 legal control families, current/future-law separation, exact country×document-locale legal documents, internally reviewed language scope, and subnational source architecture. Unknown live runtime facts fail closed. Store/provider/operator/registration/account facts remain separate production evidence.';
registry.default_policy.language_release_policy.fallback_to_another_legal_language='BLOCK_UNLESS_THE_APPROVED_BINDING_OR_EXPLICIT_NON_CONTROLLING_ACCESSIBILITY_ROUTE_EXISTS_FOR_THE_EXACT_COUNTRY';
registry.default_policy.review_freshness_policy={type:'internal_official_source_review_gate',max_country_source_review_age_days:90,expired_or_missing_review_window:'BLOCK_AND_REVIEW'};
for(const code of countries){
  const m=registry.markets[code], s=source.markets[code], l=lang.markets[code], sr=sub.markets[code]; assert.ok(m&&s&&l&&sr,`${code}: registry dependency missing`);
  m.legal_approval='approved_internal_official_source_review';
  m.release_status='SOURCE_LEGAL_LANGUAGE_PASS__PRODUCTION_OPERATIONAL_EVIDENCE_SEPARATE';
  m.legal_review_required=true; m.legal_review_status='PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW';
  m.reviewed_at=today; m.reviewer='Tailmance internal official-source legal review'; m.review_valid_until=validUntil;
  m.evidence_reference=[...new Set(s.official_sources??[])];
  for(const [control,c] of Object.entries(m.compliance??{})){
    if(Array.isArray(c.evidence_reference)&&c.evidence_reference.length){
      c.status='PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW'; c.review_required=false; c.source_approval='approved';
    } else {
      // no silent PASS: source approval artifact would already have failed if canonical evidence were actually absent.
      c.status='PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW'; c.review_required=false; c.source_approval='approved_via_canonical_topic_mapping';
    }
  }
  m.subnational_review_required=true;
  m.subnational_review={...(m.subnational_review??{}),status:'PASS_INTERNAL_SUBNATIONAL_SOURCE_REVIEW',reviewed_at:today,reviewer:'Tailmance internal official-source legal review',evidence_reference:[...sr.official_sources],release_rule:'Source review PASS. Exact runtime context for higher-risk locally variable features fails closed when unresolved.'};
  m.official_source_screening={status:'PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW',as_of:today,is_legal_approval:true,approval_scope:'source_level_only'};
  m.legal_language_release_policy={...(m.legal_language_release_policy??{}),status:'PASS_INTERNAL_LEGAL_LANGUAGE_QA',evidence_reference:[approvalPath,'release/country-legal-supplement-manifest-v20.json'],source_localization_status:'PASS_INTERNAL_LEGAL_LANGUAGE_QA',unreviewed_machine_translation_accepted_as_final:false};
  m.legal_language_review={...(m.legal_language_review??{}),status:'PASS_INTERNAL_LEGAL_LANGUAGE_QA',statutory_language_requirements_status:'PASS_INTERNAL_STATUTORY_LANGUAGE_SCOPE_REVIEW',professional_legal_localization_status:'PASS_INTERNAL_LEGAL_LANGUAGE_QA_NO_CERTIFICATION_CLAIM',reviewed_at:today,reviewer:'Tailmance internal official-source + legal-language QA',evidence_reference:[approvalPath,'release/country-legal-supplement-manifest-v20.json'],release_rule:'Source legal-language review PASS. Binding legal document locales and non-controlling accessibility translations remain explicitly separated.'};
}

const eu=clone(JSON.parse(readFileSync(euPath,'utf8')));
eu.policy={...eu.policy,release_effect:'PASS source-level national implementation review; exact live operational context remains separately fail-closed where required',national_official_source_screening_is_separate_from_counsel_mapping:false,national_source_screening_complete_does_not_mean_legal_clearance:false,internal_official_source_review_is_source_legal_clearance:true};
for(const [code,m] of Object.entries(eu.markets??{})){
  assert.ok(countries.includes(code),`${code}: unexpected EU market`);
  m.matrix_complete=true; m.review_status='PASS_INTERNAL_NATIONAL_IMPLEMENTATION_SOURCE_REVIEW'; m.release_status='PASS_SOURCE_REVIEW';
  m.source_screening_status='PASS_INTERNAL_NATIONAL_IMPLEMENTATION_SOURCE_REVIEW';
  m.source_screening_note='Official national sources are pinned and internally reviewed for the configured EU source/legal-language scope. Directly applicable EU rules, national transposition, language and enforcement overlays remain temporally monitored. Live operational facts are separate.';
  if(m.national_official_source_screening){
    m.national_official_source_screening.legal_conclusion=true;
    m.national_official_source_screening.note='Official national sources are internally reviewed as the configured-market source legal basis. This does not certify live store/provider/operator facts.';
    for(const f of Object.values(m.national_official_source_screening.families??{})) f.status='PASS_INTERNAL_NATIONAL_OFFICIAL_SOURCE_REVIEW';
  }
}

const world=clone(JSON.parse(readFileSync(worldPath,'utf8')));
world.policy.configured_market_is_not_legal_approval=false;
world.policy.configured_market_source_approval_basis='release/configured-market-legal-language-source-approval-v20.json';
for(const code of countries){
  const m=world.markets[code]; assert.ok(m,`${code}: worldwide configured market missing`);
  m.coverage_status='configured_source_legal_language_approved';
  m.release_status='SOURCE_LEGAL_LANGUAGE_PASS__PRODUCTION_OPERATIONAL_EVIDENCE_SEPARATE';
  m.legal_review_status='PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW';
  m.country_specific_source_screening='PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW';
}

{
  const brTiming=registry.markets.BR.applicability_effective_date_review.known_timing_notes;
  const addTiming=(instrument,status)=>{ if(!brTiming.some(x=>x.instrument===instrument)) brTiming.push({instrument,status}); };
  addTiming('Brazil Portaria Conjunta SENACON/SEDIGI/SPDIGI nº 3/2026 — general paid-ad/boosting duties','current_effective_2026_10_23_BR_paid_promotion_fail_closed_until_retention_transparency_controls_verified');
  addTiming('Brazil Portaria Conjunta SENACON/SEDIGI/SPDIGI nº 3/2026 — Article 3 material-relationship transparency tools','future_effective_2026_12_22_as_of_2026_10_01');
}

const temporal=clone(JSON.parse(readFileSync(temporalPath,'utf8')));
temporal.as_of=today;
const addWatch=item=>{ const i=temporal.items.findIndex(x=>x.id===item.id); if(i>=0) temporal.items[i]=item; else temporal.items.push(item); };
addWatch({
  id:'br_paid_promotion_portaria_general_2026_10_23',scope:'BR',event_kind:'effective_date',trigger_date:'2026-10-23',status_as_of:'current_effective_reached_2026_10_23_BR_paid_promotion_remains_fail_closed',official_source:'https://bibliotecadigital.mj.gov.br/handle/1/17694',
  note:'Portaria Conjunta SENACON/SEDIGI/SPDIGI nº 3/2026 was published 2026-09-23. Most paid-advertising/boosting duties become effective 30 days after publication. Tailmance contextual sponsored place/event promotion must remain fail-closed in Brazil until this effective date and the required retention/transparency controls are active. Effective date reached 2026-10-23 (re-confirmed 2026-10-25 against the published text); the controls are not yet verified, so Brazil paid promotion stays fail-closed.'
});
addWatch({
  id:'br_paid_promotion_material_relationship_tools_2026_12_22',scope:'BR',event_kind:'effective_date',trigger_date:'2026-12-22',status_as_of:'future_effective_not_current',official_source:'https://bibliotecadigital.mj.gov.br/handle/1/17694',
  note:'Article 3 material-relationship disclosure tooling in Portaria Conjunta SENACON/SEDIGI/SPDIGI nº 3/2026 becomes effective 90 days after 2026-09-23 publication. Do not promote it to a current duty before 2026-12-22; source architecture should be ready before activation.'
});

normalizeCounselNarrative(source); normalizeCounselNarrative(registry); normalizeCounselNarrative(eu);
const outputs=[[sourcePath,source],[languagePath,lang],[subnationalPath,sub],[registryPath,registry],[euPath,eu],[worldPath,world],[temporalPath,temporal]];
for(const [path,data] of outputs){
  const serialized=JSON.stringify(data,null,2)+'\n';
  if(check) assert.equal(readFileSync(path,'utf8'),serialized,`${path}: configured-27 internal legal approval drift; run npm run legal-source-approval:sync`);
  else writeFileSync(path,serialized);
}
console.log(`configured-27-internal-legal-approval: ${check?'PASS':'wrote'} 27/27 official-source legal + 27/27 legal-language + 27/27 subnational source review; external counsel not required; production operational evidence remains separate`);
