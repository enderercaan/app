import assert from 'node:assert/strict';
import { evaluateBooklet, fold, SCHEDULE_VERSION } from '../supabase/functions/_shared/healthBookletCheck.ts';

// Build an OCR page from text rows: one word per token, rows 100 px apart, tokens 80 px apart.
function page(rows, conf = 0.95) {
  const words = [];
  rows.forEach((row, r) => row.split(' ').forEach((text, c) => words.push({ text, conf, x: 10 + c * 80, y: 100 + r * 100, h: 20 })));
  return { words };
}
const TODAY = new Date('2026-10-05T10:00:00Z');
const dog = { species: 'dog', birthDate: '2022-01-10' };
const cat = { species: 'cat', birthDate: '2023-05-01' };
const FULL = [
  'Vaccination record',
  'Rabies Nobivac 14.03.2026 14.03.2027',
  'DHPPi Eurican 20.03.2026 20.03.2027',
  'Deworming Drontal 02.09.2026',
  'Flea tick Bravecto 15.09.2026',
];
let passed = 0;
const ok = (name, fn) => { fn(); passed++; };

ok('schedule version is pinned', () => assert.equal(SCHEDULE_VERSION, 'tailmance-booklet-schedule-2026-10-25'));
ok('fold removes diacritics and Turkish dotless i', () => assert.equal(fold('KUDUZ Aşısı İç Parazit ıı'), 'kuduz asisi ic parazit ii'));

