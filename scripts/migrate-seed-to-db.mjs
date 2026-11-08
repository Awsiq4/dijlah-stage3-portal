// Safe seed migration into portal_* tables.
// DEFAULT (non-destructive): ON CONFLICT DO NOTHING — existing rows (including later
// administrative edits) are NEVER overwritten. Safe to re-run any number of times.
// Explicit update mode: node ... migrate-seed-to-db.mjs --update  → ON CONFLICT DO UPDATE.
// Usage: DATABASE_URL=... node --experimental-strip-types scripts/migrate-seed-to-db.mjs [--update]
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {SEED} from '../src/lib/seed.ts';
import {buildUpsert} from '../src/lib/server/content-schema.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATABASE_URL = process.env.DATABASE_URL || '';
const MODE = process.argv.includes('--update') ? 'update' : 'nothing';
if (!DATABASE_URL) { console.error('ERROR: DATABASE_URL is required (Postgres connection string).'); process.exit(1); }

console.log(`Mode: ${MODE === 'nothing' ? 'SAFE INSERT-ONLY (existing rows preserved)' : 'EXPLICIT UPDATE (--update)'}`);

const pool = new Pool({connectionString: DATABASE_URL, ssl: {rejectUnauthorized: true} }); // TLS verification mandatory
const j = v => (v === undefined || v === null ? null : typeof v === 'object' ? JSON.stringify(v) : v);

// seed (camelCase) -> DB row (snake_case), matching the column allowlists
const mapRow = (type, s) => {
  switch (type) {
    case 'subjects': return {id: s.id, name: s.name, english_name: s.englishName, teacher: s.teacher, description: s.description, color: s.color};
    case 'lectures': return {id: s.id, subject_id: s.subjectId, number: s.number, title: s.title, description: s.description, file_url: s.fileUrl, file_name: s.fileName, status: s.status, updated_at: s.updatedAt};
    case 'schedule': return {id: s.id, section: s.section, day: s.day, start: s.start, end: s.end, subject_id: s.subjectId, teacher: s.teacher, room: s.room, kind: s.kind, status: s.status, note: s.note || '', periods: j(s.periods)};
    default: return s;
  }
};

try {
  await pool.query(readFileSync(path.join(root, 'database/portal-schema.sql'), 'utf8'));

  for (const type of ['subjects', 'lectures', 'schedule']) {
    let inserted = 0, skipped = 0;
    for (const s of SEED[type]) {
      const {sql, params} = buildUpsert(type, mapRow(type, s), MODE);
      const res = MODE === 'nothing' ? await pool.query(sql, params) : await pool.query(sql, params);
      if (MODE === 'nothing') { if (res.rows.length) inserted++; else skipped++; }
    }
    if (MODE === 'nothing') console.log(`portal_${type}: inserted ${inserted}, already existed (preserved) ${skipped}`);
    else console.log(`portal_${type}: upserted ${SEED[type].length}`);
  }

  const tg = [
    ['general', 'general', SEED.telegram.general],
    ...Object.entries(SEED.telegram.sections).map(([k, url]) => ['section', k, url]),
    ...Object.entries(SEED.telegram.subjects).map(([k, url]) => ['subject', k, url]),
  ];
  for (const [kind, key, url] of tg) {
    if (!url) continue; // e.g. section F has no confirmed channel — never invent one
    if (MODE === 'nothing') {
      const res = await pool.query(
        `INSERT INTO portal_telegram (kind,key,url) VALUES ($1,$2,$3) ON CONFLICT (kind,key) DO NOTHING RETURNING key`, [kind, key, url]);
      console.log(`portal_telegram ${kind}/${key}: ${res.rows.length ? 'inserted' : 'preserved'}`);
    } else {
      await pool.query(
        `INSERT INTO portal_telegram (kind,key,url) VALUES ($1,$2,$3) ON CONFLICT (kind,key) DO UPDATE SET url=EXCLUDED.url`, [kind, key, url]);
    }
  }

  for (const t of ['subjects', 'lectures', 'schedule', 'telegram', 'announcements', 'exams', 'assignments']) {
    const r = await pool.query(`SELECT count(*)::int AS c FROM portal_${t}`);
    console.log(`portal_${t}: total in DB = ${r.rows[0].c}`);
  }
  console.log('Done. Default mode never overwrites existing rows; re-running is safe.');
} finally {
  await pool.end();
}
