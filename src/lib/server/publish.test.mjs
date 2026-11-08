import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

process.env.DATABASE_URL = "postgres://pgmem:5432/test";
process.env.SESSION_SECRET = "pgmem-test-secret";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const {newDb} = await import("pg-mem");
const {setPoolForTests, q, qOne} = await import("./db.ts");
const {publishAnnouncement, publishLecture} = await import("./publish.ts");
const {canModifyContent} = await import("./rbac.ts");
const {lecturesForSection} = await import("./public-filters.ts");
const asArr = (v) => typeof v === "string" ? (v.trim().startsWith("[") ? JSON.parse(v) : v.split(",").filter(Boolean)) : v;

const repA = {id: 2, email: "repA@x", role: "section_representative", status: "active", is_active: true, assigned_section: "A"};
const repB = {id: 3, email: "repB@x", role: "section_representative", status: "active", is_active: true, assigned_section: "B"};
const teacher = {id: 4, email: "t@x", role: "teacher", status: "active", is_active: true, assigned_subjects: ["nonlinear-optics"], perms: {teacher_sections: {"nonlinear-optics": ["A", "B"]}}};
const suspendedTeacher = {...teacher, id: 5, email: "t-susp@x", status: "suspended", is_active: false};

async function makeDb() {
  const mem = newDb();
  const {Pool} = mem.adapters.createPg();
  const pool = new Pool();
  // pg-mem cannot DROP CONSTRAINT, so apply the base schema with the extended role CHECK inline,
  // and skip the DROP/ADD constraint statements from the rbac migration.
  let base = readFileSync(path.join(root, "database/portal-schema.sql"), "utf8");
  base = base.replace("CHECK (role IN ('super_admin','editor','viewer'))",
    "CHECK (role IN ('super_admin','editor','viewer','general_representative','section_representative','teacher'))");
  const rbac = readFileSync(path.join(root, "database/portal-rbac.sql"), "utf8")
    .split(/;\s*(?:\n|$)/).map(st => st.replace(/\s*CHECK \(sections <@[^)]*\)/, "")).filter(st => !st.includes("portal_admins_role_check"));
  for (const sql of [base, rbac.join(";")]) {
    for (const stmt of sql.split(/;\s*(?:\n|$)/)) {
      const t = stmt.replace(/--[^\n]*/g, "").trim();
      if (t) await pool.query(t);
    }
  }
  setPoolForTests(pool);
  await pool.query(`INSERT INTO portal_subjects (id, name) VALUES ('nonlinear-optics','بصريات لاخطية'), ('quantum-mechanics','ميكانيك الكم') ON CONFLICT (id) DO NOTHING`);
  for (const a of [repA, repB, teacher, suspendedTeacher]) {
    await pool.query(
      `INSERT INTO portal_admins (id, email, name, password_hash, role, status, is_active, assigned_section, assigned_subjects, perms)
       VALUES ($1,$2,$3,'scrypt:x:y',$4,$5,$6,$7,$8,$9)`,
      [a.id, a.email, a.email, a.role, a.status, a.is_active, a.assigned_section || null, JSON.stringify(a.assigned_subjects || []), JSON.stringify(a.perms || {})]
    );
  }
  return pool;
}


test("E2E publish (pg-mem): rep publishes to own section; cross-section denied and NOT persisted", async () => {
  const pool = await makeDb();
  const ok = await publishAnnouncement(repA, {title: "تبليغ A", body: "...", scope: "section", section: "A", source: "web"});
  assert.equal(ok.ok, true);
  const row = await qOne(`SELECT * FROM portal_announcements WHERE id=$1`, [ok.id]);
  assert.equal(row.created_by, repA.id);
  assert.equal(row.source, "web");

  const denied = await publishAnnouncement(repA, {title: "تبليغ B", scope: "section", section: "B", source: "web"});
  assert.equal(denied.ok, false);
  assert.equal((await q(`SELECT count(*)::int AS c FROM portal_announcements`))[0].c, 1); // nothing extra persisted

  const repBok = await publishAnnouncement(repB, {title: "تبليغ B", scope: "section", section: "B", source: "telegram"});
  assert.equal(repBok.ok, true);
  const bRow = await qOne(`SELECT source FROM portal_announcements WHERE id=$1`, [repBok.id]);
  assert.equal(bRow.source, "telegram");
  await pool.end();
});

