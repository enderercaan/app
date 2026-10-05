// Tailmance vaccination-booklet check: pure functions, no I/O, no Deno or Node APIs.
//
// Input: the words an OCR provider read from every uploaded booklet page (text, confidence, position),
// the pet's species and birth date, and the evaluation date.
// Output: approved | manual_review | rejected, a reason code and an optional "valid until" date.
//
// The check compares dated entries with a published schedule. It does not look up, name or approve any
// veterinarian or clinic, does not infer breed, and is never a statement about the pet's health. Anything
// unreadable, ambiguous, implausible or outside the rules goes to a person; nothing is approved by guessing.

export const SCHEDULE_VERSION = 'tailmance-booklet-schedule-2026-10';

export type OcrWord = { text: string; conf: number; x: number; y: number; h: number };
export type OcrPage = { words: OcrWord[] };
export type PetFacts = { species: string | null; birthDate: string | null };
export type BookletOutcome = {
  outcome: 'approved' | 'manual_review' | 'rejected';
  reasonCode: string;
  documentConfidence: number;
  signalConfidence: number;
  validUntil: string | null;
};

const DAY = 86_400_000;
const VACCINE_FALLBACK_DAYS = 366;
const VACCINE_MAX_VALIDITY_DAYS = 3 * 366 + 31;
const PARASITE_WINDOW_ADULT_DAYS = 92;
const PARASITE_WINDOW_YOUNG_DAYS = 35;
const YOUNG_MONTHS = 6;
const MIN_AGE_MONTHS = 4;
const RABIES_MIN_AGE_DAYS = 84;
const CORE_FINAL_DOSE_MIN_AGE_DAYS = 112;
const MAX_AMBIGUOUS_ITEMS = 6;
const MIN_OCR_CONFIDENCE = 0.65;

export function fold(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ı/g, 'i').replace(/ß/g, 'ss');
}

// Keyword lists are written in folded form (no diacritics, lower case). `prefix` entries also match longer words
// (dewormer, dhppi); `exact` entries must stand alone as a word.
type Lexicon = { prefix: string[]; exact: string[] };
const LEX: Record<'rabies' | 'dogCore' | 'catCore' | 'internal' | 'external' | 'both', Lexicon> = {
  rabies: {
    prefix: ['rabies', 'kuduz', 'tollwut', 'rabbia', 'raiva', 'hondsdolheid', 'wscieklizn', 'rabia', 'rabiata', 'raivo', 'бешенств', '狂犬', '광견', 'سعار', 'داء الكلب', 'rabie'],
    exact: ['rage', 'rab'],
  },
  dogCore: {
    prefix: ['dhpp', 'dhlpp', 'da2pp', 'dapp', 'dapv', 'distemper', 'parvo', 'hepatit', 'adenovir', 'kopek karma', 'karma asi', 'polivalan', 'hexadog', 'eurican', 'vanguard', 'canigen', 'duramune', 'recombitek', 'staupe', 'moquillo', 'cimurro', 'maladie de carre', 'hondenziekte', 'nobivac dhp', 'nobivac dp'],
    exact: ['dhp', 'dp', 'dhppi', 'dhppil'],
  },
  catCore: {
    prefix: ['fvrcp', 'fvrc', 'trikat', 'tricat', 'kedi karma', 'purevax', 'felocell', 'felovax', 'panleukopen', 'calici', 'rhinotracheit', 'katzenseuche', 'katzenschnupfen', 'coryza', 'nobivac tricat'],
    exact: ['fpv', 'fhv'],
  },
  internal: {
    prefix: ['deworm', 'anthelmint', 'vermifug', 'ic parazit', 'ic antiparazit', 'endoparazit', 'endoparasit', 'solucan', 'drontal', 'milbemax', 'caniverm', 'panacur', 'droncit', 'telmin', 'entwurm', 'wurmkur', 'vermifugo', 'ontworm', 'desparasit', 'deparasit', 'tenicid', 'cestod', 'nematod', 'praziquantel', 'pyrantel', 'fenbendazol', 'milbemycin', 'antiparassitario interno', 'internal parasit', 'intern parasit', 'parasites internes', 'parasitos internos', 'parassiti interni'],
    exact: ['worm', 'worms', 'kurt', 'wurm', 'wurmer'],
  },
  external: {
    prefix: ['flea', 'tick', 'dis parazit', 'dis antiparazit', 'ektoparazit', 'ectoparasit', 'ektoparasit', 'zecke', 'tique', 'garrapata', 'zecca', 'frontline', 'advantix', 'bravecto', 'nexgard', 'simparica', 'credelio', 'seresto', 'scalibor', 'effitix', 'spot-on', 'spot on', 'fipronil', 'imidacloprid', 'permethrin', 'isoxazolin', 'afoxolaner', 'fluralaner', 'sarolaner', 'lotilaner', 'external parasit', 'extern parasit', 'parasites externes', 'parasitos externos', 'parassiti esterni'],
    exact: ['pire', 'kene', 'floh', 'flohe', 'puce', 'puces', 'pulga', 'pulgas', 'pulce', 'pulci', 'vlo', 'vlooien', 'teek', 'teken', 'ticks', 'fleas'],
  },
  both: {
    prefix: ['simparica trio', 'nexgard spectra', 'nexgard combo', 'bravecto plus', 'advocate', 'broadline', 'stronghold', 'revolution plus', 'credelio quattro', 'ic ve dis parazit', 'internal and external', 'interne und externe', 'intern en extern'],
    exact: [],
  },
};

