import type { SpeechClient } from './types';
import { fakeSpeechClient } from './fake';
import { SPEECH_KEYS, shouldUseFake } from '../runtimeMode';

export * from './types';
export { fakeSpeechClient } from './fake';

let cached: SpeechClient | undefined;

/**
 * Returns the real Deepgram+ElevenLabs client when both API keys are set.
 * Uses the deterministic fake when DEMO_MODE=true, or when a key is missing
 * outside production (tests + local dev). On the production deploy a missing
 * key throws MissingProviderKeyError — see src/lib/runtimeMode.ts. Lazy
 * import keeps provider code out of the keyless path.
 */
export function getSpeechClient(): SpeechClient {
  if (cached) return cached;
  if (shouldUseFake(SPEECH_KEYS)) {
    cached = fakeSpeechClient;
    return cached;
  }
  const deepgramKey = process.env.DEEPGRAM_API_KEY as string;
  const elevenlabsKey = process.env.ELEVENLABS_API_KEY as string;
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