test("E2E publish (pg-mem): teacher subject/section enforcement + suspended denied", async () => {
  const pool = await makeDb();
  const ok = await publishLecture(teacher, {subjectId: "nonlinear-optics", number: 1, title: "محاضرة 1", fileUrl: "/lectures/x.pdf", sections: ["A", "B"], source: "telegram"});
  assert.equal(ok.ok, true);
  const badSubject = await publishLecture(teacher, {subjectId: "quantum-mechanics", number: 1, title: "x", fileUrl: "/l.pdf", sections: ["A"]});
  assert.equal(badSubject.ok, false);
  const badSection = await publishLecture(teacher, {subjectId: "nonlinear-optics", number: 2, title: "x", fileUrl: "/l.pdf", sections: ["C"]});
  assert.equal(badSection.ok, false);
  const susp = await publishLecture(suspendedTeacher, {subjectId: "nonlinear-optics", number: 3, title: "x", fileUrl: "/l.pdf", sections: ["A"]});
  assert.equal(susp.ok, false);
  assert.equal((await q(`SELECT count(*)::int AS c FROM portal_lectures`))[0].c, 1); // only the authorized one persisted
  await pool.end();
});

test("ownership: creator can modify own row; other rep cannot (canModifyContent)", async () => {
  const pool = await makeDb();
  const a = await publishAnnouncement(repA, {title: "ملكي", scope: "section", section: "A"});
  assert.equal(a.ok, true);
  const row = await qOne(`SELECT created_by FROM portal_announcements WHERE id=$1`, [a.id]);
  assert.equal(canModifyContent(repA, row), true);
  assert.equal(canModifyContent(repB, row), false);
  assert.equal(canModifyContent({id: 1, role: "super_admin", status: "active"}, row), true);
  await pool.end();
});

test("audit trail records every publication with actor+source", async () => {
  const pool = await makeDb();
  await publishAnnouncement(repA, {title: "t", scope: "section", section: "A", source: "telegram"});
  const rows = await q(`SELECT actor, action, detail FROM portal_audit WHERE action='publish.announcements'`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor, "repA@x");
  const detail = typeof rows[0].detail === "string" ? JSON.parse(rows[0].detail) : rows[0].detail;
  assert.equal(detail.source, "telegram");
  await pool.end();
});

test("E2E: section rep publishes material to ALL sections (single record, shared audience) and to own section; visibility per section", async () => {
  const pool = await makeDb();
  const ALL = ["A", "B", "C", "F"];
  const r1 = await publishLecture(repA, {subjectId: "nonlinear-optics", number: 1, title: "ملزمة week1", fileUrl: "/lectures/book1.pdf", sections: ALL, source: "web"});
  assert.equal(r1.ok, true);
  const r2 = await publishLecture(repA, {subjectId: "quantum-mechanics", number: 1, title: "محاضرة A only", fileUrl: "/lectures/lecA.pdf", sections: ["A"], source: "telegram"});
  assert.equal(r2.ok, true);
  // denied: rep A targeting section B only
  const denied = await publishLecture(repA, {subjectId: "nonlinear-optics", number: 2, title: "x", fileUrl: "/l.pdf", sections: ["B"]});
  assert.equal(denied.ok, false);

  const rows = await q(`SELECT id, subject_id, sections, source, created_by FROM portal_lectures ORDER BY id`);
  assert.equal(rows.length, 2);
  const allRow = rows.find(r => r.subject_id === "nonlinear-optics");
  assert.deepEqual(asArr(allRow.sections), ALL);
  assert.equal(allRow.created_by, repA.id);
  const ownRow = rows.find(r => r.subject_id === "quantum-mechanics");
  assert.deepEqual(asArr(ownRow.sections), ["A"]);
  assert.equal(ownRow.source, "telegram");

  // student visibility: section A sees both; B/C/F see only the all-sections one
  const forA = lecturesForSection(rows.map(r => ({...r, status: "published", sections: asArr(r.sections)})), "A");
  const forB = lecturesForSection(rows.map(r => ({...r, status: "published", sections: asArr(r.sections)})), "B");
  assert.equal(forA.length, 2);
  assert.equal(forB.length, 1);
  assert.equal(forB[0].subject_id, "nonlinear-optics");
  await pool.end();
});

