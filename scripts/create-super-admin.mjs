// Creates or updates the single Super Admin account in portal_admins.
// Usage (env vars only — secrets are never accepted as CLI args and never printed):
//   DATABASE_URL=... SUPER_ADMIN_EMAIL=... SUPER_ADMIN_PASSWORD=... \
//     node --experimental-strip-types scripts/create-super-admin.mjs
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {hashPassword} from '../src/lib/server/auth.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DATABASE_URL = process.env.DATABASE_URL || '';
const EMAIL = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
const PASSWORD = process.env.SUPER_ADMIN_PASSWORD || '';

if (!DATABASE_URL) { console.error('ERROR: DATABASE_URL is required (Postgres connection string).'); process.exit(1); }
if (!EMAIL || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(EMAIL)) { console.error('ERROR: SUPER_ADMIN_EMAIL must be a valid email.'); process.exit(1); }
if (PASSWORD.length < 12) { console.error('ERROR: SUPER_ADMIN_PASSWORD must be at least 12 characters.'); process.exit(1); }

const pool = new Pool({connectionString: DATABASE_URL, ssl: {rejectUnauthorized: false}});
try {
  await pool.query(readFileSync(path.join(root, 'database/portal-schema.sql'), 'utf8'));
  const res = await pool.query(
    `INSERT INTO portal_admins (email, password_hash, role, is_active)
     VALUES ($1, $2, 'super_admin', true)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'super_admin', is_active = true
     RETURNING id, email, role, is_active, created_at`,
    [EMAIL, hashPassword(PASSWORD)]
  );
  const a = res.rows[0];
  console.log(`Super Admin ready: id=${a.id} email=${a.email} role=${a.role} active=${a.is_active}`);
  console.log('Password was hashed with scrypt and stored server-side only. Do not commit or share it.');
} finally {
  await pool.end();
}
