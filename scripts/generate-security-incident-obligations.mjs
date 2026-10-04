import fs from 'node:fs';
import crypto from 'node:crypto';

const root = process.cwd();
const read = p => JSON.parse(fs.readFileSync(`${root}/${p}`, 'utf8'));
const source = read('release/official-source-review-v19.json');
const gates = read('release/country-release-gates.json');
const configured = Object.keys(gates.markets).sort();

const generic = code => ({
  authority_or_route: 'Use the competent privacy/cybersecurity authority and reporting route identified by the approved country/subnational incident matrix after applicability confirmation.',
  authority_notification: {
    deadline: 'country_specific_trigger_and_deadline_resolved_from_internal_official_source_incident_matrix',
    trigger: 'Determine the applicable controller/network-operator/sector rule from the approved incident matrix; source screening alone does not start or resolve the legal clock.'
  },
  data_subject_notification: {
    deadline: 'country_specific_trigger_and_deadline_resolved_from_internal_official_source_incident_matrix',
    trigger: 'Notify affected data subjects only under the applicable threshold and timing confirmed for the incident and jurisdiction.'
  },
  recordkeeping: {
    minimum: 'Preserve a complete incident decision record, evidence, containment/remediation actions, regulator/user notices and legal-clock analysis; any statutory minimum remains subject to the approved country/subnational matrix.',
    retention_period: 'country_specific_minimum_resolved_from_internal_official_source_retention_matrix'
  },
  special_cyber_reporting: 'Assess privacy-breach duties separately from cybersecurity/sector reporting duties; do not assume one filing satisfies another.',
  conditional_scope: `Tailmance production use in ${code} remains fail-closed until controller/processor, establishment, data-subject, sector and any subnational/special-jurisdiction applicability are approved.`
});

const eu72 = {
  authority_or_route: 'Route to the competent GDPR supervisory authority determined by establishment/lead-authority analysis.',
  authority_notification: {
    deadline: '72_hours_where_feasible_after_awareness',
    trigger: 'GDPR Article 33 personal-data breach likely to result in a risk to natural persons; if later than 72 hours, reasons for delay accompany the notification.'
  },
  data_subject_notification: {
    deadline: 'without_undue_delay_when_high_risk',
    trigger: 'GDPR Article 34 high-risk threshold, subject to statutory exceptions.'
  },
  recordkeeping: {
    minimum: 'Document every personal-data breach, its facts, effects and remedial action so the supervisory authority can verify compliance.',
    retention_period: 'controller_accountability_period_pending_approved_retention_schedule'
  },
  special_cyber_reporting: 'Evaluate NIS2/national cybersecurity/sector reporting separately where Tailmance or a provider falls within scope.'
};

