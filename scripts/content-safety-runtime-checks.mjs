import assert from 'node:assert/strict';
import { contentSafetyBlockCopyKeys, preflightUserText } from '../src/domain/contentSafety.ts';

const REHOMING_CASES = Object.freeze({
  en: 'I need to rehome my dog',
  tr: 'Köpek sahiplendiriyorum',
  de: 'Hund sucht neues Zuhause',
  es: 'Perro en adopción',
  fr: 'Chien à adopter',
  it: 'Cane in adozione',
  ru: 'Отдам собаку в добрые руки',
  ar: 'كلب للتبني',
  hi: 'कुत्ता गोद देना',
  id: 'anjing cari rumah baru',
  ja: '犬 里親募集',
  ko: '강아지 입양',
  nl: 'hond herplaatsen',
  pl: 'pies do adopcji',
  'pt-BR': 'cachorro para adoção',
  th: 'สุนัข หาบ้าน',
  vi: 'chó nhận nuôi',
  'zh-Hans': '狗 领养',
  'zh-Hant': '狗 領養'
});

const SAFE_CONTEXT_CASES = Object.freeze([
  'My dog was adopted three years ago and loves the park.',
  'We support responsible rescue education, but do not arrange adoption.',
  'Kedimi üç yıl önce sahiplendim, şimdi oyun arkadaşı arıyoruz.',
  'My vet explained why rescue adoption history matters medically.',
  'This event discusses animal welfare policy and shelter education.'
]);

for (const [locale, text] of Object.entries(REHOMING_CASES)) {
  const result = preflightUserText(text);
  assert.equal(result.blocked, true, `${locale}: rehoming/adoption solicitation must be blocked`);
  assert.equal(result.blockCode, 'pet_rehoming', `${locale}: wrong block code`);
}

for (const text of SAFE_CONTEXT_CASES) {
  const result = preflightUserText(text);
  assert.equal(result.blocked, false, `safe contextual text must not be blocked: ${text}`);
}

for (const [text, code] of [
  ['puppy for sale', 'pet_sale_or_commercial_breeding'],
  ['Köpek satılık yavru ilanı', 'pet_sale_or_commercial_breeding'],
  ['looking for a romantic partner', 'human_dating_profile']
]) {
  const result = preflightUserText(text);
  assert.equal(result.blocked, true, `expected blocked content: ${text}`);
  assert.equal(result.blockCode, code, `wrong block code for: ${text}`);
}

assert.deepEqual(contentSafetyBlockCopyKeys('pet_rehoming'),{title:'contentSafety.petRehomingBlockedTitle',body:'contentSafety.petRehomingBlockedBody'});

console.log(`content-safety-runtime-checks: ${Object.keys(REHOMING_CASES).length}/19 locale rehoming cases + ${SAFE_CONTEXT_CASES.length} safe-context cases passed`);
