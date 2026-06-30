// Minimal migration runner: applies db/migrations/*.sql in order.
// Usage: DATABASE_URL=postgres://... node db/migrate.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, 'migrations');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. See .env.example.');
    process.exit(1);
  }
  const client = new pg.Client({
    connectionString: url,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
  });
  await client.connect();

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
      console.log(`• skip ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    console.log(`▶ applying ${file}…`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`✓ applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`✗ failed ${file}:`, err.message);
      process.exit(1);
    }
  }
  await client.end();
  console.log('All migrations applied.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
