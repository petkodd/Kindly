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

export interface SpeechClient {
  speechToText(audio: Buffer, mimeType: string): Promise<SttResult>;
  textToSpeech(text: string, opts?: { speechRate?: 'slow' | 'normal' }): Promise<TtsResult>;
}
