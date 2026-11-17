import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {registerHooks} from "node:module";

process.env.DATABASE_URL = "postgres://pgmem:5432/security-test";
process.env.SESSION_SECRET = "isolated-security-test-secret";
process.env.TELEGRAM_BOT_ENABLED = "false";

// Exercise the actual route exports with the same aliases resolved by Next.js.
const sourceRoot = new URL("../../", import.meta.url);
registerHooks({resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(new URL(specifier.slice(2) + ".ts", sourceRoot).href, context);
  if (specifier === "next/server") return nextResolve("next/server.js", context);
  return nextResolve(specifier, context);
}});

const {newDb} = await import("pg-mem");
const {setPoolForTests, q, qOne, withTx} = await import("./db.ts");
const publishing = await import("./publish.ts");
const {createSession, getAdminFromToken} = await import("./auth.ts");
const {NextRequest} = await import("next/server.js");
const contentRoute = await import("../../app/api/admin/content/route.ts");

const teacher = {id: 4, email: "teacher@synthetic.test", role: "teacher", is_active: true, status: "active",
  assigned_subjects: ["optics"], perms: {teacher_sections: {optics: ["A"]}}};

async function fixture() {
  const mem = newDb();
  const {Pool} = mem.adapters.createPg();
  const pool = new Pool();
  let base = readFileSync(new URL("../../../database/portal-schema.sql", import.meta.url), "utf8")
    .replace("CHECK (role IN ('super_admin','editor','viewer'))",
      "CHECK (role IN ('super_admin','editor','viewer','general_representative','section_representative','teacher'))");
  const rbac = readFileSync(new URL("../../../database/portal-rbac.sql", import.meta.url), "utf8")
    .split(/;\s*(?:\n|$)/).filter(sql => !sql.includes("portal_admins_role_check"))
    .map(sql => sql.replace(/\s*CHECK \(sections <@[^)]*\)/, "")).join(";");
  for (const statement of (base + ";" + rbac).split(/;\s*(?:\n|$)/)) {
    const sql = statement.replace(/--[^\n]*/g, "").trim();
    if (sql) await pool.query(sql);
  }
  setPoolForTests(pool);
  await q("INSERT INTO portal_subjects (id,name) VALUES ('optics','Optics'),('quantum','Quantum')");
  await q(`INSERT INTO portal_admins (id,email,name,password_hash,role,is_active,status,assigned_subjects,perms)
    VALUES (4,$1,'Synthetic teacher','test-only','teacher',true,'active',$2,$3)`,
    [teacher.email, JSON.stringify(teacher.assigned_subjects), JSON.stringify(teacher.perms)]);
  await q(`INSERT INTO portal_admins (id,email,name,password_hash,role,is_active,status)
    VALUES (8,'editor@synthetic.test','Synthetic editor','test-only','editor',true,'active'),
           (1,'owner@synthetic.test','Synthetic owner','test-only','super_admin',true,'active')`);
  await q(`INSERT INTO portal_lectures (id,subject_id,number,title,file_url,status,sections,created_by)
    VALUES ('owned-lecture','optics',1,'Original lecture','/lectures/original.pdf','published','["A"]',4)`);
  await q(`INSERT INTO portal_announcements (id,title,body,scope,section,subject_id,created_by)
    VALUES ('owned-announcement','Original announcement','Original body','teacher','A','optics',4)`);
  return pool;
}

for (const [name, mutate] of [
  ["lecture metadata", admin => publishing.updateLectureMetaOwn(admin, "owned-lecture", {title: "Unauthorized change"})],
  ["file replacement", admin => publishing.replaceLectureFileOwn(admin, "owned-lecture", "/lectures/replacement.pdf", "replacement.pdf")],
  ["announcement edit", admin => publishing.updateAnnouncementOwn(admin, "owned-announcement", {body: "Unauthorized change"})],
  ["lecture deletion", admin => publishing.deleteOwnContent(admin, "lectures", "owned-lecture")],
  ["announcement deletion", admin => publishing.deleteOwnContent(admin, "announcements", "owned-announcement")],
]) {
  test(`CONT-001: subject revocation blocks ${name} through an existing session`, async () => {
    const pool = await fixture();
    try {
      const token = await createSession(teacher.id);
      await q("UPDATE portal_admins SET assigned_subjects='[]' WHERE id=4");
      const current = await getAdminFromToken(token);
      assert.ok(current, "the session stays valid while its current subject permissions are reduced");
      assert.deepEqual(current.assigned_subjects, []);
      assert.equal((await mutate(current)).ok, false);
      assert.equal((await qOne("SELECT title FROM portal_lectures WHERE id='owned-lecture'")).title, "Original lecture");
      assert.equal((await qOne("SELECT body FROM portal_announcements WHERE id='owned-announcement'")).body, "Original body");
      assert.equal((await q("SELECT id FROM portal_audit")).length, 0);
      assert.equal((await qOne("SELECT title FROM portal_lectures WHERE id='owned-lecture'")).title, "Original lecture");
      assert.equal((await qOne("SELECT body FROM portal_announcements WHERE id='owned-announcement'")).body, "Original body");
    } finally { await pool.end(); }
  });
}

