import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import type { AddressInfo } from 'node:net';

/**
 * Fix 3 smoke test. src/lib/db.ts passes `{ rejectUnauthorized: true }` (the
 * same shape exercised here) straight through pg into Node's TLS layer — pg
 * has no custom cert logic of its own. This proves that option shape actually
 * rejects an untrusted certificate, i.e. that the old `rejectUnauthorized:
 * false` was a real MITM exposure and not a no-op setting.
 */

function opensslAvailable(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!opensslAvailable())('Postgres TLS cert verification (db.ts ssl config)', () => {
  let dir: string | undefined;
  let server: tls.Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    if (dir) rmSync(dir, { recursive: true, force: true });
    server = undefined;
    dir = undefined;
  });

  async function startSelfSignedServer(): Promise<number> {
    dir = mkdtempSync(path.join(tmpdir(), 'kindly-tls-'));
    const keyPath = path.join(dir, 'key.pem');
    const certPath = path.join(dir, 'cert.pem');
    // Untrusted on purpose: a self-signed leaf with no chain to any root the
    // client trusts — this is what an attacker's MITM cert looks like.
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyPath, '-out', certPath,
      '-days', '1', '-subj', '/CN=localhost',
    ], { stdio: 'ignore' });
    const key = readFileSync(keyPath);
    const cert = readFileSync(certPath);
    server = tls.createServer({ key, cert }, (socket) => socket.end());
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return (server!.address() as AddressInfo).port;
  }

  it('rejects the connection when rejectUnauthorized is true (the db.ts config)', async () => {
    const port = await startSelfSignedServer();
    await expect(
      new Promise<void>((resolve, reject) => {
        const socket = tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: true }, () => resolve());
        socket.on('error', reject);
      }),
    ).rejects.toThrow(/self.signed|unable to verify|certificate/i);
  });

  it('sanity check: the same untrusted cert is accepted when rejectUnauthorized is false', async () => {
    const port = await startSelfSignedServer();
    await expect(
      new Promise<void>((resolve, reject) => {
        const socket = tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: false }, () => {
          socket.end();
          resolve();
        });
        socket.on('error', reject);
      }),
    ).resolves.toBeUndefined();
  });
});
