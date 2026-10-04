import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const locales=['en','es','pt-BR','fr','de','it','ru','tr','ar','hi','id','ja','ko','zh-Hans','zh-Hant','nl','pl','th','vi'];
const readJson=(p)=>JSON.parse(readFileSync(p,'utf8'));
const flatten=(value)=>{
  if(typeof value==='string')return [value];
  if(Array.isArray(value))return value.flatMap(flatten);
  if(value&&typeof value==='object')return Object.values(value).flatMap(flatten);
  return [];
};

const forbiddenJargon={
  de:[/\bmatching\b/i,/\bmatches?\b/i],
  es:[/\bmatching\b/i,/\bmatches?\b/i],
  fr:[/\bmatching\b/i,/\bmatchs?\b/i,/chat privé/i],
  hi:[/पेट/,/मैच/,/चैट/,/मीटअप/,/सोशल/],
  id:[/\bmatching\b/i,/\bmatch\b/i,/\bmeetup\b/i],
  it:[/\bmatching\b/i,/\bmatch\b/i,/\bpet\b/i],
  nl:[/\bmatching\b/i,/\bpets?\b/i,/\bmeetups?\b/i],
  'pt-BR':[/\bmatching\b/i,/\bmatches?\b/i,/\bchat\b/i],
  ru:[/мэтч/i],
  th:[/แมตช์/,/แชต/],
  tr:[/\bpet\b/i],
  vi:[/\bpet\b/i,/\bstory\b/i],
};

let fields=0;
for(const locale of locales){
  const path=`store/metadata/${locale}.json`;
  const data=readJson(path);
  const strings=flatten(data);
  fields+=strings.length;
  for(const s of strings){
    assert.equal(s,s.trim(),`${path}: leading/trailing whitespace`);
    assert.doesNotMatch(s,/\b(?:TODO|TBD|FIXME|LOREM IPSUM)\b/i,`${path}: placeholder text is not allowed`);
    assert.doesNotMatch(s,/ {2,}/,`${path}: repeated spaces are not allowed`);
  }
  for(const pattern of forbiddenJargon[locale]??[]){
    const offending=strings.find((s)=>pattern.test(s));
    assert.equal(offending,undefined,`${path}: avoid untranslated/awkward jargon ${pattern}: ${offending??''}`);
  }
}

// Guard previously observed literal/grammar regressions that generic jargon checks cannot catch.
const joined=(locale)=>flatten(readJson(`store/metadata/${locale}.json`)).join('\n');
assert.doesNotMatch(joined('de'),/sichererer Chat/i);
assert.doesNotMatch(joined('es'),/\by queda\b/i);
assert.doesNotMatch(joined('fr'),/de santé privée restent/i);
assert.doesNotMatch(joined('id'),/cocokkan dua arah/i);
assert.doesNotMatch(joined('pl'),/prywatnego zdrowia/i);
assert.doesNotMatch(joined('ja'),/ソーシャル上の主体/);
assert.doesNotMatch(joined('ko'),/사회적 정체성/);
assert.doesNotMatch(joined('nl'),/privacy met een benaderde locatie/i);
assert.doesNotMatch(readJson('store/metadata/th.json').google.shortDescription,/จับคู่สองฝ่าย/);
assert.doesNotMatch(joined('tr'),/sağlık sinyalleri|uyumlu petleri/i);

const tr=readJson('store/metadata/tr.json');
assert.match(tr.apple.description,/evcil hayvan/i);
assert.match(tr.apple.description,/18 yaş/i);
assert.match(tr.apple.description,/doğrulama rozetleri/i);
const hi=readJson('store/metadata/hi.json');
assert.match(hi.apple.description,/पालतू जानवर/);
assert.match(hi.apple.description,/18 वर्ष/);
const th=readJson('store/metadata/th.json');
assert.match(th.apple.description,/สัตว์เลี้ยง/);
assert.match(th.apple.description,/18 ปี/);
const ru=readJson('store/metadata/ru.json');
assert.match(ru.apple.description,/питомц/i);
assert.match(ru.apple.description,/18 лет/);

console.log(`store-language-quality-checks: ${locales.length}/${locales.length} locale sets; ${fields} localized text fields checked; jargon/placeholders/whitespace safeguards PASS`);
