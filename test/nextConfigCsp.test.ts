import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * `next dev` needs 'unsafe-eval' to hydrate; production must never get it.
 * next.config.mjs reads NODE_ENV at import time, so each case re-imports it.
 */
async function scriptSrc(nodeEnv: string): Promise<string> {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', nodeEnv);
  const config = (await import('../next.config.mjs')).default as {
    headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]>;
  };
  const all = await config.headers();
  const csp = all.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy')!.value;
  return csp.split('; ').find((d) => d.startsWith('script-src'))!;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Content-Security-Policy script-src', () => {
  it("keeps 'unsafe-eval' out of production", async () => {
    expect(await scriptSrc('production')).toBe("script-src 'self' 'unsafe-inline'");
  });

  it("adds 'unsafe-eval' only for `next dev`", async () => {
    expect(await scriptSrc('development')).toBe("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
  });

  it("does not add it under test either", async () => {
    expect(await scriptSrc('test')).not.toContain('unsafe-eval');
  });
});
