// Applies the portal schema (and telegram schema) idempotently.
// Safe to re-run: every statement is CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
// Usage: DATABASE_URL=... node --experimental-strip-types scripts/apply-portal-schema.mjs
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATABASE_URL = process.env.DATABASE_URL || '';
if (!DATABASE_URL) { console.error('ERROR: DATABASE_URL is required.'); process.exit(1); }

const pool = new Pool({connectionString: DATABASE_URL, ssl: {rejectUnauthorized: true} });
try {
  for (const f of ['database/portal-schema.sql', 'database/telegram-notifications.sql']) {
    const sql = readFileSync(path.join(root, f), 'utf8');
    for (const stmt of sql.split(/;\s*(?:\n|$)/)) {
      const t = stmt.replace(/--[^\n]*/g, '').trim();
      if (t) await pool.query(t);
    }
    console.log(`applied ${f} (idempotent)`);
  }
  const r = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE 'portal_%' OR table_name LIKE 'tg_%') ORDER BY 1`);
  console.log('tables present:', r.rows.map(x => x.table_name).join(', '));
} finally {
  await pool.end();
}
