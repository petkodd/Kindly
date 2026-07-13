import { describe, it, expect, afterEach } from 'vitest';
import { getAiClient, resetAiClient, fakeAiClient } from '../src/lib/ai';
import { getEmailClient, resetEmailClient, fakeEmailClient } from '../src/lib/email';
import { getSpeechClient, resetSpeechClient, fakeSpeechClient } from '../src/lib/speech';

/**
 * getAiClient / getEmailClient / getSpeechClient each fall back to a
 * deterministic fake when their provider key(s) are unset, and memoize the
 * result until reset*Client() clears it. This is the safety net that keeps
 * local dev/CI/tests provider-key-free — worth pinning down directly, since
 * every other test only exercises it incidentally (by never setting a key).
 */

afterEach(() => {
  resetAiClient();
  resetEmailClient();
  resetSpeechClient();
  delete process.env.AI_API_KEY;
  delete process.env.EMAIL_API_KEY;
  delete process.env.EMAIL_FROM;
  delete process.env.DEEPGRAM_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
});

describe('getAiClient', () => {
  it('falls back to the fake client when AI_API_KEY is unset', () => {
    delete process.env.AI_API_KEY;
    expect(getAiClient()).toBe(fakeAiClient);
  });

  it('memoizes the client until resetAiClient() is called', () => {
    delete process.env.AI_API_KEY;
    const first = getAiClient();
    process.env.AI_API_KEY = 'would-select-the-real-client';
    // Still cached — setting the env var after the fact does not retroactively swap it.
    expect(getAiClient()).toBe(first);
    resetAiClient();
    delete process.env.AI_API_KEY; // avoid actually instantiating the real (SDK) client
    expect(getAiClient()).toBe(fakeAiClient);
  });
});

describe('getEmailClient', () => {
  it('falls back to the fake client when EMAIL_API_KEY or EMAIL_FROM is unset', () => {
    delete process.env.EMAIL_API_KEY;
    delete process.env.EMAIL_FROM;
    expect(getEmailClient()).toBe(fakeEmailClient);

    resetEmailClient();
    process.env.EMAIL_API_KEY = 'key-only-no-from';
    delete process.env.EMAIL_FROM;
    expect(getEmailClient()).toBe(fakeEmailClient);
  });

  it('memoizes the client until resetEmailClient() is called', () => {
    delete process.env.EMAIL_API_KEY;
    delete process.env.EMAIL_FROM;
    const first = getEmailClient();
    process.env.EMAIL_API_KEY = 'would-select-the-real-client';
    process.env.EMAIL_FROM = 'kindly@example.com';
    // Still cached — setting the env vars after the fact does not retroactively swap it.
    expect(getEmailClient()).toBe(first);
    resetEmailClient();
    delete process.env.EMAIL_API_KEY; // avoid actually instantiating the real (network) client
    delete process.env.EMAIL_FROM;
    expect(getEmailClient()).toBe(fakeEmailClient);
  });
});

describe('getSpeechClient', () => {
  it('falls back to the fake client unless BOTH Deepgram and ElevenLabs keys are set', () => {
    delete process.env.DEEPGRAM_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    expect(getSpeechClient()).toBe(fakeSpeechClient);

    resetSpeechClient();
    process.env.DEEPGRAM_API_KEY = 'dg-only';
    delete process.env.ELEVENLABS_API_KEY;
    expect(getSpeechClient()).toBe(fakeSpeechClient);
  });

  it('memoizes the client until resetSpeechClient() is called', () => {
    delete process.env.DEEPGRAM_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    const first = getSpeechClient();
    process.env.DEEPGRAM_API_KEY = 'would-select-the-real-client';
    process.env.ELEVENLABS_API_KEY = 'would-select-the-real-client';
    // Still cached — setting the env vars after the fact does not retroactively swap it.
    expect(getSpeechClient()).toBe(first);
    resetSpeechClient();
    delete process.env.DEEPGRAM_API_KEY; // avoid actually instantiating the real (network) client
    delete process.env.ELEVENLABS_API_KEY;
    expect(getSpeechClient()).toBe(fakeSpeechClient);
  });
});
