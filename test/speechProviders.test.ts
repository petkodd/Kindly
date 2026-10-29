import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSpeechClient } from '../src/lib/speech/providers';

function stubFetchCapturingUrl() {
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(0),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createSpeechClient textToSpeech voice ID fallback', () => {
  const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';

  it.each([
    ['unset', undefined],
    ['empty string', ''],
  ])('falls back to the default voice when elevenlabsVoiceId is %s', async (_label, voiceId) => {
    const fetchMock = stubFetchCapturingUrl();
    const client = createSpeechClient({
      deepgramApiKey: 'dg-key',
      elevenlabsApiKey: 'el-key',
      elevenlabsVoiceId: voiceId,
    });

    await client.textToSpeech('hello');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${DEFAULT_VOICE_ID}?output_format=mp3_44100_128`);
  });

  it('uses an explicit voice ID when provided', async () => {
    const fetchMock = stubFetchCapturingUrl();
    const client = createSpeechClient({
      deepgramApiKey: 'dg-key',
      elevenlabsApiKey: 'el-key',
      elevenlabsVoiceId: 'customVoice123',
    });

    await client.textToSpeech('hello');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/customVoice123?output_format=mp3_44100_128');
  });
});

describe('createSpeechClient errors carry the status code only (no provider body)', () => {
  const BODY = '{"detail":"could not synthesise: I miss you, Maria"}';
  const failing = (status: number) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status, text: async () => BODY, json: async () => JSON.parse(BODY) })),
    );
  const client = () => createSpeechClient({ deepgramApiKey: 'dg', elevenlabsApiKey: 'el' });

  it('Deepgram STT failure', async () => {
    failing(400);
    const err = await client().speechToText(Buffer.from('x'), 'audio/webm').catch((e: Error) => e);
    expect((err as Error).message).toBe('Deepgram STT failed: 400');
  });

  it('ElevenLabs TTS failure', async () => {
    failing(503);
    const err = await client().textToSpeech('I miss you, Maria').catch((e: Error) => e);
    expect((err as Error).message).toBe('ElevenLabs TTS failed: 503');
  });
});

describe('talk settings reach the speech providers (chat 8)', () => {
  const client = () => createSpeechClient({ deepgramApiKey: 'dg', elevenlabsApiKey: 'el' });

  it("speech_rate 'slow' sends a real slower pace (voice_settings.speed 0.85); normal is 1.0", async () => {
    const fetchMock = stubFetchCapturingUrl();
    await client().textToSpeech('hello', { speechRate: 'slow' });
    await client().textToSpeech('hello', { speechRate: 'normal' });
    await client().textToSpeech('hello');
    const speeds = fetchMock.mock.calls.map(
      (c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)).voice_settings.speed,
    );
    expect(speeds).toEqual([0.85, 1.0, 1.0]);
  });

  it('passes the profile language to Deepgram instead of guessing it', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ results: {}, metadata: { duration: 1 } }) }));
    vi.stubGlobal('fetch', fetchMock);
    await client().speechToText(Buffer.from('x'), 'audio/webm', { language: 'es-US' });
    await client().speechToText(Buffer.from('x'), 'audio/webm');
    const urls = fetchMock.mock.calls.map((c) => String((c as unknown as [string])[0]));
    expect(urls[0]).toContain('&language=es-US');
    expect(urls[0]).not.toContain('detect_language');
    expect(urls[1]).toContain('&detect_language=true');
  });
});

describe('deepgramListenUrl', () => {
  it('accepts language codes and ignores anything that is not one', async () => {
    const { deepgramListenUrl } = await import('../src/lib/speech/providers');
    expect(deepgramListenUrl('en-US')).toMatch(/&language=en-US$/);
    expect(deepgramListenUrl('en')).toMatch(/&language=en$/);
    expect(deepgramListenUrl('es-419')).toMatch(/&language=es-419$/);
    for (const bad of ['', null, undefined, 'en&model=x', 'english', '../x']) {
      expect(deepgramListenUrl(bad)).toMatch(/&detect_language=true$/);
    }
  });
});
