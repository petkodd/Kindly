/**
 * Microphone recording helpers for the talk screen.
 *
 * Browsers record in different containers: Chrome, Edge and Firefox produce
 * WebM/Opus, while Safari (macOS and iOS) produces MP4/AAC and has no WebM
 * recorder. Hard-coding "voice.webm" made Safari uploads lie about their
 * format, so we pick a type the browser can actually record and label the
 * upload to match.
 */

/** A recording auto-stops after this long, so a forgotten tap can't record forever. */
export const MAX_RECORDING_MS = 60_000;

/** Preferred first. WebM/Opus is smallest; MP4/AAC is what Safari supports. */
export const RECORDING_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
] as const;

/**
 * The first candidate the browser says it can record, or '' to let the
 * browser choose its default (older browsers without isTypeSupported).
 */
export function pickRecordingMimeType(isTypeSupported?: ((type: string) => boolean) | null): string {
  if (typeof isTypeSupported !== 'function') return '';
  for (const type of RECORDING_MIME_CANDIDATES) {
    try {
      if (isTypeSupported(type)) return type;
    } catch {
      // Some browsers throw on unknown types; treat that as "not supported".
    }
  }
  return '';
}

/** The base media type without parameters: 'audio/webm;codecs=opus' → 'audio/webm'. */
export function baseMimeType(mimeType: string | null | undefined): string {
  return (mimeType ?? '').split(';')[0].trim().toLowerCase();
}

/**
 * Filename and content type for the upload, matching what was recorded.
 * Falls back to WebM only when the browser reported nothing at all.
 */
export function uploadFileFor(mimeType: string | null | undefined): { filename: string; type: string } {
  const base = baseMimeType(mimeType);
  if (base === 'audio/mp4' || base === 'audio/x-m4a' || base === 'audio/aac') {
    return { filename: 'voice.m4a', type: 'audio/mp4' };
  }
  if (base === 'audio/ogg') return { filename: 'voice.ogg', type: 'audio/ogg' };
  if (base === 'audio/wav' || base === 'audio/x-wav') return { filename: 'voice.wav', type: 'audio/wav' };
  return { filename: 'voice.webm', type: 'audio/webm' };
}
