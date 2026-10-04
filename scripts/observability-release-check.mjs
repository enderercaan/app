import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg=JSON.parse(readFileSync('package.json','utf8'));
const deps={...(pkg.dependencies??{}),...(pkg.devDependencies??{})};
const names=Object.keys(deps);
const crashProvider=names.find(name=>/sentry|crashlytics|bugsnag|appcenter/i.test(name))??null;
assert.ok(crashProvider,'Native crash/ANR monitoring provider dependency is not configured');

const required=['EXPO_PUBLIC_SENTRY_DSN','SENTRY_ORG','SENTRY_PROJECT','SENTRY_AUTH_TOKEN'];
for(const name of required){
  const value=(process.env[name]??'').trim();
  assert.ok(value,`${name} is required to verify production native crash reporting and symbol upload`);
  assert.doesNotMatch(value,/YOUR_|REPLACE_|xxxxx|example\.com/i,`${name} contains a placeholder`);
}
assert.match(process.env.EXPO_PUBLIC_SENTRY_DSN??'',/^https:\/\/[^\s]+$/i,'EXPO_PUBLIC_SENTRY_DSN must be HTTPS');
assert.ok((process.env.SENTRY_AUTH_TOKEN??'').length>=20,'SENTRY_AUTH_TOKEN is implausibly short');

// Product analytics is deliberately not a mandatory dependency. Tailmance may
// operate in privacy-minimal mode; security/reliability telemetry and native
// crash reporting remain mandatory regardless.
const analyticsProvider=names.find(name=>/analytics|amplitude|mixpanel|posthog|segment|firebase-analytics/i.test(name))??null;
console.log(`observability-release-check: crash=${crashProvider}; analytics=${analyticsProvider??'privacy-minimal-disabled'}; production Sentry build variables present`);
