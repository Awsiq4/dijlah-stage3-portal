import {test, after} from "node:test";
import assert from "node:assert/strict";
import {registerHooks} from "node:module";
import {newDb} from "pg-mem";
import {NextRequest} from "next/server.js";
import pg from "pg";

process.env.DATABASE_URL = "postgres://isolated-users-test";
process.env.SESSION_SECRET = "isolated-users-security-test-key";
process.env.PORTAL_BASE_URL = "https://portal.example";
process.env.TELEGRAM_BOT_ENABLED = "false";

registerHooks({resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return {url: new URL("../../" + specifier.slice(2) + ".ts", import.meta.url).href, shortCircuit: true};
  if (specifier === "next/server") return nextResolve("next/server.js", context);
  return nextResolve(specifier, context);
}});
const {setPoolForTests} = await import("./db.ts");
const {createSession, getAdminFromToken} = await import("./auth.ts");
const roles = ["super_admin", "editor", "viewer", "general_representative", "section_representative", "teacher"];
const isolatedUrl = process.env.AUDIT_TEST_DATABASE_URL;
if (isolatedUrl && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(isolatedUrl).hostname)) {
  throw new Error("Security integration tests require an explicitly supplied loopback test database");
}

// Execute actual handlers with their real auth/database services. Only resolve
// the existing tsconfig alias and Next's extensionless entry point for Node.
const users = await import("../../app/api/admin/users/route.ts");
const auditRoute = await import("../../app/api/admin/audit/route.ts");
let pool;
let schema;
async function cleanup() {
  if (schema) await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  await pool?.end();
  schema = undefined;
}
async function setup() {
  await cleanup();
  if (isolatedUrl) {
    // Dedicated generated schema on an explicitly supplied local disposable DB.
    // max=1 keeps SET search_path attached to every query in this test suite.
    pool = new pg.Pool({connectionString: isolatedUrl, max: 1});
    schema = `users_audit_${process.pid}_${Date.now()}`;
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`SET search_path TO ${schema}`);
  } else {
    const mem = newDb();
    pool = new (mem.adapters.createPg().Pool)();
    const query = pool.query.bind(pool);
    pool.query = (sql, params) => query(sql.replace(
      /\(SELECT l\.telegram_user_id FROM portal_telegram_links l WHERE l\.admin_id=a\.id AND l\.revoked_at IS NULL LIMIT 1\)/g,
      "NULL"), params);
    // pg-mem cannot execute this correlated display-only subquery. Fixtures
    // have no links when directory reads run; real-PG mode executes exact SQL.
  }
  await pool.query(`
    CREATE TABLE portal_admins(id BIGINT PRIMARY KEY,email TEXT,name TEXT,password_hash TEXT,role TEXT,
      is_active BOOLEAN,status TEXT,assigned_section TEXT,assigned_subjects JSONB,perms JSONB,
      last_login_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT now(),telegram_expected_id BIGINT,telegram_expected_username TEXT);
    CREATE TABLE portal_sessions(id BIGSERIAL PRIMARY KEY,admin_id BIGINT,token_hash TEXT UNIQUE,
      expires_at TIMESTAMPTZ,revoked_at TIMESTAMPTZ);
    CREATE TABLE portal_invitations(id BIGSERIAL PRIMARY KEY,email TEXT,name TEXT,role TEXT,assigned_section TEXT,
      assigned_subjects JSONB,perms JSONB,token_hash TEXT,expires_at TIMESTAMPTZ,created_by BIGINT,
      telegram_expected_id BIGINT,telegram_expected_username TEXT,used_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE portal_telegram_links(admin_id BIGINT,telegram_user_id BIGINT,revoked_at TIMESTAMPTZ);
    CREATE TABLE portal_link_tokens(admin_id BIGINT,used_at TIMESTAMPTZ);
    CREATE TABLE portal_password_resets(admin_id BIGINT,used_at TIMESTAMPTZ);
    CREATE TABLE portal_audit(id BIGSERIAL PRIMARY KEY,actor TEXT,action TEXT,detail JSONB,created_at TIMESTAMPTZ DEFAULT now());
  `);
  setPoolForTests(pool);
  const tokens = [];
  for (const [index, role] of roles.entries()) {
    const id = index + 1;
    await pool.query(`INSERT INTO portal_admins(id,email,name,password_hash,role,is_active,status,assigned_subjects,perms)
      VALUES($1,$2,$3,'fixture-hash',$4,true,'active','[]','{}')`, [id, `role${id}@example.test`, role, role]);
    tokens.push(await createSession(id, undefined, role === "super_admin"));
  }
  return tokens;
}
function req(token, method = "GET", body, origin = "https://portal.example") {
  return new NextRequest("https://portal.example/api/admin/users", {method, headers: {
    ...(token ? {cookie: `portal_session=${token}`} : {}), origin, "content-type": "application/json",
  }, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
}
after(async () => {setPoolForTests(null); await cleanup();});

test("owner directory/audit: actual handlers deny anonymous and all five non-owner roles", async () => {
  const tokens = await setup();
  for (const handler of [users.GET, auditRoute.GET]) {
    assert.equal((await handler(req())).status, 401);
    for (const token of tokens.slice(1)) assert.equal((await handler(req(token))).status, 403);
    assert.equal((await handler(req(tokens[0]))).status, 200);
  }
  const body = await (await users.GET(req(tokens[0]))).json();
  assert.equal(body.users.length, 6);
  assert.equal(JSON.stringify(body).includes("fixture-hash"), false);
  assert.ok(body.users.every(user => !("password_hash" in user)));
});

test("user management: anonymous and every non-owner cannot self-promote or invite an owner", async () => {
  const tokens = await setup();
  for (const [index, token] of [undefined, ...tokens.slice(1)].entries()) {
    const expected = token ? 403 : 401;
    assert.equal((await users.POST(req(token, "POST", {email: "injected@example.test", name: "Injected", role: "super_admin"}))).status, expected);
    assert.equal((await users.PATCH(req(token, "PATCH", {id: index + 1, role: "super_admin"}))).status, expected);
  }
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM portal_invitations")).rows[0].n, 0);
  assert.deepEqual((await pool.query("SELECT role FROM portal_admins ORDER BY id")).rows.map(row => row.role), roles);
});

test("user management: cross-origin owner writes are denied without changing data", async () => {
  const tokens = await setup();
  assert.equal((await users.PATCH(req(tokens[0], "PATCH", {id: 6, role: "super_admin"}, "https://attacker.example"))).status, 401);
  assert.equal((await pool.query("SELECT role FROM portal_admins WHERE id=6")).rows[0].role, "teacher");
});

test("owner update allowlist cannot mass-assign identity, password hash or Telegram binding", async () => {
  const tokens = await setup();
  const response = await users.PATCH(req(tokens[0], "PATCH", {id: 6, name: "New display name",
    email: "injected@example.test", password_hash: "injected", telegram_expected_id: 12345}));
  assert.equal(response.status, 200);
  const account = (await pool.query("SELECT * FROM portal_admins WHERE id=6")).rows[0];
  assert.equal(account.name, "New display name");
  assert.equal(account.email, "role6@example.test");
  assert.equal(account.password_hash, "fixture-hash");
  assert.equal(account.telegram_expected_id, null);
});

test("suspension through actual owner handler revokes existing session, reset and link capabilities", async () => {
  const tokens = await setup();
  await pool.query(`INSERT INTO portal_link_tokens VALUES(6,NULL);
    INSERT INTO portal_password_resets VALUES(6,NULL);
    INSERT INTO portal_telegram_links VALUES(6,666,NULL);`);
  assert.ok(await getAdminFromToken(tokens[5]));
  assert.equal((await users.PATCH(req(tokens[0], "PATCH", {id: 6, status: "suspended"}))).status, 200);
  assert.equal(await getAdminFromToken(tokens[5]), null);
  for (const [table, column] of [["portal_sessions", "revoked_at"], ["portal_link_tokens", "used_at"],
    ["portal_password_resets", "used_at"], ["portal_telegram_links", "revoked_at"]]) {
    assert.ok((await pool.query(`SELECT ${column} FROM ${table} WHERE admin_id=6`)).rows[0][column]);
  }
});

test("owner invitation stores a digest and returns its activation capability only to the authenticated owner", async () => {
  const tokens = await setup();
  const response = await users.POST(req(tokens[0], "POST", {email: "invited@example.test", name: "Invited", role: "teacher"}));
  assert.equal(response.status, 200);
  const body = await response.json();
  const token = new URL(body.setupUrl).searchParams.get("token");
  const invitation = (await pool.query("SELECT * FROM portal_invitations")).rows[0];
  assert.match(invitation.token_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(invitation.token_hash, token);
  assert.equal(Number(invitation.created_by), 1);
  const directory = await (await users.GET(req(tokens[0]))).json();
  assert.ok(directory.invitations.every(invite => !("token_hash" in invite)));
  assert.equal(JSON.stringify(directory).includes(token), false);
});

test("a demoted owner cannot restore their own role in a request authorized before demotion", async () => {
  const tokens = await setup();
  const request = req(tokens[0], "PATCH", {});
  request.json = async () => {
    await pool.query("UPDATE portal_admins SET role='viewer' WHERE id=1");
    return {id: 1, role: "super_admin"};
  };
  assert.equal((await users.PATCH(request)).status, 403);
  assert.equal((await pool.query("SELECT role FROM portal_admins WHERE id=1")).rows[0].role, "viewer");
});

test("a suspended owner cannot issue invitations in a request authorized before suspension", async () => {
  const tokens = await setup();
  const request = req(tokens[0], "POST", {});
  request.json = async () => {
    await pool.query("UPDATE portal_admins SET is_active=false,status='suspended' WHERE id=1");
    return {email: "injected@example.test", name: "Injected", role: "super_admin"};
  };
  assert.equal((await users.POST(request)).status, 403);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM portal_invitations")).rows[0].n, 0);
});
