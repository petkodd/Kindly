import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import { parseArgs, promoteToAdmin } from '../scripts/admin-create.mjs';
import { jobUrl, JOBS } from '../scripts/cron.mjs';
import { dbHostOf } from '../scripts/lib/env.mjs';

describe('admin:create argument parsing', () => {
  it('requires exactly one valid email', () => {
    expect(parseArgs([]).error).toMatch(/Usage/);
    expect(parseArgs(['not-an-email', '--confirm']).error).toMatch(/Usage/);
    expect(parseArgs(['a@example.com', 'b@example.com', '--confirm']).error).toMatch(/Usage/);
  });

  it('is a dry run unless --confirm is passed', () => {
    expect(parseArgs(['a@example.com'])).toEqual({ email: 'a@example.com', confirm: false });
    expect(parseArgs(['a@example.com', '--confirm'])).toEqual({ email: 'a@example.com', confirm: true });
    expect(parseArgs(['--confirm', 'a@example.com']).confirm).toBe(true);
  });

  it('rejects unknown flags rather than guessing', () => {
    expect(parseArgs(['a@example.com', '--yes']).error).toMatch(/Unknown option: --yes/);
  });
});

describe('admin:create promoteToAdmin', () => {
  let q: Querier;
  beforeEach(() => {
    q = makeTestDb();
  });

  it('promotes an existing user and writes an audit row', async () => {
    await q.query(`INSERT INTO users (email) VALUES ('owner@example.com')`);
    expect(await promoteToAdmin(q, 'owner@example.com')).toBe('promoted');
    const { rows } = await q.query<{ is_admin: boolean }>(`SELECT is_admin FROM users WHERE email = 'owner@example.com'`);
    expect(rows[0].is_admin).toBe(true);
    const { rows: audit } = await q.query<{ action: string }>(`SELECT action FROM audit_log`);
    expect(audit.map((a) => a.action)).toEqual(['admin_promote']);
  });

  it('reports already-admin and unknown users without changing anything', async () => {
    await q.query(`INSERT INTO users (email, is_admin) VALUES ('boss@example.com', true)`);
    expect(await promoteToAdmin(q, 'boss@example.com')).toBe('already_admin');
    expect(await promoteToAdmin(q, 'nobody@example.com')).toBe('not_found');
  });

  it('never promotes a soft-deleted account', async () => {
    await q.query(`INSERT INTO users (email, deleted_at) VALUES ('gone@example.com', now())`);
    expect(await promoteToAdmin(q, 'gone@example.com')).toBe('not_found');
  });
});

describe('dbHostOf (the only part of DATABASE_URL scripts print)', () => {
  it('returns the host name without credentials', () => {
    expect(dbHostOf('postgres://user:secret@db.example.com:5432/x')).toBe('db.example.com');
    expect(dbHostOf('garbage')).toBe('(unparseable DATABASE_URL)');
  });
});

describe('cron scripts', () => {
  it('always target the local dev server', () => {
    expect(jobUrl('weekly', {})).toBe('http://localhost:3000/api/jobs/generate-weekly-summary');
    expect(jobUrl('purge', { PORT: '4000' })).toBe('http://localhost:4000/api/jobs/purge-hard-deletes');
    expect(Object.keys(JOBS)).toEqual(['weekly', 'purge', 'idle']);
    expect(jobUrl('idle', {})).toBe('http://localhost:3000/api/jobs/end-idle-sessions');
  });

  it('match the routes scheduled in vercel.json', async () => {
    const { readFileSync } = await import('node:fs');
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: { path: string }[] };
    expect(vercel.crons.map((c) => c.path).sort()).toEqual(Object.values(JOBS).sort());
  });

  it('reject an unknown job name', () => {
    expect(() => jobUrl('nightly', {})).toThrow(/Unknown job/);
  });
});
