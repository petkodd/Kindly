import { describe, it, expect, afterEach } from 'vitest';
import { getPriceIdForInterval } from '../src/lib/billing';

afterEach(() => {
  delete process.env.STRIPE_PRICE_FAMILY_MONTHLY;
  delete process.env.STRIPE_PRICE_FAMILY_ANNUAL;
});

describe('getPriceIdForInterval', () => {
  it('resolves month -> STRIPE_PRICE_FAMILY_MONTHLY and year -> STRIPE_PRICE_FAMILY_ANNUAL', () => {
    process.env.STRIPE_PRICE_FAMILY_MONTHLY = 'price_monthly_123';
    process.env.STRIPE_PRICE_FAMILY_ANNUAL = 'price_annual_456';
    expect(getPriceIdForInterval('month')).toBe('price_monthly_123');
    expect(getPriceIdForInterval('year')).toBe('price_annual_456');
  });

  it('throws when the interval-specific env var is unset, independently of the other', () => {
    process.env.STRIPE_PRICE_FAMILY_MONTHLY = 'price_monthly_123';
    delete process.env.STRIPE_PRICE_FAMILY_ANNUAL;
    expect(() => getPriceIdForInterval('month')).not.toThrow();
    expect(() => getPriceIdForInterval('year')).toThrow(/STRIPE_PRICE_FAMILY_ANNUAL/);
  });
});
