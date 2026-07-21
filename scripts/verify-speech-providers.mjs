#!/usr/bin/env node
/**
 * One-off MANUAL verification that the real Deepgram + ElevenLabs speech
 * providers work end-to-end with the keys in .env.local. Not part of the
 * test suite, not run by npm test/CI — invoke directly:
 *
 *   node scripts/verify-speech-providers.mjs          # TTS/STT + cost ledger
 *   node scripts/verify-speech-providers.mjs --voice-route   # + real /api/talk/voice round trip (starts `next dev`)
 *
 * The `src/lib/speech/*.ts` sources use extensionless relative imports
 * (resolved by Next.js's bundler) and index.ts uses a require() inside an
 * ESM-syntax file (relies on being bundled to CJS by Next). Raw Node ESM
 * can't load that directly, so we compile just this subtree (plus the two
 * small repo files needed for the cost-ledger check) to CommonJS with the
 * project's own `tsc` into a temp dir and require the output — this
 * exercises the exact same source, just compiled the way Next does.
 */
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
const { Pool } = pg;

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const runVoiceRoute = process.argv.includes('--voice-route');

process.loadEnvFile(path.join(rootDir, '.env.local'));

let failures = 0;
function report(name, ok, detail) {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const deepgramKey = process.env.DEEPGRAM_API_KEY;
const elevenlabsKey = process.env.ELEVENLABS_API_KEY;
const elevenlabsVoiceId = process.env.ELEVENLABS_VOICE_ID;
if (!deepgramKey || !elevenlabsKey || !elevenlabsVoiceId) {
  report(
    'env keys present',
    false,
    'DEEPGRAM_API_KEY / ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID missing from .env.local',
  );
  process.exit(1);
}
report('env keys present', true);

const DEFAULT_VOICE_ID = 'pNInz6obpgDQGcFmaJgB'; // Adam — providers.ts fallback
if (elevenlabsVoiceId === DEFAULT_VOICE_ID) {
  console.log(
    '[NOTE] ELEVENLABS_VOICE_ID in .env.local is literally the same id as the hardcoded ' +
      "default (Adam). That means a real config value and 'no config, fell back to default' " +
      'are indistinguishable by output alone. The check below instead proves the code *path* ' +
      '(voiceId flows from opts into the request URL) by passing a different explicit id and ' +
      "confirming the URL changes accordingly — but if you meant to configure a non-Adam voice, " +
      'ELEVENLABS_VOICE_ID needs to be updated.',
  );
}

const buildDir = mkdtempSync(path.join(tmpdir(), 'kindly-speech-verify-'));

// Capture outgoing fetch() calls (url + body) without altering behavior —
// still forwards to the real global fetch so every call below is a live
// network request against Deepgram/ElevenLabs.
const realFetch = globalThis.fetch;
let lastRequest = null;
globalThis.fetch = async (url, init) => {
  lastRequest = { url: String(url), body: init?.body ? String(init.body) : undefined };
  return realFetch(url, init);
};

try {
  const speechDir = path.join(rootDir, 'src/lib/speech');
  const reposDir = path.join(rootDir, 'src/lib/repos');
  const billingDir = path.join(rootDir, 'src/lib/billing');
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
      path.join(reposDir, 'usageCost.ts'),
      path.join(billingDir, 'usageRates.ts'),
    ],
    { cwd: rootDir, stdio: 'inherit' },
  );

  const { createSpeechClient } = require(path.join(buildDir, 'speech/providers.js'));
  const { SpeechError } = require(path.join(buildDir, 'speech/types.js'));
  const { usageCostRepo } = require(path.join(buildDir, 'repos/usageCost.js'));
  const { ELEVENLABS_TTS_MICROS_PER_CHARACTER } = require(path.join(buildDir, 'billing/usageRates.js'));

  const client = createSpeechClient({
    deepgramApiKey: deepgramKey,
    elevenlabsApiKey: elevenlabsKey,
    elevenlabsVoiceId,
  });

  const bgText = 'Здравей, това е тестов глас на Kindly.';
  const enText = 'Hello, this is a Kindly test voice.';

  // --- TTS: primary (normal rate, Bulgarian) — this is the buffer we keep, feed to STT, and save to disk ---
  let ttsAudio;
  let primaryReplyText = bgText;
  try {
    const { audioUrl } = await client.textToSpeech(bgText, { speechRate: 'normal' });
    const match = /^data:audio\/mp3;base64,(.+)$/.exec(audioUrl);
    ttsAudio = match ? Buffer.from(match[1], 'base64') : undefined;
    const ok = !!ttsAudio && ttsAudio.length > 1000;
    report('ElevenLabs textToSpeech (bg, normal)', ok, `decoded audio bytes=${ttsAudio?.length ?? 0}`);
    const usedConfiguredVoice = lastRequest.url.includes(`/text-to-speech/${elevenlabsVoiceId}`);
    report('  → request URL uses ELEVENLABS_VOICE_ID', usedConfiguredVoice, lastRequest.url);
    const stabilityNormal = JSON.parse(lastRequest.body).voice_settings.stability;
    report('  → stability=0.6 for normal rate', stabilityNormal === 0.6, `got ${stabilityNormal}`);
  } catch (err) {
    const detail = err instanceof SpeechError ? err.message : String(err instanceof Error ? err.stack : err);
    report('ElevenLabs textToSpeech (bg, normal)', false, detail);
  }

  // --- TTS: English text, normal rate — confirms both languages synthesize ---
  try {
    const { audioUrl } = await client.textToSpeech(enText, { speechRate: 'normal' });
    const match = /^data:audio\/mp3;base64,(.+)$/.exec(audioUrl);
    const audio = match ? Buffer.from(match[1], 'base64') : undefined;
    report('ElevenLabs textToSpeech (en, normal)', !!audio && audio.length > 1000, `decoded audio bytes=${audio?.length ?? 0}`);
  } catch (err) {
    const detail = err instanceof SpeechError ? err.message : String(err instanceof Error ? err.stack : err);
    report('ElevenLabs textToSpeech (en, normal)', false, detail);
  }

  // --- TTS: slow rate — confirms stability differs (0.75 vs 0.6) ---
  try {
    const { audioUrl } = await client.textToSpeech(bgText, { speechRate: 'slow' });
    const match = /^data:audio\/mp3;base64,(.+)$/.exec(audioUrl);
    const audio = match ? Buffer.from(match[1], 'base64') : undefined;
    report('ElevenLabs textToSpeech (bg, slow)', !!audio && audio.length > 1000, `decoded audio bytes=${audio?.length ?? 0}`);
    const stabilitySlow = JSON.parse(lastRequest.body).voice_settings.stability;
    report('  → stability=0.75 for slow rate', stabilitySlow === 0.75, `got ${stabilitySlow}`);
  } catch (err) {
    const detail = err instanceof SpeechError ? err.message : String(err instanceof Error ? err.stack : err);
    report('ElevenLabs textToSpeech (bg, slow)', false, detail);
  }

  // --- TTS: explicit different voice id — proves voiceId is a real parameter, not hardcoded.
  // Checked via the outgoing request URL (captured even if ElevenLabs itself then rejects the
  // call, e.g. a free-plan account can't use most library voices) — what we're verifying is that
  // OUR code put the passed-in id in the URL, not whether ElevenLabs happens to serve that voice.
  const otherVoiceId = elevenlabsVoiceId === '21m00Tcm4TlvDq8ikWAM' ? DEFAULT_VOICE_ID : '21m00Tcm4TlvDq8ikWAM'; // Rachel
  try {
    const otherClient = createSpeechClient({
      deepgramApiKey: deepgramKey,
      elevenlabsApiKey: elevenlabsKey,
      elevenlabsVoiceId: otherVoiceId,
    });
    await otherClient.textToSpeech('Testing a different voice id.', { speechRate: 'normal' });
    report(
      'ElevenLabs textToSpeech respects a different explicit voiceId',
      lastRequest.url.includes(`/text-to-speech/${otherVoiceId}`),
      lastRequest.url,
    );
  } catch (err) {
    const urlOk = lastRequest?.url.includes(`/text-to-speech/${otherVoiceId}`);
    const detail = err instanceof SpeechError ? err.message : String(err instanceof Error ? err.stack : err);
    report(
      'ElevenLabs textToSpeech respects a different explicit voiceId',
      !!urlOk,
      urlOk
        ? `request URL correctly used ${otherVoiceId}; ElevenLabs then rejected it — ${detail}`
        : detail,
    );
  }

  // --- save the primary mp3 so a human can listen ---
  if (ttsAudio) {
    const outDir = path.join(rootDir, 'scripts/output');
    mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, 'test-tts.mp3');
    writeFileSync(outFile, ttsAudio);
    console.log(`\n[OUTPUT] Saved synthesized audio to ${outFile} (not committed — see .gitignore)`);
  }

  // --- speechToText --- (reuses the primary TTS audio as real, known speech content)
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

  // --- error scenario: invalid ElevenLabs key must throw SpeechError, not crash ---
  try {
    const badClient = createSpeechClient({
      deepgramApiKey: deepgramKey,
      elevenlabsApiKey: 'sk_invalid_test_key_0000000000000000000000000000000000',
      elevenlabsVoiceId,
    });
    await badClient.textToSpeech('this should fail', { speechRate: 'normal' });
    report('invalid ELEVENLABS_API_KEY → SpeechError', false, 'call unexpectedly succeeded');
  } catch (err) {
    const isSpeechError = err instanceof SpeechError;
    report('invalid ELEVENLABS_API_KEY → SpeechError', isSpeechError, err instanceof Error ? err.message : String(err));
    if (isSpeechError) {
      console.log(
        '  → per src/lib/auth.ts errorToResponse(), a SpeechError with this .name is mapped to ' +
          "HTTP 502 { error: { code: 'speech_unavailable' } } — verified by reading route.ts + " +
          'auth.ts, not re-executed here (that mapping has no network dependency to re-verify).',
      );
    }
  }

  // --- usage cost ledger: recordTtsCost against the real formula, real Postgres row ---
  {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: true },
    });
    let buyerId;
    try {
      const { rows: userRows } = await pool.query(
        `INSERT INTO users (email) VALUES ($1) RETURNING id`,
        [`speech-verify-${Date.now()}@example.com`],
      );
      buyerId = userRows[0].id;
      const { rows: parentRows } = await pool.query(
        `INSERT INTO parents (buyer_id, first_name, relationship) VALUES ($1, 'ScriptVerify', 'father') RETURNING id`,
        [buyerId],
      );
      const parentId = parentRows[0].id;
      const { rows: convoRows } = await pool.query(
        `INSERT INTO conversations (parent_id, channel) VALUES ($1, 'voice') RETURNING id`,
        [parentId],
      );
      const conversationId = convoRows[0].id;
      const { rows: turnRows } = await pool.query(
        `INSERT INTO conversation_turns (conversation_id, role, content) VALUES ($1, 'kindly', $2) RETURNING id`,
        [conversationId, primaryReplyText],
      );
      const turnId = turnRows[0].id;

      const record = await usageCostRepo.recordTtsCost(pool, {
        turnId,
        conversationId,
        parentId,
        characterCount: primaryReplyText.length,
      });

      const expectedCostMicros = Math.round(primaryReplyText.length * ELEVENLABS_TTS_MICROS_PER_CHARACTER);
      const costOk =
        Number(record.quantity) === primaryReplyText.length &&
        Number(record.unit_rate_micros) === ELEVENLABS_TTS_MICROS_PER_CHARACTER &&
        Number(record.cost_micros) === expectedCostMicros;
      report(
        'usageCostRepo.recordTtsCost matches $0.05/1000 chars',
        costOk,
        `characterCount=${primaryReplyText.length}, unit_rate_micros=${record.unit_rate_micros}, ` +
          `cost_micros=${record.cost_micros} (expected ${expectedCostMicros})`,
      );
    } finally {
      if (buyerId) await pool.query('DELETE FROM users WHERE id = $1', [buyerId]); // cascades parents/conversations/turns/usage_costs
      await pool.end();
    }
  }
} finally {
  globalThis.fetch = realFetch;
  rmSync(buildDir, { recursive: true, force: true });
}

