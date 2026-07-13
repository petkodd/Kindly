import { describe, it, expect } from 'vitest';
import { EMAIL_RE } from '../src/lib/validation';

describe('EMAIL_RE', () => {
  it('accepts ordinary addresses, plus-addressing, and subdomains', () => {
    expect(EMAIL_RE.test('sarah@example.com')).toBe(true);
    expect(EMAIL_RE.test('sarah+kindly@example.com')).toBe(true);
    expect(EMAIL_RE.test('sarah@mail.example.co.uk')).toBe(true);
  });

  it('rejects missing local part, domain, TLD, or an embedded space', () => {
    expect(EMAIL_RE.test('@example.com')).toBe(false);
    expect(EMAIL_RE.test('sarah@')).toBe(false);
    expect(EMAIL_RE.test('sarah@example')).toBe(false);
    expect(EMAIL_RE.test('sarah @example.com')).toBe(false);
    expect(EMAIL_RE.test('not-an-email')).toBe(false);
    expect(EMAIL_RE.test('')).toBe(false);
  });

  it('rejects more than one @', () => {
    expect(EMAIL_RE.test('sarah@@example.com')).toBe(false);
    expect(EMAIL_RE.test('sarah@example@com')).toBe(false);
  });
});