const overrides = {
  AT: eu72, BE: eu72, DE: eu72, ES: eu72, FR: eu72, IE: eu72, IT: eu72, NL: eu72, PL: eu72,
  GB: {
    authority_or_route: 'UK Information Commissioner’s Office (ICO), subject to UK GDPR applicability and any sector overlays.',
    authority_notification: {deadline:'72_hours_where_feasible_after_awareness', trigger:'UK GDPR reportable personal-data breach threshold.'},
    data_subject_notification: {deadline:'without_undue_delay_when_high_risk', trigger:'UK GDPR high-risk threshold, subject to exceptions.'},
    recordkeeping:{minimum:'Document all personal-data breaches, including facts, effects and remedial action.', retention_period:'controller_accountability_period_pending_approved_retention_schedule'},
    special_cyber_reporting:'Evaluate UK cybersecurity/sector incident-reporting duties separately where applicable.'
  },
  TR: {
    authority_or_route:'Kişisel Verileri Koruma Kurumu / Kişisel Verileri Koruma Kurulu breach-notification route under Board Decision 2019/10.',
    authority_notification:{deadline:'72_hours_after_learning_of_breach', trigger:'Where processed personal data is obtained by others through unlawful means; notify without delay and no later than 72 hours after learning of the breach.'},
    data_subject_notification:{deadline:'as_soon_as_reasonably_possible_after_affected_people_are_identified', trigger:'Notify affected data subjects directly where contactable, otherwise by an appropriate method such as website publication.'},
    recordkeeping:{minimum:'Record breach facts, effects, measures, reporting decisions and evidence and keep them ready for Authority review.', retention_period:'approved_KVKK_retention_schedule_required'},
    special_cyber_reporting:'Assess sector/cybersecurity reporting independently from KVKK Board Decision 2019/10.'
  },
  BR: {
    authority_or_route:'Autoridade Nacional de Proteção de Dados (ANPD) security-incident communication route under Resolution CD/ANPD 15/2024.',
    authority_notification:{deadline:'3_business_days_for_qualifying_incidents', trigger:'Security incident that may cause relevant risk or damage to data subjects, subject to the regulation and any specific-law exception.'},
    data_subject_notification:{deadline:'3_business_days_for_qualifying_incidents', trigger:'Same qualifying relevant-risk/damage threshold, with required clear communication to affected data subjects.'},
    recordkeeping:{minimum:'Keep a record of every personal-data security incident, including incidents not notified.', retention_period:'at_least_5_years'},
    special_cyber_reporting:'Evaluate sector-specific or cybersecurity duties separately from the ANPD incident communication regime.'
  },
  CA: {
    authority_or_route:'Office of the Privacy Commissioner of Canada for the federal PIPEDA layer; separately resolve Alberta, British Columbia, Quebec and other provincial/private-sector overlays.',
    authority_notification:{deadline:'as_soon_as_feasible_for_PIPEDA_reportable_breach', trigger:'Federal PIPEDA real-risk-of-significant-harm threshold, if PIPEDA applies; provincial rules may differ.'},
    data_subject_notification:{deadline:'as_soon_as_feasible_for_PIPEDA_reportable_breach', trigger:'Notify affected individuals under the federal significant-harm threshold, subject to applicable provincial law.'},
    recordkeeping:{minimum:'Keep a record of every breach of security safeguards, including non-reportable breaches.', retention_period:'24_months_from_determination'},
    special_cyber_reporting:'Resolve federal/provincial privacy and any sector cybersecurity duties independently; do not treat PIPEDA as a complete Canada matrix.'
  },
  AU: {
    authority_or_route:'Office of the Australian Information Commissioner (OAIC) under the Notifiable Data Breaches scheme, subject to Privacy Act coverage and any state/sector overlay.',
    authority_notification:{deadline:'as_soon_as_practicable_after_eligible_breach_is_confirmed', trigger:'A suspected eligible data breach must be assessed reasonably and expeditiously, with all reasonable steps taken to complete the assessment within 30 calendar days.'},
    data_subject_notification:{deadline:'as_soon_as_practicable_after_eligible_breach_is_confirmed', trigger:'Notify individuals at risk of serious harm where the eligible-breach threshold is met and no exception/remedial-action exclusion applies.'},
    recordkeeping:{minimum:'Preserve assessment, eligibility, remedial-action and notification evidence under the approved incident runbook.', retention_period:'approved_AU_retention_schedule_required'},
    special_cyber_reporting:'Assess Security of Critical Infrastructure and sector-specific cyber reporting separately if Tailmance or a provider becomes in scope.'
  },
  CN: {
    authority_or_route:'Personal-information protection authorities under PIPL plus the competent provincial cyberspace administration route under the National Cybersecurity Incident Reporting Measures where applicable.',
    authority_notification:{deadline:'4_hours_for_qualifying_incidents_of_other_network_operators_under_CAC_measures; PIPL_requires_immediate_remedial_action_and_notification_when_personal_information_breach_may_occur_or_occurs', trigger:'The 4-hour clock is conditional on Tailmance being an in-scope network operator and the incident meeting the Measures reporting classification; critical infrastructure and central-state routes can be shorter.'},
    data_subject_notification:{deadline:'PIPL_immediate_notification_unless_effective_measures_avoid_harm_or_authority_requires_notice', trigger:'PIPL Article 57 breach/tampering/loss rules and harm exception; apply the internally reviewed current-law incident matrix to resolve interaction with cyber-incident reporting.'},
    recordkeeping:{minimum:'Preserve incident classification, PIPL remedial actions/notices, CAC reports and evidence; PIPL impact-assessment records have separate minimum retention requirements.', retention_period:'approved_CN_incident_retention_schedule_required'},
    special_cyber_reporting:'CAC 2025 Measures use differentiated 1h/2h/4h routes; Tailmance must not default to 4h without incident-classification and operator-scope confirmation.'
  },
  ID: {
    authority_or_route:'The institution/competent personal-data protection authority route under UU No. 27/2022 Article 46, with the production filing channel confirmed before launch.',
    authority_notification:{deadline:'3_x_24_hours_after_personal_data_protection_failure', trigger:'UU No. 27/2022 Article 46 written notification after a personal-data protection failure; Tailmance must confirm the competent institutional route and any sector overlay for the incident.'},
    data_subject_notification:{deadline:'3_x_24_hours_after_personal_data_protection_failure', trigger:'Article 46 requires written notice to the affected Personal Data Subject and institution, with the minimum statutory content.'},
    recordkeeping:{minimum:'Preserve exposed-data scope, chronology, handling/recovery actions, notices, delivery evidence and incident decision record.', retention_period:'approved_ID_retention_schedule_required'},
    special_cyber_reporting:'Assess Komdigi/BSSN/sector cyber-incident reporting separately; Article 46 privacy notification does not automatically satisfy other cyber duties.'
  },
  TH: {
    authority_or_route:'Thailand Personal Data Protection Committee / Office of the PDPC breach-notification route.',
    authority_notification:{deadline:'72_hours_for_section_37_breach_notification_to_PDPC_office', trigger:'Official PDPC GPPC materials describe Section 37 breach notification to the Office within 72 hours; exact statutory risk threshold/exemptions remain incident-context dependent under the internally reviewed source matrix.'},
    data_subject_notification:{deadline:'risk_threshold_and_timing_resolved_from_current_official_source_incident_matrix', trigger:'Resolve the applicable affected-data-subject notice threshold and timing under the current PDPA/subordinate rules; do not equate the regulator 72-hour route with a universal data-subject deadline.'},
    recordkeeping:{minimum:'Preserve breach assessment, risk determination, PDPC filing, data-subject decision, containment and remediation evidence.', retention_period:'approved_TH_retention_schedule_required'},
    special_cyber_reporting:'Assess Thai cybersecurity/sector reporting independently from PDPA breach notification.'
  },
  AE: {
    authority_or_route:'UAE Data Office/Bureau under Federal Decree-Law No. 45/2021 Article 9 for onshore federal PDPL scope; separately resolve DIFC and ADGM.',
    authority_notification:{deadline:'article_9_period_and_measures_follow_current_executive_regulations_and_incident_context', trigger:'Controller becomes aware of a personal-data breach/violation that would prejudice privacy, confidentiality or security; do not invent a fixed 72-hour federal deadline.'},
    data_subject_notification:{deadline:'article_9_period_and_measures_follow_current_executive_regulations_and_incident_context', trigger:'Article 9 requires affected data-subject notice where the breach would prejudice privacy/confidentiality/security, subject to the applicable measures and timing.'},
    recordkeeping:{minimum:'Preserve breach nature/cause, approximate records/subjects, DPO details, expected effects, corrective actions, investigation and notice evidence.', retention_period:'approved_AE_retention_schedule_required'},
    special_cyber_reporting:'Federal PDPL, DIFC, ADGM and any cybersecurity/sector reporting must be scoped separately.'
  },
  IN: {
    authority_or_route:'CERT-In reporting route under directions issued under section 70B of the IT Act, plus any applicable privacy/data-protection authority route.',
    authority_notification:{deadline:'6_hours_for_CERT_In_enumerated_cyber_incidents', trigger:'Service providers, intermediaries, data centres, body corporate and government organisations must report Annexure-I cyber incidents within six hours of noticing or being brought to notice of them.'},
    data_subject_notification:{deadline:'current_personal_data_notice_duty_from_current_law; future_DPDP_breach_rules_not_yet_in_force_on_2026_10_01', trigger:'CERT-In reporting is not a substitute for any currently applicable data-subject/privacy duty. Do not prematurely apply future DPDP Act/Rules breach duties before their eighteen-month commencement.'},
    recordkeeping:{minimum:'Maintain ICT logs securely for the rolling 180-day CERT-In period where the Directions apply, within India as required by the Directions, and preserve incident/privacy decision evidence under the approved schedule.', retention_period:'CERT_In_180_day_ICT_log_minimum_where_applicable_plus_approved_IN_incident_retention_schedule'},
    special_cyber_reporting:'CERT-In six-hour cyber reporting is the current separate operational clock. DPDP Act sections 3–17 and DPDP Rules 3,5–16 are future-effective eighteen months after the 13 Nov 2025 Gazette publications and are tracked as a future-law watch item, not asserted as current on 30 Sep 2026.',
    temporal_watch:{status:'future_effective_not_current_on_2026_09_30', rule:'DPDP Act sections 3–17 and DPDP Rules 3,5–16', commencement:'eighteen_months_after_13_November_2025_Gazette_publication'}
  },
  RU: {
    authority_or_route:'Roskomnadzor / the authorized personal-data protection authority under Federal Law No. 152-FZ, subject to controller/operator applicability and any parallel cybersecurity duties.',
    authority_notification:{deadline:'24_hours_initial_then_72_hours_internal_investigation_results', trigger:'Federal Law No. 152-FZ Article 21(3.1), introduced by Federal Law No. 266-FZ, requires an initial authority notice within 24 hours after discovering an unlawful or accidental transfer/provision/distribution/access incident that violates data-subject rights, followed within 72 hours by the internal-investigation results and available responsible-person information.'},
    data_subject_notification:{deadline:'separate_data_subject_duty_and_route_from_current_official_source_incident_matrix', trigger:'Do not infer a universal affected-person notice clock from Article 21(3.1); resolve any direct data-subject, sector or cybersecurity notice duty for the incident.'},
    recordkeeping:{minimum:'Preserve discovery chronology, initial 24-hour authority notice, 72-hour internal investigation, containment/remediation, responsible-person findings where available and all internal legal/applicability decisions.', retention_period:'approved_RU_retention_schedule_required'},
    special_cyber_reporting:'Assess personal-data incident notification separately from Russian information-security, critical-information-infrastructure, telecom/platform or other sector reporting duties; the shortest confirmed applicable clock governs operational escalation.'
  },
  JP: {
    authority_or_route:'Personal Information Protection Commission (PPC) leak-reporting route, subject to the APPI reportability categories and sector overlays.',
    authority_notification:{deadline:'preliminary_3_to_5_days_then_final_30_days_or_60_days_for_suspected_malicious_purpose', trigger:'Qualifying leakage etc.; preliminary report promptly, with 3–5 days as the general guideline from discovery.'},
    data_subject_notification:{deadline:'promptly_according_to_incident_circumstances', trigger:'Notify the affected individual where the statutory notification duty applies; permitted alternatives/sector rules require incident-specific review.'},
    recordkeeping:{minimum:'Preserve preliminary/final report content, discovery date, investigation, notices and remediation evidence.', retention_period:'approved_JP_retention_schedule_required'},
    special_cyber_reporting:'Assess sector-specific regulator reporting separately from PPC/APPI duties.'
  },
  KR: {
    authority_or_route:'Personal Information Protection Commission / designated reporting institution under the Personal Information Protection Act and current Enforcement Decree.',
    authority_notification:{deadline:'72_hours_for_qualifying_breach_reports', trigger:'Current Enforcement Decree Article 40 qualifying categories, including threshold/sensitive-or-unique-ID/external-illegal-access cases, subject to exceptions.'},
    data_subject_notification:{deadline:'72_hours_after_becoming_aware_subject_to_current_exceptions', trigger:'Current Enforcement Decree Article 39 notification rule; urgent containment or unavoidable circumstances can affect timing as prescribed.'},
    recordkeeping:{minimum:'Preserve breach determination, containment, notifications/reports and supporting evidence under the approved Korean incident procedure.', retention_period:'approved_KR_retention_schedule_required'},
    special_cyber_reporting:'Evaluate sector/network cybersecurity reporting separately from PIPA breach reporting.'
  },
  SA: {
    authority_or_route:'Saudi Data & AI Authority / National Data Management Office personal-data breach notification service, subject to PDPL applicability.',
    authority_notification:{deadline:'72_hours_after_becoming_aware_for_qualifying_breach', trigger:'Article 24 Implementing Regulation threshold: breach potentially harms personal data/data subject or conflicts with rights or interests.'},
    data_subject_notification:{deadline:'without_undue_delay_when_required_by_PDPL_implementing_regulation', trigger:'Apply the current data-subject notification threshold and content requirements after incident-specific assessment.'},
    recordkeeping:{minimum:'Keep regulator reports, corrective measures and relevant supporting documents/evidence.', retention_period:'approved_SA_retention_schedule_required'},
    special_cyber_reporting:'National Cybersecurity Authority and sector duties may create additional reporting obligations; Article 24 expressly preserves them.'
  },
  SG: {
    authority_or_route:'Personal Data Protection Commission (PDPC) mandatory data-breach notification route.',
    authority_notification:{deadline:'3_calendar_days_after_determining_breach_is_notifiable', trigger:'Notifiable breach under the PDPA; notify as soon as practicable and no later than three calendar days after determination.'},
    data_subject_notification:{deadline:'as_soon_as_practicable_at_same_time_or_after_PDPC_when_required', trigger:'Affected-individual notification applies where the statutory criteria are met.'},
    recordkeeping:{minimum:'Preserve assessment, determination, PDPC/individual notifications, containment and remediation evidence.', retention_period:'approved_SG_retention_schedule_required'},
    special_cyber_reporting:'Assess Cyber Security Act/sector reporting separately where Tailmance or a provider is designated/in scope.'
  },
  TW: {
    authority_or_route:'Ministry of Digital Affairs / central competent authority route under the Cyber Security Management Act incident rules where Tailmance is designated as a specific non-government agency; separately assess personal-data law duties.',
    authority_notification:{deadline:'1_hour_for_in_scope_specific_non_government_agency_cybersecurity_incident', trigger:'The one-hour clock is conditional on Tailmance being an in-scope/designated specific non-government agency and becoming aware of a cyber security incident.'},
    data_subject_notification:{deadline:'personal_data_rule_from_current_official_source_incident_matrix', trigger:'The cybersecurity one-hour report is not a universal personal-data-subject notification deadline.'},
    recordkeeping:{minimum:'Preserve incident reports, classification/review, containment/recovery and personal-data notification decisions.', retention_period:'approved_TW_retention_schedule_required'},
    special_cyber_reporting:'Do not apply the one-hour designated-entity cybersecurity clock unless scope/designation is confirmed.'
  },
  US: {
    authority_or_route:'Use the applicable state/territory attorney general/regulator and affected-individual route; FTC guidance is not a nationwide substitute for state law.',
    authority_notification:{deadline:'state_and_territory_specific', trigger:'Resolve state/territory residence, controller/business role, data type, trigger, regulator/consumer/credit-bureau duties and sector overlays.'},
    data_subject_notification:{deadline:'state_and_territory_specific', trigger:'State/territory and sector rules vary materially; use the approved US subnational breach matrix.'},
    recordkeeping:{minimum:'Preserve state-by-state applicability decisions, notices, regulator/credit-bureau filings and incident evidence.', retention_period:'state_and_territory_specific'},
    special_cyber_reporting:'Evaluate FTC, state, sector and cyber-reporting duties independently; no single federal Tailmance deadline is asserted.'
  },
  VN: {
    authority_or_route:'Use the current Vietnam personal-data protection/cybersecurity route under Law 91/2025/QH15 and Decree 356/2025/ND-CP, with competent-authority route confirmed for the incident.',
    authority_notification:{deadline:'current_authority_route_and_trigger_from_current_official_source_incident_matrix', trigger:'Do not reuse superseded Decree 13/2023 mechanics; apply the current 2026 law/decree and any parallel cybersecurity/consumer reporting duty.'},
    data_subject_notification:{deadline:'72_hours_for_location_or_biometric_breach_and_other_current_qualifying_cases_as_applicable', trigger:'Current rules include a 72-hour affected-data-subject notice for specified personal-location/biometric and other applicable breach contexts; incident scope must be confirmed.'},
    recordkeeping:{minimum:'Preserve incident files, notices, remediation and authority-facing evidence under the current 2026 regime.', retention_period:'at_least_5_years_after_incident_remediation_for_location_or_biometric_breach'},
    special_cyber_reporting:'Vietnam also has cybersecurity/consumer reporting clocks; evaluate them independently and preserve the shortest applicable clock.'
  }
};

