import type { SpeechClient, SttResult, TtsResult } from './types';

/**
 * Deterministic stand-in for STT + TTS. Used by tests and local dev when
 * DEEPGRAM_API_KEY / ELEVENLABS_API_KEY are unset. Returns fixed values so
 * downstream voice route tests don't require live speech providers.
 */
export const fakeSpeechClient: SpeechClient = {
  async speechToText(_audio: Buffer, _mimeType: string): Promise<SttResult> {
    return { transcript: 'Hello, I would like to talk.', durationSeconds: 3.0 };
  },

  async textToSpeech(text: string, _opts?: { speechRate?: 'slow' | 'normal' }): Promise<TtsResult> {
    // Return a minimal valid data URL so the client can detect the format.
    const encoded = Buffer.from(text).toString('base64');
    return { audioUrl: `data:audio/mp3;base64,${encoded}` };
  },
};
