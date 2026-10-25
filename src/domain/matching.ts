import type { Pet, Purpose } from '../types/domain';

const intersect = <T,>(a: T[], b: T[]): T[] => a.filter((x) => b.includes(x));

export function commonPurposes(a: Pet, b: Pet): Purpose[] {
  return intersect(a.purposes, b.purposes);
}

type MatingSafetyReason = 'species' | 'sex' | 'neutered' | 'vaccination';

export function matingSafetySignals(a: Pet, b: Pet) {
  const reasons: MatingSafetyReason[] = [];
  if (a.species !== b.species) reasons.push('species');
  if (a.sex === b.sex) reasons.push('sex');
  if (a.health.neutered !== false || b.health.neutered !== false) reasons.push('neutered');
  if (a.health.vaccinationStatus !== 'complete' || b.health.vaccinationStatus !== 'complete') reasons.push('vaccination');
  return { eligibleForDiscovery: reasons.length === 0, reasons };
}

// Spec v5.0 Annex A: explainable weighted match score.
// Proximity 30 %, energy 25 %, size safety 20 %, character 15 %, health/documents 10 %.
export const MATCH_SCORE_WEIGHTS = { proximity: 30, energy: 25, size: 20, character: 15, health: 10 } as const;
export type MatchScoreComponent = keyof typeof MATCH_SCORE_WEIGHTS;
export type MatchScoreBreakdown = { score: number; sizeExcluded: boolean; components: Record<MatchScoreComponent, number> };

const SIZE_ORDER = { mini: 0, small: 1, medium: 2, large: 3, giant: 4 } as const;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** Giant and mini dogs are never paired: the size gap is a physical safety risk (spec 3.5 / Annex A). */
export function isSizeSafetyExcluded(a: Pet, b: Pet): boolean {
  if (a.species !== 'dog' || b.species !== 'dog') return false;
  const pair = [a.size, b.size].sort().join(':');
  return pair === 'giant:mini';
}

function proximityFactor(distanceKm: number | undefined): number {
  if (distanceKm === undefined || !Number.isFinite(distanceKm)) return 0.5;
  if (distanceKm <= 1) return 1;
  return clamp01(1 - (distanceKm - 1) / 24);
}

function energyFactor(a: Pet, b: Pet): number {
  if (!a.energyLevel || !b.energyLevel) return 0.5;
  return clamp01(1 - Math.abs(a.energyLevel - b.energyLevel) / 4);
}

function sizeFactor(a: Pet, b: Pet): number {
  if (isSizeSafetyExcluded(a, b)) return 0;
  const gap = Math.abs((SIZE_ORDER[a.size] ?? 2) - (SIZE_ORDER[b.size] ?? 2));
  return [1, 0.75, 0.4, 0, 0][gap] ?? 0;
}

function characterFactor(a: Pet, b: Pet): number {
  const left = new Set(a.temperamentTags.map((tag) => tag.toLowerCase()));
  const right = new Set(b.temperamentTags.map((tag) => tag.toLowerCase()));
  if (!left.size && !right.size) return 0.5;
  const union = new Set([...left, ...right]);
  let shared = 0;
  left.forEach((tag) => { if (right.has(tag)) shared += 1; });
  return union.size ? shared / union.size : 0.5;
}

function healthFactor(a: Pet, b: Pet): number {
  const vaccinated = (a.health.vaccinationStatus === 'complete' ? 1 : 0) + (b.health.vaccinationStatus === 'complete' ? 1 : 0);
  return clamp01(vaccinated / 2);
}

/** `b.approximateDistanceKm` is the viewer-relative distance returned by discovery. */
export function matchScoreBreakdown(a: Pet, b: Pet): MatchScoreBreakdown {
  const factors: Record<MatchScoreComponent, number> = {
    proximity: proximityFactor(b.approximateDistanceKm ?? a.approximateDistanceKm),
    energy: energyFactor(a, b),
    size: sizeFactor(a, b),
    character: characterFactor(a, b),
    health: healthFactor(a, b),
  };
  const components = Object.fromEntries(
    (Object.keys(MATCH_SCORE_WEIGHTS) as MatchScoreComponent[]).map((key) => [key, Math.round(factors[key] * MATCH_SCORE_WEIGHTS[key] * 10) / 10]),
  ) as Record<MatchScoreComponent, number>;
  const total = Object.values(components).reduce((sum, value) => sum + value, 0);
  const sizeExcluded = isSizeSafetyExcluded(a, b);
  return { score: sizeExcluded ? 0 : Math.max(0, Math.min(100, Math.round(total))), sizeExcluded, components };
}

export function compatibilityScore(a: Pet, b: Pet): number {
  return matchScoreBreakdown(a, b).score;
}

export function ageYearsFromBirthDate(birthDate?: string, now = new Date()): number | undefined {
  if (!birthDate) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const validationDate = new Date(Date.UTC(year, month - 1, day));
  if (validationDate.getUTCFullYear() !== year || validationDate.getUTCMonth() !== month - 1 || validationDate.getUTCDate() !== day) return undefined;

  const todayYear = now.getFullYear();
  const todayMonth = now.getMonth() + 1;
  const todayDay = now.getDate();
  if (year > todayYear || (year === todayYear && (month > todayMonth || (month === todayMonth && day > todayDay)))) return undefined;

  let age = todayYear - year;
  if (todayMonth < month || (todayMonth === month && todayDay < day)) age -= 1;
  return Math.max(0, age);
}
