import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

process.env.DATABASE_URL = "postgres://pgmem:5432/test";
process.env.SESSION_SECRET = "pgmem-test-secret";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const {newDb} = await import("pg-mem");
const {buildUpsert} = await import("./content-schema.ts");
const {setPoolForTests, withTx, q} = await import("./db.ts");
const {audit, auditBestEffort} = await import("./content.ts");

// Mock pool that records the exact SQL lifecycle of a transaction.
function recordingPool(failOn) {
  const log = [];
  const client = {
    query: async (sql, params = []) => {
      log.push(sql);
      if (failOn && failOn(sql)) { log.push("ERROR"); throw new Error("simulated DB failure: " + sql.slice(0, 60)); }
      return {rows: sql.includes("RETURNING") ? [{id: "x"}] : []};
    },
    release: () => { log.push("RELEASE"); },
  };
  return {pool: {connect: async () => client, query: client.query, end: async () => {}}, log};
}

const ann = (id, title, section = "A") => ({id, title, body: "b", scope: "section", section, author: "e2e", priority: "normal", published_at: "2026-11-05", pinned: "false"});

test("tx: a failing REQUIRED audit propagates and triggers ROLLBACK (never COMMIT, error not swallowed)", async () => {
  const {pool, log} = recordingPool(sql => sql.includes("portal_audit"));
  setPoolForTests(pool);
  await assert.rejects(
    withTx(async db => {
      const {sql, params} = buildUpsert("announcements", ann("tx-1", "before"));
      await db.q(sql, params);
      await audit("admin@x", "content.upsert.announcements", {id: "tx-1"}, db); // must throw
    }),
    /portal_audit/
  );
  assert.equal(log[0], "BEGIN");
  assert.ok(log.includes("ROLLBACK"));
  assert.ok(!log.includes("COMMIT"));
  assert.ok(log.some(s => s.includes("portal_announcements"))); // content write was attempted inside the tx
  assert.ok(log.some(s => s.includes("portal_audit")));         // audit attempted after it
});

test("tx: content + audit commit together when both succeed", async () => {
  const {pool, log} = recordingPool(null);
  setPoolForTests(pool);
  await withTx(async db => {
    const {sql, params} = buildUpsert("announcements", ann("tx-2", "ok"));
    await db.q(sql, params);
    await audit("admin@x", "content.upsert.announcements", {id: "tx-2"}, db);
  });
  assert.equal(log[0], "BEGIN");
  assert.ok(log.includes("COMMIT"));
  assert.ok(!log.includes("ROLLBACK"));
});

test("audit policy: required audit throws, best-effort audit (login attempts) never throws", async () => {
  const {pool} = recordingPool(sql => sql.includes("portal_audit"));
  setPoolForTests(pool);
  const failing = {q: async (sql) => { if (sql.includes("portal_audit")) throw new Error("db down"); return []; }, qOne: async () => null};
  await assert.rejects(audit("a", "content.upsert.subjects", {}, failing));
  await auditBestEffort("a", "admin.login.failed", {ip: "1.2.3.4"}, failing); // resolves, logs warning only
});

async function pgMemPool() {
  const mem = newDb();
  const {Pool} = mem.adapters.createPg();
  const pool = new Pool();
  const schema = readFileSync(path.join(root, "database/portal-schema.sql"), "utf8");
  for (const stmt of schema.split(/;\s*(?:\n|$)/)) {
    const t = stmt.replace(/--[^\n]*/g, "").trim();
    if (t) await pool.query(t);
  }
  return pool;
}

test("schema applies cleanly and enforces CHECK + FK constraints", async () => {
  const pool = await pgMemPool();
  setPoolForTests(pool);
  await assert.rejects(pool.query(`INSERT INTO portal_schedule (id,section,day,start,"end") VALUES ('bad','Z',9,'x','y')`));
  await assert.rejects(pool.query(`INSERT INTO portal_lectures (id,subject_id,number,title,status) VALUES ('l','nope',1,'t','weird')`));
  await pool.query(`INSERT INTO portal_subjects (id,name) VALUES ('s1','mat')`);
  await pool.query(`INSERT INTO portal_lectures (id,subject_id,number,title,status) VALUES ('l1','s1',1,'t','draft')`);
  const rows = await pool.query(`SELECT status FROM portal_lectures`);
  assert.equal(rows.rows[0].status, "draft"); // drafts allowed in DB; filtered out of the public layer
  await pool.end();
});

test("migration safety (real SQL semantics via pg-mem): DO NOTHING preserves admin edits; --update overwrites; re-run safe", async () => {
  const pool = await pgMemPool();
  setPoolForTests(pool);
  const count = async () => (await pool.query(`SELECT count(*)::int AS c FROM portal_announcements`)).rows[0].c;

  const safe = buildUpsert("announcements", ann("m-1", "seed-title"), "nothing");
  await pool.query(safe.sql.replace(" RETURNING id", ""), safe.params);
  assert.equal(await count(), 1);

  await pool.query(`UPDATE portal_announcements SET title='admin-edit' WHERE id='m-1'`);

  // re-run default (nothing) mode → no overwrite, no duplicate
  await pool.query(safe.sql.replace(" RETURNING id", ""), safe.params);
  assert.equal(await count(), 1);
  assert.equal((await pool.query(`SELECT title FROM portal_announcements WHERE id='m-1'`)).rows[0].title, "admin-edit");

  // explicit --update mode → controlled overwrite
  const upd = buildUpsert("announcements", ann("m-1", "seed-title"), "update");
  await pool.query(upd.sql, upd.params);
  assert.equal((await pool.query(`SELECT title FROM portal_announcements WHERE id='m-1'`)).rows[0].title, "seed-title");
  assert.equal(await count(), 1); // still one row — idempotent
  await pool.end();
});
