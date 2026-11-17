import {test, after} from "node:test";
import assert from "node:assert/strict";
import {registerHooks} from "node:module";
import {createHash} from "node:crypto";
import {newDb} from "pg-mem";
import pg from "pg";

// Exercise the real Next route handlers under the repository's Node test runner.
// Resolve only Next's extensionless entry point and the existing tsconfig alias.
registerHooks({resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return {url: new URL("../../" + specifier.slice(2) + ".ts", import.meta.url).href, shortCircuit: true};
  if (specifier === "next/server") return nextResolve("next/server.js", context);
  return nextResolve(specifier, context);
}});
process.env.DATABASE_URL = "postgres://isolated.invalid/audit";
process.env.SESSION_SECRET = "isolated-auth-route-session-secret";
process.env.PORTAL_BASE_URL = "https://portal.example";
process.env.TELEGRAM_BOT_ENABLED = "false";
process.env.OWNER_MFA_SECRET = "isolated-owner-mfa-route-secret";

const {NextRequest} = await import("next/server.js");
const {setPoolForTests, qOne} = await import("./db.ts");
const {createSession, getAdminFromToken, hashPassword, verifyPassword, sha256Hex} = await import("./auth.ts");
const {totpCode} = await import("./owner-mfa.ts");
const {issuePasskeyChallenge, consumePasskeyChallenge} = await import("./passkeys.ts");
const {hashToken} = await import("./rbac.ts");
const {POST: logout} = await import("../../app/api/admin/logout/route.ts");
const {POST: setup} = await import("../../app/api/admin/setup/route.ts");
const {POST: resetPassword} = await import("../../app/api/admin/reset-password/route.ts");
const {POST: login} = await import("../../app/api/admin/login/route.ts");
const {GET: me} = await import("../../app/api/admin/me/route.ts");

const POSTGRES_URL = process.env.AUDIT_AUTH_POSTGRES_URL;
const TEST_SCHEMA = "auth_audit_" + process.pid;
if (POSTGRES_URL && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(POSTGRES_URL).hostname)) {
  throw new Error("Auth integration tests require an explicitly configured loopback PostgreSQL fixture");
}
const SCHEMA_SQL = `CREATE TABLE portal_admins (
    id BIGSERIAL PRIMARY KEY,email TEXT UNIQUE,name TEXT DEFAULT '',password_hash TEXT,role TEXT,
    status TEXT DEFAULT 'active',is_active BOOLEAN DEFAULT true,assigned_section TEXT,
    assigned_subjects JSONB DEFAULT '[]',perms JSONB DEFAULT '{}',
    telegram_expected_id BIGINT,telegram_expected_username TEXT,last_login_at TIMESTAMPTZ);
    CREATE TABLE portal_owner_mfa (admin_id BIGINT PRIMARY KEY,encrypted_seed TEXT,last_step BIGINT DEFAULT -1,
      recovery_hashes TEXT[] DEFAULT '{}',enrollment_hash TEXT,enrollment_expires_at TIMESTAMPTZ);
    CREATE TABLE portal_sessions (admin_id BIGINT,token_hash TEXT UNIQUE,expires_at TIMESTAMPTZ,revoked_at TIMESTAMPTZ);
    CREATE TABLE portal_passkey_challenges (token_hash TEXT PRIMARY KEY,purpose TEXT,challenge TEXT,session_hash TEXT,expires_at TIMESTAMPTZ);
    CREATE TABLE portal_login_attempts (key TEXT PRIMARY KEY,count INT,reset_at TIMESTAMPTZ);
    CREATE TABLE portal_audit (actor TEXT,action TEXT,detail JSONB);
    CREATE TABLE portal_telegram_links (admin_id BIGINT,telegram_user_id BIGINT,revoked_at TIMESTAMPTZ);
    CREATE TABLE portal_password_resets (token_hash TEXT PRIMARY KEY,admin_id BIGINT,expires_at TIMESTAMPTZ,used_at TIMESTAMPTZ);
    CREATE TABLE portal_link_tokens (token_hash TEXT,admin_id BIGINT,used_at TIMESTAMPTZ);
    CREATE TABLE portal_invitations (email TEXT,name TEXT,role TEXT,assigned_section TEXT,
      assigned_subjects JSONB,perms JSONB,telegram_expected_id BIGINT,telegram_expected_username TEXT,
      token_hash TEXT UNIQUE,expires_at TIMESTAMPTZ,used_at TIMESTAMPTZ);`;
