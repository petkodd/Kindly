import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isPromptSignoffBlocking } from '../scripts/prompt-signoff-policy.mjs';

describe('prompt sign-off CI policy', () => {
  const cases: Array<[string, string, string, string, boolean]> = [
    ['push to main', 'push', 'refs/heads/main', '', true],
    ['push to MVP alpha', 'push', 'refs/heads/release/mvp-alpha', '', false],
    ['push to another release', 'push', 'refs/heads/release/v1', '', true],
    ['similarly named release', 'push', 'refs/heads/release/mvp-alpha-next', '', true],
    ['feature push', 'push', 'refs/heads/feature/example', '', false],
    ['PR into MVP alpha', 'pull_request', 'refs/pull/1/merge', 'release/mvp-alpha', false],
    ['PR into another release', 'pull_request', 'refs/pull/1/merge', 'release/v1', true],
    ['PR into similarly named release', 'pull_request', 'refs/pull/1/merge', 'release/mvp-alpha-next', true],
    ['PR into main (existing policy)', 'pull_request', 'refs/pull/1/merge', 'main', false],
    ['manual run on alpha', 'workflow_dispatch', 'refs/heads/release/mvp-alpha', '', true],
    ['manual run on main', 'workflow_dispatch', 'refs/heads/main', '', true],
    ['missing push ref', 'push', '', '', true],
    ['missing PR base', 'pull_request', 'refs/pull/1/merge', '', true],
    ['unknown event', 'schedule', 'refs/heads/release/mvp-alpha', '', true],
    ['missing context', '', '', '', true],
  ];
  it.each(cases)('%s', (_label, eventName, ref, baseRef, expected) => {
    expect(isPromptSignoffBlocking({ eventName, ref, baseRef })).toBe(expected);
  });

  it.each([
    ['push', 'refs/heads/release/mvp-alpha', 'false'],
    ['workflow_dispatch', 'refs/heads/release/mvp-alpha', 'true'],
    ['', '', 'true'],
  ])('CLI emits only the policy output for %s on %s', (eventName, ref, expected) => {
    const result = execFileSync(process.execPath, [
      fileURLToPath(new URL('../scripts/prompt-signoff-policy.mjs', import.meta.url)),
    ], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_EVENT_NAME: eventName, GITHUB_REF: ref, GITHUB_BASE_REF: '' },
    });
    expect(result).toBe(`${expected}\n`);
  });
});
