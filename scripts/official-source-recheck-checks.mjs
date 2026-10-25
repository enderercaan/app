// Validates the 2026-10-25 official-source recheck ledger and that the screening window is derived from it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ledger = JSON.parse(readFileSync('release/official-source-recheck-2026-10-25.json', 'utf8'));
const source = JSON.parse(readFileSync('release/official-source-review-v19.json', 'utf8'));
const watch = JSON.parse(readFileSync('release/temporal-watchlist-v19.json', 'utf8'));

assert.equal(ledger.scan_date, '2026-10-25');
assert.equal(ledger.summary.urls_scanned, ledger.entries.length, 'ledger entry count');
assert.equal(ledger.summary.reachable, ledger.entries.filter(e => e.ok).length, 'reachable count');
assert.equal(Object.values(ledger.summary.by_outcome).reduce((a, b) => a + b, 0), ledger.entries.length, 'outcome totals');
for (const e of ledger.entries) {
  if (e.ok) assert.match(e.sha256 ?? '', /^[0-9a-f]{64}$/, `${e.url}: content baseline hash missing`);
  else assert.ok(e.reason, `${e.url}: unreachable entries must state why`);
}
assert.deepEqual(Object.keys(ledger.markets).sort(), Object.keys(source.markets).sort(), 'every configured market is in the ledger');
const carried = Object.values(ledger.markets).reduce((n, m) => n + m.cells_without_reachable_source, 0);
assert.equal(carried, ledger.cells_without_reachable_source.length, 'carried-forward cell list matches market totals');
assert.ok(ledger.honest_limits.length >= 3, 'limits of the scan must stay stated');

const policy = source.source_freshness_policy;
assert.equal(policy.screened_at, ledger.scan_date, 'screening date must come from the ledger');
const due = new Date(`${ledger.scan_date}T00:00:00Z`); due.setUTCDate(due.getUTCDate() + policy.max_screening_age_days);
assert.equal(policy.refresh_due_at, due.toISOString().slice(0, 10), 'refresh date is scan date + max age');
assert.equal(policy.recheck_ledger, 'release/official-source-recheck-2026-10-25.json');
for (const [cc, m] of Object.entries(source.markets)) {
  assert.equal(m.source_screened_at, ledger.scan_date, `${cc}: screening date`);
  assert.equal(m.last_official_source_recheck, ledger.scan_date, `${cc}: recheck date`);
}
const byId = Object.fromEntries(watch.items.map(i => [i.id, i]));
for (const id of ledger.watchlist_rechecked) {
  assert.ok(byId[id], `${id}: watchlist item missing`);
  assert.equal(byId[id].last_rechecked_at, ledger.scan_date, `${id}: recheck date`);
  assert.ok(byId[id].trigger_date > ledger.scan_date, `${id}: next trigger must be after the recheck`);
}
for (const [oldUrl, newUrl] of Object.entries(ledger.dead_links_replaced)) {
  for (const f of ['official-source-review-v19', 'country-release-gates']) {
    assert.ok(!readFileSync(`release/${f}.json`, 'utf8').includes(oldUrl), `${f}: dead link still pinned: ${oldUrl}`);
  }
  assert.ok(newUrl.startsWith('https://'), 'replacement must be https');
}
console.log(`official-source-recheck-checks: ${ledger.summary.reachable}/${ledger.summary.urls_scanned} sources reachable; ${carried} topic cells carried forward and listed; ${ledger.watchlist_rechecked.length} watchlist items rechecked; screening valid to ${policy.refresh_due_at} PASS`);
