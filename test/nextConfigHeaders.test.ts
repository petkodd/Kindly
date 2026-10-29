import { describe, it, expect } from 'vitest';
import nextConfig from '../next.config.mjs';

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

describe('next.config.mjs headers', () => {
  it('sends Cache-Control: no-store on every /api/* response', async () => {
    const rules = (await nextConfig.headers!()) as HeaderRule[];
    const api = rules.find((r) => r.source === '/api/:path*');
    expect(api).toBeDefined();
    const cc = api!.headers.find((h) => h.key.toLowerCase() === 'cache-control');
    expect(cc?.value).toMatch(/\bno-store\b/);
  });

  it('keeps the security headers on every route', async () => {
    const rules = (await nextConfig.headers!()) as HeaderRule[];
    const all = rules.find((r) => r.source === '/:path*');
    const keys = all!.headers.map((h) => h.key);
    expect(keys).toEqual(expect.arrayContaining(['Content-Security-Policy', 'Strict-Transport-Security', 'X-Frame-Options']));
  });
});