let pool;
async function closeFixture() {
  if (!pool) return;
  if (POSTGRES_URL) await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
  await pool.end();
  pool = undefined;
}
after(async () => { setPoolForTests(null); await closeFixture(); });
async function fixture() {
  await closeFixture();
  if (POSTGRES_URL) {
    pool = new pg.Pool({connectionString: POSTGRES_URL, options: `-c search_path=${TEST_SCHEMA}`, max: 12});
    await pool.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    await pool.query(SCHEMA_SQL);
  } else {
    const mem = newDb();
    mem.public.none(SCHEMA_SQL);
    // pg-mem lacks OF <table> row lock targets, text casts for timestamps,
    // unquoted WINDOW aliases, and unspaced subtraction. Adapt those limitations.
    // This adapter cannot establish PostgreSQL concurrency guarantees.
    mem.public.interceptQueries(sql => /FOR UPDATE OF a\b|AS window\b|count=count-1/.test(sql)
      ? mem.public.many(sql.replace(/FOR UPDATE OF a\b/g, "FOR UPDATE")
        .replace(/reset_at::text AS window\b/g, 'reset_at AS "window"')
        .replace(/count=count-1/g, "count = count - 1")) : null);
    pool = new (mem.adapters.createPg().Pool)();
  }
  setPoolForTests(pool);
  const passwordHash = hashPassword("synthetic-password-only");
  await pool.query("INSERT INTO portal_admins (id,email,password_hash,role) VALUES (7,'staff@example.invalid',$1,'teacher'),(8,'other@example.invalid',$1,'teacher')", [passwordHash]);
}
function request(path, body, {origin = "https://portal.example", token, ip = "192.0.2.1"} = {}) {
  return new NextRequest("https://portal.example" + path, {
    method: "POST", headers: {"content-type": "application/json", origin, "x-forwarded-for": ip,
      ...(token ? {cookie: "portal_session=" + token} : {})}, body: JSON.stringify(body),
  });
}

test("logout rejects a hostile Origin without revoking the session or clearing its cookie", async () => {
  await fixture();
  const token = await createSession(7);
  const response = await logout(request("/api/admin/logout", {}, {origin: "https://untrusted.portal.example", token}));
  assert.deepEqual({status: response.status, cookie: response.headers.get("set-cookie"),
    authenticated: Boolean(await getAdminFromToken(token))},
    {status: 403, cookie: null, authenticated: true});
});

test("logout revokes the server session and expires the secure cookie", async () => {
  await fixture();
  const token = await createSession(7);
  const response = await logout(request("/api/admin/logout", {}, {token}));
  assert.equal(response.status, 200);
  assert.equal(await getAdminFromToken(token), null);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/i);
  assert.match(response.headers.get("set-cookie"), /HttpOnly/i);
  assert.match(response.headers.get("set-cookie"), /Secure/i);
});

test("logout does not claim success when server-side session revocation fails", async () => {
  await fixture();
  const token = await createSession(7);
  const query = pool.query.bind(pool);
  pool.query = async (sql, values) => {
    if (sql.startsWith("UPDATE portal_sessions SET revoked_at=now() WHERE token_hash=")) throw new Error("synthetic revocation outage");
    return query(sql, values);
  };
  const response = await logout(request("/api/admin/logout", {}, {token}));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.ok(await getAdminFromToken(token));
});

