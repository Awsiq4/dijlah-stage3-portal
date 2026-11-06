import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

process.env.DATABASE_URL = "postgres://pgmem:5432/test";
process.env.SESSION_SECRET = "pgmem-test-secret";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const {newDb} = await import("pg-mem");
const {setPoolForTests, withTx, q, qOne, defaultQueryer} = await import("./db.ts");
const {hashPassword, createSession, getAdminFromToken} = await import("./auth.ts");
const {applyContentUpsert} = await import("./publish.ts");
const {validateUploadRequest, UploadRejectedError, MAX_PDF_BYTES_DIRECT} = await import("./storage.ts");

const repA = {id: 2, email: "repA@x", role: "section_representative", status: "active", is_active: true, assigned_section: "A"};
const repB = {id: 3, email: "repB@x", role: "section_representative", status: "active", is_active: true, assigned_section: "B"};

async function makeDb() {
  const mem = newDb();
  const {Pool} = mem.adapters.createPg();
  const pool = new Pool();
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
  for (const a of [repA, repB]) {
    await pool.query(
      `INSERT INTO portal_admins (id, email, name, password_hash, role, status, is_active, assigned_section) VALUES ($1,$2,$3,$4,$5,'active',true,$6)`,
      [a.id, a.email, "Rep " + a.assigned_section, hashPassword("password-12345"), a.role, a.assigned_section]
    );
  }
  return pool;
}

test("me/session: admin row exposes role+assignments and NEVER leaks password_hash", async () => {
  const pool = await makeDb();
  const token = await createSession(repA.id);
  const admin = await getAdminFromToken(token);
  assert.ok(admin);
  assert.equal(admin.email, "repA@x");
  assert.equal(admin.role, "section_representative");
  assert.equal(admin.assigned_section, "A");
  assert.ok(!("password_hash" in admin), "password_hash must not be present");
  assert.ok(!("revoked" in admin) && !("expired" in admin));
  await pool.end();
});

test("content API ownership: created_by/source come from the session, never the client", async () => {
  const pool = await makeDb();
  await withTx(async tx => {
    // client tries to spoof ownership — must be ignored
    await applyContentUpsert(tx, repA, "announcements", {id: "a1", title: "t", scope: "section", section: "A", created_by: 999, source: "telegram"}, "web");
  });
  const row = await qOne(`SELECT created_by, source FROM portal_announcements WHERE id='a1'`);
  assert.equal(row.created_by, repA.id);   // server identity wins
  assert.equal(row.source, "web");         // server source wins
  await pool.end();
});

test("content API ownership: non-owner update is rejected with 403, owner update works", async () => {
  const pool = await makeDb();
  await withTx(async tx => { await applyContentUpsert(tx, repA, "announcements", {id: "a2", title: "mine", scope: "section", section: "A"}); });
  // rep B tries to edit rep A's announcement
  await assert.rejects(
    withTx(async tx => { await applyContentUpsert(tx, repB, "announcements", {id: "a2", title: "hacked", scope: "section", section: "B"}); }),
    (e) => e.status === 403
  );
  assert.equal((await qOne(`SELECT title FROM portal_announcements WHERE id='a2'`)).title, "mine"); // unchanged
  // owner can edit
  await withTx(async tx => { await applyContentUpsert(tx, repA, "announcements", {id: "a2", title: "updated", scope: "section", section: "A"}); });
  assert.equal((await qOne(`SELECT title FROM portal_announcements WHERE id='a2'`)).title, "updated");
  await pool.end();
});

test("upload validation: role, pdf type, size cap, subject authorization", () => {
  const teacher = {id: 4, role: "teacher", status: "active", assigned_subjects: ["nonlinear-optics"], perms: {teacher_sections: {"nonlinear-optics": ["A"]}}};
  // happy path
  validateUploadRequest(teacher, {filename: "lec.pdf", contentType: "application/pdf", size: 50 * 1024 * 1024, subjectId: "nonlinear-optics", sections: ["A"]});
  // non-pdf rejected
  assert.throws(() => validateUploadRequest(teacher, {filename: "x.exe", contentType: "application/x-msdownload", size: 1000}), UploadRejectedError);
  assert.throws(() => validateUploadRequest(teacher, {filename: "x.pdf", contentType: "text/html", size: 1000}), UploadRejectedError);
  // over cap rejected (direct cap is 100MB, not the 4.5MB function limit)
  assert.throws(() => validateUploadRequest(teacher, {filename: "big.pdf", contentType: "application/pdf", size: MAX_PDF_BYTES_DIRECT + 1}), /too large/);
  // unassigned subject rejected
  assert.throws(() => validateUploadRequest(teacher, {filename: "x.pdf", contentType: "application/pdf", size: 1000, subjectId: "quantum-mechanics"}), /not authorized/);
  // unauthorized section for the subject
  assert.throws(() => validateUploadRequest(teacher, {filename: "x.pdf", contentType: "application/pdf", size: 1000, subjectId: "nonlinear-optics", sections: ["C"]}), /not authorized/);
  // viewer cannot upload
  assert.throws(() => validateUploadRequest({id: 9, role: "viewer", status: "active"}, {filename: "x.pdf", contentType: "application/pdf", size: 1000}), UploadRejectedError);
  // suspended teacher cannot upload
  assert.throws(() => validateUploadRequest({...teacher, status: "suspended", is_active: false}, {filename: "x.pdf", contentType: "application/pdf", size: 1000}), UploadRejectedError);
});

test("REGRESSION: section rep CAN upload/publish a valid subject (was 403), audience own-or-all only", () => {
  const ALL = ["A", "B", "C", "F"];
  // the original bug: rep A + digital-systems + all sections was rejected
  validateUploadRequest(repA, {filename: "lec.pdf", contentType: "application/pdf", size: 1024, subjectId: "digital-systems", sections: ALL});
  validateUploadRequest(repA, {filename: "lec.pdf", contentType: "application/pdf", size: 1024, subjectId: "digital-systems", sections: ["A"]});
  // rep A targeting section B alone must still be rejected
  assert.throws(() => validateUploadRequest(repA, {filename: "lec.pdf", contentType: "application/pdf", size: 1024, subjectId: "digital-systems", sections: ["B"]}), /not authorized/);
  assert.throws(() => validateUploadRequest(repA, {filename: "lec.pdf", contentType: "application/pdf", size: 1024, subjectId: "digital-systems", sections: ["A", "B"]}), /not authorized/);
});

test("teacher upload: assigned subject OK, unassigned rejected, unpermitted section rejected", () => {
  const t = {id: 4, role: "teacher", status: "active", assigned_subjects: ["nonlinear-optics"], perms: {teacher_sections: {"nonlinear-optics": ["A", "B"]}}};
  validateUploadRequest(t, {filename: "x.pdf", contentType: "application/pdf", size: 1000, subjectId: "nonlinear-optics", sections: ["A"]});
  assert.throws(() => validateUploadRequest(t, {filename: "x.pdf", contentType: "application/pdf", size: 1000, subjectId: "digital-systems"}), /not authorized/);
  assert.throws(() => validateUploadRequest(t, {filename: "x.pdf", contentType: "application/pdf", size: 1000, subjectId: "nonlinear-optics", sections: ["C"]}), /not authorized/);
});
