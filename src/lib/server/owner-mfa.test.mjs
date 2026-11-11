import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {newDb} from "pg-mem";
import {hashToken} from "./rbac.ts";
import {totpCode, verifyOwnerLogin} from "./owner-mfa.ts";

process.env.OWNER_MFA_SECRET = "isolated-test-key";

function decodeBase32(key) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...key].map(char => alphabet.indexOf(char).toString(2).padStart(5, "0")).join("");
  return Buffer.from(bits.match(/.{8}/g).map(byte => parseInt(byte, 2)));
}

test("TOTP matches the RFC 6238 SHA-1 vector modulo six digits", () => {
  assert.equal(totpCode(Buffer.from("12345678901234567890"), 1), "287082");
});

test("owner enrollment, replay rejection, and single-use recovery", async () => {
  const mem = newDb();
  mem.public.none(`CREATE TABLE portal_admins(id BIGINT PRIMARY KEY);
    CREATE TABLE portal_sessions(admin_id BIGINT, revoked_at TIMESTAMPTZ);
    INSERT INTO portal_admins VALUES (7);
    INSERT INTO portal_sessions VALUES (7,NULL);`);
  mem.public.none(readFileSync(new URL("../../../database/portal-owner-mfa.sql", import.meta.url), "utf8"));
  const pool = new (mem.adapters.createPg().Pool)();
  const db = {
    q: async (sql, values) => (await pool.query(sql, values)).rows,
    qOne: async (sql, values) => (await pool.query(sql, values)).rows[0] ?? null,
  };
  const input = {code: "", enrollmentToken: "", existingCode: ""};
  assert.equal((await verifyOwnerLogin(db, 7, input)).kind, "enrollment_required");
  const token = "A".repeat(32);
  const grant = async value => db.q(`INSERT INTO portal_owner_mfa (admin_id,enrollment_hash,enrollment_expires_at)
    VALUES (7,$1,$2) ON CONFLICT (admin_id) DO UPDATE SET enrollment_hash=EXCLUDED.enrollment_hash,
      enrollment_expires_at=EXCLUDED.enrollment_expires_at`, [hashToken(value), new Date(Date.now()+600_000).toISOString()]);
  await grant(token);
  assert.equal((await verifyOwnerLogin(db, 7, {...input, enrollmentToken:"B".repeat(32)})).kind, "invalid_factor");
  const setup = await verifyOwnerLogin(db, 7, {...input, enrollmentToken: token});
  assert.equal(setup.kind, "configure_authenticator");
  assert.match(setup.setupKey, /^[A-Z2-7]{32}$/);
  const seed = decodeBase32(setup.setupKey);
  const step = Math.floor(Date.now()/30_000);
  const code = totpCode(seed, step);
  const enrolled = await verifyOwnerLogin(db, 7, {...input, enrollmentToken:token, code});
  assert.equal(enrolled.kind, "verified");
  assert.equal(enrolled.recoveryCodes.length, 8);
  assert.ok((await db.qOne("SELECT revoked_at FROM portal_sessions WHERE admin_id=7")).revoked_at);
  assert.equal((await verifyOwnerLogin(db, 7, {...input, enrollmentToken:token, code})).kind, "invalid_factor");
  assert.equal((await verifyOwnerLogin(db, 7, {...input, code})).kind, "invalid_factor");
  const next = totpCode(seed, step+1);
  assert.equal((await verifyOwnerLogin(db, 7, {...input, code:next})).kind, "verified");
  assert.equal((await verifyOwnerLogin(db, 7, {...input, code:next})).kind, "invalid_factor");
  const recovery = enrolled.recoveryCodes[0];
  assert.equal((await verifyOwnerLogin(db, 7, {...input, code:recovery})).kind, "verified");
  assert.equal((await verifyOwnerLogin(db, 7, {...input, code:recovery})).kind, "invalid_factor");
  const rotationToken = "C".repeat(32);
  await grant(rotationToken);
  assert.equal((await verifyOwnerLogin(db, 7, {...input, enrollmentToken:rotationToken})).kind, "invalid_factor");
  const recoveryForRotation = enrolled.recoveryCodes[1];
  const rotated = await verifyOwnerLogin(db, 7, {...input, enrollmentToken:rotationToken, existingCode:recoveryForRotation});
  assert.equal(rotated.kind, "configure_authenticator");
  assert.notEqual(rotated.setupKey, setup.setupKey);
  const rotationCode = totpCode(decodeBase32(rotated.setupKey), Math.floor(Date.now()/30_000));
  const finished = await verifyOwnerLogin(db, 7, {...input, enrollmentToken:rotationToken, existingCode:recoveryForRotation, code:rotationCode});
  assert.equal(finished.kind, "verified");
  assert.equal((await verifyOwnerLogin(db, 7, {...input, code:enrolled.recoveryCodes[2]})).kind, "invalid_factor");
  await pool.end();
});