test("anonymous me and revoked, suspended or disabled sessions cannot authenticate", async () => {
  await fixture();
  assert.equal((await me(new NextRequest("https://portal.example/api/admin/me"))).status, 401);
  const token = await createSession(7);
  const before = await getAdminFromToken(token);
  assert.equal(Number(before.id), 7);
  assert.equal("password_hash" in before, false);
  await pool.query("UPDATE portal_admins SET status='suspended' WHERE id=7");
  assert.equal(await getAdminFromToken(token), null);
  await pool.query("UPDATE portal_admins SET status='active',is_active=false WHERE id=7");
  assert.equal(await getAdminFromToken(token), null);
  await pool.query("UPDATE portal_admins SET is_active=true WHERE id=7");
  await pool.query("UPDATE portal_sessions SET revoked_at=now() WHERE token_hash=$1", [sha256Hex(token)]);
  assert.equal(await getAdminFromToken(token), null);
});

async function invitation(token, expiresAt) {
  await pool.query(`INSERT INTO portal_invitations
    (email,name,role,assigned_subjects,perms,token_hash,expires_at)
    VALUES ('invited@example.invalid','Synthetic teacher','teacher','["optics"]','{}',$1,$2)`, [hashToken(token), expiresAt]);
}
test("invitation activation ignores privilege fields and rejects token replay", async () => {
  await fixture();
  const token = "A".repeat(43);
  await invitation(token, new Date(Date.now() + 60_000).toISOString());
  const response = await setup(request("/api/admin/setup", {token, password: "new-synthetic-password", role: "super_admin", email: "attacker@example.invalid", id: 8}));
  assert.equal(response.status, 200);
  const account = await qOne("SELECT * FROM portal_admins WHERE email='invited@example.invalid'");
  assert.equal(account.role, "teacher");
  assert.equal(verifyPassword("new-synthetic-password", account.password_hash), true);
  assert.equal(await qOne("SELECT * FROM portal_admins WHERE email='attacker@example.invalid'"), null);
  assert.equal((await setup(request("/api/admin/setup", {token, password: "second-synthetic-password"}))).status, 410);
});
test("expired invitation cannot activate an account", async () => {
  await fixture();
  const token = "B".repeat(43);
  await invitation(token, new Date(Date.now() - 60_000).toISOString());
  assert.equal((await setup(request("/api/admin/setup", {token, password: "new-synthetic-password"}))).status, 410);
  assert.equal(await qOne("SELECT * FROM portal_admins WHERE email='invited@example.invalid'"), null);
});

async function resetToken(token, adminId = 7, expired = false) {
  await pool.query("INSERT INTO portal_password_resets(token_hash,admin_id,expires_at) VALUES ($1,$2,$3)",
    [createHash("sha256").update(token).digest("hex"), adminId, new Date(Date.now() + (expired ? -60_000 : 60_000)).toISOString()]);
}
test("password reset is account-bound, single-use, and revokes old sessions and link tokens", async () => {
  await fixture();
  const token = "a".repeat(64);
  await resetToken(token);
  const session = await createSession(7);
  const other = (await qOne("SELECT password_hash FROM portal_admins WHERE id=8")).password_hash;
  await pool.query("INSERT INTO portal_link_tokens(token_hash,admin_id) VALUES ('synthetic-link',7)");
  const response = await resetPassword(request("/api/admin/reset-password", {token, password: "replacement-synthetic-password", admin_id: 8, role: "super_admin"}));
  assert.equal(response.status, 200);
  assert.equal(verifyPassword("replacement-synthetic-password", (await qOne("SELECT password_hash FROM portal_admins WHERE id=7")).password_hash), true);
  assert.equal((await qOne("SELECT password_hash FROM portal_admins WHERE id=8")).password_hash, other);
  assert.equal(await getAdminFromToken(session), null);
  assert.ok((await qOne("SELECT used_at FROM portal_link_tokens WHERE admin_id=7")).used_at);
  assert.equal((await resetPassword(request("/api/admin/reset-password", {token, password: "replayed-synthetic-password"}))).status, 401);
});
test("expired reset and disabled-account reset do not change passwords", async () => {
  await fixture();
  const oldHash = (await qOne("SELECT password_hash FROM portal_admins WHERE id=7")).password_hash;
  const expired = "b".repeat(64);
  await resetToken(expired, 7, true);
  assert.equal((await resetPassword(request("/api/admin/reset-password", {token: expired, password: "replacement-synthetic-password"}))).status, 401);
  const active = "c".repeat(64);
  await resetToken(active);
  await pool.query("UPDATE portal_admins SET is_active=false WHERE id=7");
  assert.equal((await resetPassword(request("/api/admin/reset-password", {token: active, password: "replacement-synthetic-password"}))).status, 401);
  assert.equal((await qOne("SELECT password_hash FROM portal_admins WHERE id=7")).password_hash, oldHash);
});

