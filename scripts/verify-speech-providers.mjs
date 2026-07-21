#!/usr/bin/env node
/**
 * One-off MANUAL verification that the real Deepgram + ElevenLabs speech
 * providers work end-to-end with the keys in .env.local. Not part of the
 * test suite, not run by npm test/CI — invoke directly:
 *
 *   node scripts/verify-speech-providers.mjs
 *
 * The `src/lib/speech/*.ts` sources use extensionless relative imports
 * (resolved by Next.js's bundler) and index.ts uses a require() inside an
 * ESM-syntax file (relies on being bundled to CJS by Next). Raw Node ESM
 * can't load that directly, so we compile just this subtree to CommonJS
 * with the project's own `tsc` into a temp dir and require the output —
 * this exercises the exact same source, just compiled the way Next does.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

process.loadEnvFile(path.join(rootDir, '.env.local'));

let failures = 0;
function report(name, ok, detail) {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const deepgramKey = process.env.DEEPGRAM_API_KEY;
const elevenlabsKey = process.env.ELEVENLABS_API_KEY;
if (!deepgramKey || !elevenlabsKey) {
  report('env keys present', false, 'DEEPGRAM_API_KEY and/or ELEVENLABS_API_KEY missing from .env.local');
  process.exit(1);
}
report('env keys present', true);

const buildDir = mkdtempSync(path.join(tmpdir(), 'kindly-speech-verify-'));
try {
  const speechDir = path.join(rootDir, 'src/lib/speech');
  // Flags are hardcoded rather than read from tsconfig.json: this only needs
  // to transpile to runnable CJS, not type-check, so it deliberately doesn't
  // inherit the project's strictness settings.
  execFileSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    [
      '--no-install',
      'tsc',
      '--module', 'commonjs',
      '--target', 'es2020',
      '--moduleResolution', 'node',
      '--esModuleInterop',
      '--skipLibCheck',
      '--outDir', buildDir,
      path.join(speechDir, 'types.ts'),
      path.join(speechDir, 'fake.ts'),
      path.join(speechDir, 'providers.ts'),
      path.join(speechDir, 'index.ts'),
    ],
    { cwd: rootDir, stdio: 'inherit' },
  );

  const { createSpeechClient } = require(path.join(buildDir, 'providers.js'));
  const { SpeechError } = require(path.join(buildDir, 'types.js'));

  const client = createSpeechClient({
    deepgramApiKey: deepgramKey,
    elevenlabsApiKey: elevenlabsKey,
    elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID,
  });

  // --- textToSpeech ---
  let ttsAudio;
  try {
    const { audioUrl } = await client.textToSpeech('Здравей, това е тестово съобщение от Kindly.');
    const match = /^data:audio\/mp3;base64,(.+)$/.exec(audioUrl);
    ttsAudio = match ? Buffer.from(match[1], 'base64') : undefined;
    const ok = !!ttsAudio && ttsAudio.length > 1000;
    report('ElevenLabs textToSpeech', ok, `decoded audio bytes=${ttsAudio?.length ?? 0}`);
  } catch (err) {
    const detail = err instanceof SpeechError ? err.message : String(err instanceof Error ? err.stack : err);
    report('ElevenLabs textToSpeech', false, detail);
  }

  // --- speechToText ---
  // Reuse the audio we just synthesized above as real, known speech content —
  // avoids committing a binary fixture file and gives a deterministic non-empty
  // transcript to assert against.
  if (ttsAudio) {
    try {
      const { transcript, durationSeconds } = await client.speechToText(ttsAudio, 'audio/mpeg');
      const ok = transcript.trim().length > 0 && durationSeconds > 0;
      report('Deepgram speechToText', ok, `transcript="${transcript}", durationSeconds=${durationSeconds}`);
    } catch (err) {
      const detail = err instanceof SpeechError ? err.message : String(err instanceof Error ? err.stack : err);
      report('Deepgram speechToText', false, detail);
    }
  } else {
    report('Deepgram speechToText', false, 'skipped — no TTS audio to transcribe (ElevenLabs step failed above)');
  }
} finally {
  rmSync(buildDir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
