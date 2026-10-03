import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const locales = ['en','es','pt-BR','fr','de','it','ru','tr','ar','hi','id','ja','ko','zh-Hans','zh-Hant','nl','pl','th','vi'];
const translatedCriticalExpected = new Set(locales.filter(x => x !== 'en'));
const taiwanRuntimeForbidden=['賬戶','數據','營銷','准則','啓用','知識產權','運營','默認','消息','網絡','用戶','服務器','登錄','設置','獲取','訪問','崩潰','導出','坐標','存儲','加載','高級','質量','反饋','實時','身份驗證','帖子','屏幕'];
const fullRuntimeReady = new Set(['en','tr','de','es','fr','pt-BR','it','nl','pl','ru','ar','id','vi','hi','ja','ko','zh-Hans','zh-Hant','th']);
const criticalManifest = JSON.parse(fs.readFileSync(path.join(root,'release/i18n-critical-keys-v1.json'),'utf8'));
const criticalKeys = Array.isArray(criticalManifest) ? criticalManifest.map(x => typeof x === 'string' ? x : x.key) : Object.keys(criticalManifest);
const allowData = JSON.parse(fs.readFileSync(path.join(root,'release/i18n-runtime-invariant-allowlist-v1.json'),'utf8'));
const invariantAllow = allowData.locales || {};
const normalizedVariantAllow = allowData.normalized_variants || {};