function compile(lex: Lexicon) {
  const e = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts: string[] = [];
  if (lex.prefix.length) parts.push(`(?<![\\p{L}\\p{N}])(?:${lex.prefix.map(e).join('|')})`);
  if (lex.exact.length) parts.push(`(?<![\\p{L}\\p{N}])(?:${lex.exact.map(e).join('|')})(?![\\p{L}\\p{N}])`);
  return new RegExp(parts.join('|'), 'u');
}
const RX = {
  rabies: compile(LEX.rabies), dogCore: compile(LEX.dogCore), catCore: compile(LEX.catCore),
  internal: compile(LEX.internal), external: compile(LEX.external), both: compile(LEX.both),
};
// A date next to one of these words is a product or lot date, not an administration or due date.
const IGNORE_DATE_CONTEXT = /(?:exp(?:iry|ires|\.)?|skt|son kullanma|lot|batch|serie|serial|verfall|haltbar|peremption|caducidad|scad(?:enza)?|vence|mfg|prod(?:uction)?|uretim|fabric)\s*[:.]?\s*$/u;

const MONTHS: Record<string, number> = {
  jan: 1, ene: 1, gen: 1, oca: 1, feb: 2, fev: 2, sub: 2, mar: 3, mrt: 3, apr: 4, abr: 4, avr: 4, nis: 4,
  may: 5, mai: 5, mei: 5, mag: 5, haz: 6, tem: 7, lug: 7, ago: 8, aug: 8, aou: 8, agu: 8,
  set: 9, sep: 9, eyl: 9, okt: 10, oct: 10, out: 10, ott: 10, eki: 10, nov: 11, kas: 11,
  dec: 12, dez: 12, dic: 12, ara: 12,
};
function monthFromWord(word: string): number | null {
  const w = word.slice(0, 4);
  if (w.startsWith('jui')) return w[3] === 'n' ? 6 : w[3] === 'l' ? 7 : null;
  if (w.startsWith('jun')) return 6;
  if (w.startsWith('jul')) return 7;
  return MONTHS[w.slice(0, 3)] ?? null;
}

function utc(y: number, m: number, d: number): Date | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}
function expandYear(y: string) {
  const n = Number(y);
  return y.length === 4 ? n : n <= 69 ? 2000 + n : 1900 + n;
}

