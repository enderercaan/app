import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=JSON.parse(fs.readFileSync('release/official-source-review-v19.json','utf8'));
const approval=JSON.parse(fs.readFileSync('release/configured-market-legal-language-source-approval-v20.json','utf8'));
assert.equal(source.reviewed_at,'2026-10-01');
assert.equal(source.source_freshness_policy?.screened_at,'2026-10-01');
assert.ok(new Date(source.source_freshness_policy.refresh_due_at)>new Date('2026-10-01T00:00:00Z'));
assert.equal(Object.keys(source.markets).length,27);
assert.equal(source.required_topic_families.length,22);
assert.equal(source.source_gap_summary?.remaining_topic_source_presence_gaps,0);
assert.equal(approval.summary?.source_legal_approved_markets,27);
assert.equal(approval.summary?.language_source_approved_markets,27);
assert.equal(approval.summary?.official_source_topic_cells,594);
assert.equal(approval.summary?.exact_country_language_routes,594);
assert.equal(approval.summary?.binding_country_language_routes,34);
assert.equal(approval.summary?.accessibility_translation_routes,560);
assert.equal(approval.summary?.source_legal_language_blockers,0);
const must=(cc,topic,url,needle)=>{const m=source.markets[cc],t=m.topics[topic];assert.ok(t.evidence_reference.includes(url),`${cc}/${topic}: current official source missing`);assert.ok(m.timing_notes.some(x=>x.includes(needle)),`${cc}: current-law timing note missing: ${needle}`);};
must('GB','privacy_data_protection','https://ico.org.uk/about-the-ico/what-we-do/legislation-we-cover/data-use-and-access-act-2025/','Data (Use and Access) Act 2025');
must('US','privacy_data_protection','https://cppa.ca.gov/regulations/ccpa_updates.html','California CPPA final CCPA');
must('AU','age_age_assurance','https://www.esafety.gov.au/about-us/industry-regulation/social-media-age-restrictions','Social Media Minimum Age');
must('JP','privacy_data_protection','https://www.ppc.go.jp/news/press/2026/260717/','17 July 2026 APPI amendment');
must('AE','age_age_assurance','https://uaelegislation.gov.ae/en/legislations/4506','Cabinet Resolution No. 106 of 2026');
must('IN','privacy_data_protection','https://www.meity.gov.in/documents/act-and-policies?page=1&persona=Business-owner','DPDP Rules 2025');
must('KR','cybersecurity_breach_notification','https://law.go.kr/LSW/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=1000089686','11 September 2026');
must('BR','ugc_moderation_appeals','https://www.gov.br/anpd/pt-br/assuntos/marco-civil-da-internet','Decrees 12.975/2026 and 12.976/2026');
must('BR','privacy_data_protection','https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/relatorio-de-impacto-a-protecao-de-dados-pessoais-ripd','RIPD guidance was updated on 23 September 2026');
must('BR','ugc_moderation_appeals','https://www.gov.br/mj/pt-br/assuntos/noticias-1/mjsp-regulamenta-notificacao-de-crimes-contra-criancas-em-plataformas-digitais/','Portaria 1.312/2026');
must('BR','consumer_protection','https://bibliotecadigital.mj.gov.br/handle/1/17694','Portaria Conjunta SENACON/SEDIGI/SPDIGI nº 3/2026');
must('US','subnational_requirements','https://www.gov.ca.gov/2026/09/10/governor-newsom-signs-the-strongest-child-safety-chatbot-and-social-media-laws-in-the-nation/','California chaptered a new child-online-safety package on 10 September 2026');
must('GB','age_age_assurance','https://www.gov.uk/government/consultations/growing-up-in-the-online-world-a-national-consultation/outcome/growing-up-in-the-online-world-progress-statement','expects the first restrictions to take effect in Spring 2027');
must('RU','consumer_protection','https://government.ru/docs/57713/','has entered into force on 1 October 2026');
must('CA','privacy_data_protection','https://www.parl.ca/legisinfo/en/bill/45-1/c-36','Bill C-36');
must('ID','age_age_assurance','https://jdih.komdigi.go.id/produk_hukum/view/id/1007/t/peraturan%2Bmenteri%2Bkomunikasi%2Bdan%2Bdigital%2Bnomor%2B9%2Btahun%2B2026','PP TUNAS');
must('TR','consumer_protection','https://ticaret.gov.tr/haberler/ticaret-bakanligindan-cocuklarin-dijital-guvenligini-guclendirecek-onemli-duzenleme','1 August 2026');
must('AU','age_age_assurance','https://www.oaic.gov.au/privacy/privacy-registers/privacy-codes/childrens-online-privacy-code','Children’s Online Privacy Code');
const staleNarratives=[/pending attributable external review/i,/external counsel approval/i,/pending counsel/i,/professional localization required/i,/desk screening only/i,/does not grant market approval/i,/release remains fail-closed pending attributable/i];
for(const pattern of staleNarratives){assert.doesNotMatch(JSON.stringify(source),pattern,`configured source truth contains stale pre-internal-approval narrative: ${pattern}`);}
assert.doesNotMatch(JSON.stringify(source.markets.RU.timing_notes),/scheduled to enter (?:into )?force 2026-10-01[\s\S]*not a current obligation/i,'RU: 1 Oct 2026 platform-economy law must not remain future-classified on its effective date');
for(const code of ['AT','BE','DE','ES','FR','IE','IT','NL','PL']) assert.doesNotMatch(JSON.stringify(source.markets[code].timing_notes),/As of 2026-09-29 it is a legislative proposal/i,`${code}: KIDS Act current narrative must be revalidated to 2026-10-01`);
for(const [cc,m] of Object.entries(source.markets)){
  assert.ok(m.official_sources?.length>=1,`${cc}: official source inventory empty`);
  for(const topic of source.required_topic_families){const t=m.topics?.[topic];assert.ok(t,`${cc}/${topic}: missing`);assert.ok(t.evidence_reference?.length,`${cc}/${topic}: no official evidence`);}
}
console.log('configured-market-current-law-revalidation: PASS 27/27 markets; 594/594 official-source topic cells; 18 high-volatility 2026 temporal anchors pinned; 27/27 source legal + language approval');