ok('complete current booklet is approved and expires at the earliest date', () => {
  const r = evaluateBooklet([page(FULL)], dog, TODAY);
  assert.equal(r.outcome, 'approved');
  assert.equal(r.reasonCode, 'all_required_entries_current');
  assert.equal(r.validUntil.slice(0, 10), '2026-12-03'); // 2026-09-02 + 92 days
  assert.ok(r.signalConfidence > 0.85);
});
ok('several pages are evaluated together', () => {
  const r = evaluateBooklet([page(FULL.slice(0, 3)), page(FULL.slice(3))], dog, TODAY);
  assert.equal(r.outcome, 'approved');
});
ok('overdue rabies goes to a person', () => {
  const rows = [...FULL]; rows[1] = 'Rabies Nobivac 14.03.2025 14.03.2026';
  assert.deepEqual([evaluateBooklet([page(rows)], dog, TODAY).outcome, evaluateBooklet([page(rows)], dog, TODAY).reasonCode], ['manual_review', 'rabies_overdue']);
});
ok('missing external parasite entry goes to a person', () => {
  const r = evaluateBooklet([page(FULL.slice(0, 4))], dog, TODAY);
  assert.equal(r.outcome, 'manual_review'); assert.equal(r.reasonCode, 'external_parasite_entry_not_found');
});
ok('old parasite treatment is not current', () => {
  const rows = [...FULL]; rows[3] = 'Deworming Drontal 02.05.2026';
  const r = evaluateBooklet([page(rows)], dog, TODAY);
  assert.equal(r.reasonCode, 'internal_parasite_treatment_not_current');
});
ok('combined product counts for both parasite kinds', () => {
  const rows = [FULL[0], FULL[1], FULL[2], 'Simparica Trio 10.09.2026'];
  assert.equal(evaluateBooklet([page(rows)], dog, TODAY).outcome, 'approved');
});
ok('ambiguous dates whose readings agree are approved with the earliest reading', () => {
  const rows = [
    'Rabies 03/04/2026 03/04/2027', 'DHPP 05/04/2026 05/04/2027', 'Deworming 08/09/2026', 'Flea Frontline 09/08/2026',
  ];
  const r = evaluateBooklet([page(rows)], dog, TODAY);
  assert.equal(r.outcome, 'approved');
  assert.equal(r.validUntil.slice(0, 10), '2026-11-09'); // earliest reading: 2026-08-09 + 92 days
});
ok('ambiguous dates whose readings disagree go to a person', () => {
  const rows = ['Rabies 06/10/2026', 'DHPP 05/04/2026 05/04/2027', 'Deworming 02/09/2026', 'Flea Frontline 04/09/2026'];
  const r = evaluateBooklet([page(rows)], dog, TODAY);
  assert.equal(r.outcome, 'manual_review');
});
ok('low OCR confidence is rejected, not approved', () => {
  const r = evaluateBooklet([page(FULL, 0.5)], dog, TODAY);
  assert.equal(r.outcome, 'rejected'); assert.equal(r.reasonCode, 'ocr_confidence_too_low');
});
ok('medium OCR confidence cannot reach the approval signal confidence', () => {
  const r = evaluateBooklet([page(FULL, 0.8)], dog, TODAY);
  assert.equal(r.outcome, 'approved'); assert.ok(r.signalConfidence <= 0.85);
});
ok('no text is rejected', () => assert.equal(evaluateBooklet([{ words: [] }], dog, TODAY).reasonCode, 'no_text_found'));
ok('unknown content goes to a person', () => assert.equal(evaluateBooklet([page(['Hello world this is a menu'])], dog, TODAY).reasonCode, 'no_known_entries_found'));
ok('puppies are never approved by the series check', () => {
  assert.equal(evaluateBooklet([page(FULL)], { species: 'dog', birthDate: '2026-07-20' }, TODAY).reasonCode, 'primary_series_in_progress');
});
ok('species other than dog or cat go to a person', () => {
  assert.equal(evaluateBooklet([page(FULL)], { species: 'rabbit', birthDate: '2022-01-10' }, TODAY).reasonCode, 'species_not_covered');
});
ok('missing or invalid birth date goes to a person', () => {
  assert.equal(evaluateBooklet([page(FULL)], { species: 'dog', birthDate: null }, TODAY).reasonCode, 'pet_birth_date_missing');
  assert.equal(evaluateBooklet([page(FULL)], { species: 'dog', birthDate: '2030-01-01' }, TODAY).reasonCode, 'pet_birth_date_invalid');
});
ok('entries dated before birth are inconsistent', () => {
  const rows = [...FULL]; rows[1] = 'Rabies Nobivac 14.03.2020 14.03.2027';
  assert.equal(evaluateBooklet([page(rows)], dog, TODAY).reasonCode, 'dates_inconsistent');
});
ok('vial expiry and lot dates are not mistaken for due dates', () => {
  const rows = [...FULL]; rows[1] = 'Rabies Nobivac 14.03.2026 EXP 31.08.2030';
  const r = evaluateBooklet([page(rows)], dog, TODAY);
  assert.equal(r.outcome, 'approved');
  assert.equal(r.validUntil.slice(0, 10), '2026-12-03');
});
ok('rabies without a stated due date older than twelve months needs a person', () => {
  const rows = [...FULL]; rows[1] = 'Rabies Nobivac 14.03.2025';
  assert.equal(evaluateBooklet([page(rows)], dog, TODAY).reasonCode, 'rabies_validity_unclear');
});
ok('named months and English order are read', () => {
  const rows = ['Rabies 14 Mar 2026 14 Mar 2027', 'DHPP March 20, 2026 20 Mar 2027', 'Deworming 2 Sep 2026', 'Fleas 15 Sep 2026'];
  assert.equal(evaluateBooklet([page(rows)], dog, TODAY).outcome, 'approved');
});
ok('Turkish booklet words are read', () => {
  const rows = ['Kuduz aşısı 14.03.2026 14.03.2027', 'Köpek karması 20.03.2026 20.03.2027', 'İç parazit 02.09.2026', 'Dış parazit 15.09.2026'];
  assert.equal(evaluateBooklet([page(rows)], dog, TODAY).outcome, 'approved');
});
ok('cat core vaccine is FVRCP, not the dog combination', () => {
  const rows = ['Rabies 14.03.2026 14.03.2027', 'FVRCP Purevax 20.03.2026 20.03.2027', 'Deworming 02.09.2026', 'Flea Advocate 15.09.2026'];
  assert.equal(evaluateBooklet([page(rows)], cat, TODAY).outcome, 'approved');
  assert.equal(evaluateBooklet([page(FULL)], cat, TODAY).reasonCode, 'core_entry_not_found');
});
ok('product name wrapping onto the row above its dates is joined', () => {
  const rows = ['Rabies', '14.03.2026 14.03.2027', 'DHPPi 20.03.2026 20.03.2027', 'Deworming 02.09.2026', 'Flea 15.09.2026'];
  assert.equal(evaluateBooklet([page(rows)], dog, TODAY).outcome, 'approved');
});
ok('stamps and signatures on the pages change nothing and are not returned', () => {
  const r = evaluateBooklet([page([...FULL, 'Stamp Dr Example Clinic signature'])], dog, TODAY);
  assert.equal(r.outcome, 'approved');
  assert.deepEqual(Object.keys(r).sort(), ['documentConfidence', 'outcome', 'reasonCode', 'signalConfidence', 'signals', 'validUntil']);
});
ok('a booklet without a chip entry yields the vaccination signal only', () => {
  const r = evaluateBooklet([page(FULL)], dog, TODAY);
  assert.deepEqual(r.signals.map(x => x.signal), ['vaccination_complete']);
});

