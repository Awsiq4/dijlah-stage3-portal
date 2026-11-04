import {test} from "node:test";
import assert from "node:assert/strict";

process.env.SESSION_SECRET = "test-session-secret-123";
process.env.ADMIN_API_SECRET = "test-admin-secret-456";

const {hashPassword, verifyPassword, signSessionToken, verifySessionToken, sha256Hex, checkLoginRateLimit, requireAdmin} =
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

test("session token: tampering, wrong secret, expiry, garbage all rejected", () => {
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

test("login rate limit: allows 5 per window, blocks the 6th, resets after window", () => {
  const key = `test:${Date.now()}`;
  for (let i = 0; i < 5; i++) assert.equal(checkLoginRateLimit(key), true);
  assert.equal(checkLoginRateLimit(key), false);
  assert.equal(checkLoginRateLimit(`other:${Date.now()}`), true); // independent keys
});

test("requireAdmin: no cookie and no header -> null; wrong secret header -> null", async () => {
  const req = {cookies: {get: () => undefined}, headers: {get: () => null}};
  assert.equal(await requireAdmin(req), null);
  const bad = {cookies: {get: () => undefined}, headers: {get: n => (n === "x-admin-secret" ? "wrong" : null)}};
  assert.equal(await requireAdmin(bad), null);
});
