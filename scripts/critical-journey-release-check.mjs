import {readFileSync, realpathSync, statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isAbsolute, relative, resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';

// Required records belong to the gate contract, not caller-controlled evidence.
export const REQUIRED_UI_EVIDENCE = Object.freeze({
  ios_reviewer_critical_journey: {
    platform: 'ios',
    required: ['real_release_candidate_build', 'real_review_account', 'onboarding_entry_screenshot_sha256', 'verification_center_screenshot_sha256', 'premium_paywall_screenshot_sha256', 'test_run_log_sha256'],
  },
  android_reviewer_critical_journey: {
    platform: 'android',
    required: ['real_release_candidate_build', 'real_review_account', 'onboarding_entry_screenshot_sha256', 'verification_center_screenshot_sha256', 'premium_paywall_screenshot_sha256', 'test_run_log_sha256'],
  },
  core_ui_visual_golden_matrix: {
    platform: 'ios_android',
    required: ['approved_baseline_image_hashes', 'current_candidate_image_hashes', 'pixel_or_perceptual_diff_report', 'dynamic_type_rtl_dark_mode_matrix'],
  },
});

function need(condition, message) {
  if (!condition) throw new Error(message);
}

function evidenceFile(root, record, label) {
  need(record && typeof record === 'object', `${label}:missing_artifact`);
  need(typeof record.path === 'string' && record.path.length > 0 && !isAbsolute(record.path), `${label}:invalid_path`);
  need(/^[0-9a-f]{64}$/.test(record.sha256 ?? ''), `${label}:invalid_sha256`);
  const file = realpathSync(resolve(root, record.path));
  const rel = relative(root, file);
  need(rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), `${label}:outside_evidence_root`);
  const stat = statSync(file);
  need(stat.isFile() && stat.size > 0, `${label}:empty_or_non_file_artifact`);
  const bytes = readFileSync(file);
  need(createHash('sha256').update(bytes).digest('hex') === record.sha256, `${label}:sha256_mismatch`);
  return bytes;
}

export function validateUiEvidence(evidence, directory = process.cwd()) {
  const root = realpathSync(directory);
  need(evidence?.schema_version === 1 && evidence.policy_version === 'tailmance-ui-e2e-v23', 'invalid_evidence_schema');
  const expectedFlows = ['e2e/maestro/onboarding-entry.yaml', 'e2e/maestro/verification-paywall.yaml'];
  const contract = evidence.source_contract;
  need(contract?.status === 'implemented' && contract.framework === 'Maestro external runner', 'invalid_source_contract');
  need(contract.credentials_policy === 'environment_injected_only_no_binary_or_repo_credentials', 'invalid_credentials_policy');
  need(JSON.stringify(contract.flows) === JSON.stringify(expectedFlows), 'invalid_source_flows');
  for (const flow of expectedFlows) need(statSync(resolve(root, flow)).isFile(), `missing_flow:${flow}`);
  const items = evidence.required_execution_evidence;
  need(Array.isArray(items) && items.length === Object.keys(REQUIRED_UI_EVIDENCE).length, 'missing_or_extra_evidence_items');
  const seen = new Set();
  let count = 0;
  for (const item of items) {
    need(item && Object.hasOwn(REQUIRED_UI_EVIDENCE, item.id) && !seen.has(item.id), 'unknown_or_duplicate_evidence_id');
    seen.add(item.id);
    const spec = REQUIRED_UI_EVIDENCE[item.id];
    need(item.platform === spec.platform, `${item.id}:wrong_platform`);
    need(item.status === 'verified', `${item.id}:not_verified`);
    need(JSON.stringify(item.required) === JSON.stringify(spec.required), `${item.id}:required_contract_changed`);
    const run = item.execution;
    need(run?.result === 'passed' && run.runner === 'Maestro' && run.device_kind === 'physical_device', `${item.id}:missing_physical_device_execution`);
    need(typeof run.app_version === 'string' && run.app_version.trim() && typeof run.build_number === 'string' && run.build_number.trim(), `${item.id}:missing_build_identity`);
    const started = Date.parse(run.started_at);
    const completed = Date.parse(run.completed_at);
    need(Number.isFinite(started) && Number.isFinite(completed) && completed >= started && completed <= Date.now(), `${item.id}:invalid_execution_time`);
    const platforms = spec.platform === 'ios_android' ? ['ios', 'android'] : [spec.platform];
    need(Array.isArray(run.devices) && platforms.every(platform => run.devices.some(device => device.platform === platform && /^[0-9a-f]{64}$/.test(device.device_id_sha256 ?? '') && typeof device.os_version === 'string' && device.os_version.trim())), `${item.id}:missing_device_identity`);
    for (const key of spec.required) {
      const record = item.artifacts?.[key];
      const bytes = evidenceFile(root, record, `${item.id}:${key}`);
      if (key.endsWith('_sha256')) need(item[key] === record.sha256, `${item.id}:${key}:declared_hash_mismatch`);
      if (key.includes('screenshot')) need(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${item.id}:${key}:not_png`);
      count += 1;
    }
  }
  return {items: seen.size, artifacts: count};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const evidence = JSON.parse(readFileSync('release/ui-e2e-evidence-v23.json', 'utf8'));
    const result = validateUiEvidence(evidence);
    console.log(`critical-journey-release-check: PASS (${result.items} execution records; ${result.artifacts} artifact hashes verified; authenticity requires trusted device runner provenance)`);
  } catch (error) {
    console.error(`critical-journey-release-check: BLOCK (${error.message})`);
    process.exitCode = 1;
  }
}
