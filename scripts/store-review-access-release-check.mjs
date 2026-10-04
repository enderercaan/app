import {readFileSync} from 'node:fs';
const x=JSON.parse(readFileSync('release/store-review-access-v22.json','utf8'));
const statuses={
  apple_review_account:x.apple.review_account_provisioned_status,
  apple_full_feature_access:x.apple.review_account_full_feature_access_status,
  apple_review_metadata:x.apple.app_review_information_credentials_entered_status,
  apple_sandbox_billing:x.apple.sandbox_subscription_lifecycle_status,
  google_review_account:x.google.review_access_account_provisioned_status,
  google_app_access_instructions:x.google.play_console_app_access_instructions_status,
  google_license_test_billing:x.google.license_test_subscription_lifecycle_status
};
const blocked=Object.entries(statuses).filter(([,v])=>v!=='verified');
if(blocked.length)throw new Error(`Store review access release gate failed (${blocked.length}/${Object.keys(statuses).length} unresolved):\n- ${blocked.map(([k,v])=>`${k}: ${v??'missing'}`).join('\n- ')}\nProvision/verify the real review account and store-console access instructions. Never replace this evidence with a source-code bypass.`);
console.log(`store-review-access-release-check: ${Object.keys(statuses).length} real store-review access items verified`);
