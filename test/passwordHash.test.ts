import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomBytes, scryptSync } from 'node:crypto';
import * as crypto from 'node:crypto';
import {
  SCRYPT_DEFAULT_N,
  scryptN,
  hashPassword,
  verifyPassword,
  verifyAgainstDummy,
  resetDummyHash,
} from '../src/lib/passwordHash';
import { makeTestDb } from './db';
import { userRepo } from '../src/lib/repos/user';

vi.mock('node:crypto', async (orig) => {
  const actual = await orig<typeof import('node:crypto')>();
  return { ...actual, scrypt: vi.fn(actual.scrypt) };
});

afterEach(() => {
  vi.mocked(crypto.scrypt).mockClear();
});

describe('scrypt parameters (chat 7)', () => {
  it('defaults to N = 2^17 (OWASP) and ignores a weak or test override in production', () => {
    expect(SCRYPT_DEFAULT_N).toBe(131072);
    expect(scryptN({})).toBe(2 ** 17);
    expect(scryptN({ AUTH_SCRYPT_N: '1024', VERCEL_ENV: 'production' })).toBe(2 ** 17);
    expect(scryptN({ AUTH_SCRYPT_N: '512' })).toBe(2 ** 17); // below the floor
    expect(scryptN({ AUTH_SCRYPT_N: '3000' })).toBe(2 ** 17); // not a power of two
    expect(scryptN({ AUTH_SCRYPT_N: '1024' })).toBe(1024); // tests only
  });

  it('a real 2^17 hash round-trips (memory limit set high enough)', async () => {
    const before = process.env.AUTH_SCRYPT_N;
    delete process.env.AUTH_SCRYPT_N;
    try {
      const h = await hashPassword('correct-horse');
      expect(h.startsWith('scrypt$131072$8$1$')).toBe(true);
      expect(await verifyPassword('correct-horse', h)).toEqual({ ok: true, needsRehash: false });
    } finally {
      process.env.AUTH_SCRYPT_N = before;
    }
  }, 20_000);

  it('uses the async scrypt (does not block the event loop)', async () => {
    await hashPassword('correct-horse');
    expect(crypto.scrypt).toHaveBeenCalled();
  });
});

describe('verifyPassword', () => {
  it('accepts the right password and rejects a wrong one', async () => {
    const h = await hashPassword('correct-horse');
    expect((await verifyPassword('correct-horse', h)).ok).toBe(true);
    expect((await verifyPassword('wrong-horse', h)).ok).toBe(false);
  });

  it('normalizes Unicode (NFKC) so the same password typed differently still matches', async () => {
    const h = await hashPassword('café-pass'); // precomposed é
    expect((await verifyPassword('café-pass', h)).ok).toBe(true); // e + combining accent
  });

  it('verifies a legacy salt:key hash and asks for a rehash', async () => {
    const salt = randomBytes(16);
    const legacy = `${salt.toString('hex')}:${scryptSync('legacy-pass', salt, 64).toString('hex')}`;
    expect(await verifyPassword('legacy-pass', legacy)).toEqual({ ok: true, needsRehash: true });
    expect(await verifyPassword('other', legacy)).toEqual({ ok: false, needsRehash: false });
  });

  it('asks for a rehash when the stored N is lower than the current one', async () => {
    const weak = `scrypt$1024$8$1$${'00'.repeat(16)}$${scryptSync('pw-pw-pw-pw', Buffer.alloc(16), 64, { N: 1024 }).toString('hex')}`;
    const before = process.env.AUTH_SCRYPT_N;
    process.env.AUTH_SCRYPT_N = '2048';
    try {
      expect(await verifyPassword('pw-pw-pw-pw', weak)).toEqual({ ok: true, needsRehash: true });
    } finally {
      process.env.AUTH_SCRYPT_N = before;
    }
  });

  it('rejects garbage stored values without throwing', async () => {
    expect((await verifyPassword('x', '')).ok).toBe(false);
    expect((await verifyPassword('x', 'scrypt$nope')).ok).toBe(false);
  });
});

describe('timing: unknown users still pay for a hash', () => {
  it('verifyAgainstDummy runs scrypt', async () => {
    resetDummyHash();
    await verifyAgainstDummy('anything');
    expect(crypto.scrypt).toHaveBeenCalled();
  });

  it('verifyCredentials runs scrypt for an unknown email and for a password-less account', async () => {
    const q = makeTestDb();
    await q.query(`INSERT INTO users (email) VALUES ('magic-only@example.com')`);
    await verifyAgainstDummy('warm-up'); // build the cached dummy first
    vi.mocked(crypto.scrypt).mockClear();

    expect(await userRepo.verifyCredentials(q, 'ghost@example.com', 'whatever')).toBeNull();
    expect(crypto.scrypt).toHaveBeenCalledTimes(1);

    expect(await userRepo.verifyCredentials(q, 'magic-only@example.com', 'whatever')).toBeNull();
    expect(crypto.scrypt).toHaveBeenCalledTimes(2);
  });
});
