/** Thrown when a speech provider (Deepgram/ElevenLabs) call fails. */
export class SpeechError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpeechError';
  }
}

export interface SttResult {
  transcript: string;
  /** Wall-clock duration of the audio clip in seconds. Used to log voice_minutes. */
  durationSeconds: number;
}

export interface TtsResult {
  /**
   * URL to the synthesized audio. In Alpha this is a data URL (base64 encoded
   * audio/mp3); once blob storage is wired it becomes a CDN URL.
   */
  audioUrl: string;
}

export interface SttOptions {
  /**
   * BCP-47 language of the speaker (the parent profile's `language`, e.g.
   * 'en-US'). When set, recognition uses it instead of guessing the language.
   */
  language?: string | null;
}

export interface TtsOptions {
  /** 'slow' speaks noticeably slower (ElevenLabs voice_settings.speed). */
  speechRate?: 'slow' | 'normal';
}

/** ElevenLabs voice_settings.speed per profile setting (API range 0.7–1.2, 1.0 = natural pace). */
export const TTS_SPEED: Record<'slow' | 'normal', number> = { slow: 0.85, normal: 1.0 };

export interface SpeechClient {
  speechToText(audio: Buffer, mimeType: string, opts?: SttOptions): Promise<SttResult>;
  textToSpeech(text: string, opts?: TtsOptions): Promise<TtsResult>;
}
