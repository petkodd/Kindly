import { describe, it, expect, afterEach } from 'vitest';
import { isFoundingBetaEnabled, getFoundingBetaDurationDays } from '../src/lib/foundingBeta';

afterEach(() => {
  delete process.env.FOUNDING_FAMILY_BETA_ENABLED;
  delete process.env.FOUNDING_FAMILY_BETA_DAYS;
});

describe('isFoundingBetaEnabled', () => {
  it('is false when unset', () => {
    expect(isFoundingBetaEnabled()).toBe(false);
  });

  it('is false for any value other than the literal string "true"', () => {
    process.env.FOUNDING_FAMILY_BETA_ENABLED = '1';
    expect(isFoundingBetaEnabled()).toBe(false);
    process.env.FOUNDING_FAMILY_BETA_ENABLED = 'TRUE';
    expect(isFoundingBetaEnabled()).toBe(false);
    process.env.FOUNDING_FAMILY_BETA_ENABLED = 'yes';
    expect(isFoundingBetaEnabled()).toBe(false);
  });

  it('is true only for the literal string "true"', () => {
    process.env.FOUNDING_FAMILY_BETA_ENABLED = 'true';
    expect(isFoundingBetaEnabled()).toBe(true);
  });
});

describe('getFoundingBetaDurationDays', () => {
  it('defaults to 14 when unset', () => {
    expect(getFoundingBetaDurationDays()).toBe(14);
  });

  it('reads a valid positive integer', () => {
    process.env.FOUNDING_FAMILY_BETA_DAYS = '30';
    expect(getFoundingBetaDurationDays()).toBe(30);
  });

  it('falls back to 14 for zero, negative, non-integer, or non-numeric values', () => {
    for (const v of ['0', '-5', '3.5', 'abc', '']) {
      process.env.FOUNDING_FAMILY_BETA_DAYS = v;
      expect(getFoundingBetaDurationDays()).toBe(14);
    }
  });

  it('falls back to 14 above the 365-day bound', () => {
    process.env.FOUNDING_FAMILY_BETA_DAYS = '9999';
    expect(getFoundingBetaDurationDays()).toBe(14);
  });

  it('accepts the bound itself', () => {
    process.env.FOUNDING_FAMILY_BETA_DAYS = '365';
    expect(getFoundingBetaDurationDays()).toBe(365);
  });
});
