import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";

const connectionString = process.env.CONTENT_SECURITY_TEST_DATABASE_URL || "";
if (connectionString) {
  const url = new URL(connectionString);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Content security integration tests require an explicit loopback-only disposable PostgreSQL database");
  }
}
// Normal CI uses pg-mem. This optional suite never inherits DATABASE_URL.
process.env.DATABASE_URL = "postgres://isolated-content-fixture.invalid/test";
process.env.TELEGRAM_BOT_ENABLED = "false";
const {Pool} = await import("pg");
const {setPoolForTests, q, qOne, withTx} = await import("./db.ts");
const {applyContentUpsert} = await import("./publish.ts");
const teacher = {id: 4, role: "teacher", is_active: true, status: "active", assigned_subjects: ["optics"], perms: {}};
const row = {id: "concurrent-material", subject_id: "optics", number: 1, title: "Synthetic material", sections: ["A"]};

async function fixture() {
  const schema = "audit_content_" + randomUUID().replaceAll("-", "");
  const control = new Pool({connectionString, ssl: false, max: 2});
  await control.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({connectionString, ssl: false, max: 4, application_name: schema,
    options: `-c search_path=${schema} -c statement_timeout=5000 -c lock_timeout=4000`});
  setPoolForTests(pool);
  try {
    for (const file of ["portal-schema.sql", "portal-rbac.sql", "portal-material-kind.sql"]) {
      await pool.query(readFileSync(new URL("../../../database/" + file, import.meta.url), "utf8"));
    }
    await q("INSERT INTO portal_subjects(id,name) VALUES('optics','Synthetic Optics')");
    await q(`INSERT INTO portal_admins(id,email,password_hash,role,is_active,status,assigned_subjects)
      VALUES(4,'teacher@synthetic.test','test-only','teacher',true,'active','["optics"]')`);
  } catch (error) {
    await pool.end();
    await control.query(`DROP SCHEMA "${schema}" CASCADE`);
    await control.end();
    throw error;
  }
  return {pool, control, schema, async close() {
    setPoolForTests(null);
    await pool.end();
    await control.query(`DROP SCHEMA "${schema}" CASCADE`);
    await control.end();
  }};
}

async function waitingOnLock(control, applicationName) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await control.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'", [applicationName]);
    if (result.rowCount > 0) return true;
    await delay(20);
  }
  return false;
}

test("CONT-003/PostgreSQL: revocation holding the account lock completes before a pending publish is authorized", {
  skip: !connectionString, timeout: 10000,
}, async () => {
  const f = await fixture();
  const revoker = await f.pool.connect();
  let write;
  try {
    await revoker.query("BEGIN");
    await revoker.query("UPDATE portal_admins SET role='viewer' WHERE id=4");
    write = withTx(tx => applyContentUpsert(tx, teacher, "lectures", row)).then(() => ({ok: true}), error => ({error}));
    assert.equal(await waitingOnLock(f.control, f.schema), true, "publishing must wait on the account row lock");
    await revoker.query("COMMIT");
    assert.equal((await write).error?.status, 403);
    assert.equal(await qOne("SELECT id FROM portal_lectures WHERE id=$1", [row.id]), null);
    assert.equal((await q("SELECT id FROM portal_audit")).length, 0);
  } finally {
    await revoker.query("ROLLBACK");
    revoker.release();
    await write;
    await f.close();
  }
});

test("CONT-003/PostgreSQL: an authorized write serializes before revocation and later stale writes are denied", {
  skip: !connectionString, timeout: 10000,
}, async () => {
  const f = await fixture();
  const revoker = await f.pool.connect();
  let releaseWrite;
  let signalReady;
  const ready = new Promise(resolve => {signalReady = resolve;});
  const commit = new Promise(resolve => {releaseWrite = resolve;});
  let write;
  let revoke;
  try {
    write = withTx(async tx => {
      await applyContentUpsert(tx, teacher, "lectures", row);
      signalReady();
      await commit;
    });
    await Promise.race([ready, write]);
    revoke = revoker.query("UPDATE portal_admins SET role='viewer' WHERE id=4");
    assert.equal(await waitingOnLock(f.control, f.schema), true, "revocation must wait for the already-authorized write");
    releaseWrite();
    await write;
    await revoke;
    await assert.rejects(withTx(tx => applyContentUpsert(tx, teacher, "lectures", {...row, id: "denied-after-revocation"})), error => error.status === 403);
    assert.equal((await q("SELECT id FROM portal_lectures")).length, 1);
    assert.equal((await q("SELECT id FROM portal_audit")).length, 1);
  } finally {
    releaseWrite();
    await Promise.allSettled([write, revoke]);
    revoker.release();
    await f.close();
  }
});
