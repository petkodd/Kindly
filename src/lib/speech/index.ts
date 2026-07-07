import type { SpeechClient } from './types';
import { fakeSpeechClient } from './fake';

export * from './types';
export { fakeSpeechClient } from './fake';

let cached: SpeechClient | undefined;

/**
 * Returns the real Deepgram+ElevenLabs client when both API keys are set;
 * otherwise falls back to the deterministic fake (tests + local dev).
 * Mirrors the pattern of getAiClient() — lazy import keeps provider code
 * out of the keyless path.
 */
export function getSpeechClient(): SpeechClient {
  if (cached) return cached;
  const deepgramKey = process.env.DEEPGRAM_API_KEY;
  const elevenlabsKey = process.env.ELEVENLABS_API_KEY;
  if (!deepgramKey || !elevenlabsKey) {
    cached = fakeSpeechClient;
    return cached;
  }
  const { createSpeechClient } = require('./providers') as typeof import('./providers');
  cached = createSpeechClient({
    deepgramApiKey: deepgramKey,
    elevenlabsApiKey: elevenlabsKey,
    elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID,
  });
  return cached;
}

/** Test seam: reset the memoized client. */
export function resetSpeechClient(): void {
  cached = undefined;
}
