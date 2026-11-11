import {test} from "node:test";
import assert from "node:assert/strict";

process.env.SESSION_SECRET = "test-session-secret-123";
process.env.ADMIN_API_SECRET = "test-admin-secret-456";
process.env.PORTAL_BASE_URL = "https://portal.example";

const {hashPassword, verifyPassword, signSessionToken, verifySessionToken, sha256Hex,
       checkLoginRateLimit, checkLoginRateLimitMemory, csrfWriteOk, canModify, requireAdmin} =
  await import("./auth.ts");

test("password: hash+verify roundtrip, wrong password rejected, malformed stored rejected", () => {
  const h = hashPassword("correct horse battery staple");
  assert.match(h, /^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);
  assert.equal(verifyPassword("correct horse battery staple", h), true);
  assert.equal(verifyPassword("wrong", h), false);
  assert.equal(verifyPassword("x", "not-a-hash"), false);
  assert.equal(verifyPassword("x", "scrypt:zz:zz"), false);
  assert.notEqual(hashPassword("same"), hashPassword("same")); // random salt
});

test("session token: sign+verify roundtrip", () => {
  const t = signSessionToken(7, 1_000_000_000);
  assert.deepEqual(verifySessionToken(t, 1_000_000_000 + 1000), {adminId: 7});
});

test("session token: tampering, expiry, garbage all rejected", () => {
  const t = signSessionToken(7, 1_000_000_000);
  const [v, id, exp, nonce, signature] = t.split(".");
  assert.equal(verifySessionToken(`${v}.8.${exp}.${nonce}.${signature}`, 1_000_000_000), null);
  const flipped = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
  assert.equal(verifySessionToken(`${v}.${id}.${exp}.${nonce}.${flipped}`, 1_000_000_000), null);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const alias = signature.slice(0, -1) + alphabet[alphabet.indexOf(signature.at(-1)) + 1];
  assert.deepEqual(Buffer.from(alias, "base64url"), Buffer.from(signature, "base64url"));
  assert.equal(verifySessionToken(`${v}.${id}.${exp}.${nonce}.${alias}`, 1_000_000_000), null);
  assert.equal(verifySessionToken(t, 1_000_000_000 + 8 * 24 * 3600 * 1000), null); // expired (TTL 7d)
  assert.equal(verifySessionToken("garbage", 1_000_000_000), null);
  assert.equal(verifySessionToken("v2.1.2.sig", 1_000_000_000), null);
  assert.equal(verifySessionToken("", 1_000_000_000), null);
});

test("session tokens require the separate session secret", () => {
  const saved = process.env.SESSION_SECRET;
  try {
    delete process.env.SESSION_SECRET;
    assert.throws(() => signSessionToken(3, 1_000_000_000), /SESSION_SECRET/);
  } finally {
    process.env.SESSION_SECRET = saved;
  }
});

test("sha256Hex is deterministic and hex", () => {
  assert.match(sha256Hex("abc"), /^[0-9a-f]{64}$/);
  assert.equal(sha256Hex("abc"), sha256Hex("abc"));
  assert.notEqual(sha256Hex("abc"), sha256Hex("abd"));
});

test("rate limit (memory fallback, no DATABASE_URL): 5 per window then blocked", async () => {
  const key = `mem:${Date.now()}`;
  for (let i = 0; i < 5; i++) assert.equal(checkLoginRateLimitMemory(key), true);
  assert.equal(checkLoginRateLimitMemory(key), false);
  assert.equal(await checkLoginRateLimit(`db-less:${Date.now()}`), true); // async path falls back to memory
});

test("rbac: only super_admin and editor can modify; viewer cannot", () => {
  assert.equal(canModify("super_admin"), true);
  assert.equal(canModify("editor"), true);
  assert.equal(canModify("viewer"), false);
  assert.equal(canModify("guest"), false);
  assert.equal(canModify(""), false);
});

test("csrf: cookie write requires matching Origin or the custom header", () => {
  const mk = (origin, custom) => ({headers: {get: n => (n === "origin" ? origin : n === "x-portal-admin" ? custom : null)}});
  assert.equal(csrfWriteOk(mk("https://portal.example", null)), true);   // same origin
  assert.equal(csrfWriteOk(mk("https://evil.example", null)), false);      // cross-site origin
  assert.equal(csrfWriteOk(mk(null, "1")), true);                          // custom header (no CORS -> not forgeable cross-site)
  assert.equal(csrfWriteOk(mk(null, null)), false);                        // neither
  assert.equal(csrfWriteOk(mk("not a url", null)), false);                 // malformed origin
});

test("requireAdmin: no cookie and no header -> null; wrong secret header -> null", async () => {
  const req = {cookies: {get: () => undefined}, headers: {get: () => null}};
  assert.equal(await requireAdmin(req), null);
  assert.equal(await requireAdmin(req, {write: true}), null);
  const bad = {cookies: {get: () => undefined}, headers: {get: n => (n === "x-admin-secret" ? "wrong" : null)}};
  assert.equal(await requireAdmin(bad), null);
  const legacySecret = {cookies: {get: () => undefined}, headers: {get: n => n === "x-admin-secret" ? process.env.ADMIN_API_SECRET : null}};
  assert.equal(await requireAdmin(legacySecret), null);
});

test("sessions issued for one account in the same second are distinct", () => {
  const now = 1_000_000_000;
  const first = signSessionToken(7, now);
  const second = signSessionToken(7, now);
  assert.notEqual(first, second);
  assert.deepEqual(verifySessionToken(first, now), {adminId: 7});
  assert.deepEqual(verifySessionToken(second, now), {adminId: 7});
});

test("navigation and file links reject unsafe protocols and URL parsing ambiguities", async () => {
  const {adminReturnPath, safeFileUrl} = await import("../safe-url.ts");
  for (const url of ["javascript:alert(1)", "//external.test", "/\\external.test", "/admin/../outside", "https://external.test"]) {
    assert.equal(adminReturnPath(url), "/admin");
  }
  assert.equal(adminReturnPath("/admin-legacy"), "/admin-legacy");
  assert.equal(safeFileUrl("/files/handout.pdf"), "/files/handout.pdf");
  assert.equal(safeFileUrl("https://cdn.example.org/handout.pdf"), "https://cdn.example.org/handout.pdf");
  for (const url of ["javascript:alert(1)", "//external.test/a.pdf", "/a\\b.pdf", "https://user@external.test/a.pdf"]) {
    assert.equal(safeFileUrl(url), "");
  }
});

test("owner requires a verified MFA session, ordinary staff keep their sessions", async () => {
  const {getAdminFromToken} = await import("./auth.ts");
  const row = {id: 7, role: "super_admin", is_active: true, status: "active", revoked: 0, expired: 0};
  const db = {qOne: async () => row};
  assert.equal(await getAdminFromToken(signSessionToken(7), db), null);
  assert.equal((await getAdminFromToken(signSessionToken(7, Date.now(), true), db)).id, 7);
  row.role = "teacher";
  assert.equal((await getAdminFromToken(signSessionToken(7), db)).id, 7);
});