// --- optional: real round trip through /api/talk/voice (requires `next dev`) ---
if (runVoiceRoute) {
  console.log('\n--- /api/talk/voice round trip ---');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: true },
  });
  let buyerId;
  let parentId;
  let devServer;
  try {
    const { rows: userRows } = await pool.query(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`,
      [`voice-route-verify-${Date.now()}@example.com`],
    );
    buyerId = userRows[0].id;
    const { rows: parentRows } = await pool.query(
      `INSERT INTO parents (buyer_id, first_name, relationship, speech_rate) VALUES ($1, 'RouteVerify', 'father', 'normal') RETURNING id`,
      [buyerId],
    );
    parentId = parentRows[0].id;
    await pool.query(
      `INSERT INTO consents (parent_id, kind, granted_by) VALUES ($1, 'buyer_attestation', $2)`,
      [parentId, buyerId],
    );
    await pool.query(`UPDATE parents SET activated_at = now() WHERE id = $1`, [parentId]);
    await pool.query(`INSERT INTO consents (parent_id, kind) VALUES ($1, 'parent_conversation')`, [parentId]);
    await pool.query(
      `INSERT INTO subscriptions (buyer_id, parent_id, plan, status, current_period_end)
       VALUES ($1, $2, 'family', 'trialing', now() + interval '7 days')`,
      [buyerId, parentId],
    );
    const { rows: convoRows } = await pool.query(
      `INSERT INTO conversations (parent_id, channel) VALUES ($1, 'voice') RETURNING id`,
      [parentId],
    );
    const conversationId = convoRows[0].id;

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    await pool.query(
      `INSERT INTO parent_access_tokens (parent_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`,
      [parentId, tokenHash],
    );

    // Reuse the mp3 saved above as real audio content for the multipart upload.
    const mp3Path = path.join(rootDir, 'scripts/output/test-tts.mp3');
    const { readFileSync } = await import('node:fs');
    const audioBytes = readFileSync(mp3Path);

    let baseUrl = 'http://localhost:3000';
    const alreadyUp = await fetch(baseUrl).then(() => true).catch(() => false);
    if (alreadyUp) {
      console.log('Reusing already-running dev server on :3000 (not starting a second one).');
    } else {
      console.log('Starting `npm run dev`…');
      devServer = spawn('npm', ['run', 'dev'], { cwd: rootDir, stdio: 'pipe' });
      baseUrl = await waitForServer(devServer, baseUrl, 60_000);
    }

    const form = new FormData();
    form.append('conversation_id', conversationId);
    form.append('audio', new Blob([audioBytes], { type: 'audio/mpeg' }), 'test.mp3');

    const res = await fetch(`${baseUrl}/api/talk/voice`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${rawToken}` },
      body: form,
    });
    const json = await res.json().catch(() => ({}));
    report('/api/talk/voice returns 200', res.status === 200, `status=${res.status} body=${JSON.stringify(json).slice(0, 300)}`);
    if (json.tts_url) {
      console.log(`\n[OUTPUT] tts_url from /api/talk/voice: ${json.tts_url.slice(0, 80)}... (${json.tts_url.length} chars total)`);
    }
  } catch (err) {
    report('/api/talk/voice round trip', false, err instanceof Error ? err.stack : String(err));
  } finally {
    if (devServer) devServer.kill();
    // consents.granted_by → users(id) has no ON DELETE CASCADE, so the parent
    // (which cascades its own consents) must go before the user that granted them.
    if (parentId) await pool.query('DELETE FROM parents WHERE id = $1', [parentId]);
    if (buyerId) await pool.query('DELETE FROM users WHERE id = $1', [buyerId]);
    await pool.end();
  }
}

function waitForServer(child, url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    child.stderr.on('data', (d) => process.stderr.write(`[dev] ${d}`));
    const tick = async () => {
      try {
        await fetch(url);
        resolve(url);
        return;
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) {
        reject(new Error('dev server did not become ready in time'));
        return;
      }
      setTimeout(tick, 1000);
    };
    tick();
  });
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
