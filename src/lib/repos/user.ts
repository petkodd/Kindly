import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Querier } from '../querier';
import { ConflictError, ValidationError } from '../types';

/**
 * Buyer accounts. Passwords are stored as scrypt(salt, password) — never
 * plaintext. Email is CITEXT UNIQUE in the schema, so it's case-insensitive.
 */

export interface AuthUser {
  id: string;
  email: string;
  is_admin: boolean;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MIN_PASSWORD = 8;

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${dk.toString('hex')}`;
}

function verifyPasswordHash(password: string, stored: string): boolean {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  const key = Buffer.from(keyHex, 'hex');
  const dk = scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  return key.length === dk.length && timingSafeEqual(key, dk);
}

function normalizeEmail(email: string): string {
  return (email ?? '').trim();
}

export const userRepo = {
  /** Create a buyer with an email + password. Duplicate email → ConflictError (409). */
  async create(q: Querier, input: { email: string; password: string }): Promise<AuthUser> {
    const email = normalizeEmail(input.email);
    if (!EMAIL_RE.test(email)) throw new ValidationError('a valid email is required');
    if ((input.password ?? '').length < MIN_PASSWORD) {
      throw new ValidationError(`password must be at least ${MIN_PASSWORD} characters`);
    }
    try {
      const { rows } = await q.query<AuthUser>(
        `INSERT INTO users (email, password_hash, auth_provider)
         VALUES ($1, $2, 'email')
         RETURNING id, email, is_admin`,
        [email, hashPassword(input.password)],
      );
      return rows[0];
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictError('An account with this email already exists.');
      }
      throw err;
    }
  },

  async findByEmail(q: Querier, email: string): Promise<{ id: string; email: string; is_admin: boolean; password_hash: string | null } | null> {
    const { rows } = await q.query<{ id: string; email: string; is_admin: boolean; password_hash: string | null }>(
      `SELECT id, email, is_admin, password_hash FROM users
       WHERE email = $1 AND deleted_at IS NULL`,
      [normalizeEmail(email)],
    );
    return rows[0] ?? null;
  },

  /**
   * Verify email + password for login. Returns the user or null — the caller
   * MUST NOT distinguish "no such email" from "wrong password" (no enumeration).
   */
  async verifyCredentials(q: Querier, email: string, password: string): Promise<AuthUser | null> {
    const user = await userRepo.findByEmail(q, email);
    if (!user || !user.password_hash) return null;
    if (!verifyPasswordHash(password, user.password_hash)) return null;
    await q.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
    return { id: user.id, email: user.email, is_admin: user.is_admin };
  },
};
