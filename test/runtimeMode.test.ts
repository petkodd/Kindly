import { describe, it, expect, afterEach } from 'vitest';
import {
  isAiOrVoiceSimulated,
  isDemoMode,
  MissingProviderKeyError,
  shouldUseFake,
} from '../src/lib/runtimeMode';
import { getAiClient, resetAiClient, fakeAiClient } from '../src/lib/ai';
import { getEmailClient, resetEmailClient, fakeEmailClient } from '../src/lib/email';
import { getSpeechClient, resetSpeechClient, fakeSpeechClient } from '../src/lib/speech';

/**
 * Production must never silently fall back to a fake provider client. Only
 * DEMO_MODE=true allows the fakes on a production deploy; local dev, tests and
 * previews keep the old keyless fallback.
 */

const VARS = [
  'VERCEL_ENV',
  'DEMO_MODE',
  'AI_API_KEY',
  'DEEPGRAM_API_KEY',
  'ELEVENLABS_API_KEY',
  'EMAIL_API_KEY',
  'EMAIL_FROM',
];

afterEach(() => {
  for (const v of VARS) delete process.env[v];
  resetAiClient();
  resetEmailClient();
  resetSpeechClient();
});

describe('isDemoMode', () => {
  it('is true only for the exact string "true"', () => {
    expect(isDemoMode({ DEMO_MODE: 'true' })).toBe(true);
    for (const v of [undefined, '', '1', 'TRUE', 'yes', 'false']) {
      expect(isDemoMode({ DEMO_MODE: v })).toBe(false);
    }
  });
});

describe('shouldUseFake', () => {
  it('uses the real client when every key is set', () => {
    expect(shouldUseFake(['A', 'B'], { A: 'x', B: 'y', VERCEL_ENV: 'production' })).toBe(false);
  });

  it('falls back to the fake outside production (local dev, tests, preview)', () => {
    expect(shouldUseFake(['A'], {})).toBe(true);
    expect(shouldUseFake(['A'], { VERCEL_ENV: 'preview' })).toBe(true);
    expect(shouldUseFake(['A'], { VERCEL_ENV: 'development' })).toBe(true);
  });

  it('throws in production when a key is missing and DEMO_MODE is off', () => {
    expect(() => shouldUseFake(['A', 'B'], { VERCEL_ENV: 'production', A: 'x' })).toThrow(
      MissingProviderKeyError,
    );
    expect(() => shouldUseFake(['A'], { VERCEL_ENV: 'production', DEMO_MODE: 'false' })).toThrow(
      /A is not set/,
    );
  });

  it('names every missing key in the error, never a value', () => {
    try {
      shouldUseFake(['A', 'B'], { VERCEL_ENV: 'production' });
      throw new Error('expected a throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MissingProviderKeyError);
      expect((err as MissingProviderKeyError).missing).toEqual(['A', 'B']);
      expect((err as Error).message).toMatch(/A, B are not set/);
      expect((err as Error).message).toMatch(/DEMO_MODE=true/);
    }
  });

  it('DEMO_MODE=true uses the fake even in production and even when keys are set', () => {
    expect(shouldUseFake(['A'], { VERCEL_ENV: 'production', DEMO_MODE: 'true' })).toBe(true);
    expect(shouldUseFake(['A'], { VERCEL_ENV: 'production', DEMO_MODE: 'true', A: 'x' })).toBe(true);
  });
});

describe('provider clients on a production deploy (VERCEL_ENV=production)', () => {
  it('getAiClient throws a clear error when AI_API_KEY is missing', () => {
    process.env.VERCEL_ENV = 'production';
    expect(() => getAiClient()).toThrow(/AI_API_KEY is not set/);
  });

  it('getSpeechClient throws when DEEPGRAM_API_KEY or ELEVENLABS_API_KEY is missing', () => {
    process.env.VERCEL_ENV = 'production';
    expect(() => getSpeechClient()).toThrow(/DEEPGRAM_API_KEY, ELEVENLABS_API_KEY are not set/);

    resetSpeechClient();
    process.env.DEEPGRAM_API_KEY = 'dg';
    expect(() => getSpeechClient()).toThrow(/ELEVENLABS_API_KEY is not set/);

    resetSpeechClient();
    delete process.env.DEEPGRAM_API_KEY;
    process.env.ELEVENLABS_API_KEY = 'el';
    expect(() => getSpeechClient()).toThrow(/DEEPGRAM_API_KEY is not set/);
  });

  it('getEmailClient throws when EMAIL_API_KEY (or EMAIL_FROM) is missing', () => {
    process.env.VERCEL_ENV = 'production';
    expect(() => getEmailClient()).toThrow(/EMAIL_API_KEY, EMAIL_FROM are not set/);

    resetEmailClient();
    process.env.EMAIL_FROM = 'Dearly <hello@example.com>';
    expect(() => getEmailClient()).toThrow(/EMAIL_API_KEY is not set/);
  });

  it('a failed build is not cached — setting the key afterwards fixes it', () => {
    process.env.VERCEL_ENV = 'production';
    expect(() => getAiClient()).toThrow(MissingProviderKeyError);
    process.env.DEMO_MODE = 'true';
    expect(getAiClient()).toBe(fakeAiClient);
  });

  it('with DEMO_MODE=true every client is the fake', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.DEMO_MODE = 'true';
    expect(getAiClient()).toBe(fakeAiClient);
    expect(getSpeechClient()).toBe(fakeSpeechClient);
    expect(getEmailClient()).toBe(fakeEmailClient);
  });
});

describe('the fake email client', () => {
  it('reports its sends as simulated', async () => {
    const r = await fakeEmailClient.send({ to: 'a@example.com', subject: 's', html: 'h', text: 't' });
    expect(r.simulated).toBe(true);
  });
});

describe('isAiOrVoiceSimulated (drives the demo badge)', () => {
  it('is true in demo mode', () => {
    expect(isAiOrVoiceSimulated({ DEMO_MODE: 'true', VERCEL_ENV: 'production' })).toBe(true);
  });

  it('is true locally when an AI or voice key is missing', () => {
    expect(isAiOrVoiceSimulated({})).toBe(true);
    expect(isAiOrVoiceSimulated({ AI_API_KEY: 'a', DEEPGRAM_API_KEY: 'd' })).toBe(true);
  });

  it('is false when every AI and voice key is set', () => {
    expect(
      isAiOrVoiceSimulated({ AI_API_KEY: 'a', DEEPGRAM_API_KEY: 'd', ELEVENLABS_API_KEY: 'e' }),
    ).toBe(false);
  });

  it('never claims "simulated" on production without demo mode (the clients throw instead)', () => {
    expect(isAiOrVoiceSimulated({ VERCEL_ENV: 'production' })).toBe(false);
  });
});
