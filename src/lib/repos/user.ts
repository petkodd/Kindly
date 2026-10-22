import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Querier } from '../querier';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../types';
import { EMAIL_RE } from '../validation';

/**
 * Buyer accounts. Passwords are stored as scrypt(salt, password) — never
 * plaintext. Email is CITEXT UNIQUE in the schema, so it's case-insensitive.
 */

export interface AuthUser {
  id: string;
  email: string;
  is_admin: boolean;
}

/** Account view returned to the owner — never includes the password hash. */
export interface Account {
  id: string;
  email: string;
  full_name: string | null;
  is_admin: boolean;
  created_at: string;
}

/** Buyer contact details used for P0/P1 safety alerts. */
export interface AlertContact {
  id: string;
  email: string;
  fullName: string | null;
  alertPhone: string | null;
  smsAlertConsentAt: string | null;
}

const E164_RE = /^\+[1-9]\d{7,14}$/;

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

  /**
   * Minimal fields the auth path needs to validate a session: whether the user
   * is deleted, the revocation watermark, and admin status. Returns null when
   * the user doesn't exist.
   */
  async sessionAuth(
    q: Querier,
    userId: string,
  ): Promise<{ deleted_at: string | null; sessions_valid_from: string; is_admin: boolean } | null> {
    const { rows } = await q.query<{ deleted_at: string | null; sessions_valid_from: string; is_admin: boolean }>(
      `SELECT deleted_at, sessions_valid_from, is_admin FROM users WHERE id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  },

  /** Invalidate every outstanding session for a user (bumps the watermark). */
  async revokeSessions(q: Querier, userId: string): Promise<void> {
    await q.query(`UPDATE users SET sessions_valid_from = now() WHERE id = $1`, [userId]);
  },

  /**
   * Who to alert about a parent on a P0/P1 safety flag (decision D2): the
   * buyer's email, their emergency alert phone, and whether they opted in to
   * SMS. Null for a missing or deleted account.
   */
  async getAlertContact(q: Querier, userId: string): Promise<AlertContact | null> {
    const { rows } = await q.query<{
      id: string;
      email: string;
      full_name: string | null;
      alert_phone: string | null;
      sms_alert_consent_at: string | Date | null;
    }>(
      `SELECT id, email, full_name, alert_phone, sms_alert_consent_at FROM users
       WHERE id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      alertPhone: row.alert_phone,
      smsAlertConsentAt: row.sms_alert_consent_at ? new Date(row.sms_alert_consent_at).toISOString() : null,
    };
  },

  /**
   * Set or clear the buyer's emergency alert phone and SMS consent. The
   * onboarding UI for this is chat 10. A phone must be E.164 (+15551234567).
   * Clearing the phone also clears the consent; consent can't exist without a
   * phone.
   */
  async setAlertPhone(
    q: Querier,
    userId: string,
    input: { phone: string | null; smsConsent: boolean },
  ): Promise<AlertContact> {
    const phone = input.phone?.replace(/[\s().-]/g, '') || null;
    if (phone !== null && !E164_RE.test(phone)) {
      throw new ValidationError('Alert phone must be a full number with country code, e.g. +15551234567');
    }
    if (phone === null && input.smsConsent) {
      throw new ValidationError('SMS consent needs an alert phone');
    }
    // Same number: keep the original consent time. A new number needs new consent.
    const { rowCount } = await q.query(
      `UPDATE users
          SET alert_phone = $2,
              sms_alert_consent_at = CASE
                WHEN $3 THEN (CASE WHEN alert_phone = $2 THEN COALESCE(sms_alert_consent_at, now()) ELSE now() END)
                ELSE NULL
              END
        WHERE id = $1 AND deleted_at IS NULL`,
      [userId, phone, phone !== null && input.smsConsent],
    );
    if (!rowCount) throw new NotFoundError('Account not found');
    const contact = await userRepo.getAlertContact(q, userId);
    if (!contact) throw new NotFoundError('Account not found');
    return contact;
  },

  /** The owner's own account (password hash never selected). */
  async getAccount(q: Querier, userId: string): Promise<Account> {
    const { rows } = await q.query<Account>(
      `SELECT id, email, full_name, is_admin, created_at FROM users
       WHERE id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    if (rows.length === 0) throw new NotFoundError('Account not found');
    return rows[0];
  },

  /** Update the owner's display name. */
  async updateProfile(q: Querier, userId: string, patch: { fullName?: string | null }): Promise<Account> {
    await userRepo.getAccount(q, userId); // ensures the account exists / not deleted
    const fullName = patch.fullName === undefined ? undefined : (patch.fullName ?? '').trim();
    if (fullName !== undefined && fullName.length > 120) {
      throw new ValidationError('name is too long');
    }
    const { rows } = await q.query<Account>(
      `UPDATE users SET full_name = COALESCE($2, full_name)
       WHERE id = $1
       RETURNING id, email, full_name, is_admin, created_at`,
      [userId, fullName ?? null],
    );
    return rows[0];
  },

  /**
   * Change the owner's password. Requires the current password (defends against
   * a hijacked session silently taking over the account). Magic-only accounts
   * (no password) can't use this path.
   */
  async changePassword(
    q: Querier,
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const { rows } = await q.query<{ password_hash: string | null }>(
      `SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    if (rows.length === 0) throw new NotFoundError('Account not found');
    const hash = rows[0].password_hash;
    if (!hash) throw new ForbiddenError('This account has no password set.');
    if (!verifyPasswordHash(currentPassword ?? '', hash)) {
      throw new ForbiddenError('Current password is incorrect.');
    }
    if ((newPassword ?? '').length < MIN_PASSWORD) {
      throw new ValidationError(`password must be at least ${MIN_PASSWORD} characters`);
    }
    // Set the new hash AND revoke all existing sessions (a changed password must
    // invalidate any token an attacker may hold).
    await q.query(
      `UPDATE users SET password_hash = $2, sessions_valid_from = now() WHERE id = $1`,
      [userId, hashPassword(newPassword)],
    );
  },

  /** Soft-delete the owner's account + revoke its sessions immediately. */
  async softDelete(q: Querier, userId: string): Promise<void> {
    await q.query(
      `UPDATE users SET deleted_at = now(), sessions_valid_from = now()
       WHERE id = $1 AND deleted_at IS NULL`,
      [userId],
    );
  },
};
