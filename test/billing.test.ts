import { describe, it, expect, afterEach } from 'vitest';
import { getPriceIdForInterval, computeReferralCreditCents } from '../src/lib/billing';

afterEach(() => {
  delete process.env.STRIPE_PRICE_ID;
  delete process.env.STRIPE_PRICE_ID_ANNUAL;
});

describe('getPriceIdForInterval', () => {
  it('resolves month -> STRIPE_PRICE_ID and year -> STRIPE_PRICE_ID_ANNUAL', () => {
    process.env.STRIPE_PRICE_ID = 'price_monthly_123';
    process.env.STRIPE_PRICE_ID_ANNUAL = 'price_annual_456';
    expect(getPriceIdForInterval('month')).toBe('price_monthly_123');
    expect(getPriceIdForInterval('year')).toBe('price_annual_456');
  });

  it('throws when the interval-specific env var is unset, independently of the other', () => {
    process.env.STRIPE_PRICE_ID = 'price_monthly_123';
    delete process.env.STRIPE_PRICE_ID_ANNUAL;
    expect(() => getPriceIdForInterval('month')).not.toThrow();
    expect(() => getPriceIdForInterval('year')).toThrow(/STRIPE_PRICE_ID_ANNUAL/);
  });
});

describe('computeReferralCreditCents', () => {
  it('monthly (or unknown/null) interval credits one month\'s price, unchanged from today\'s behavior', () => {
    expect(computeReferralCreditCents('month', 5900, 56640)).toBe(5900);
    expect(computeReferralCreditCents(null, 5900, 56640)).toBe(5900);
  });

  it('annual interval credits 1/12 of the annual price (Option B)', () => {
    expect(computeReferralCreditCents('year', 5900, 56640)).toBe(4720); // 56640/12, exact
  });

  it('rounds a non-evenly-divisible annual price to the nearest cent', () => {
    expect(computeReferralCreditCents('year', 5900, 10000)).toBe(833); // round(10000/12) = 833
  });
});
