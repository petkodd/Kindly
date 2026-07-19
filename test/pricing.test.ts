import { describe, it, expect } from 'vitest';
import { computeAnnualSavingsPercent, formatUsdCents, perMonthEquivalentCents } from '../src/lib/pricing';

describe('formatUsdCents', () => {
  it('formats cents as a two-decimal dollar string', () => {
    expect(formatUsdCents(5900)).toBe('$59.00');
    expect(formatUsdCents(56640)).toBe('$566.40');
  });
});

describe('perMonthEquivalentCents', () => {
  it('divides the annual price by 12, rounding to the nearest cent', () => {
    expect(perMonthEquivalentCents(56640)).toBe(4720); // $566.40/yr -> exactly $47.20/mo, no rounding artifact
    expect(perMonthEquivalentCents(10000)).toBe(833); // a non-evenly-divisible price still rounds cleanly
  });
});

describe('computeAnnualSavingsPercent', () => {
  it('computes the whole-percent discount of annual vs. 12x monthly', () => {
    expect(computeAnnualSavingsPercent(5900, 56640)).toBe(20); // the confirmed 20% discount
  });

  it('returns 0 for an annual price with no discount', () => {
    expect(computeAnnualSavingsPercent(5900, 5900 * 12)).toBe(0);
  });

  it('guards against a zero/negative monthly price rather than dividing by zero', () => {
    expect(computeAnnualSavingsPercent(0, 56640)).toBe(0);
  });
});