// `candidates` holds every reading of the date that could be right. A numeric date such as 03/04/2026 has two
// (day-month and month-day) until the whole booklet shows which order it uses; see resolveDateOrder.
type DateItem = { candidates: Date[]; order?: { day: Date | null; month: Date | null; dotted: boolean } };
function parseDates(row: string): DateItem[] {
  const out: DateItem[] = [];
  const push = (index: number, item: DateItem) => {
    if (!item.candidates.length) return;
    if (IGNORE_DATE_CONTEXT.test(row.slice(Math.max(0, index - 14), index))) return;
    out.push(item);
  };
  const numeric = /(?<![\d])(\d{1,4})([./-])(\d{1,2})[./-](\d{1,4})(?![\d])/g;
  for (const m of row.matchAll(numeric)) {
    const [a, sep, b, c] = [m[1], m[2], m[3], m[4]];
    if (a.length === 4) { const d = utc(Number(a), Number(b), Number(c)); push(m.index ?? 0, { candidates: d ? [d] : [] }); continue; }
    if (c.length !== 4 && c.length !== 2) continue;
    const y = expandYear(c);
    const day = utc(y, Number(b), Number(a)); // day-month-year
    const month = utc(y, Number(a), Number(b)); // month-day-year
    const candidates = Number(a) === Number(b) ? (day ? [day] : []) : [day, month].filter((d): d is Date => d !== null);
    push(m.index ?? 0, candidates.length > 1 ? { candidates, order: { day, month, dotted: sep === '.' } } : { candidates });
  }
  const named = /(?<![\d])(\d{1,2})[\s./-]*(\p{L}{3,9})\.?[\s,./-]*(\d{4}|\d{2})(?![\d])/gu;
  for (const m of row.matchAll(named)) {
    const month = monthFromWord(m[2]);
    const d = month ? utc(expandYear(m[3]), month, Number(m[1])) : null;
    if (d) push(m.index ?? 0, { candidates: [d] });
  }
  const english = /(\p{L}{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?![\d])/gu;
  for (const m of row.matchAll(english)) {
    const month = monthFromWord(m[1]);
    const d = month ? utc(Number(m[3]), month, Number(m[2])) : null;
    if (d) push(m.index ?? 0, { candidates: [d] });
  }
  return out;
}

// One booklet uses one date order. A date like 25.03.2026 (or 03.25.2026) proves the order for every similar date in the
// booklet; dates written with dots are day-first. With no proof, or with proof of both orders, the dates stay ambiguous
// and the check will only approve if every reading gives the same result.
function resolveDateOrder(rows: Row[]) {
  const items = rows.flatMap(r => r.dates);
  const ambiguous = items.filter(i => i.order);
  if (!ambiguous.length) return;
  let dayProof = 0;
  let monthProof = 0;
  const dotted = ambiguous.filter(i => i.order!.dotted).length;
  for (const r of rows) for (const m of r.text.matchAll(/(?<![\d])(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?![\d])/g)) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a > 12 && b <= 12) dayProof++;
    else if (b > 12 && a <= 12) monthProof++;
  }
  const order = dayProof && !monthProof ? 'day' : monthProof && !dayProof ? 'month' : !dayProof && !monthProof && dotted === ambiguous.length ? 'day' : null;
  if (!order) return;
  for (const i of ambiguous) {
    const chosen = order === 'day' ? i.order!.day : i.order!.month;
    if (chosen) i.candidates = [chosen];
    i.order = undefined;
  }
}

type Row = { text: string; conf: number; dates: DateItem[]; cats: Set<string> };

function buildRows(pages: OcrPage[]): { rows: Row[]; docConf: number; words: number } {
  const rows: Row[] = [];
  let confSum = 0;
  let count = 0;
  for (const page of pages) {
    const words = page.words.filter(w => typeof w.text === 'string' && w.text.trim() && Number.isFinite(w.conf));
    if (!words.length) continue;
    for (const w of words) { confSum += Math.min(1, Math.max(0, w.conf)); count++; }
    const heights = words.map(w => w.h).filter(h => h > 0).sort((a, b) => a - b);
    const median = heights.length ? heights[Math.floor(heights.length / 2)] : 10;
    const tolerance = Math.max(4, median * 0.6);
    const sorted = [...words].sort((a, b) => a.y - b.y);
    const groups: { y: number; words: OcrWord[] }[] = [];
    for (const w of sorted) {
      const g = groups[groups.length - 1];
      if (g && Math.abs(g.y - w.y) <= tolerance) { g.words.push(w); g.y = g.words.reduce((s, x) => s + x.y, 0) / g.words.length; }
      else groups.push({ y: w.y, words: [w] });
    }
    for (const g of groups) {
      const ordered = g.words.sort((a, b) => a.x - b.x);
      const text = fold(ordered.map(w => w.text).join(' '));
      const conf = ordered.reduce((s, w) => s + Math.min(1, Math.max(0, w.conf)), 0) / ordered.length;
      const cats = new Set<string>();
      if (RX.rabies.test(text)) cats.add('rabies');
      if (RX.dogCore.test(text)) cats.add('dogCore');
      if (RX.catCore.test(text)) cats.add('catCore');
      const both = RX.both.test(text);
      if (both || RX.internal.test(text)) cats.add('internal');
      if (both || RX.external.test(text)) cats.add('external');
      rows.push({ text, conf, dates: parseDates(text), cats });
    }
  }
  resolveDateOrder(rows);
  return { rows, docConf: count ? confSum / count : 0, words: count };
}