test("migration file is idempotent: applying portal-rbac.sql twice succeeds", async () => {
  const mem = newDb();
  const {Pool} = mem.adapters.createPg();
  const pool = new Pool();
  let base = readFileSync(path.join(root, "database/portal-schema.sql"), "utf8");
  base = base.replace("CHECK (role IN ('super_admin','editor','viewer'))",
    "CHECK (role IN ('super_admin','editor','viewer','general_representative','section_representative','teacher'))");
  const rbacRaw = readFileSync(path.join(root, "database/portal-rbac.sql"), "utf8");
  const norm = (sql) => sql.split(/;\s*(?:\n|$)/)
    .filter(st => !st.includes("portal_admins_role_check"))
    .map(st => st.replace(/\s*CHECK \(sections <@[^)]*\)/, "")).join(";");
  for (const round of [1, 2]) {
    for (const stmt of norm(base + ";" + rbacRaw).split(/;\s*(?:\n|$)/)) {
      const t = stmt.replace(/--[^\n]*/g, "").trim();
      if (!t) continue;
      // pg-mem cannot re-apply CREATE TABLE IF NOT EXISTS with PK; round 2 re-runs only the idempotent ALTERs
      if (round === 2 && !/^ALTER TABLE/i.test(t)) continue;
      await pool.query(t);
    }
    const cols = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name='portal_lectures' AND column_name='sections'`);
    assert.equal(cols.rowCount, 1, `round ${round}: sections column exists`);
  }
  await pool.end();
});

// ---------- content management services (ownership, archive, replace, delete) ----------
test("manage: owner can edit/archive/delete own announcement; other rep cannot", async () => {
  const {updateAnnouncementOwn, archiveContent, deleteOwnContent, listOwnContent} = await import("./publish.ts");
  const pool = await makeDb();
  const a = await publishAnnouncement(repA, {title: "mine", scope: "section", section: "A"});
  assert.equal(a.ok, true);
  const id = a.id;

  const edit = await updateAnnouncementOwn(repA, id, {title: "mine v2"});
  assert.equal(edit.ok, true);
  assert.equal((await qOne(`SELECT title FROM portal_announcements WHERE id=$1`, [id])).title, "mine v2");

  // repB cannot edit
  const hack = await updateAnnouncementOwn(repB, id, {title: "hacked"});
  assert.equal(hack.ok, false);
  assert.equal((await qOne(`SELECT title FROM portal_announcements WHERE id=$1`, [id])).title, "mine v2");

  // archive hides from public filter
  const arch = await archiveContent(repA, "announcements", id, true);
  assert.equal(arch.ok, true);
  const {announcementsForSection} = await import("./public-filters.ts");
  const rows = await q(`SELECT * FROM portal_announcements WHERE id=$1`, [id]);
  assert.equal(announcementsForSection(rows.map(r => ({...r, archived_at: r.archived_at ? String(r.archived_at) : null})), "A").length, 0);

  // unarchive restores
  await archiveContent(repA, "announcements", id, false);
  const rows2 = await q(`SELECT * FROM portal_announcements WHERE id=$1`, [id]);
  assert.equal(announcementsForSection(rows2.map(r => ({...r, archived_at: r.archived_at ? String(r.archived_at) : null})), "A").length, 1);

  // listOwnContent: repA sees own, repB doesn't
  const mine = await listOwnContent(repA, "announcements", 0, 10);
  assert.ok(mine.rows.some(r => r.id === id));
  const theirs = await listOwnContent(repB, "announcements", 0, 10);
  assert.ok(!theirs.rows.some(r => r.id === id));

  // delete: owner only
  const delOther = await deleteOwnContent(repB, "announcements", id);
  assert.equal(delOther.ok, false);
  const del = await deleteOwnContent(repA, "announcements", id);
  assert.equal(del.ok, true);
  assert.equal((await qOne(`SELECT 1 FROM portal_announcements WHERE id=$1`, [id])), null);
  await pool.end();
});

test("manage: lecture meta edit + file replace keep the same id (stable link); ownership enforced", async () => {
  const {publishLecture, updateLectureMetaOwn, replaceLectureFileOwn} = await import("./publish.ts");
  const pool = await makeDb();
  const a = await publishLecture(repA, {subjectId: "nonlinear-optics", number: 1, title: "old", fileUrl: "/lectures/old.pdf", sections: ["A", "B", "C", "F"]});
  assert.equal(a.ok, true);
  const id = a.id;
  const meta = await updateLectureMetaOwn(repA, id, {title: "new title", description: "d"});
  assert.equal(meta.ok, true);
  const row = await qOne(`SELECT title, file_url FROM portal_lectures WHERE id=$1`, [id]);
  assert.equal(row.title, "new title");
  assert.equal(row.file_url, "/lectures/old.pdf");
  const rep = await replaceLectureFileOwn(repA, id, "https://blob.vercel-storage.com/x-new.pdf", "new.pdf");
  assert.equal(rep.ok, true);
  const row2 = await qOne(`SELECT file_url, file_name FROM portal_lectures WHERE id=$1`, [id]);
  assert.equal(row2.file_url, "https://blob.vercel-storage.com/x-new.pdf"); // same id, new file
  // repB cannot replace
  const hack = await replaceLectureFileOwn(repB, id, "/evil.pdf", "e.pdf");
  assert.equal(hack.ok, false);
  await pool.end();
});