test("CONT-001: an allowed new subject cannot retarget content outside the teacher's current scope", async () => {
  const pool = await fixture();
  try {
    await q("UPDATE portal_admins SET assigned_subjects='[\"quantum\"]', perms='{}' WHERE id=4");
    const current = {...teacher, assigned_subjects: ["quantum"], perms: {}};
    await assert.rejects(withTx(tx => publishing.applyContentUpsert(tx, current, "lectures", {
      id: "owned-lecture", subject_id: "quantum", number: 1, title: "Retargeted", sections: ["A"],
    })), error => error.status === 403);
    assert.equal((await qOne("SELECT subject_id FROM portal_lectures WHERE id='owned-lecture'")).subject_id, "optics");
  } finally { await pool.end(); }
});

test("CONT-003: stale principal cannot publish after its role is revoked before transaction entry", async () => {
  const pool = await fixture();
  try {
    await q("UPDATE portal_admins SET role='viewer' WHERE id=4");
    await assert.rejects(withTx(tx => publishing.applyContentUpsert(tx, teacher, "lectures", {
      id: "stale-principal", subject_id: "optics", number: 2, title: "Stale principal", sections: ["A"],
    })), error => error.status === 403);
    assert.equal(await qOne("SELECT id FROM portal_lectures WHERE id='stale-principal'"), null);
  } finally { await pool.end(); }
});

function request(method, type = "lectures", id = "owned-lecture", token, body) {
  return new NextRequest(`https://portal.synthetic.test/api/admin/content?type=${type}&id=${id}`, {
    method, headers: {"x-portal-admin": "1", ...(token ? {cookie: `portal_session=${token}`} : {}),
      ...(body ? {"content-type": "application/json"} : {})},
    ...(body ? {body: JSON.stringify(body)} : {}),
  });
}

for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
  test(`anonymous ${method} /api/admin/content fails closed`, async () => {
    const response = await contentRoute[method](request(method));
    assert.equal(response.status, 401);
  });
}

test("CONT-002: editor cannot DELETE an owner-managed university exam through the actual API", async () => {
  const pool = await fixture();
  try {
    await q(`INSERT INTO portal_exams (id,subject_id,title,type,date,start_time,sections,created_by)
      VALUES ('university-final','optics','Final','Final','2099-11-25','09:00','["A"]',1)`);
    const token = await createSession(8);
    const response = await contentRoute.DELETE(request("DELETE", "exams", "university-final", token));
    assert.equal(response.status, 403);
    assert.ok(await qOne("SELECT id FROM portal_exams WHERE id='university-final'"));
  } finally { await pool.end(); }
});

test("owner can delete university exams and editor can delete ordinary content", async () => {
  const pool = await fixture();
  try {
    await q(`INSERT INTO portal_exams (id,subject_id,title,type,date,start_time,sections,created_by)
      VALUES ('university-final','optics','Final','Final','2099-11-25','09:00','["A"]',1)`);
    const ownerToken = await createSession(1, undefined, true);
    assert.equal((await contentRoute.DELETE(request("DELETE", "exams", "university-final", ownerToken))).status, 200);
    const editorToken = await createSession(8);
    assert.equal((await contentRoute.DELETE(request("DELETE", "lectures", "owned-lecture", editorToken))).status, 200);
    assert.equal(await qOne("SELECT id FROM portal_exams WHERE id='university-final'"), null);
    assert.equal(await qOne("SELECT id FROM portal_lectures WHERE id='owned-lecture'"), null);
  } finally { await pool.end(); }
});

test("DELETE missing content fails closed and does not create a deletion audit", async () => {
  const pool = await fixture();
  try {
    const token = await createSession(8);
    assert.equal((await contentRoute.DELETE(request("DELETE", "lectures", "missing", token))).status, 403);
    assert.equal((await q("SELECT id FROM portal_audit")).length, 0);
  } finally { await pool.end(); }
});

test("CONT-001: API DELETE rejects the former teacher even when they still own the row", async () => {
  const pool = await fixture();
  try {
    const token = await createSession(teacher.id);
    await q("UPDATE portal_admins SET assigned_subjects='[]' WHERE id=4");
    assert.equal((await contentRoute.DELETE(request("DELETE", "lectures", "owned-lecture", token))).status, 403);
    assert.ok(await qOne("SELECT id FROM portal_lectures WHERE id='owned-lecture'"));
  } finally { await pool.end(); }
});
