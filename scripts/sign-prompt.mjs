#!/usr/bin/env node
/**
 * Record a prompt sign-off. Reads the CURRENT text of a named prompt straight
 * out of src/lib/ai/prompts.ts, hashes it, and appends a signed entry to
 * prompts/signoffs.json — see prompts/README.md for the full workflow.
 *
 *   node scripts/sign-prompt.mjs --prompt COMPANION_SYSTEM_V1 --role safety \
 *     --reviewer "Jane Doe" --decision approved --notes "reviewed tone + crisis clause"
 *
 * --role is one of: safety | gerontology | privacy (mapped to the internal
 * ai_safety/gerontology/privacy role names src/lib/ai/promptSignOff.ts uses).
 *
 * prompts.ts has no imports of its own, so it's compiled to CommonJS with the
 * project's own tsc into a temp dir and required — same technique
 * scripts/verify-speech-providers.mjs uses for src/lib/speech. This script
 * deliberately does NOT import src/lib/ai/promptSignOff.ts (which itself
 * imports prompts/signoffs.json via a repo-root-relative path — compiling
 * that cleanly needs --rootDir gymnastics that aren't worth it here); it
 * reads/writes prompts/signoffs.json directly as plain JSON instead.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const ROLE_ALIASES = { safety: 'ai_safety', ai_safety: 'ai_safety', gerontology: 'gerontology', privacy: 'privacy' };
const DECISIONS = new Set(['approved', 'changes_requested']);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    out[arg.slice(2)] = argv[i + 1];
    i++;
  }
  return out;
}

function usageError(message) {
  console.error(`Error: ${message}\n`);
  console.error(
    'Usage: node scripts/sign-prompt.mjs --prompt <PROMPT_KEY> --role safety|gerontology|privacy ' +
      '--reviewer "Name" --decision approved|changes_requested [--notes "..."]',
  );
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));

if (!args.prompt) usageError('--prompt is required');
if (!args.role || !ROLE_ALIASES[args.role]) usageError('--role must be one of: safety, gerontology, privacy');
if (!args.reviewer || !args.reviewer.trim()) usageError('--reviewer is required');
if (!args.decision || !DECISIONS.has(args.decision)) usageError('--decision must be approved or changes_requested');

const role = ROLE_ALIASES[args.role];
const promptKey = args.prompt;

// --- get the live prompt text out of src/lib/ai/prompts.ts ---
const buildDir = mkdtempSync(path.join(tmpdir(), 'kindly-sign-prompt-'));
let liveText;
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
  const compiled = require(path.join(buildDir, 'prompts.js'));
  liveText = compiled[promptKey];
} finally {
  rmSync(buildDir, { recursive: true, force: true });
}

if (typeof liveText !== 'string') {
  console.error(
    `Error: '${promptKey}' is not a string-valued export of src/lib/ai/prompts.ts ` +
      '(check spelling — it must match the exported constant name exactly).',
  );
  process.exit(1);
}

const promptHash = createHash('sha256').update(liveText).digest('hex');

// --- append the entry to prompts/signoffs.json ---
const ledgerPath = path.join(rootDir, 'prompts/signoffs.json');
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));

if (!Object.prototype.hasOwnProperty.call(ledger, promptKey)) {
  console.error(
    `Error: '${promptKey}' has no entry in prompts/signoffs.json. Register it there first (an empty ` +
      'array) — every shipped prompt must be in the ledger before it can be signed off.',
  );
  process.exit(1);
}

const entry = {
  role,
  reviewer: args.reviewer.trim(),
  decision: args.decision,
  promptHash,
  notedAt: new Date().toISOString(),
  ...(args.notes ? { notes: args.notes } : {}),
};

ledger[promptKey].push(entry);
writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

console.log(
  `Recorded ${args.decision} sign-off for ${promptKey} — role=${role}, reviewer="${entry.reviewer}", ` +
    `hash=${promptHash.slice(0, 12)}…`,
);
if (args.decision === 'approved') {
  console.log(
    'Reminder: run `npm run check:prompt-signoffs` to see updated coverage across all three roles, ' +
      'and update the matrix in docs/PROMPT_SIGN_OFF.md.',
  );
}