test("login returns the same credential error for unknown, wrong-password and disabled accounts", async () => {
  await fixture();
  const results = [];
  for (const body of [
    {email: "unknown@example.invalid", password: "incorrect-synthetic-password"},
    {email: "staff@example.invalid", password: "incorrect-synthetic-password"},
  ]) {
    const response = await login(request("/api/admin/login", body));
    results.push({status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")});
  }
  await pool.query("UPDATE portal_admins SET is_active=false WHERE id=7");
  const disabled = await login(request("/api/admin/login", {email: "staff@example.invalid", password: "synthetic-password-only"}));
  results.push({status: disabled.status, body: await disabled.json(), cookie: disabled.headers.get("set-cookie")});
  for (const result of results) assert.deepEqual(result, {status: 401, body: {error: "Invalid credentials"}, cookie: null});
});

test("staff password login issues a secure fresh session, owner password alone does not", async () => {
  await fixture();
  const response = await login(request("/api/admin/login", {email: "staff@example.invalid", password: "synthetic-password-only"}));
  assert.equal(response.status, 200);
  const cookie = response.cookies.get("portal_session").value;
  assert.equal(Number((await getAdminFromToken(cookie)).id), 7);
  for (const attribute of [/HttpOnly/i, /Secure/i, /SameSite=lax/i]) assert.match(response.headers.get("set-cookie"), attribute);
  await pool.query("UPDATE portal_admins SET role='super_admin' WHERE id=8");
  const owner = await login(request("/api/admin/login", {email: "other@example.invalid", password: "synthetic-password-only"}));
  assert.equal(owner.status, 202);
  assert.equal((await owner.json()).step, "enrollment_required");
  assert.equal(owner.headers.get("set-cookie"), null);
});

if (POSTGRES_URL) {
  test("PostgreSQL owner password and enrollment token require a valid factor; used factors cannot replay", async () => {
    await fixture();
    await pool.query("UPDATE portal_admins SET role='super_admin' WHERE id=7");
    const enrollmentToken = "E".repeat(32);
    await pool.query("INSERT INTO portal_owner_mfa(admin_id,enrollment_hash,enrollment_expires_at) VALUES (7,$1,$2)",
      [hashToken(enrollmentToken), new Date(Date.now() + 60_000).toISOString()]);
    const credentials = {email: "staff@example.invalid", password: "synthetic-password-only"};
    const configured = await login(request("/api/admin/login", {...credentials, enrollmentToken}));
    assert.equal(configured.status, 202);
    assert.equal(configured.headers.get("set-cookie"), null);
    const {setupKey} = await configured.json();
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const bits = [...setupKey].map(char => alphabet.indexOf(char).toString(2).padStart(5, "0")).join("");
    const seed = Buffer.from(bits.match(/.{8}/g).map(byte => parseInt(byte, 2)));
    const code = totpCode(seed, Math.floor(Date.now() / 30_000));
    const enrolled = await login(request("/api/admin/login", {...credentials, enrollmentToken, code}));
    assert.equal(enrolled.status, 200);
    const session = enrolled.cookies.get("portal_session").value;
    assert.ok(session.startsWith("v3."));
    assert.equal((await getAdminFromToken(session)).role, "super_admin");
    assert.equal((await enrolled.json()).recoveryCodes.length, 8);
    const replay = await login(request("/api/admin/login", {...credentials, enrollmentToken, code}));
    assert.equal(replay.status, 401);
    assert.equal(replay.headers.get("set-cookie"), null);
    const passwordOnly = await login(request("/api/admin/login", credentials));
    assert.equal(passwordOnly.status, 202);
    assert.equal((await passwordOnly.json()).step, "factor_required");
    assert.equal(passwordOnly.headers.get("set-cookie"), null);
    const usedFactor = await login(request("/api/admin/login", {...credentials, code}));
    assert.equal(usedFactor.status, 401);
    for (let attempt = 0; attempt < 3; attempt++) {
      assert.equal((await login(request("/api/admin/login", {...credentials, code: "invalid-factor"}))).status, 401);
    }
    assert.equal((await login(request("/api/admin/login", {...credentials, code: "invalid-factor"}))).status, 429);
  });

  test("PostgreSQL concurrent password guesses share the IP rate limit", async () => {
    await fixture();
    const responses = await Promise.all(Array.from({length: 8}, (_, index) => login(request("/api/admin/login",
      {email: "unknown-" + index + "@example.invalid", password: "incorrect-synthetic-password"}))));
    assert.deepEqual(responses.map(response => response.status).sort(), [401,401,401,401,401,429,429,429]);
  });

  test("PostgreSQL passkey challenges bind registration sessions, expire, and allow one concurrent consumption", async () => {
    await fixture();
    const token = await issuePasskeyChallenge("register", "synthetic-challenge", "session-a");
    assert.equal(await consumePasskeyChallenge("register", token, "session-b"), null);
    assert.equal((await consumePasskeyChallenge("register", token, "session-a")).challenge, "synthetic-challenge");
    assert.equal(await consumePasskeyChallenge("register", token, "session-a"), null);
    const auth = await issuePasskeyChallenge("authenticate", "synthetic-login-challenge");
    const attempts = await Promise.all(Array.from({length: 4}, () => consumePasskeyChallenge("authenticate", auth)));
    assert.equal(attempts.filter(Boolean).length, 1);
    const expired = await issuePasskeyChallenge("authenticate", "synthetic-expired-challenge");
    await pool.query("UPDATE portal_passkey_challenges SET expires_at=now()-interval '1 second'");
    assert.equal(await consumePasskeyChallenge("authenticate", expired), null);
  });

  test("PostgreSQL concurrent invitation redemption permits exactly one activation", async () => {
    await fixture();
    const token = "D".repeat(43);
    await invitation(token, new Date(Date.now() + 60_000).toISOString());
    const responses = await Promise.all(Array.from({length: 4}, (_, index) => setup(request("/api/admin/setup",
      {token, password: "concurrent-synthetic-password"}, {ip: "192.0.2." + (index + 20)}))));
    assert.deepEqual(responses.map(r => r.status).sort(), [200,410,410,410]);
    assert.equal((await qOne("SELECT count(*)::int AS n FROM portal_sessions")).n, 1);
    assert.equal((await qOne("SELECT count(*)::int AS n FROM portal_admins WHERE email='invited@example.invalid'")).n, 1);
  });

  test("PostgreSQL concurrent reset redemption permits one password change and revokes prior sessions", async () => {
    await fixture();
    const token = "d".repeat(64);
    await resetToken(token);
    const oldSession = await createSession(7);
    const responses = await Promise.all(Array.from({length: 4}, (_, index) => resetPassword(request("/api/admin/reset-password",
      {token, password: "concurrent-password-" + index}, {ip: "192.0.2." + (index + 30)}))));
    assert.deepEqual(responses.map(r => r.status).sort(), [200,401,401,401]);
    assert.equal(await getAdminFromToken(oldSession), null);
    const successes = responses.flatMap((response, index) => response.status === 200 ? [index] : []);
    assert.equal(verifyPassword("concurrent-password-" + successes[0], (await qOne("SELECT password_hash FROM portal_admins WHERE id=7")).password_hash), true);
    assert.equal((await qOne("SELECT count(*)::int AS n FROM portal_audit WHERE action='admin.password_reset'")).n, 1);
  });
}
