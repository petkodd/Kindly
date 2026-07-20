import { describe, it, expect, afterEach } from 'vitest';
import { getPriceIdForInterval } from '../src/lib/billing';

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
