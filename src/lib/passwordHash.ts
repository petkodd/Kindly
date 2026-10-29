import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password hashing with scrypt, run asynchronously (off the event loop).
 *
 * Format: `scrypt$N$r$p$saltHex$keyHex`. The parameters live in the hash, so
 * they can be raised later without breaking old hashes: verifyPassword reports
 * `needsRehash` when a stored hash is weaker than the current parameters, and
 * the login path re-hashes it with the password it just verified.
 *
 * Legacy hashes from before this module (`saltHex:keyHex`, N=16384, r=8, p=1)
 * still verify and are upgraded on the next successful login.
 *
 * N = 2^17 (OWASP's scrypt recommendation) needs 128 MiB of memory per hash
 * (128 · N · r bytes), so maxmem is raised accordingly.
 */

export const SCRYPT_DEFAULT_N = 2 ** 17;
const R = 8;
const P = 1;
const KEYLEN = 64;
const LEGACY = { N: 2 ** 14, r: 8, p: 1 };

/**
 * The work factor. Tests set AUTH_SCRYPT_N lower to stay fast; the override
 * is ignored on the production deploy, and anything below 2^10 is ignored
 * everywhere, so it can never quietly weaken production hashing.
 */
export function scryptN(env: Record<string, string | undefined> = process.env): number {
  if (env.VERCEL_ENV === 'production') return SCRYPT_DEFAULT_N;
  const n = Number(env.AUTH_SCRYPT_N);
  const isPow2 = Number.isInteger(n) && n >= 2 ** 10 && (n & (n - 1)) === 0;
  return isPow2 ? n : SCRYPT_DEFAULT_N;
}

function derive(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  const opts: ScryptOptions = { N, r, p, maxmem: 256 * N * r };
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEYLEN, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const N = scryptN();
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${key.toString('hex')}`;
}

function parse(stored: string): { N: number; r: number; p: number; salt: Buffer; key: Buffer; legacy: boolean } | null {
  if (stored.startsWith('scrypt$')) {
    const [, n, r, p, salt, key] = stored.split('$');
    const N = Number(n);
    if (!N || !Number(r) || !Number(p) || !salt || !key) return null;
    return { N, r: Number(r), p: Number(p), salt: Buffer.from(salt, 'hex'), key: Buffer.from(key, 'hex'), legacy: false };
  }
  const [salt, key] = stored.split(':');
  if (!salt || !key) return null;
  return { ...LEGACY, salt: Buffer.from(salt, 'hex'), key: Buffer.from(key, 'hex'), legacy: true };
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<{ ok: boolean; needsRehash: boolean }> {
  const h = parse(stored);
  if (!h) return { ok: false, needsRehash: false };
  // Legacy hashes were made without NFKC normalization; verify them as they were made.
  const input = h.legacy ? password : password.normalize('NFKC');
  const key = await new Promise<Buffer>((resolve, reject) => {
    scrypt(input, h.salt, h.key.length, { N: h.N, r: h.r, p: h.p, maxmem: 256 * h.N * h.r }, (err, k) =>
      err ? reject(err) : resolve(k),
    );
  });
  const ok = key.length === h.key.length && timingSafeEqual(key, h.key);
  return { ok, needsRehash: ok && (h.legacy || h.N < scryptN() || h.r !== R || h.p !== P) };
}

let dummy: Promise<string> | undefined;

/**
 * Spend the same time as a real verification when there is no account (or no
 * password) to check, so response time doesn't reveal which emails exist.
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummy ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(password ?? '', await dummy);
}

/** Test seam: forget the cached dummy hash (e.g. after changing AUTH_SCRYPT_N). */
export function resetDummyHash(): void {
  dummy = undefined;
}
