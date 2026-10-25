import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const manifestPath=path.join(root,'release','country-legal-supplement-manifest-v20.json');
const migrationPath=path.join(root,'supabase','migrations','207_configured_27_legal_text_hash_sync.sql');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const sourceReview=JSON.parse(fs.readFileSync(path.join(root,'release','official-source-review-v19.json'),'utf8'));
const screenedAt=sourceReview.source_freshness_policy.screened_at;
const refreshDueAt=sourceReview.source_freshness_policy.refresh_due_at;
const q=v=>`'${String(v).replaceAll("'","''")}'`;
const bool=v=>v?'true':'false';
const evidence=JSON.stringify([
  'release/country-legal-supplement-manifest-v20.json',
  'release/configured-market-legal-language-source-approval-v20.json'
]);
const rows=[];
for(const cc of Object.keys(manifest.markets).sort()){
  const market=manifest.markets[cc];
  for(const locale of Object.keys(market.routes).sort((a,b)=>a.localeCompare(b,'en'))){
    const route=market.routes[locale];
    rows.push(`  (${[
      q(cc),q(locale),q(manifest.as_of),q(route.source_file),q(route.source_sha256),q(route.public_file),q(route.public_sha256),
      Number(route.official_source_count),q(route.internal_language_qa_status),q(route.route_role),bool(route.required_binding_locale),
      `${q(evidence)}::jsonb`,q(`${screenedAt}T00:00:00Z`)+`::timestamptz`,q(`${refreshDueAt}T23:59:59Z`)+`::timestamptz`,q('v19_207_legal_text_hash_sync')
    ].join(',')})`);
  }
}
if(rows.length!==594)throw new Error(`expected 594 exact country×language rows, got ${rows.length}`);
const sql=`-- Tailmance v19 R8 legal-language natural-copy/hash synchronization.\n`+
`-- Deterministically generated from release/country-legal-supplement-manifest-v20.json.\n`+
`-- Keeps all 594 exact country×legal-language source/public hashes aligned after legal-copy, source-review or framework-inventory updates.\n`+
`-- Historical migrations 133/135/138/139/140 remain immutable; this migration is the current runtime source-hash authority after the 2026-10-25 legal-text update (no veterinarian wording, microchip disclosure).\n\n`+
`insert into public.legal_country_source_document_supplements(\n`+
`  legal_country_code,document_locale,document_version,source_path,source_sha256,public_relative_path,public_sha256,\n`+
`  official_source_count,internal_language_qa_status,route_role,required_binding_locale,internal_review_evidence_reference,reviewed_at,valid_until,reviewed_by\n`+
`) values\n${rows.join(',\n')}\n`+
`on conflict (legal_country_code,document_locale) do update set\n`+
`  document_version=excluded.document_version,source_path=excluded.source_path,source_sha256=excluded.source_sha256,\n`+
`  public_relative_path=excluded.public_relative_path,public_sha256=excluded.public_sha256,official_source_count=excluded.official_source_count,\n`+
`  internal_language_qa_status=excluded.internal_language_qa_status,route_role=excluded.route_role,required_binding_locale=excluded.required_binding_locale,\n`+
`  internal_review_evidence_reference=excluded.internal_review_evidence_reference,reviewed_at=excluded.reviewed_at,valid_until=excluded.valid_until,reviewed_by=excluded.reviewed_by;\n`;
fs.writeFileSync(migrationPath,sql);
console.log(`generate-configured-27-source-hash-sync-migration: PASS ${rows.length}/594 rows -> ${path.relative(root,migrationPath)}`);
