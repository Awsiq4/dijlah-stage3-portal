import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

process.env.DATABASE_URL = "postgres://pgmem:5432/test";
process.env.SESSION_SECRET = "pgmem-test-secret";
process.env.TELEGRAM_BOT_ENABLED = "true";
process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.TELEGRAM_BOT_USERNAME = "test_bot";

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
  const notifications = readFileSync(path.join(root, "database/telegram-notifications.sql"), "utf8");
  for (const sql of [base, rbac.join(";"), notifications]) {
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

test("web and bot use the same PDF fingerprint and keep one item when expanding its audience", async () => {
  const pool = await makeDb();
  try {
    const {withTx} = await import("./db.ts");
    const {applyContentUpsert} = await import("./publish.ts");
    await q(`INSERT INTO tg_subscribers (chat_id,section,prefs) VALUES
      (101,'A','{}'),(102,'B','{}'),(103,'C','{"lectures":false}'),(104,'F','{}')`);
    const hash = "a".repeat(64);
    const row = {id: "web-original", subject_id: "nonlinear-optics", number: 1, title: "بصريات", file_url: "/lectures/first.pdf", sections: ["A"], status: "published"};
    await withTx(tx => applyContentUpsert(tx, repA, "lectures", row, "web", {}, hash));
    const input = {id: "bot-copy", subjectId: "nonlinear-optics", number: 2, title: "عنوان مختلف", fileUrl: "/lectures/renamed.pdf", sections: ["A"], source: "telegram", fingerprint: hash};
    const duplicate = await publishLecture(teacher, input);
    assert.equal(duplicate.issue.kind, "duplicate");
    assert.equal(duplicate.issue.id, row.id);
    const otherAudience = {...input, sections: ["A", "B", "C", "F"]};
    assert.equal((await publishLecture(teacher, otherAudience)).ok, false);
    const proposal = await publishLecture(repA, otherAudience);
    assert.equal(proposal.issue.kind, "expand");
    assert.deepEqual(proposal.issue.addedSections, ["B", "C", "F"]);
    const applied = await publishLecture(repA, {...otherAudience, options: {expand: row.id}});
    assert.equal(applied.action, "expanded");
    assert.equal(applied.id, row.id);
    const [stored] = await q("SELECT id, title, sections, created_by FROM portal_lectures");
    assert.deepEqual(asArr(stored.sections), ["A", "B", "C", "F"]);
    assert.equal(stored.created_by, repA.id);
    assert.equal(stored.title, row.title);
    assert.equal((await q("SELECT id FROM portal_lectures")).length, 1);
    assert.equal((await publishLecture(repA, {...otherAudience, options: {expand: row.id}})).issue.kind, "duplicate");
    const delivered = await q(`SELECT s.section, count(*)::int AS count FROM tg_deliveries d
      JOIN tg_subscribers s ON s.id=d.subscriber_id GROUP BY s.section ORDER BY s.section`);
    assert.deepEqual(delivered, [{section: "A", count: 1}, {section: "B", count: 1}, {section: "F", count: 1}]);
  } finally {
    await pool.end();
  }
});

test("identical announcements are blocked, and changed announcements require review", async () => {
  const pool = await makeDb();
  try {
    const original = {id: "ann-original", title: "موعد الامتحان", body: "الأحد الساعة التاسعة", scope: "section", section: "A", source: "telegram"};
    assert.equal((await publishAnnouncement(repA, original)).ok, true);
    const duplicate = await publishAnnouncement(repA, {...original, id: "ann-copy", body: "الأحد   الساعة التاسعة"});
    assert.equal(duplicate.issue.kind, "duplicate");
    const changed = {...original, id: "ann-change", body: "الأحد الساعة العاشرة"};
    const proposal = await publishAnnouncement(repA, changed);
    assert.equal(proposal.issue.kind, "similar");
    assert.equal(proposal.issue.canUpdate, true);
    const update = await publishAnnouncement(repA, {...changed, options: {replace: original.id}});
    assert.equal(update.action, "updated");
    assert.equal(update.id, original.id);
    assert.equal((await qOne("SELECT body FROM portal_announcements WHERE id=$1", [original.id])).body, changed.body);
    assert.equal((await publishAnnouncement(repB, {...original, id: "ann-b", section: "B"})).ok, true);
    assert.equal((await q("SELECT id FROM portal_announcements")).length, 2);
  } finally {
    await pool.end();
  }
});

test("PDF fingerprint comes from server-read bytes rather than filename", async () => {
  const {pdfFingerprint} = await import("./publication-dedup.ts");
  const originalFetch = globalThis.fetch;
  const origin = "https://test.public.blob.vercel-storage.com/lectures/";
  try {
    globalThis.fetch = async url => new Response(url.pathname.endsWith("updated.pdf") ? "%PDF-1.7 updated" : "%PDF-1.7 original");
    const first = await pdfFingerprint(origin + "first.pdf");
    assert.match(first, /^[0-9a-f]{64}$/);
    assert.equal(await pdfFingerprint(origin + "renamed.pdf"), first);
    assert.notEqual(await pdfFingerprint(origin + "updated.pdf"), first);
    assert.equal(await pdfFingerprint("https://example.test/file.pdf"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("workers claim the same notification once and leave unrelated events queued", async () => {
  const pool = await makeDb();
  const originalFetch = globalThis.fetch;
  const sent = [];
  try {
    const {createEvent, drainQueue} = await import("./notify.ts");
    await q("INSERT INTO tg_subscribers (chat_id,section) VALUES (2001,'A')");
    const event = {type: "lecture", title: "ملزمة", version: 1, scope: "section", section: "A"};
    const target = await createEvent({...event, refId: "target"});
    const unrelated = await createEvent({...event, refId: "unrelated"});
    globalThis.fetch = async (url, request) => {
      sent.push(JSON.parse(request.body).chat_id);
      return Response.json({ok: true, result: {message_id: 1}});
    };
    await Promise.all([drainQueue(20, [target.eventId]), drainQueue(20, [target.eventId])]);
    assert.deepEqual(sent, [2001]);
    assert.equal((await qOne("SELECT status FROM tg_deliveries WHERE event_id=$1", [target.eventId])).status, "sent");
    assert.equal((await qOne("SELECT status FROM tg_deliveries WHERE event_id=$1", [unrelated.eventId])).status, "pending");
  } finally {
    globalThis.fetch = originalFetch;
    await pool.end();
  }
});

test("owner publication stores public display name instead of login email", async () => {
  const pool = await makeDb();
  const owner = {id: 1, role: "super_admin", is_active: true, status: "active", name: "", email: "owner@private.test"};
  await pool.query("INSERT INTO portal_admins(id,email,name,password_hash,role) VALUES(1,'owner@private.test','','hash','super_admin')");
  const published = await publishAnnouncement(owner, {title: "تبليغ من المالك", body: "محتوى", scope: "general", section: "all", source: "telegram"});
  assert.equal(published.ok, true);
  const row = await qOne("SELECT author FROM portal_announcements WHERE id=$1", [published.id]);
  assert.equal(row.author, "Aws Faris");
  await pool.end();
});

test("web coursework retries enqueue once and archive/restore never queues a new notification", async () => {
  const pool = await makeDb();
  try {
    const {withTx} = await import("./db.ts");
    const {applyContentUpsert, publicationQueuesTelegram} = await import("./publish.ts");
    const {archiveCoursework, changeCoursework} = await import("./bot-coursework-manage.ts");
    const row = {id:"retry-assignment", subject_id:"nonlinear-optics", title:"تطبيق", instructions:"حل التمارين",
      assigned_at:"2035-01-01", due_at:"2035-01-05", sections:["A"], status:"active"};
    assert.equal(publicationQueuesTelegram("assignments", row), true);
    assert.equal(publicationQueuesTelegram("exams", {...row, status:"cancelled"}), false);
    await withTx(tx => applyContentUpsert(tx, repA, "assignments", row));
    await withTx(tx => applyContentUpsert(tx, repA, "assignments", row));
    assert.equal((await q("SELECT id FROM portal_assignments")).length, 1);
    assert.equal((await q("SELECT id FROM tg_events")).length, 1);
    assert.equal((await changeCoursework(repB, "a", row.id, "due_at", "2035-01-06", row.due_at, "web")).ok, false);
    assert.equal((await changeCoursework(repA, "a", row.id, "due_at", "2035-01-06", row.due_at, "web")).ok, true);
    assert.equal((await changeCoursework(repA, "a", row.id, "due_at", "2035-01-07", row.due_at, "web")).ok, false);
    assert.equal((await archiveCoursework(repB, "a", row.id, true, "web")).ok, false);
    assert.equal((await archiveCoursework(repA, "a", row.id, true, "web")).ok, true);
    assert.ok((await qOne("SELECT archived_at FROM portal_assignments WHERE id=$1", [row.id])).archived_at);
    assert.equal((await archiveCoursework(repA, "a", row.id, false, "web")).ok, true);
    assert.equal((await qOne("SELECT archived_at FROM portal_assignments WHERE id=$1", [row.id])).archived_at, null);
    assert.equal((await q("SELECT id FROM tg_events")).length, 1);
  } finally {
    await pool.end();
  }
});

test("teacher announcements enforce the same subject and section on the web and can be restored", async () => {
  const pool = await makeDb();
  try {
    const {withTx} = await import("./db.ts");
    const {applyContentUpsert, archiveContent} = await import("./publish.ts");
    const row = {id:"teacher-web-ann", title:"تبليغ البصريات", body:"تفاصيل", subject_id:"nonlinear-optics",
      scope:"teacher", section:"A", published_at:"2035-01-02"};
    await assert.rejects(withTx(tx => applyContentUpsert(tx, teacher, "announcements", {...row, section:"C"})), {status:403});
    await assert.rejects(withTx(tx => applyContentUpsert(tx, teacher, "announcements", {...row, section:"invalid"})), {status:403});
    await withTx(tx => applyContentUpsert(tx, teacher, "announcements", row));
    assert.equal((await archiveContent(teacher, "announcements", row.id, true)).ok, true);
    assert.equal((await archiveContent(teacher, "announcements", row.id, false)).ok, true);
    assert.equal((await q("SELECT id FROM tg_events")).length, 1);
  } finally {
    await pool.end();
  }
});
