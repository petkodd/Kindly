import { SpeechError, type SpeechClient, type SttResult, type TtsResult } from './types';

/**
 * Real speech client using Deepgram (STT) and ElevenLabs (TTS).
 * Both are called via fetch — no SDK dependency required.
 *
 * Deepgram: POST audio bytes to the Nova-2 model with smart_format enabled.
 * ElevenLabs: POST text to the TTS endpoint, receive mp3 bytes, return as
 * a base64 data URL (blob storage upgrade is tracked as a follow-up).
 */
export function createSpeechClient(opts: {
  deepgramApiKey: string;
  elevenlabsApiKey: string;
  /** ElevenLabs voice ID. Default: Adam (pNInz6obpgDQGcFmaJgB). */
  elevenlabsVoiceId?: string;
}): SpeechClient {
  const voiceId = opts.elevenlabsVoiceId || 'pNInz6obpgDQGcFmaJgB';

  return {
    async speechToText(audio: Buffer, mimeType: string): Promise<SttResult> {
      const res = await fetch(
        'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&detect_language=true',
        {
          method: 'POST',
          headers: {
            Authorization: `Token ${opts.deepgramApiKey}`,
            'Content-Type': mimeType,
          },
          body: audio,
        },
      );
      if (!res.ok) {
        throw new SpeechError(`Deepgram STT failed: ${res.status} ${await res.text()}`);
      }
      const data = (await res.json()) as {
        results?: {
          channels?: { alternatives?: { transcript?: string }[] }[];
          metadata?: { duration?: number };
        };
        metadata?: { duration?: number };
      };
      const transcript =
        data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? '';
      const durationSeconds = data.metadata?.duration ?? 0;
      return { transcript, durationSeconds };
    },

    async textToSpeech(
      text: string,
      opts2?: { speechRate?: 'slow' | 'normal' },
    ): Promise<TtsResult> {
      // stability + similarity_boost tuned for clarity with older listeners.
      const stability = opts2?.speechRate === 'slow' ? 0.75 : 0.6;
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': opts.elevenlabsApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_turbo_v2_5',
            voice_settings: { stability, similarity_boost: 0.75 },
          }),
        },
      );
      if (!res.ok) {
        throw new SpeechError(`ElevenLabs TTS failed: ${res.status} ${await res.text()}`);
      }
      const audioBuffer = Buffer.from(await res.arrayBuffer());
      const audioUrl = `data:audio/mp3;base64,${audioBuffer.toString('base64')}`;
      return { audioUrl };
    },
  };
}
