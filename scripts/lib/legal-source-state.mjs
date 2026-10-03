import assert from 'node:assert/strict';

export const EVIDENCE_CLASSIFICATIONS = Object.freeze({
  OFFICIAL: 'official_source_internal_legal_review_complete',
  LANGUAGE_POLICY: 'internal_legal_language_policy_review_complete',
  SUBNATIONAL_COUNSEL: 'subnational_runtime_context_requires_fail_closed_resolution',
  TOPIC_GAP: 'topic_specific_official_source_presence_gap',
});


export const CANONICAL_CONTROL_TOPIC_MAPPING = Object.freeze({
  privacy: Object.freeze(['privacy_data_protection']),
  consumer: Object.freeze(['consumer_protection']),
  age: Object.freeze(['age_age_assurance']),
  ugc_moderation: Object.freeze(['ugc_moderation_appeals']),
  subscription_iap: Object.freeze(['subscription_iap_auto_renewal']),
  international_transfer: Object.freeze(['international_data_transfers']),
  data_localization: Object.freeze(['data_localization']),
  representative_requirement: Object.freeze(['representative_requirement']),
  store_platform_obligations: Object.freeze(['store_platform_obligations']),
  animal_welfare: Object.freeze(['animal_welfare']),
  breeding_mating: Object.freeze(['breeding_mating']),
  pet_commerce: Object.freeze(['pet_commerce_restrictions']),
  subnational_requirements: Object.freeze(['subnational_requirements']),
  applicability_effective_dates: Object.freeze(['applicability_effective_dates']),
  electronic_marketing_push: Object.freeze(['electronic_marketing_direct_marketing']),
  legal_document_language: Object.freeze(['legal_document_language_localization']),
  digital_accessibility: Object.freeze(['digital_accessibility']),
  operator_identity_tax_invoicing: Object.freeze(['operator_identity_tax_invoicing']),
  ip_notice_takedown: Object.freeze(['intellectual_property_notice_takedown']),
  cybersecurity_breach_notification: Object.freeze(['cybersecurity_breach_notification']),
  regulatory_recordkeeping: Object.freeze(['regulatory_recordkeeping']),
  sanctions_payments_distribution: Object.freeze(['sanctions_payments_distribution']),
});

export const CANONICAL_CONTROL_FAMILIES = Object.freeze(Object.keys(CANONICAL_CONTROL_TOPIC_MAPPING));

export const CRITICAL_LEGAL_SUBDIMENSION_TOPIC_MAPPING = Object.freeze({
  child_online_safety_emergency_reporting: Object.freeze(['age_age_assurance','ugc_moderation_appeals','regulatory_recordkeeping']),
  csam_reporting_preservation: Object.freeze(['ugc_moderation_appeals','regulatory_recordkeeping']),
  targeted_ads_dark_patterns: Object.freeze(['consumer_protection','privacy_data_protection','age_age_assurance','electronic_marketing_direct_marketing']),
  recommender_algorithmic_safety: Object.freeze(['age_age_assurance','ugc_moderation_appeals','consumer_protection']),
  precise_location_sensitive_data: Object.freeze(['privacy_data_protection']),
  age_assurance_vendor_privacy_biometrics: Object.freeze(['age_age_assurance','privacy_data_protection','international_data_transfers']),
  automated_moderation_explanations_appeals: Object.freeze(['ugc_moderation_appeals']),
  automated_significant_decision_human_intervention: Object.freeze(['privacy_data_protection','ugc_moderation_appeals']),
  platform_registration_representative_licensing: Object.freeze(['representative_requirement','operator_identity_tax_invoicing','applicability_effective_dates']),
  regulator_notice_response_preservation: Object.freeze(['ugc_moderation_appeals','cybersecurity_breach_notification','regulatory_recordkeeping','applicability_effective_dates']),
  moderation_statement_of_reasons: Object.freeze(['ugc_moderation_appeals']),
  internal_complaint_out_of_court_redress: Object.freeze(['ugc_moderation_appeals','consumer_protection']),
  trusted_flagger_priority: Object.freeze(['ugc_moderation_appeals']),
  platform_transparency_reporting_reason_database: Object.freeze(['ugc_moderation_appeals','regulatory_recordkeeping']),
  terms_restriction_transparency: Object.freeze(['ugc_moderation_appeals','consumer_protection']),
  advertising_commercial_communications_transparency: Object.freeze(['consumer_protection','electronic_marketing_direct_marketing','privacy_data_protection']),
});

export const CRITICAL_LEGAL_SUBDIMENSIONS = Object.freeze(Object.keys(CRITICAL_LEGAL_SUBDIMENSION_TOPIC_MAPPING));

