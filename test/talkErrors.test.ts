import { describe, it, expect } from 'vitest';
import { expiredLinkMessage, familyLabel, mapTalkError } from '../src/lib/talk/errors';

const SARAH = { familyFirstName: 'Sarah', linkOwner: 'family' as const };

describe('mapTalkError', () => {
  it('no transcript (422) → "didn’t catch that", retry and typing offered', () => {
    for (const f of [{ status: 422 }, { status: 400, code: 'no_transcript' }]) {
      expect(mapTalkError(f)).toMatchObject({
        kind: 'not_heard',
        message: 'Sorry, I didn’t catch that — please try again.',
        canRetry: true,
        canType: true,
      });
    }
  });

  it('401 names the family member, or "your family" when unknown, and offers no dead-end buttons', () => {
    expect(mapTalkError({ status: 401 }, SARAH)).toMatchObject({
      message: 'Please ask Sarah to send you a new link.',
      canRetry: false,
      canType: false,
    });
    expect(mapTalkError({ status: 401 }).message).toBe('Please ask your family to send you a new link.');
  });

  it('self-use profiles are never told to ask their family', () => {
    expect(mapTalkError({ status: 401 }, { linkOwner: 'self' }).message).toBe('Please open Dearly again from your account.');
    expect(mapTalkError({ status: 403 }, { linkOwner: 'self' }).message).not.toMatch(/ask/i);
  });

  it('403, 429, 413, mic, offline and anything else all get a plain next step', () => {
    expect(mapTalkError({ status: 403 }, SARAH).message).toBe('I can’t chat just now. Please ask Sarah to check the account.');
    expect(mapTalkError({ status: 429 })).toMatchObject({ kind: 'too_many', canRetry: true, canType: false });
    expect(mapTalkError({ status: 413 })).toMatchObject({ kind: 'too_long', canType: true });
    expect(mapTalkError({ micDenied: true })).toMatchObject({ kind: 'mic_blocked', canType: true });
    expect(mapTalkError({ network: true })).toMatchObject({ kind: 'offline', canType: true, canRetry: true });
    expect(mapTalkError({ status: 500 })).toMatchObject({ kind: 'went_wrong', canType: true, canRetry: true });
    expect(mapTalkError({ status: 502, code: 'whatever' }).kind).toBe('went_wrong');
  });

  it('every message is short, plain and free of technical words', () => {
    const failures = [
      { status: 422 }, { status: 401 }, { status: 403 }, { status: 429 }, { status: 413 },
      { status: 500 }, { micDenied: true }, { network: true },
    ];
    for (const f of failures) {
      const { message } = mapTalkError(f, SARAH);
      expect(message.split(/\s+/).length).toBeLessThanOrEqual(20);
      expect(message).not.toMatch(/transcri|token|error|server|http|\d{3}|request|api/i);
    }
  });
});

describe('familyLabel / expiredLinkMessage', () => {
  it('falls back to "your family" for empty names', () => {
    expect(familyLabel({ familyFirstName: '  ' })).toBe('your family');
    expect(expiredLinkMessage({ familyFirstName: 'Mike' })).toBe('Please ask Mike to send you a new link.');
  });
});
