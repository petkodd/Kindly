import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import { userRepo } from '../src/lib/repos/user';
import { ForbiddenError, NotFoundError, ValidationError } from '../src/lib/types';

let q: Querier;
beforeEach(() => {
  q = makeTestDb();
});

async function makeAccount(): Promise<string> {
  const user = await userRepo.create(q, { email: `u${Math.random()}@example.com`, password: 'originalpass' });
  return user.id;
}

describe('account view', () => {
  it('returns the account without the password hash', async () => {
    const id = await makeAccount();
    const account = await userRepo.getAccount(q, id);
    expect(account.id).toBe(id);
    expect(account.email).toContain('@');
    expect(account).not.toHaveProperty('password_hash');
  });

  it('404s for a deleted account', async () => {
    const id = await makeAccount();
    await userRepo.softDelete(q, id);
    await expect(userRepo.getAccount(q, id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('update profile', () => {
  it('sets the display name', async () => {
    const id = await makeAccount();
    const updated = await userRepo.updateProfile(q, id, { fullName: 'Sarah Connor' });
    expect(updated.full_name).toBe('Sarah Connor');
  });

  it('rejects an over-long name', async () => {
    const id = await makeAccount();
    await expect(
      userRepo.updateProfile(q, id, { fullName: 'x'.repeat(200) }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('change password', () => {
  it('changes the password when the current one is correct', async () => {
    const id = await makeAccount();
    await userRepo.changePassword(q, id, 'originalpass', 'brandnewpass');
    // Old password no longer works; new one does.
    const { rows } = await q.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [id]);
    expect(await userRepo.verifyCredentials(q, rows[0].email, 'originalpass')).toBeNull();
    expect(await userRepo.verifyCredentials(q, rows[0].email, 'brandnewpass')).not.toBeNull();
  });

  it('rejects a wrong current password (Forbidden)', async () => {
    const id = await makeAccount();
    await expect(
      userRepo.changePassword(q, id, 'wrongcurrent', 'brandnewpass'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects a too-short new password', async () => {
    const id = await makeAccount();
    await expect(
      userRepo.changePassword(q, id, 'originalpass', 'short'),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