const countrySpecificNotes = {
  AE:'Federal UAE screening is not a substitute for DIFC/ADGM/free-zone applicability review.',
  CA:'Federal PIPEDA/OPC screening is not a substitute for Alberta, British Columbia, Quebec or other provincial applicability/notification analysis.',
  DE:'Competent German federal/Länder supervisory-authority routing depends on controller/establishment context.',
  US:'A current state/territory breach matrix is mandatory before US production approval.',
  TW:'The one-hour cybersecurity route is designation/scope dependent and is not asserted as a universal Tailmance privacy-breach deadline.',
  CN:'The four-hour CAC route is incident/operator-class dependent and coexists with PIPL personal-information duties.'
};

const markets = {};
for (const code of configured) {
  const canonical = source.markets?.[code];
  const topic = canonical?.topics?.cybersecurity_breach_notification;
  if (!canonical || !topic) throw new Error(`missing cybersecurity_breach_notification topic for ${code}`);
  const base = generic(code);
  const o = overrides[code] ?? {};
  markets[code] = {
    country_name: canonical.name,
    external_counsel_confirmation_required: false,
    release_effect: topic.release_effect,
    official_source_topic_status: topic.status,
    source_screened_at: canonical.source_screened_at ?? null,
    last_official_source_recheck: canonical.last_official_source_recheck ?? null,
    source_review_valid_until: canonical.source_review_valid_until ?? null,
    official_sources: [...(topic.evidence_reference ?? [])],
    canonical_screening_note: topic.screening_note,
    authority_or_route: o.authority_or_route ?? base.authority_or_route,
    authority_notification: o.authority_notification ?? base.authority_notification,
    data_subject_notification: o.data_subject_notification ?? base.data_subject_notification,
    recordkeeping: o.recordkeeping ?? base.recordkeeping,
    special_cyber_reporting: o.special_cyber_reporting ?? base.special_cyber_reporting,
    ...(o.temporal_watch ? {temporal_watch:o.temporal_watch} : {}),
    conditional_scope: countrySpecificNotes[code] ?? base.conditional_scope,
    operational_controls: [
      'contain_and_preserve_evidence_immediately',
      'classify_data_subjects_data_types_and_incident_severity',
      'identify_controller_processor_operator_sector_and_jurisdiction_scope',
      'start_the_shortest_confirmed_legal_clock_without_waiting_for_full_forensics',
      'escalate_to_privacy_legal_within_internal_target',
      'use_only_the_approved_country_and_subnational_notification_matrix',
      'record_notification_or_non_notification_decision_and_supporting_evidence',
      'complete_post_incident_remediation_and_retention_actions'
    ]
  };
}

