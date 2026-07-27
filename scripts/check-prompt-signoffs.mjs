#!/usr/bin/env node
/**
 * STRICT release-readiness gate. NOT part of `npm test`/CI (see
 * test/promptSignOff.test.ts for the CI-blocking drift-only check) — this is
 * the "are we actually allowed to launch" check, run deliberately before a
 * release, e.g.:
 *
 *   npm run check:prompt-signoffs
 *
 * For every prompt registered in prompts/signoffs.json, requires all three
 * reviewer roles (AI Safety, Gerontology Advisor, Privacy Advisor) to have an
 * 'approved' entry matching the CURRENT hash of the live prompt text in
 * src/lib/ai/prompts.ts. Exits non-zero — with a per-prompt, per-role report —
 * if any prompt is missing a role's approval or has drifted since one.
 *
 * Deliberately expected to fail today: nothing has been reviewed yet.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const ROLES = ['ai_safety', 'gerontology', 'privacy'];
const ROLE_LABEL = { ai_safety: 'AI Safety Reviewer', gerontology: 'Gerontology Advisor', privacy: 'Privacy Advisor' };

function hashPrompt(text) {
  return createHash('sha256').update(text).digest('hex');
}

/** Latest entry per role by notedAt — a later entry for a role supersedes an earlier one. */
function latestByRole(entries) {
  const latest = {};
  for (const entry of entries) {
    const current = latest[entry.role];
    if (!current || entry.notedAt > current.notedAt) latest[entry.role] = entry;
  }
  return latest;
}

const buildDir = mkdtempSync(path.join(tmpdir(), 'kindly-check-signoffs-'));
let prompts;
try {
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
      path.join(rootDir, 'src/lib/ai/prompts.ts'),
    ],
    { cwd: rootDir, stdio: 'inherit' },
  );
  prompts = require(path.join(buildDir, 'prompts.js'));
} finally {
  rmSync(buildDir, { recursive: true, force: true });
}

const ledger = JSON.parse(readFileSync(path.join(rootDir, 'prompts/signoffs.json'), 'utf8'));

let anyFailure = false;
console.log('Prompt sign-off coverage\n' + '='.repeat(60));

for (const [promptKey, entries] of Object.entries(ledger)) {
  const liveText = prompts[promptKey];
  if (typeof liveText !== 'string') {
    anyFailure = true;
    console.log(`\n${promptKey}: FAIL — registered in prompts/signoffs.json but no longer exported from prompts.ts`);
    continue;
  }

  const currentHash = hashPrompt(liveText);
  const latest = latestByRole(entries);
  let promptOk = true;

  console.log(`\n${promptKey}  (hash ${currentHash.slice(0, 12)}…)`);
  for (const role of ROLES) {
    const entry = latest[role];
    if (!entry) {
      console.log(`  [MISSING] ${ROLE_LABEL[role]} — no sign-off recorded`);
      promptOk = false;
      continue;
    }
    const matchesHash = entry.promptHash === currentHash;
    if (entry.decision !== 'approved') {
      console.log(`  [PENDING] ${ROLE_LABEL[role]} — latest decision is '${entry.decision}' (${entry.reviewer}, ${entry.notedAt})`);
      promptOk = false;
    } else if (!matchesHash) {
      console.log(`  [STALE]   ${ROLE_LABEL[role]} — approved by ${entry.reviewer} on ${entry.notedAt}, but the prompt text has changed since (re-review needed)`);
      promptOk = false;
    } else {
      console.log(`  [OK]      ${ROLE_LABEL[role]} — approved by ${entry.reviewer} on ${entry.notedAt}`);
    }
  }

  if (!promptOk) anyFailure = true;
}

console.log('\n' + '='.repeat(60));
if (anyFailure) {
  console.log('FAIL — one or more prompts are missing a required role\'s current-hash approval.');
  console.log('Record a sign-off with: node scripts/sign-prompt.mjs --prompt <KEY> --role <role> --reviewer "<name>" --decision approved');
  process.exit(1);
} else {
  console.log('PASS — every registered prompt has all three roles approved at the current hash.');
  process.exit(0);
}
