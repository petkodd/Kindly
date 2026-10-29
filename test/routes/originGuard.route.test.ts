/// <reference types="vite/client" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';
import { parentRepo } from '../../src/lib/repos/parent';
import { accessTokenRepo } from '../../src/lib/repos/accessToken';
import { signSession, SESSION_COOKIE } from '../../src/lib/session';
import { isCrossOriginWrite } from '../../src/lib/auth';
import { makeBuyer } from './helpers';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

/**
 * Chat 7: every state-changing /api route refuses a cross-site request (CSRF),
 * even when it carries a valid admin session cookie AND a valid parent talk
 * token. Walks every route file, so a new route that forgets the guard fails
 * here. Exempt: the Stripe webhook (server-to-server, verified by signature)
 * and the cron jobs (GET + bearer secret).
 */
const routes: Record<string, () => Promise<unknown>> = import.meta.glob('../../src/app/api/**/route.ts');
const EXEMPT = new Set(['billing/webhook']);
const WRITE_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE'] as const;

function routeName(path: string): string {
  return path.replace(/^.*\/src\/app\/api\//, '').replace(/\/route\.ts$/, '');
}

let buyerId: string;
let parentId: string;
let parentToken: string;

async function setup(): Promise<void> {
  q = makeTestDb();
  buyerId = await makeBuyer(q, 'owner@example.com');
  await q.query(`UPDATE users SET is_admin = true WHERE id = $1`, [buyerId]);
  const parent = await parentRepo.create(q, { buyerId, firstName: 'Robert', relationship: 'father' });
  parentId = parent.id;
  parentToken = (await accessTokenRepo.issue(q, parentId)).token;
}

beforeEach(async () => {
  process.env.SESSION_SECRET = 'test-secret-value';
  delete process.env.EMAIL_API_KEY;
  await setup();
});

function attackReq(url: string, method: string, headers: Record<string, string>): NextRequest {
  return new NextRequest(url, {
    method,
    headers: {
      'content-type': 'application/json',
      cookie: `${SESSION_COOKIE}=${signSession(buyerId, { isAdmin: true })}`,
      authorization: `Bearer ${parentToken}`,
      'x-forwarded-for': '6.6.6.6',
      ...headers,
    },
    body: method === 'DELETE' ? undefined : JSON.stringify({ email: 'x@example.com', password: 'whatever-pass', token: 'x' }),
  });
}

const ATTACKS: Array<[string, Record<string, string>]> = [
  ['a foreign Origin', { origin: 'https://evil.example' }],
  ['Sec-Fetch-Site: cross-site', { 'sec-fetch-site': 'cross-site' }],
  ['Origin: null (sandboxed iframe)', { origin: 'null' }],
  ['a foreign Referer with no Origin', { referer: 'https://evil.example/page' }],
];

describe('cross-origin write guard on every state-changing /api route', () => {
  const entries = Object.entries(routes).filter(([p]) => !EXEMPT.has(routeName(p)));

  it('finds the routes (sanity)', () => {
    expect(entries.length).toBeGreaterThan(30);
  });

  it('control: the same credentials ARE accepted same-origin (so the 401/403s above come from the guard)', async () => {
    const accepted: string[] = [];
    for (const [path, load] of entries) {
      const name = routeName(path);
      const mod = (await load()) as Record<string, unknown>;
      for (const method of WRITE_METHODS.filter((m) => typeof mod[m] === 'function')) {
        const handler = mod[method] as (req: NextRequest, ctx: unknown) => Promise<Response>;
        await setup(); // fresh fixtures: earlier calls (logout, delete, re-issue link) revoke them
        const u = `http://localhost/api/${name.replace(/\[[a-z]+\]/g, parentId)}`;
        const c = { params: Promise.resolve({ id: parentId, mid: parentId, cid: parentId, fid: parentId }) };
        const res = await handler(attackReq(u, method, { origin: 'http://localhost' }), c);
        if (res.status !== 401 && res.status !== 403) accepted.push(`${method} ${name}`);
      }
    }
    // Most routes get past auth with these credentials (some still 401 on
    // their own rules, e.g. a wrong login password or a garbage reset token).
    expect(accepted.length).toBeGreaterThan(entries.length * 0.6);
  });

  for (const [path, load] of entries) {
    const name = routeName(path);
    it(`${name}: refuses cross-site writes`, async () => {
      const mod = (await load()) as Record<string, unknown>;
      const methods = WRITE_METHODS.filter((m) => typeof mod[m] === 'function');
      for (const method of methods) {
        const handler = mod[method] as (req: NextRequest, ctx: unknown) => Promise<Response>;
        const url = `http://localhost/api/${name.replace(/\[[a-z]+\]/g, parentId)}`;
        const ctx = { params: Promise.resolve({ id: parentId, mid: parentId, cid: parentId, fid: parentId }) };
        for (const [label, headers] of ATTACKS) {
          const res = await handler(attackReq(url, method, headers), ctx);
          expect([401, 403], `${method} /api/${name} with ${label} → ${res.status}`).toContain(res.status);
          expect(res.headers.get('set-cookie') ?? '', `${method} /api/${name} set a cookie`).not.toMatch(/kindly_session=[^;]/);
        }
      }
    });
  }
});

describe('isCrossOriginWrite', () => {
  const req = (method: string, headers: Record<string, string>) =>
    new NextRequest('http://localhost/api/x', { method, headers });

  it('allows same-origin writes, header-less clients, and every read', () => {
    expect(isCrossOriginWrite(req('POST', { origin: 'http://localhost' }))).toBe(false);
    expect(isCrossOriginWrite(req('POST', { origin: 'https://app.example', 'x-forwarded-host': 'app.example' }))).toBe(false);
    expect(isCrossOriginWrite(req('POST', { 'sec-fetch-site': 'same-origin', origin: 'http://localhost' }))).toBe(false);
    expect(isCrossOriginWrite(req('POST', {}))).toBe(false); // curl / server-to-server: no ambient cookies
    expect(isCrossOriginWrite(req('GET', { origin: 'https://evil.example' }))).toBe(false);
  });

  it('allows the configured site URL (e.g. the www host behind a proxy)', () => {
    const before = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = 'https://www.dearly.example';
    try {
      expect(isCrossOriginWrite(req('POST', { origin: 'https://www.dearly.example' }))).toBe(false);
    } finally {
      process.env.NEXT_PUBLIC_SITE_URL = before;
    }
  });

  it('rejects a look-alike host and a malformed origin', () => {
    expect(isCrossOriginWrite(req('POST', { origin: 'http://localhost.evil.example' }))).toBe(true);
    expect(isCrossOriginWrite(req('DELETE', { origin: 'not a url' }))).toBe(true);
  });
});