const CHIP = 'Microchip 985 112 345 678 901 12.01.2022';
ok('a consistent ISO chip number adds the microchip signal without an expiry', () => {
  const r = evaluateBooklet([page([...FULL, CHIP])], dog, TODAY);
  assert.equal(r.outcome, 'approved');
  assert.deepEqual(r.signals.map(x => x.signal), ['vaccination_complete', 'microchip_verified']);
  assert.equal(r.signals[1].validUntil, null);
  assert.ok(r.signals[1].confidence > 0.85);
});
ok('dotted, plain and wrapped chip numbers are read', () => {
  for (const rows of [[...FULL, 'Mikroçip no: 985.112.345.678.901'], [...FULL, 'Transponder 985112345678901'], [...FULL, 'Chip', '985 112 345 678 901']]) {
    assert.deepEqual(evaluateBooklet([page(rows)], dog, TODAY).signals.map(x => x.signal), ['vaccination_complete', 'microchip_verified']);
  }
});
ok('two different chip numbers go to a person', () => {
  const r = evaluateBooklet([page([...FULL, CHIP, 'Microchip 985 112 345 678 902'])], dog, TODAY);
  assert.equal(r.outcome, 'manual_review'); assert.equal(r.reasonCode, 'microchip_numbers_inconsistent');
});
ok('a test code or a non-ISO number goes to a person', () => {
  assert.equal(evaluateBooklet([page([...FULL, 'Microchip 999 112 345 678 901'])], dog, TODAY).reasonCode, 'microchip_code_invalid');
  assert.equal(evaluateBooklet([page([...FULL, 'Microchip 1234567890'])], dog, TODAY).reasonCode, 'microchip_number_not_iso');
});
ok('a chip number that differs from the owner-entered one goes to a person', () => {
  const same = evaluateBooklet([page([...FULL, CHIP])], { ...dog, declaredMicrochip: '985112345678901' }, TODAY);
  assert.equal(same.signals.length, 2);
  const other = evaluateBooklet([page([...FULL, CHIP])], { ...dog, declaredMicrochip: '985112345678999' }, TODAY);
  assert.equal(other.outcome, 'manual_review'); assert.equal(other.reasonCode, 'microchip_number_mismatch');
});
ok('a chip implant date before birth or in the future is inconsistent', () => {
  assert.equal(evaluateBooklet([page([...FULL, 'Microchip 985 112 345 678 901 12.01.2019'])], dog, TODAY).reasonCode, 'dates_inconsistent');
  assert.equal(evaluateBooklet([page([...FULL, 'Microchip 985 112 345 678 901 12.01.2029'])], dog, TODAY).reasonCode, 'dates_inconsistent');
});
ok('a chip entry never rescues a booklet whose vaccines are not current', () => {
  const rows = [...FULL]; rows[1] = 'Rabies Nobivac 14.03.2025 14.03.2026';
  const r = evaluateBooklet([page([...rows, CHIP])], dog, TODAY);
  assert.equal(r.outcome, 'manual_review'); assert.equal(r.signals.length, 0);
});
ok('breed, sex, size and weight are accepted but change no schedule rule', () => {
  const plain = evaluateBooklet([page(FULL)], dog, TODAY);
  for (const facts of [{ breed: 'Rottweiler', sex: 'male', size: 'large', weightKg: 45 }, { breed: 'Chihuahua', sex: 'female', size: 'mini', weightKg: 2.1 }]) {
    const r = evaluateBooklet([page(FULL)], { ...dog, ...facts }, TODAY);
    assert.deepEqual([r.outcome, r.reasonCode, r.validUntil], [plain.outcome, plain.reasonCode, plain.validUntil]);
  }
});

console.log(`health-booklet-check-tests: ${passed} scenarios PASS (${SCHEDULE_VERSION})`);