const canonicalProjection = JSON.stringify({configured, markets:Object.fromEntries(configured.map(c=>[c,{status:markets[c].official_source_topic_status,sources:markets[c].official_sources}]))});
const out = {
  schema_version: 2,
  reviewed_at: '2026-09-30',
  policy: 'fail_closed',
  purpose: 'Operational security/privacy incident-routing matrix for the 27 configured Tailmance markets, derived from the internally approved official-source legal matrix. It does not claim regulator certification and keeps live incident facts conditional.',
  source_of_truth: 'release/official-source-review-v19.json',
  default_release_effect: 'Source-level incident legal review PASS. At incident time, exact country/subnational context and legal clock are resolved from the current official-source matrix; unknown live facts fail closed.',
  configured_market_count: configured.length,
  internal_response_targets: {
    incident_owner: 'Yekta Özel',
    containment: 'immediate_on_detection',
    evidence_preservation: 'immediate_and_before_destructive_remediation_where_safe',
    privacy_legal_escalation: 'within_60_minutes_of_security_incident_classification',
    clock_rule: 'Legal clocks vary by jurisdiction and may start on awareness, detection, determination, discovery, or a sector-specific event; never assume a universal 72-hour clock.',
    decision_rule: 'Use the shortest applicable clock supported by the current internal official-source incident matrix while incident classification/applicability review runs in parallel; uncertainty never means no notification duty.'
  },
  canonical_projection_sha256: crypto.createHash('sha256').update(canonicalProjection).digest('hex'),
  markets
};

const json = JSON.stringify(out, null, 2) + '\n';
const path = `${root}/release/security-incident-obligations-v19.json`;
if (process.argv.includes('--check')) {
  if (!fs.existsSync(path) || fs.readFileSync(path, 'utf8') !== json) {
    console.error('security incident registry drift; run npm run security-incidents:generate');
    process.exit(1);
  }
  console.log(`security-incident-obligations: CHECK PASS ${configured.length}/${configured.length} configured markets`);
} else {
  fs.writeFileSync(path, json);
  console.log(`security-incident-obligations: wrote ${configured.length}/${configured.length} configured markets`);
}
