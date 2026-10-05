import type { DiscoveryFilters, Pet } from '../types/domain';

const MAX_PET_BIO_LENGTH = 500;
const MAX_MESSAGE_LENGTH = 2000;

export function validatePetForDiscovery(pet: Pet): string[] {
  const errors: string[] = [];
  if (!pet.name.trim()) errors.push('name_required');
  if (!pet.breed.trim()) errors.push('breed_required');
  if (!pet.birthDate) errors.push('birth_date_required');
  if (!pet.city.trim() || !pet.district.trim() || !pet.neighborhood?.trim()) errors.push('location_required');
  if (!pet.purposes.length) errors.push('purpose_required');
  if (pet.photos.length !== 3) errors.push('three_photos_required');
  if (pet.photos.some((p) => p.moderationStatus !== 'approved')) errors.push('photos_must_be_approved');
  if (pet.bio.length > MAX_PET_BIO_LENGTH) errors.push('bio_too_long');
  return errors;
}

export function defaultDiscoveryFilters(): DiscoveryFilters {
  return {
    species: 'all', breeds: [], sex: 'all', sizes: [], minAge: null, maxAge: null,
    minWeightKg:null,maxWeightKg:null,energyLevels:[],temperamentTags:[],neutered:'all',
    city: null, district: null, neighborhood: null, maxDistanceKm: null, purposes: [],
    vaccinatedOnly: false, profileVerifiedOnly: true, ownerVerifiedOnly:false,microchipVerifiedOnly:false,geneticScreeningOnly:false,pedigreeOnly:false,
    matingOnlyNonNeutered: true
  };
}

export function isPetSetupComplete(pet: Pet): boolean {
  return Boolean(pet.name.trim() && pet.breed.trim() && pet.birthDate && pet.city.trim() && pet.district.trim() && pet.neighborhood?.trim() && pet.purposes.length && pet.photos.length === 3);
}

export function normalizeMessageBody(input: string): string {
  return input.replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE_LENGTH);
}

/**
 * Parses a decimal typed by a user in any runtime locale ("1,5", "1.5", "2."), returning null for empty or
 * invalid input. Grouping separators are not accepted, so "1.000,5" is rejected instead of being misread.
 */
export function parseLocalizedDecimal(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(',', '.');
  if (!/^\d+(?:\.\d*)?$/.test(normalized) && !/^\.\d+$/.test(normalized)) return null;
  const value = Number(normalized.endsWith('.') ? normalized.slice(0, -1) : normalized);
  return Number.isFinite(value) ? value : null;
}
