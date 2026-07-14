import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import { parentRepo } from '../src/lib/repos/parent';
import { memoryRepo } from '../src/lib/repos/memory';
import { consentRepo } from '../src/lib/repos/consent';
import { NotFoundError, PreconditionError, ValidationError } from '../src/lib/types';

let q: Querier;

// Two buyers, used across isolation tests.
async function makeBuyer(email: string): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [email],
  );
  return rows[0].id;
}

beforeEach(() => {
  q = makeTestDb();
});

describe('parent profile + isolation', () => {
  it('creates a parent that starts un-activated', async () => {
    const buyer = await makeBuyer('sarah@example.com');
    const parent = await parentRepo.create(q, {
      buyerId: buyer,
      firstName: 'Robert',
      relationship: 'father',
    });
    expect(parent.first_name).toBe('Robert');
    expect(parent.activated_at).toBeNull();
  });

  it('rejects empty first name and bad relationship', async () => {
    const buyer = await makeBuyer('a@example.com');
    await expect(
      parentRepo.create(q, { buyerId: buyer, firstName: '  ', relationship: 'father' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      // @ts-expect-error testing invalid relationship at runtime
      parentRepo.create(q, { buyerId: buyer, firstName: 'Bob', relationship: 'cousin' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts relationship "self" (self-use mode, not a gift for someone else)', async () => {
    const buyer = await makeBuyer('self-user@example.com');
    const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Maria', relationship: 'self' });
    expect(parent.relationship).toBe('self');
  });

  it('ISOLATION: a different buyer cannot read the parent (404, not 403)', async () => {
    const sarah = await makeBuyer('sarah@example.com');
    const mallory = await makeBuyer('mallory@example.com');
    const parent = await parentRepo.create(q, {
      buyerId: sarah,
      firstName: 'Robert',
      relationship: 'father',
    });
    // Owner can read.
    await expect(parentRepo.getOwned(q, parent.id, sarah)).resolves.toMatchObject({
      first_name: 'Robert',
    });
    // Stranger gets NotFound — never the data, never a 403 that confirms existence.
    await expect(parentRepo.getOwned(q, parent.id, mallory)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('listForBuyer returns the buyer’s non-deleted parents and isolates tenants', async () => {
    const sarah = await makeBuyer('sarah@example.com');
    const mallory = await makeBuyer('mallory@example.com');
    const robert = await parentRepo.create(q, {
      buyerId: sarah,
      firstName: 'Robert',
      relationship: 'father',
    });
    await parentRepo.create(q, {
      buyerId: sarah,
      firstName: 'Nadia',
      relationship: 'mother',
    });
    // Another tenant's parent must never appear in sarah's list.
    await parentRepo.create(q, {
      buyerId: mallory,
      firstName: 'Eve',
      relationship: 'other',
    });

    expect((await parentRepo.listForBuyer(q, sarah)).map((p) => p.first_name).sort()).toEqual([
      'Nadia',
      'Robert',
    ]);

    // A soft-deleted parent drops out of the list.
    await parentRepo.softDelete(q, robert.id, sarah);
    expect((await parentRepo.listForBuyer(q, sarah)).map((p) => p.first_name)).toEqual(['Nadia']);

    // Isolation: mallory sees only her own parent.
    expect((await parentRepo.listForBuyer(q, mallory)).map((p) => p.first_name)).toEqual(['Eve']);
  });
});

describe('consent-gated activation', () => {
  it('blocks activation without buyer attestation', async () => {
    const buyer = await makeBuyer('sarah@example.com');
    const parent = await parentRepo.create(q, {
      buyerId: buyer,
      firstName: 'Robert',
      relationship: 'father',
    });
    await expect(parentRepo.activate(q, parent.id, buyer)).rejects.toBeInstanceOf(
      PreconditionError,
    );
  });

  it('activates once buyer attestation is recorded; is idempotent', async () => {
    const buyer = await makeBuyer('sarah@example.com');
    const parent = await parentRepo.create(q, {
      buyerId: buyer,
      firstName: 'Robert',
      relationship: 'father',
    });
    await consentRepo.record(q, {
      parentId: parent.id,
      kind: 'buyer_attestation',
      grantedBy: buyer,
    });
    const activated = await parentRepo.activate(q, parent.id, buyer);
    expect(activated.activated_at).not.toBeNull();

    // Calling again returns the same activated parent without error.
    const again = await parentRepo.activate(q, parent.id, buyer);
    expect(again.activated_at).toEqual(activated.activated_at);
  });

  it('has() ignores revoked consents', async () => {
    const buyer = await makeBuyer('sarah@example.com');
    const parent = await parentRepo.create(q, {
      buyerId: buyer,
      firstName: 'Robert',
      relationship: 'father',
    });
    const c = await consentRepo.record(q, {
      parentId: parent.id,
      kind: 'summary_recipient',
      grantedBy: buyer,
      detail: { recipient_email: 'mike@example.com' },
    });
    expect(await consentRepo.has(q, parent.id, 'summary_recipient')).toBe(true);
    await consentRepo.revoke(q, c.id);
    expect(await consentRepo.has(q, parent.id, 'summary_recipient')).toBe(false);
  });
});

describe('memory approval semantics + restricted exclusion', () => {
  async function seedParent(email = 'sarah@example.com'): Promise<{ parentId: string; buyerId: string }> {
    const buyer = await makeBuyer(email);
    const parent = await parentRepo.create(q, {
      buyerId: buyer,
      firstName: 'Robert',
      relationship: 'father',
    });
    return { parentId: parent.id, buyerId: buyer };
  }

  it('onboarding memories are confirmed; conversation memories are proposed', async () => {
    const { parentId } = await seedParent();
    const seeded = await memoryRepo.add(q, {
      parentId,
      layer: 'core',
      key: 'late_spouse',
      value: 'Margaret',
      source: 'onboarding',
    });
    const proposed = await memoryRepo.add(q, {
      parentId,
      layer: 'interest',
      key: 'favorite_music',
      value: 'jazz',
      source: 'conversation',
    });
    expect(seeded.status).toBe('confirmed');
    expect(proposed.status).toBe('proposed');
  });

  it('confirm() promotes a proposed memory exactly once', async () => {
    const { parentId, buyerId } = await seedParent();
    const m = await memoryRepo.add(q, {
      parentId,
      layer: 'interest',
      key: 'team',
      value: 'Tigers',
      source: 'conversation',
    });
    const confirmed = await memoryRepo.confirm(q, m.id, buyerId);
    expect(confirmed.status).toBe('confirmed');
    // Second confirm fails — it's no longer in a proposed state.
    await expect(memoryRepo.confirm(q, m.id, buyerId)).rejects.toBeInstanceOf(PreconditionError);
  });

  it('ISOLATION: a stranger cannot confirm/retire/delete another buyer’s memory', async () => {
    const { parentId } = await seedParent('owner@example.com');
    const stranger = await makeBuyer('stranger@example.com');
    const m = await memoryRepo.add(q, {
      parentId,
      layer: 'interest',
      key: 'team',
      value: 'Tigers',
      source: 'conversation',
    });
    await expect(memoryRepo.confirm(q, m.id, stranger)).rejects.toBeInstanceOf(NotFoundError);
    await expect(memoryRepo.retire(q, m.id, stranger)).rejects.toBeInstanceOf(NotFoundError);
    await expect(memoryRepo.hardDelete(q, m.id, stranger)).rejects.toBeInstanceOf(NotFoundError);
    // The memory is untouched — still proposed and present.
    const [still] = await memoryRepo.list(q, parentId, { status: 'proposed' });
    expect(still?.id).toBe(m.id);
  });

  it('FAMILY VIEW never includes restricted memories or unconfirmed ones', async () => {
    const { parentId } = await seedParent();
    // Confirmed, normal — should appear.
    await memoryRepo.add(q, {
      parentId, layer: 'core', key: 'hometown', value: 'Detroit', source: 'onboarding',
    });
    // Confirmed but restricted (health) — must be excluded.
    await memoryRepo.add(q, {
      parentId, layer: 'sensitive', key: 'mood', value: 'felt low Tuesday',
      source: 'conversation', sensitivity: 'restricted',
    });
    // Manually confirm the restricted one to prove sensitivity (not status) excludes it.
    const all = await memoryRepo.list(q, parentId);
    const restricted = all.find((m) => m.sensitivity === 'restricted')!;
    await q.query(`UPDATE memories SET status = 'confirmed' WHERE id = $1`, [restricted.id]);
    // Proposed, normal — excluded because not confirmed.
    await memoryRepo.add(q, {
      parentId, layer: 'interest', key: 'food', value: 'pie', source: 'conversation',
    });

    const family = await memoryRepo.listForFamily(q, parentId);
    const keys = family.map((m) => m.mem_key);
    expect(keys).toContain('hometown');
    expect(keys).not.toContain('mood'); // restricted excluded
    expect(keys).not.toContain('food'); // unconfirmed excluded
  });

  it('hardDelete removes a memory from the store', async () => {
    const { parentId, buyerId } = await seedParent();
    const m = await memoryRepo.add(q, {
      parentId, layer: 'core', key: 'pet', value: 'Buddy', source: 'onboarding',
    });
    await memoryRepo.hardDelete(q, m.id, buyerId);
    const all = await memoryRepo.list(q, parentId);
    expect(all.find((x) => x.id === m.id)).toBeUndefined();
  });
});