function parseLocale(locale) {
  const file = path.join(root, 'src/i18n/locales', `${locale}.ts`);
  const src = fs.readFileSync(file, 'utf8');
  const out = {};
  const re = /^\s*(["'])(.*?)\1:\s*(["'])(.*)\3,?\s*$/gm;
  let m;
  while ((m = re.exec(src))) out[m[2]] = m[4];
  return out;
}
function hasScript(locale, value) {
  if (locale === 'ar') return /[\u0621-\u063A\u0641-\u064A\u066E-\u06D3]/.test(value);
  if (locale === 'hi') return /[\u0904-\u0939\u0958-\u0961]/.test(value);
  if (locale === 'ja') return /[\u3040-\u30FF\u4E00-\u9FFF]/.test(value);
  if (locale === 'ko') return /[\uAC00-\uD7AF]/.test(value);
  if (locale === 'ru') return /[А-Яа-яЁё]/.test(value);
  if (locale === 'zh-Hans' || locale === 'zh-Hant') return /[\u4E00-\u9FFF]/.test(value);
  if (locale === 'th') return /[\u0E01-\u0E2E]/.test(value);
  return true;
}
function placeholders(s) { return [...s.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(m=>m[1]).sort().join('|'); }
function normalizedVisibleText(s) { return String(s).normalize('NFKC').toLowerCase().replace(/\{[A-Za-z0-9_]+\}/g,'{}').replace(/[\p{P}\p{S}]+/gu,' ').replace(/\s+/g,' ').trim(); }
const en = parseLocale('en');
const userFacingAuditJargon = /\b(production evidence|production legal review|external[- ]counsel|release-ready|fail-closed|not_verified|immutable bundle|content hash|jurisdiction matrix|applicable-jurisdiction matrix|premium entitlement|store entitlement)\b/i;
const literalEnglishJargon = /\b(production evidence|release-ready|fail-closed|not_verified|backend|content hash|jurisdiction matrix|premium entitlement|store entitlement)\b/i;
let errors = [];
for (const [k,v] of Object.entries(en)) {
  if (userFacingAuditJargon.test(v)) {
    errors.push(`en: internal audit/engineering jargon leaked into user-facing copy ${k}`);
  }
}

if (criticalKeys.length !== 316) errors.push(`critical manifest must contain 316 keys, found ${criticalKeys.length}`);
for (const k of criticalKeys) if (!(k in en)) errors.push(`critical manifest unknown key ${k}`);
for (const locale of locales) {
  const d = parseLocale(locale);
  if (Object.keys(d).length !== Object.keys(en).length) errors.push(`${locale}: key count ${Object.keys(d).length}/${Object.keys(en).length}`);
  for (const k of Object.keys(en)) {
    if (!(k in d)) errors.push(`${locale}: missing ${k}`);
    else if (placeholders(d[k]) !== placeholders(en[k])) errors.push(`${locale}: placeholder drift ${k}`);
  }
  if (locale !== 'en') {
    for (const [k,v] of Object.entries(d)) {
      if (literalEnglishJargon.test(v)) {
        errors.push(`${locale}: literal English audit/engineering jargon leaked into user-facing copy ${k}`);
      }
    }
  }
  const translatedCritical = criticalKeys.filter(k => d[k] !== en[k]).length;
  console.log(`${locale}: keys=${Object.keys(d).length}; critical-localized=${translatedCritical}/${criticalKeys.length}`);
  if (translatedCriticalExpected.has(locale) && translatedCritical !== criticalKeys.length) errors.push(`${locale}: expected all critical keys localized, got ${translatedCritical}/${criticalKeys.length}`);
  if (translatedCriticalExpected.has(locale) && ['ar','hi','ja','ko','ru','zh-Hans','zh-Hant','th'].includes(locale)) {
    const missingScript = criticalKeys.filter(k => !hasScript(locale,d[k]));
    if (missingScript.length) errors.push(`${locale}: critical translations missing target script in ${missingScript.slice(0,5).join(', ')}${missingScript.length>5?'…':''}`);
  }
  if (fullRuntimeReady.has(locale) && ['ar','hi','ja','ko','ru','zh-Hans','zh-Hant','th'].includes(locale)) {
    const allow = new Set(invariantAllow[locale] || []);
    const missingFullScript = Object.keys(en).filter(k => !allow.has(k) && !hasScript(locale,d[k]));
    if (missingFullScript.length) errors.push(`${locale}: full-runtime translations missing target script in ${missingFullScript.slice(0,5).join(', ')}${missingFullScript.length>5?'…':''}`);
  }
  if (fullRuntimeReady.has(locale) && locale !== 'en') {
    const allow = new Set(invariantAllow[locale] || []);
    const normalizedAllow = new Set(normalizedVariantAllow[locale] || []);
    const same = Object.keys(en).filter(k => d[k] === en[k]);
    const unexpected = same.filter(k => !allow.has(k));
    const staleAllow = [...allow].filter(k => d[k] !== en[k]);
    const normalizedEnglishCopies = Object.keys(en).filter(k => !allow.has(k) && !normalizedAllow.has(k) && d[k] !== en[k] && normalizedVisibleText(d[k]) && normalizedVisibleText(d[k]) === normalizedVisibleText(en[k]));
    const staleNormalizedAllow = [...normalizedAllow].filter(k => d[k] === en[k] || normalizedVisibleText(d[k]) !== normalizedVisibleText(en[k]));
    if (unexpected.length) errors.push(`${locale}: unexpected English-identical full-runtime keys: ${unexpected.slice(0,8).join(', ')}${unexpected.length>8?'…':''}`);
    if (normalizedEnglishCopies.length) errors.push(`${locale}: punctuation/case-only English copies outside invariant allowlist: ${normalizedEnglishCopies.slice(0,8).join(', ')}${normalizedEnglishCopies.length>8?'…':''}`);
    if (staleAllow.length) errors.push(`${locale}: stale invariant allowlist keys: ${staleAllow.slice(0,8).join(', ')}`);
    if (staleNormalizedAllow.length) errors.push(`${locale}: stale normalized-variant allowlist keys: ${staleNormalizedAllow.slice(0,8).join(', ')}`);
    console.log(`${locale}: full-runtime identical=${same.length}, all explicitly allowlisted`);
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`runtime-language-quality-checks: PASS (${criticalKeys.length} fixed critical keys; placeholder/key parity across ${locales.length} locales; full-runtime invariants explicit)`);
