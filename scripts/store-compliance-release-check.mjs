import {readFileSync} from 'node:fs';
const x=JSON.parse(readFileSync('release/store-compliance-v19.json','utf8'));
const required={
  apple_age_rating:x.apple_age_rating.console_evidence_status,
  apple_AU_BR_SG_regional_18plus_distribution_review:x.apple_regional_age_assurance_distribution_2026.production_distribution_behavior_status,
  apple_AU_BR_SG_declared_age_range_integration:x.apple_regional_age_assurance_distribution_2026.declared_age_range_production_integration_status,
  apple_AU_regional_age_rating:x.apple_regional_age_rating_updates_2026.australia.console_rating_evidence_status,
  apple_VN_regional_age_rating:x.apple_regional_age_rating_updates_2026.vietnam.console_rating_evidence_status,
  google_iarc:x.google_iarc.console_evidence_status,
  apple_app_privacy:x.apple_app_privacy.console_declaration_status,
  google_data_safety:x.google_data_safety.console_declaration_status,
  google_delete_endpoint:x.google_account_deletion.production_endpoint_status,
  google_delete_identity:x.google_account_deletion.production_identity_verification_status,
  google_delete_data_safety_url:x.google_account_deletion.data_safety_deletion_url_console_status,
  google_delete_data_safety_questions:x.google_account_deletion.data_safety_deletion_questions_console_status,
  apple_ugc_human_sla:x.apple_ugc.timely_moderation.production_sla_status,
  apple_ugc_published_contact:x.apple_ugc.published_contact.live_publication_status,
  google_ugc_operations:x.google_ugc.ongoing_moderation.production_operations_status,
  google_ugc_child_safety_operations:x.google_ugc.child_safety.production_operations_status,
  google_child_safety_console_self_certification:x.google_child_safety_standards.play_console_self_certification_status,
  google_child_safety_live_point_of_contact:x.google_child_safety_standards.designated_child_safety_point_of_contact.live_contact_and_operational_authority_status,
  google_child_safety_reporting_operations:x.google_child_safety_standards.child_safety_law_reporting_runbook.production_operations_status,
  google_age_restricted_scope:x.google_age_restricted_content.scope_status,
  google_restrict_minor_access:x.google_age_restricted_content.restrict_minor_access_console_status,
  google_target_audience:x.google_target_audience_and_minor_access.target_audience_console_status,
  google_target_minor_access_configuration:x.google_target_audience_and_minor_access.restrict_minor_access_configuration_status,
  android_developer_identity_verification:x.android_developer_verification.developer_identity_verification_status,
  google_play_global_package_registration:x.android_developer_verification.global_play_package_registration_evidence_status,
  android_regional_certified_device_enforcement:x.android_developer_verification.regional_certified_device_enforcement_evidence_status,
  us_state_age_assurance_current_texas_integration:x.us_state_app_store_age_assurance.texas.production_integration_status,
  subscription_lifecycle:x.subscription.store_lifecycle_production_evidence_status,
  subscription_base_price_apple:x.subscription.intended_base_price.app_store_connect_status,
  subscription_base_price_google:x.subscription.intended_base_price.play_console_status,
  subscription_price_tax_parity:x.subscription.price_tax_console_parity_status,
  apple_subscription_multiseat:x.subscription.apple_multiseat_purchase_option.console_configuration_status,
  apple_streamlined_purchasing:x.subscription.apple_streamlined_purchasing.console_configuration_status
};
const failures=Object.entries(required).filter(([,status])=>status!=='verified').map(([name,status])=>`${name}: ${status ?? 'missing'}`);
if(failures.length)throw new Error(`Store compliance release gate failed (${failures.length}/${Object.keys(required).length} unresolved):\n- ${failures.join('\n- ')}\nDo not mark these verified without the named real console/production evidence.`);
console.log(`store-compliance-release-check: ${Object.keys(required).length} production store/legal evidence items verified`);
