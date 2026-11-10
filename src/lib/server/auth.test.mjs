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
  const [v, id, exp] = t.split(".");
  assert.equal(verifySessionToken(`${v}.8.${exp}.${t.split(".")[3]}`, 1_000_000_000), null); // id tampered
  const flipped = t.slice(0, -2) + (t.endsWith("aa") ? "bb" : "aa");
  assert.equal(verifySessionToken(flipped, 1_000_000_000), null); // sig tampered
  assert.equal(verifySessionToken(t, 1_000_000_000 + 8 * 24 * 3600 * 1000), null); // expired (TTL 7d)
  assert.equal(verifySessionToken("garbage", 1_000_000_000), null);
  assert.equal(verifySessionToken("v2.1.2.sig", 1_000_000_000), null);
  assert.equal(verifySessionToken("", 1_000_000_000), null);
});

test("session token: falls back to ADMIN_API_SECRET when SESSION_SECRET is unset", () => {
  const saved = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  const t = signSessionToken(3, 1_000_000_000); // must not throw: ADMIN_API_SECRET is set
  assert.deepEqual(verifySessionToken(t, 1_000_000_000), {adminId: 3});
  process.env.SESSION_SECRET = saved;
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