// A category's dates may sit on the next row when the product name wraps; only a row without its own category qualifies.
function datesFor(rows: Row[], index: number): DateItem[] {
  const row = rows[index];
  if (row.dates.length || index + 1 >= rows.length) return row.dates;
  const next = rows[index + 1];
  return next.cats.size === 0 ? next.dates : row.dates;
}

type Entry = { items: DateItem[]; conf: number };
function entriesFor(rows: Row[], cat: string): Entry[] {
  const out: Entry[] = [];
  rows.forEach((row, i) => { if (row.cats.has(cat)) out.push({ items: datesFor(rows, i), conf: row.conf }); });
  return out;
}

type Verdict = { ok: boolean; reason: string; until: number | null; conf: number };

function* combos(items: DateItem[]): Generator<Date[]> {
  const idx = new Array(items.length).fill(0);
  while (true) {
    yield items.map((it, i) => it.candidates[idx[i]]);
    let p = items.length - 1;
    while (p >= 0 && ++idx[p] >= items[p].candidates.length) { idx[p] = 0; p--; }
    if (p < 0) return;
  }
}

function vaccineVerdict(entries: Entry[], today: number, birth: number, kind: 'rabies' | 'core', ageMonths: number): Verdict {
  if (!entries.length) return { ok: false, reason: `${kind}_entry_not_found`, until: null, conf: 0 };
  const all = entries.flatMap(e => e.items);
  const ambiguous = all.filter(i => i.candidates.length > 1).length;
  if (ambiguous > MAX_AMBIGUOUS_ITEMS) return { ok: false, reason: 'dates_ambiguous', until: null, conf: 0 };
  const conf = Math.min(...entries.map(e => e.conf));
  let until: number | null = null;
  // Every reading of an ambiguous date (day-month or month-day) must lead to the same, valid result.
  const flat = entries.map(e => e.items);
  const sizes = flat.map(i => i.length);
  const merged: DateItem[] = flat.flat();
  for (const pick of combos(merged)) {
    let offset = 0;
    let bestAdmin = -Infinity;
    let bestDue: number | null = null;
    const adminDates: number[] = [];
    for (let e = 0; e < entries.length; e++) {
      const dates = pick.slice(offset, offset + sizes[e]).map(d => d.getTime()).sort((a, b) => a - b);
      offset += sizes[e];
      const past = dates.filter(d => d <= today + DAY);
      const future = dates.filter(d => d > today + DAY);
      if (!past.length) continue;
      const admin = past[0];
      const due = dates.length > 1 ? dates[dates.length - 1] : null;
      if (admin < birth) return { ok: false, reason: 'dates_inconsistent', until: null, conf };
      adminDates.push(admin);
      if (admin > bestAdmin) { bestAdmin = admin; bestDue = due !== null && due > admin ? due : future.length ? future[future.length - 1] : null; }
    }
    if (!Number.isFinite(bestAdmin)) return { ok: false, reason: `${kind}_date_not_found`, until: null, conf };
    if (kind === 'rabies' && bestAdmin - birth < RABIES_MIN_AGE_DAYS * DAY) return { ok: false, reason: 'rabies_given_too_young', until: null, conf };
    if (kind === 'core') {
      if (ageMonths < 12 && new Set(adminDates).size < 2) return { ok: false, reason: 'primary_series_incomplete', until: null, conf };
      if (ageMonths >= 5 && bestAdmin - birth < CORE_FINAL_DOSE_MIN_AGE_DAYS * DAY) return { ok: false, reason: 'primary_series_incomplete', until: null, conf };
    }
    let validUntil: number;
    if (bestDue !== null) {
      if (bestDue - bestAdmin > VACCINE_MAX_VALIDITY_DAYS * DAY) return { ok: false, reason: 'due_date_implausible', until: null, conf };
      if (bestDue < today) return { ok: false, reason: `${kind}_overdue`, until: null, conf };
      validUntil = bestDue;
    } else {
      validUntil = bestAdmin + VACCINE_FALLBACK_DAYS * DAY;
      if (validUntil < today) return { ok: false, reason: `${kind}_validity_unclear`, until: null, conf };
    }
    until = until === null ? validUntil : Math.min(until, validUntil);
  }
  return { ok: true, reason: 'ok', until, conf };
}

