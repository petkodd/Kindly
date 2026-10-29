import { describe, it, expect } from 'vitest';
import { MAX_RECORDING_MS, baseMimeType, pickRecordingMimeType, uploadFileFor } from '../src/lib/talk/recording';

describe('pickRecordingMimeType', () => {
  it('prefers WebM/Opus (Chrome, Edge, Firefox)', () => {
    expect(pickRecordingMimeType((t) => t.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus');
  });

  it('falls back to MP4 on Safari, which has no WebM recorder', () => {
    expect(pickRecordingMimeType((t) => t === 'audio/mp4')).toBe('audio/mp4');
  });

  it('returns "" (browser default) when isTypeSupported is missing, throws, or supports nothing', () => {
    expect(pickRecordingMimeType(undefined)).toBe('');
    expect(pickRecordingMimeType(null)).toBe('');
    expect(pickRecordingMimeType(() => false)).toBe('');
    expect(
      pickRecordingMimeType(() => {
        throw new Error('nope');
      }),
    ).toBe('');
  });
});

describe('uploadFileFor', () => {
  it('names the upload after what was really recorded', () => {
    expect(uploadFileFor('audio/webm;codecs=opus')).toEqual({ filename: 'voice.webm', type: 'audio/webm' });
    expect(uploadFileFor('audio/mp4')).toEqual({ filename: 'voice.m4a', type: 'audio/mp4' });
    expect(uploadFileFor('audio/mp4;codecs=mp4a.40.2')).toEqual({ filename: 'voice.m4a', type: 'audio/mp4' });
    expect(uploadFileFor('audio/ogg;codecs=opus')).toEqual({ filename: 'voice.ogg', type: 'audio/ogg' });
    expect(uploadFileFor('')).toEqual({ filename: 'voice.webm', type: 'audio/webm' });
    expect(uploadFileFor(undefined)).toEqual({ filename: 'voice.webm', type: 'audio/webm' });
  });

  it('baseMimeType strips parameters', () => {
    expect(baseMimeType('Audio/WebM; codecs=opus')).toBe('audio/webm');
  });
});

it('recordings auto-stop at 60 seconds', () => {
  expect(MAX_RECORDING_MS).toBe(60_000);
});
