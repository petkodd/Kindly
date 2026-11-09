#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Alpha integration may proceed while human reviews are pending. This is a
 * CI policy only: check:prompt-signoffs itself remains strict in every context.
 * Missing event context fails closed, as does every explicit manual check.
 *
 * @param {{ eventName: string, ref?: string, baseRef?: string }} context
 */
export function isPromptSignoffBlocking({ eventName, ref = '', baseRef = '' }) {
  if (eventName === 'workflow_dispatch') return true;
  if (eventName === 'push') {
    if (!ref) return true;
    if (ref === 'refs/heads/release/mvp-alpha') return false;
    return ref === 'refs/heads/main' || ref.startsWith('refs/heads/release/');
  }
  if (eventName === 'pull_request') {
    if (!baseRef) return true;
    if (baseRef === 'release/mvp-alpha') return false;
    // Preserve the existing informational policy for PRs into main.
    return baseRef.startsWith('release/');
  }
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const blocking = isPromptSignoffBlocking({
    eventName: process.env.GITHUB_EVENT_NAME ?? '',
    ref: process.env.GITHUB_REF,
    baseRef: process.env.GITHUB_BASE_REF,
  });
  process.stdout.write(`${blocking}\n`);
}
