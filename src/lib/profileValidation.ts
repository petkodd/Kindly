import { PARENT_SHORT_FIELD_MAX } from '@/lib/types';

export type ProfileField = 'pronouns' | 'city';

/**
 * Client-side mirror of the server caps on the parent profile (parentRepo
 * shortText) for inline validation. The server stays the authority.
 */
export function validateProfile(values: { pronouns: string; city: string }): Partial<Record<ProfileField, string>> {
  const errors: Partial<Record<ProfileField, string>> = {};
  if (values.pronouns.trim().length > PARENT_SHORT_FIELD_MAX) {
    errors.pronouns = `Pronouns must be ${PARENT_SHORT_FIELD_MAX} characters or fewer.`;
  }
  if (values.city.trim().length > PARENT_SHORT_FIELD_MAX) {
    errors.city = `City must be ${PARENT_SHORT_FIELD_MAX} characters or fewer.`;
  }
  return errors;
}
