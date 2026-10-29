#!/usr/bin/env node
// npm run cron:weekly | npm run cron:purge | npm run cron:idle
//
// Calls the local job routes exactly as Vercel Cron does in production
// (GET with "Authorization: Bearer $CRON_SECRET"). Needs `npm run dev`
// running. Always targets http://localhost:$PORT (default 3000), never a
// deployed URL.
import { pathToFileURL } from 'node:url';
import { loadLocalEnv } from './lib/env.mjs';

export const JOBS = {
  weekly: '/api/jobs/generate-weekly-summary',
  purge: '/api/jobs/purge-hard-deletes',
  idle: '/api/jobs/end-idle-sessions',
};

/**
 * @param {string} job
 * @param {Record<string, string | undefined>} [env]
 */
export function jobUrl(job, env = process.env) {
  const path = /** @type {Record<string, string>} */ (JOBS)[job];
  if (!path) throw new Error(`Unknown job "${job}". Use one of: ${Object.keys(JOBS).join(', ')}.`);
  return `http://localhost:${env.PORT || 3000}${path}`;
}

async function main() {
  const job = process.argv[2];
  loadLocalEnv();
  let url;
  try {
    url = jobUrl(job);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('CRON_SECRET is not set. Generate one (see README, "Secrets") and add it to .env.local.');
    process.exit(1);
  }
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } });
  } catch {
    console.error(`✗ Could not reach ${url}. Is \`npm run dev\` running?`);
    process.exit(1);
  }
  const text = await res.text();
  let body = text;
  try {
    body = JSON.stringify(JSON.parse(text), null, 2);
  } catch {}
  console.log(`${res.ok ? '✓' : '✗'} ${job}: HTTP ${res.status}\n${body}`);
  if (res.status === 401) console.error('  401: CRON_SECRET in .env.local must match the one the dev server started with (restart `npm run dev` after changing it).');
  if (!res.ok) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