function parasiteVerdict(entries: Entry[], today: number, birth: number, kind: 'internal' | 'external', young: boolean): Verdict {
  if (!entries.length) return { ok: false, reason: `${kind}_parasite_entry_not_found`, until: null, conf: 0 };
  const merged: DateItem[] = entries.flatMap(e => e.items);
  if (merged.filter(i => i.candidates.length > 1).length > MAX_AMBIGUOUS_ITEMS) return { ok: false, reason: 'dates_ambiguous', until: null, conf: 0 };
  const conf = Math.min(...entries.map(e => e.conf));
  const window = (young ? PARASITE_WINDOW_YOUNG_DAYS : PARASITE_WINDOW_ADULT_DAYS) * DAY;
  let until: number | null = null;
  if (!merged.length) return { ok: false, reason: `${kind}_parasite_date_not_found`, until: null, conf };
  for (const pick of combos(merged)) {
    const times = pick.map(d => d.getTime());
    if (times.some(t => t < birth)) return { ok: false, reason: 'dates_inconsistent', until: null, conf };
    const past = times.filter(t => t <= today + DAY);
    if (!past.length) return { ok: false, reason: `${kind}_parasite_date_not_found`, until: null, conf };
    const latest = Math.max(...past);
    const validUntil = latest + window;
    if (validUntil < today) return { ok: false, reason: `${kind}_parasite_treatment_not_current`, until: null, conf };
    until = until === null ? validUntil : Math.min(until, validUntil);
  }
  return { ok: true, reason: 'ok', until, conf };
}

export function evaluateBooklet(pages: OcrPage[], pet: PetFacts, today: Date): BookletOutcome {
  const { rows, docConf, words } = buildRows(pages);
  const base = { documentConfidence: docConf, signalConfidence: 0, validUntil: null as string | null };
  if (!words) return { outcome: 'rejected', reasonCode: 'no_text_found', ...base };
  if (docConf < MIN_OCR_CONFIDENCE) return { outcome: 'rejected', reasonCode: 'ocr_confidence_too_low', ...base };
  const manual = (reasonCode: string): BookletOutcome => ({ outcome: 'manual_review', reasonCode, ...base });

  const species = (pet.species ?? '').toLowerCase();
  if (species !== 'dog' && species !== 'cat') return manual('species_not_covered');
  const birthMs = pet.birthDate ? Date.parse(`${pet.birthDate.slice(0, 10)}T00:00:00Z`) : NaN;
  if (!Number.isFinite(birthMs)) return manual('pet_birth_date_missing');
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (birthMs > todayMs) return manual('pet_birth_date_invalid');
  const ageMonths = Math.floor((todayMs - birthMs) / (30.4375 * DAY));
  if (ageMonths < MIN_AGE_MONTHS) return manual('primary_series_in_progress');
  if (!rows.some(r => r.cats.size > 0)) return manual('no_known_entries_found');

  const young = ageMonths < YOUNG_MONTHS;
  const coreKey = species === 'dog' ? 'dogCore' : 'catCore';
  const verdicts: [string, Verdict][] = [
    ['rabies', vaccineVerdict(entriesFor(rows, 'rabies'), todayMs, birthMs, 'rabies', ageMonths)],
    ['core', vaccineVerdict(entriesFor(rows, coreKey), todayMs, birthMs, 'core', ageMonths)],
    ['internal', parasiteVerdict(entriesFor(rows, 'internal'), todayMs, birthMs, 'internal', young)],
    ['external', parasiteVerdict(entriesFor(rows, 'external'), todayMs, birthMs, 'external', young)],
  ];
  const failed = verdicts.find(([, v]) => !v.ok);
  if (failed) return manual(failed[1].reason);

  const until = Math.min(...verdicts.map(([, v]) => v.until as number));
  const signalConfidence = Math.min(docConf, ...verdicts.map(([, v]) => v.conf));
  return {
    outcome: 'approved',
    reasonCode: 'all_required_entries_current',
    documentConfidence: docConf,
    signalConfidence,
    validUntil: new Date(until).toISOString(),
  };
}
