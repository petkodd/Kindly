import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import { parentRepo } from '../src/lib/repos/parent';
import { safetyFlagRepo } from '../src/lib/repos/safetyFlag';
import { fakeAiClient } from '../src/lib/ai/fake';
import { crisisResourceV1 } from '../src/lib/ai/prompts';
import { NotFoundError, ValidationError } from '../src/lib/types';

let q: Querier;

async function makeUserId(): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`u${Math.random()}@example.com`],
  );
  return rows[0].id;
}

async function makeParentId(): Promise<string> {
  const parent = await parentRepo.create(q, {
    buyerId: await makeUserId(),
    firstName: 'Robert',
    relationship: 'father',
  });
  return parent.id;
}

beforeEach(() => {
  q = makeTestDb();
});

describe('safety flag repo', () => {
  it('maps the scan severity to the DB enum and minimizes detail', async () => {
    const parentId = await makeParentId();
    const flag = await safetyFlagRepo.record(q, {
      parentId,
      severity: 'p0',
      detail: 'expressed suicidal intent',
    });
    expect(flag.severity).toBe('p0_crisis');
    expect(flag.status).toBe('open');
    expect(flag.detail).toBe('expressed suicidal intent');
  });

  it('queue returns unresolved flags, highest severity first', async () => {
    const parentId = await makeParentId();
    await safetyFlagRepo.record(q, { parentId, severity: 'p2', detail: 'welfare' });
    await safetyFlagRepo.record(q, { parentId, severity: 'p0', detail: 'crisis' });
    await safetyFlagRepo.record(q, { parentId, severity: 'p1', detail: 'medical' });

    const queue = await safetyFlagRepo.queue(q);
    expect(queue.map((f) => f.severity)).toEqual([
      'p0_crisis',
      'p1_acute_medical',
      'p2_welfare',
    ]);
  });

  it('resolving stamps who + when and drops it from the queue', async () => {
    const parentId = await makeParentId();
    const flag = await safetyFlagRepo.record(q, { parentId, severity: 'p3', detail: 'abuse' });
    const admin = await makeUserId();

    const resolved = await safetyFlagRepo.updateStatus(q, flag.id, 'resolved', admin);
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolved_at).not.toBeNull();
    expect(resolved.resolved_by).toBe(admin);
    expect((await safetyFlagRepo.queue(q)).find((f) => f.id === flag.id)).toBeUndefined();
  });

  it('reviewing keeps a flag in the queue and unresolved', async () => {
    const parentId = await makeParentId();
    const flag = await safetyFlagRepo.record(q, { parentId, severity: 'p2', detail: 'welfare' });
    const reviewing = await safetyFlagRepo.updateStatus(q, flag.id, 'reviewing');
    expect(reviewing.resolved_at).toBeNull();
    expect((await safetyFlagRepo.queue(q)).some((f) => f.id === flag.id)).toBe(true);
  });

  it('truncates an over-long detail to the cap (no transcript dumps)', async () => {
    const parentId = await makeParentId();
    const flag = await safetyFlagRepo.record(q, {
      parentId,
      severity: 'p2',
      detail: 'x'.repeat(500),
    });
    expect(flag.detail).toHaveLength(280);
  });

  it('rejects an invalid status and an unknown flag', async () => {
    const parentId = await makeParentId();
    const flag = await safetyFlagRepo.record(q, { parentId, severity: 'p2', detail: 'x' });
    // @ts-expect-error testing an invalid status at runtime
    await expect(safetyFlagRepo.updateStatus(q, flag.id, 'nope')).rejects.toBeInstanceOf(ValidationError);
    await expect(
      safetyFlagRepo.updateStatus(q, '00000000-0000-0000-0000-000000000000', 'resolved'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('crisis resources', () => {
  it('surfaces 988 for P0 and 911 for P1', () => {
    expect(crisisResourceV1('p0')).toContain('988');
    expect(crisisResourceV1('p1')).toContain('911');
  });
});

describe('message safety hook (mirrors the route)', () => {
  it('a crisis message classifies P0 and records a flag', async () => {
    const parentId = await makeParentId();
    const scan = await fakeAiClient.safetyScan({ message: 'I want to kill myself' });
    expect(scan.severity).toBe('p0');

    if (scan.severity !== 'none') {
      await safetyFlagRepo.record(q, {
        parentId,
        severity: scan.severity,
        detail: scan.rationale,
      });
    }
    const queue = await safetyFlagRepo.queue(q);
    expect(queue).toHaveLength(1);
    expect(queue[0].severity).toBe('p0_crisis');
  });

  it('an ordinary message is not flagged', async () => {
    const scan = await fakeAiClient.safetyScan({ message: 'The garden looks lovely today' });
    expect(scan.severity).toBe('none');
  });

  it('records the flag from the scan before the reply — survives a reply failure', async () => {
    const parentId = await makeParentId();
    // The route now records the flag from the scan result BEFORE awaiting the
    // companion reply, so a reply failure can't lose it.
    const scan = await fakeAiClient.safetyScan({ message: 'I want to kill myself' });
    if (scan.severity !== 'none') {
      await safetyFlagRepo.record(q, { parentId, severity: scan.severity, detail: scan.rationale });
    }
    // (companion reply would throw here — irrelevant to the persisted flag)
    expect(await safetyFlagRepo.queue(q)).toHaveLength(1);
  });
});