export function criticalSubdimensionEvidenceForMarket(sourceMarket) {
  const out = {};
  for (const [subdimension, topics] of Object.entries(CRITICAL_LEGAL_SUBDIMENSION_TOPIC_MAPPING)) {
    const refs = new Set();
    const topicStatuses = {};
    for (const topic of topics) {
      const review = sourceMarket?.topics?.[topic];
      assert.ok(review, `source market missing critical-subdimension topic ${topic} for ${subdimension}`);
      topicStatuses[topic] = review.status ?? 'missing_status';
      for (const ref of review.evidence_reference ?? []) {
        if (typeof ref === 'string' && ref.trim()) refs.add(ref.trim());
      }
    }
    out[subdimension] = {
      mapped_topics: topics,
      topic_statuses: topicStatuses,
      evidence_reference: [...refs],
      source_evidence_present: refs.size > 0,
      status: refs.size > 0
        ? 'screened_from_canonical_topics_source_evidence_complete'
        : 'BLOCK_topic_specific_official_source_presence_gap',
    };
  }
  return out;
}

export function deriveCriticalSubdimensionReview(sourceReview) {
  const expected = sourceReview.required_critical_subdimensions ?? [];
  assert.deepEqual(expected, CRITICAL_LEGAL_SUBDIMENSIONS, 'required_critical_subdimensions must exactly match canonical mapping');
  const markets = {};
  let cells = 0;
  let missing = 0;
  for (const [country, market] of Object.entries(sourceReview.markets ?? {})) {
    const reviews = criticalSubdimensionEvidenceForMarket(market);
    markets[country] = reviews;
    for (const subdimension of CRITICAL_LEGAL_SUBDIMENSIONS) {
      cells += 1;
      if (!reviews[subdimension].source_evidence_present) missing += 1;
    }
  }
  return {
    schema_version: 1,
    generated_at: sourceReview.reviewed_at ?? new Date().toISOString().slice(0,10),
    purpose: 'Derived critical legal subdimension official-source screening matrix for the configured 27 markets. Source evidence completeness feeds the separate v20 internal source-approval artifact; live store/provider/operator/runtime evidence remains a separate production boundary.',
    required_subdimensions: CRITICAL_LEGAL_SUBDIMENSIONS,
    summary: {
      markets_total: Object.keys(markets).length,
      subdimensions_total: CRITICAL_LEGAL_SUBDIMENSIONS.length,
      cells_total: cells,
      missing_source_cells: missing,
      source_evidence_complete: missing === 0,
      source_approval_governed_by: 'release/configured-market-legal-language-source-approval-v20.json',
      production_release_approval_granted: false,
    },
    markets,
  };
}


export function canonicalControlEvidenceForMarket(sourceMarket) {
  const out = {};
  for (const [control, topics] of Object.entries(CANONICAL_CONTROL_TOPIC_MAPPING)) {
    const refs = new Set();
    for (const topic of topics) {
      const review = sourceMarket?.topics?.[topic];
      assert.ok(review, `source market missing mapped topic ${topic} for ${control}`);
      for (const ref of review.evidence_reference ?? []) {
        if (typeof ref === 'string' && ref.trim()) refs.add(ref.trim());
      }
    }
    out[control] = [...refs];
  }
  return out;
}

