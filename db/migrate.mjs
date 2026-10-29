// Minimal migration runner: applies db/migrations/*.sql in order.
// Usage: DATABASE_URL=postgres://... node db/migrate.mjs
// Also imported by db/seed.mjs (runMigrations), which applies migrations to
// the local Docker database before seeding.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { pgSslConfig, stripUrlSslParams } from './pgSsl.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, 'migrations');

/** Apply every pending migration through an already-connected pg client. */
export async function runMigrations(client, log = console.log) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const { rows } = await client.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
    if (rows.length) {
      log(`• skip ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    log(`▶ applying ${file}…`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      log(`✓ applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`failed ${file}: ${err.message}`);
    }
  }
  log('All migrations applied.');
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. See .env.example.');
    process.exit(1);
  }
  const { connectionString, stripped } = stripUrlSslParams(url);
  if (stripped.length) {
    console.warn(`Ignoring ${stripped.join(', ')} in DATABASE_URL; TLS is set by PGSSL / PGSSLROOTCERT (see db/pgSsl.mjs).`);
  }
  // Certificates are always verified. See db/pgSsl.mjs for PGSSLROOTCERT / PGSSL=disable.
  const client = new pg.Client({ connectionString, ssl: pgSslConfig(process.env) });
  await client.connect();
  try {
    await runMigrations(client);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
  await client.end();
}

// Run only when invoked directly (`node db/migrate.mjs`), not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
