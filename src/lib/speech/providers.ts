import { SpeechError, TTS_SPEED, type SpeechClient, type SttOptions, type SttResult, type TtsOptions, type TtsResult } from './types';

/** Deepgram language codes look like 'en', 'en-US', 'es-419'. Anything else falls back to detection. */
const LANGUAGE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,4})?$/;

/**
 * Deepgram /listen URL: the profile's language when valid, otherwise language
 * detection. `mip_opt_out=true` opts every request out of Deepgram's Model
 * Improvement Program, so parents' audio is never kept to train Deepgram's
 * models (see docs/voice-selection.md, "Vendor data handling").
 */
export function deepgramListenUrl(language?: string | null): string {
  const base = 'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&mip_opt_out=true';
  const lang = language?.trim();
  return lang && LANGUAGE_RE.test(lang) ? `${base}&language=${encodeURIComponent(lang)}` : `${base}&detect_language=true`;
}

/**
 * Real speech client using Deepgram (STT) and ElevenLabs (TTS).
 * Both are called via fetch — no SDK dependency required.
 *
 * Deepgram: POST audio bytes to the Nova-2 model with smart_format enabled.
 * ElevenLabs: POST text to the TTS endpoint using eleven_multilingual_v2
 * (chosen over the turbo models for voice quality — latency isn't yet a
 * constraint here), receive mp3 bytes, return as a base64 data URL (blob
 * storage upgrade is tracked as a follow-up).
 */
export function createSpeechClient(opts: {
  deepgramApiKey: string;
  elevenlabsApiKey: string;
  /** ElevenLabs voice ID. Default: Bella (EXAVITQu4vr4xnSDxMaL). */
  elevenlabsVoiceId?: string;
}): SpeechClient {
  const voiceId = opts.elevenlabsVoiceId || 'EXAVITQu4vr4xnSDxMaL';

  return {
    async speechToText(audio: Buffer, mimeType: string, sttOpts?: SttOptions): Promise<SttResult> {
      const res = await fetch(
        deepgramListenUrl(sttOpts?.language),
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
        // Status only: provider bodies can echo request content and end up in logs/Sentry.
        throw new SpeechError(`Deepgram STT failed: ${res.status}`);
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

    async textToSpeech(text: string, opts2?: TtsOptions): Promise<TtsResult> {
      // stability + similarity_boost tuned for clarity with older listeners;
      // speed is the real pace control (voice_settings.speed, 0.7–1.2).
      const rate = opts2?.speechRate === 'slow' ? 'slow' : 'normal';
      const stability = rate === 'slow' ? 0.75 : 0.6;
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
            model_id: 'eleven_multilingual_v2',
            voice_settings: { stability, similarity_boost: 0.75, speed: TTS_SPEED[rate] },
          }),
        },
      );
      if (!res.ok) {
        // Status only: provider bodies can echo the spoken text and end up in logs/Sentry.
        throw new SpeechError(`ElevenLabs TTS failed: ${res.status}`);
      }
      const audioBuffer = Buffer.from(await res.arrayBuffer());
      const audioUrl = `data:audio/mp3;base64,${audioBuffer.toString('base64')}`;
      return { audioUrl };
    },
  };
}
