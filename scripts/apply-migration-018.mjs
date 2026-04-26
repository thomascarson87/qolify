// One-shot migration runner for 018. Reads the SQL file and executes it
// against DATABASE_URL_POOLER. Idempotency-safe to a degree (will fail if
// re-run because CREATE TABLE without IF NOT EXISTS); that's intentional —
// migrations should run once.
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = resolve(__dirname, '../supabase/migrations/018_saved_analyses_and_import_batches.sql');

const url = process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL(_POOLER) missing'); process.exit(1); }

const sql = postgres(url, { ssl: 'require', max: 1, prepare: !url.includes('pooler.supabase.com') });
const ddl = readFileSync(sqlPath, 'utf8');

try {
  console.log('Applying migration 018...');
  await sql.unsafe(ddl);
  console.log('OK');
} catch (e) {
  console.error('Migration failed:', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
