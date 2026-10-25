// Product rule (2026-10-25): Tailmance has no veterinarian concept. No screen, text, store listing, legal document,
// push copy or place category may mention a veterinarian; health checks are AI document checks only.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const WORDS = /veterin|\bvets?\b|vétérin|tierarzt|tierärzt|veterinär|veterinári|veterinar|ветеринар|weterynar|dierenarts|بيطر|पशु[- ]?चिकित्स|獣医|獸醫|兽医|수의|สัตวแพทย์|thú y|dokter hewan|albaitari|veterinàri/i;
const roots = ['src', 'web', 'store/metadata', 'supabase/functions', 'App.tsx', 'app.config.ts', 'brand.json', 'brand.ts', 'modules', 'plugins'];
const skipDir = new Set(['node_modules', '.git', 'assets']);
const exts = new Set(['.ts', '.tsx', '.js', '.json', '.html', '.swift', '.kt', '.md', '.txt']);
function* walk(p) {
  if (!existsSync(p)) return;
  const st = statSync(p);
  if (st.isFile()) { yield p; return; }
  for (const e of readdirSync(p, { withFileTypes: true })) {
    if (skipDir.has(e.name)) continue;
    yield* walk(path.join(p, e.name));
  }
}
const hits = [];
let files = 0;
for (const r of roots) for (const f of walk(r)) {
  if (!exts.has(path.extname(f))) continue;
  files++;
  // Official-source links are citations; only visible wording is checked.
  const text = readFileSync(f, 'utf8').replace(/https?:\/\/[^\s"'<>)\\]+/g, '');
  const m = WORDS.exec(text);
  if (m) hits.push(`${f}: …${text.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' ')}…`);
}
if (hits.length) {
  console.error(`no-veterinarian-wording-checks: FAIL — ${hits.length} file(s) mention a veterinarian:\n${hits.slice(0, 20).join('\n')}`);
  process.exit(1);
}
console.log(`no-veterinarian-wording-checks: ${files} user-facing files, 0 veterinarian mentions PASS`);
