// E2E publishing-workflow test against a REAL PostgreSQL database.
// Without DATABASE_URL it prints SKIP and exits 0 (CI stays green); it never claims
// success without an actual database connection.
//
// Scenario (mirrors the manual checklist):
//   1. sign in as Super Admin  2. create a test announcement  3. persisted in PG
//   4. public layer shows it for its section  5. edit -> public update  6. audit log
//   7. section targeting (other section must NOT see it)  8. delete safely
//   9. telegram bot stays disabled the whole time.
//
// Usage: DATABASE_URL=... SUPER_ADMIN_EMAIL=... SUPER_ADMIN_PASSWORD=... [SESSION_SECRET=...] \
//          node --experimental-strip-types scripts/e2e-publish-test.mjs
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {hashPassword, verifyPassword, createSession, getAdminFromToken} from '../src/lib/server/auth.ts';
import {createContent, deleteContent, audit} from '../src/lib/server/content.ts';
import {withTx, q, qOne} from '../src/lib/server/db.ts';
import {getPublicContent} from '../src/lib/server/public.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATABASE_URL = process.env.DATABASE_URL || '';
const EMAIL = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
const PASSWORD = process.env.SUPER_ADMIN_PASSWORD || '';

if (!DATABASE_URL) {
  console.log('SKIP: DATABASE_URL is not configured — E2E publishing test requires a real PostgreSQL database.');
  console.log('     Configure Neon + env vars, then run: npm run test:e2e');
  process.exit(0);
}
if (!EMAIL || !PASSWORD) { console.error('ERROR: SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD are required for the sign-in step.'); process.exit(1); }
if (process.env.TELEGRAM_BOT_ENABLED === 'true') { console.error('ABORT: TELEGRAM_BOT_ENABLED=true — this test must run with the bot disabled.'); process.exit(1); }

const pool = new Pool({connectionString: DATABASE_URL, ssl: {rejectUnauthorized: true} });
let failures = 0;
const step = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failures++; };

try {
  for (const stmt of readFileSync(path.join(root, 'database/portal-schema.sql'), 'utf8').split(/;\s*(?:\n|$)/)) {
    const t = stmt.replace(/--[^\n]*/g, '').trim();
    if (t) await pool.query(t);
  }

  // 1. create a test-only Super Admin session after verifying the fixture password
  const admin = await qOne(`SELECT id,email,role,is_active,password_hash FROM portal_admins WHERE email=$1`, [EMAIL]);
  const signedIn = admin && admin.is_active && verifyPassword(PASSWORD, admin.password_hash);
  step('1. Super Admin sign-in (password verified against scrypt hash)', Boolean(signedIn));
  if (!signedIn) throw new Error('cannot continue without a valid super admin — run npm run create:super-admin first');
  const token = await createSession(admin.id, undefined, true);
  const sessionAdmin = await getAdminFromToken(token);
  step('1b. session token resolves to the admin in DB', sessionAdmin?.id === admin.id);

  const testId = `e2e-ann-${Date.now()}`;
  const row = {id: testId, title: 'إشعار اختبار E2E', body: 'محتوى اختبار E2E', scope: 'section', section: 'A', subject_id: '', author: 'e2e', priority: 'normal', published_at: new Date().toISOString(), pinned: 'false'};

  // 2+3. create announcement inside a transaction with required audit
  await withTx(async db => {
    await createContent('announcements', row, db);
    await audit(admin.email, 'content.upsert.announcements', {id: testId}, db);
  });
  const persisted = await qOne(`SELECT id,title FROM portal_announcements WHERE id=$1`, [testId]);
  step('2/3. test announcement created and persisted in PostgreSQL', persisted?.id === testId);

  // 4/5. public read layer shows it for section A only
  const pubA = await getPublicContent('announcements', 'A');
  const pubB = await getPublicContent('announcements', 'B');
  step('4. public layer (section A) shows the announcement', pubA.content.announcements.some(a => a.id === testId));
  step('7. section targeting: section B does NOT see it', !pubB.content.announcements.some(a => a.id === testId));

  // 5. edit -> public update
  await withTx(async db => {
    await createContent('announcements', {...row, title: 'إشعار اختبار E2E — مُحدَّث'}, db);
    await audit(admin.email, 'content.upsert.announcements', {id: testId, edit: true}, db);
  });
  const pubA2 = await getPublicContent('announcements', 'A');
  step('5. edit is visible publicly after update', pubA2.content.announcements.find(a => a.id === testId)?.title.includes('مُحدَّث'));

  // 6. audit log has both upserts
  const auditRows = await q(`SELECT action FROM portal_audit WHERE detail->>'id'=$1 ORDER BY id`, [testId]);
  step('6. audit log contains the create+edit actions', auditRows.length >= 2, `${auditRows.length} entries`);

  // 8. delete safely (transaction + audit)
  await withTx(async db => {
    await deleteContent('announcements', testId, db);
    await audit(admin.email, 'content.delete.announcements', {id: testId}, db);
  });
  const afterDelete = await qOne(`SELECT id FROM portal_announcements WHERE id=$1`, [testId]);
  const pubA3 = await getPublicContent('announcements', 'A');
  step('8. test content removed safely and no longer public', !afterDelete && !pubA3.content.announcements.some(a => a.id === testId));

  // 9. telegram stayed disabled
  step('9. Telegram notifications remained disabled throughout', process.env.TELEGRAM_BOT_ENABLED !== 'true');
} catch (err) {
  console.error('ERROR:', err instanceof Error ? err.message : err);
  failures++;
} finally {
  await pool.end();
}
console.log(failures ? `\nE2E RESULT: FAIL (${failures} failing step(s))` : '\nE2E RESULT: PASS — all steps verified against the real database.');
process.exit(failures ? 1 : 0);
