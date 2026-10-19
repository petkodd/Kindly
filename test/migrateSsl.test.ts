import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import type { AddressInfo } from 'node:net';
import { pgSslConfig, stripUrlSslParams } from '../db/pgSsl.mjs';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';

describe('db/pgSsl.mjs: pgSslConfig (migration TLS policy)', () => {
  it('verifies certificates by default', () => {
    expect(pgSslConfig({})).toEqual({ rejectUnauthorized: true });
  });

  it('never returns rejectUnauthorized:false, whatever the env says', () => {
    for (const env of [{}, { PGSSL: 'require' }, { PGSSL: 'no-verify' }, { PGSSLROOTCERT: '' }]) {
      const cfg = pgSslConfig(env);
      expect(cfg).not.toBe(false);
      expect(cfg && cfg.rejectUnauthorized).toBe(true);
    }
  });

  it('PGSSL=disable turns TLS off (local Docker only)', () => {
    expect(pgSslConfig({ PGSSL: 'disable' })).toBe(false);
  });

  it('PGSSLROOTCERT adds the CA and keeps verification on', () => {
    const cfg = pgSslConfig({ PGSSLROOTCERT: '/etc/ca.pem' }, (p) => {
      expect(p).toBe('/etc/ca.pem');
      return PEM;
    });
    expect(cfg).toEqual({ rejectUnauthorized: true, ca: PEM });
  });

  it('fails closed when PGSSLROOTCERT cannot be read', () => {
    const missing = () => {
      throw Object.assign(new Error('nope'), { code: 'ENOENT' });
    };
    expect(() => pgSslConfig({ PGSSLROOTCERT: '/missing.pem' }, missing)).toThrow(/could not be read \(ENOENT\)/);
  });

  it('fails closed when PGSSLROOTCERT is not a PEM certificate', () => {
    expect(() => pgSslConfig({ PGSSLROOTCERT: '/x' }, () => 'garbage')).toThrow(/PEM/);
  });
});

describe('db/pgSsl.mjs: stripUrlSslParams', () => {
  it('removes sslmode=no-verify and friends so the URL cannot disable verification', () => {
    const { connectionString, stripped } = stripUrlSslParams(
      'postgres://u:p@db.example.com:5432/kindly?sslmode=no-verify&sslrootcert=/x&application_name=migrate',
    );
    expect(stripped).toEqual(['sslmode', 'sslrootcert']);
    expect(connectionString).not.toMatch(/ssl/);
    expect(connectionString).toContain('application_name=migrate');
  });

  it('leaves a URL without ssl params untouched', () => {
    const url = 'postgres://u:p@db.example.com:5432/kindly';
    expect(stripUrlSslParams(url)).toEqual({ connectionString: url, stripped: [] });
  });
});

function opensslAvailable(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!opensslAvailable())('pgSslConfig against a real TLS server', () => {
  let dir: string | undefined;
  let server: tls.Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    if (dir) rmSync(dir, { recursive: true, force: true });
    server = undefined;
    dir = undefined;
  });

  async function start(): Promise<{ port: number; certPath: string }> {
    dir = mkdtempSync(path.join(tmpdir(), 'kindly-ca-'));
    const keyPath = path.join(dir, 'key.pem');
    const certPath = path.join(dir, 'cert.pem');
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath,
      '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
    ], { stdio: 'ignore' });
    server = tls.createServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, (s) => s.end());
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return { port: (server!.address() as AddressInfo).port, certPath };
  }

  function connect(port: number, ssl: object): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = tls.connect({ host: '127.0.0.1', servername: 'localhost', port, ...ssl }, () => {
        socket.end();
        resolve();
      });
      socket.on('error', reject);
    });
  }

  it('rejects an untrusted server with the default config', async () => {
    const { port } = await start();
    await expect(connect(port, pgSslConfig({}) as object)).rejects.toThrow(/self.signed|unable to verify|certificate/i);
  });

  it('accepts the server once its CA is supplied through PGSSLROOTCERT', async () => {
    const { port, certPath } = await start();
    await expect(connect(port, pgSslConfig({ PGSSLROOTCERT: certPath }) as object)).resolves.toBeUndefined();
  });
});
