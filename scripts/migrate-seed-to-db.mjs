// Idempotent migration of the verified seed data (src/lib/seed.ts) into the portal_* tables.
// Safe to re-run: every row is upserted ON CONFLICT (id) / (kind,key).
// Usage: DATABASE_URL=... node --experimental-strip-types scripts/migrate-seed-to-db.mjs
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {SEED} from '../src/lib/seed.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATABASE_URL = process.env.DATABASE_URL || '';
if (!DATABASE_URL) { console.error('ERROR: DATABASE_URL is required (Postgres connection string).'); process.exit(1); }

const pool = new Pool({connectionString: DATABASE_URL, ssl: {rejectUnauthorized: false}});
const j = v => (v === undefined || v === null ? null : typeof v === 'object' ? JSON.stringify(v) : v);

try {
  await pool.query(readFileSync(path.join(root, 'database/portal-schema.sql'), 'utf8'));

  for (const s of SEED.subjects) {
    await pool.query(
      `INSERT INTO portal_subjects (id,name,english_name,teacher,description,color) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, english_name=EXCLUDED.english_name, teacher=EXCLUDED.teacher, description=EXCLUDED.description, color=EXCLUDED.color, updated_at=now()`,
      [s.id, s.name, s.englishName, s.teacher, s.description, s.color]
    );
  }

  for (const l of SEED.lectures) {
    await pool.query(
      `INSERT INTO portal_lectures (id,subject_id,number,title,description,file_url,file_name,status,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET subject_id=EXCLUDED.subject_id, number=EXCLUDED.number, title=EXCLUDED.title, description=EXCLUDED.description, file_url=EXCLUDED.file_url, file_name=EXCLUDED.file_name, status=EXCLUDED.status, updated_at=EXCLUDED.updated_at`,
      [l.id, l.subjectId, l.number, l.title, l.description, l.fileUrl, l.fileName, l.status, l.updatedAt]
    );
  }

  for (const s of SEED.schedule) {
    await pool.query(
      `INSERT INTO portal_schedule (id,section,day,start,"end",subject_id,teacher,room,kind,status,note,periods) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET section=EXCLUDED.section, day=EXCLUDED.day, start=EXCLUDED.start, "end"=EXCLUDED."end", subject_id=EXCLUDED.subject_id, teacher=EXCLUDED.teacher, room=EXCLUDED.room, kind=EXCLUDED.kind, status=EXCLUDED.status, note=EXCLUDED.note, periods=EXCLUDED.periods`,
      [s.id, s.section, s.day, s.start, s.end, s.subjectId, s.teacher, s.room, s.kind, s.status, s.note || '', j(s.periods)]
    );
  }

  const tg = [
    ['general', 'general', SEED.telegram.general],
    ...Object.entries(SEED.telegram.sections).map(([k, url]) => ['section', k, url]),
    ...Object.entries(SEED.telegram.subjects).map(([k, url]) => ['subject', k, url]),
  ];
  for (const [kind, key, url] of tg) {
    if (!url) continue; // e.g. section F has no confirmed channel — never invent one
    await pool.query(
      `INSERT INTO portal_telegram (kind,key,url) VALUES ($1,$2,$3) ON CONFLICT (kind,key) DO UPDATE SET url=EXCLUDED.url`,
      [kind, key, url]
    );
  }

  for (const [t, n] of [['subjects', SEED.subjects.length], ['lectures', SEED.lectures.length], ['schedule', SEED.schedule.length], ['telegram', tg.filter(x => x[2]).length]]) {
    const r = await pool.query(`SELECT count(*)::int AS c FROM portal_${t}`);
    console.log(`portal_${t}: seeded ${n}, in DB ${r.rows[0].c}`);
  }
  for (const t of ['announcements', 'exams', 'assignments']) {
    const r = await pool.query(`SELECT count(*)::int AS c FROM portal_${t}`);
    console.log(`portal_${t}: in DB ${r.rows[0].c} (seed is empty — nothing lost)`);
  }
  console.log('Migration complete. Idempotent: re-running only updates rows.');
} finally {
  await pool.end();
}