export function canonicalEvidenceState(sourceReview) {
  const topics = sourceReview.required_topic_families ?? [];
  const markets = sourceReview.markets ?? {};
  assert.ok(Array.isArray(topics) && topics.length > 0, 'required_topic_families must be non-empty');
  assert.ok(markets && typeof markets === 'object' && Object.keys(markets).length > 0, 'markets must be non-empty');

  const classificationCounts = {};
  const topicSpecificGapsByTopic = {};
  const topicSpecificGapsByCountry = {};
  const emptyEvidenceByClassification = {};
  const emptyEvidenceByTopic = {};
  const emptyEvidenceByCountry = {};
  const emptyEvidenceCells = [];
  let cells = 0;

  for (const [country, market] of Object.entries(markets)) {
    for (const topic of topics) {
      const review = market.topics?.[topic];
      assert.ok(review, `${country}/${topic}: missing topic review`);
      cells += 1;
      const classification = review.evidence_classification ?? 'missing_classification';
      classificationCounts[classification] = (classificationCounts[classification] ?? 0) + 1;
      const evidence = Array.isArray(review.evidence_reference) ? review.evidence_reference : [];
      const hasEvidence = evidence.some((value) => typeof value === 'string' && value.trim().length > 0);
      if (!hasEvidence) {
        emptyEvidenceByClassification[classification] = (emptyEvidenceByClassification[classification] ?? 0) + 1;
        emptyEvidenceByTopic[topic] = (emptyEvidenceByTopic[topic] ?? 0) + 1;
        emptyEvidenceByCountry[country] = (emptyEvidenceByCountry[country] ?? 0) + 1;
        emptyEvidenceCells.push({country, topic, review, classification});
        if (classification === EVIDENCE_CLASSIFICATIONS.TOPIC_GAP) {
          topicSpecificGapsByTopic[topic] = (topicSpecificGapsByTopic[topic] ?? 0) + 1;
          topicSpecificGapsByCountry[country] = (topicSpecificGapsByCountry[country] ?? 0) + 1;
        }
      }
    }
  }

  const sortObject = (obj) => Object.fromEntries(Object.entries(obj).sort(([a],[b]) => a.localeCompare(b)));
  const topicSpecificGapCount = Object.values(topicSpecificGapsByTopic).reduce((sum, n) => sum + n, 0);
  const emptyEvidenceCount = emptyEvidenceCells.length;

  return {
    topics,
    markets,
    cells,
    classificationCounts: sortObject(classificationCounts),
    emptyEvidenceCells,
    emptyEvidenceCount,
    emptyEvidenceByClassification: sortObject(emptyEvidenceByClassification),
    emptyEvidenceByTopic: sortObject(emptyEvidenceByTopic),
    emptyEvidenceByCountry: sortObject(emptyEvidenceByCountry),
    topicSpecificGapCount,
    topicSpecificGapsByTopic: sortObject(topicSpecificGapsByTopic),
    topicSpecificGapsByCountry: sortObject(topicSpecificGapsByCountry),
  };
}

export function deriveSourceGapSummary(sourceReview) {
  const state = canonicalEvidenceState(sourceReview);
  return {
    generated_at: sourceReview.reviewed_at ?? new Date().toISOString().slice(0,10),
    topic_cells_total: state.cells,
    classification_counts: state.classificationCounts,
    empty_evidence_cells_total: state.emptyEvidenceCount,
    empty_evidence_by_classification: state.emptyEvidenceByClassification,
    remaining_topic_source_presence_gaps: state.topicSpecificGapCount,
    legacy_remaining_topic_specific_source_or_scope_gaps: state.topicSpecificGapCount,
    legacy_gap_field_semantics: 'Deprecated compatibility field: counts only canonical topic cells missing attributable source evidence; it does not measure unresolved legal scope/applicability.',
    configured_market_count: Object.keys(state.markets).length,
    configured_market_scope: 'explicit_launch_markets_only_not_worldwide_country_coverage',
    worldwide_country_coverage_complete: false,
    unknown_or_unlisted_country_release_effect: 'BLOCK',
    configured_market_source_legal_language_approval_separate_artifact: true,
    source_legal_language_blockers: state.emptyEvidenceCount,
    configured_source_legal_approved_markets: Object.values(state.markets).filter((m) => m.legal_approval === 'approved_internal_official_source_review').length,
    subnational_source_review_complete_markets: Object.values(state.markets).filter((m) => m.subnational_review_required === true && m.screening_status === 'PASS_INTERNAL_OFFICIAL_SOURCE_REVIEW').length,
    exact_runtime_subnational_context_resolution_markets: Object.values(state.markets).filter((m) => m.subnational_review_required === true).length,
    remaining_gaps_by_topic: state.topicSpecificGapsByTopic,
    remaining_gaps_by_country: state.topicSpecificGapsByCountry,
    configured_source_legal_coverage_claim_allowed: state.emptyEvidenceCount === 0 && Object.values(state.markets).every((m) => m.legal_approval === 'approved_internal_official_source_review'),
    full_production_operational_legal_coverage_claim_allowed: false,
    exact_runtime_subnational_context_is_separate_from_source_approval: true,
    interpretation: 'Counts are evidence-state classifications, not counts of legal violations. For the configured 27-market source scope, zero empty/topic-specific cells means the canonical country×topic matrix has attributable official-source evidence. Exact country×legal-language source approval is governed by release/configured-market-legal-language-source-approval-v20.json. Configured source legal review is internally complete for the 27 markets. Exact state/province/territory/region/emirate/local facts that depend on a live user or operating context are runtime inputs rather than source-review gaps; unknown live context fails closed. Live store/provider/operator/runtime facts are separate production evidence and are not source legal-language gaps. Countries outside the configured 27 are out of scope for this source approval.'
  };
}
