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

export function compatibilityScore(a: Pet, b: Pet): number {
  let score = 35;
  if (a.species === b.species) score += 15;
  score += Math.min(20, commonPurposes(a, b).length * 7);
  if (a.size === b.size) score += 8;
  if (a.energyLevel && b.energyLevel) score += Math.max(0, 10 - Math.abs(a.energyLevel - b.energyLevel) * 2);
  if (a.health.vaccinationStatus === 'complete' && b.health.vaccinationStatus === 'complete') score += 5;
  if (a.profileVerified && b.profileVerified) score += 5;
  return Math.max(0, Math.min(100, Math.round(score)));
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
