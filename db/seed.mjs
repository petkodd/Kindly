#!/usr/bin/env node
// npm run db:seed — local demo data. Applies migrations, then seeds.
// Refuses to run unless DATABASE_URL points at localhost / 127.0.0.1 and
// NODE_ENV is not production. Safe to re-run: it replaces the demo rows
// and refreshes their dates to the current week.
import pg from 'pg';
import { loadLocalEnv, sslOption } from '../scripts/lib/env.mjs';
import { runMigrations } from './migrate.mjs';
import { assertSafeSeedTarget, demoPasswordFrom, seedDemo, DEMO_EMAIL, ADMIN_EMAIL, PARENT_FIRST_NAME } from './seed-lib.mjs';

async function main() {
  loadLocalEnv();
  let host, password;
  try {
    host = assertSafeSeedTarget(process.env);
    password = demoPasswordFrom(process.env);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: sslOption() });
  try {
    await client.connect();
  } catch (err) {
    console.error(`✗ Could not connect to Postgres on ${host}: ${err.message}`);
    console.error('  Is the database running? Try: docker compose up -d --wait');
    process.exit(1);
  }

  try {
    await runMigrations(client, () => {});
    console.log(`✓ migrations applied on ${host}`);
    await client.query('BEGIN');
    const { token } = await seedDemo(client, { password });
    await client.query('COMMIT');

    const port = process.env.PORT || 3000;
    console.log(`✓ demo data seeded on ${host}

  Organizer login   ${DEMO_EMAIL}   (password: your DEMO_PASSWORD)
  Admin login       ${ADMIN_EMAIL}  (password: your DEMO_PASSWORD)
  Parent            "${PARENT_FIRST_NAME}": 8 memories, 3 conversations, 1 open P2 flag, summary preview

  Parent talk link (new on every run; the previous link stops working):
  http://localhost:${port}/app/talk?token=${token}
`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`✗ Seed failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
