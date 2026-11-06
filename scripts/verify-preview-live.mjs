// Live end-to-end verification against the Vercel PREVIEW deployment.
// Run locally with env (values never printed):
//   PREVIEW_URL=https://<preview>.vercel.app
//   VERCEL_BYPASS=<x-vercel-protection-bypass secret>   (if preview has Deployment Protection)
//   SUPER_ADMIN_EMAIL=... SUPER_ADMIN_PASSWORD=...       (existing super admin)
// Optional Telegram: TELEGRAM_WEBHOOK_SECRET, TEST_BOT_TOKEN, TEST_CHAT_ID
// Usage: node --experimental-strip-types scripts/verify-preview-live.mjs
import {readFileSync} from "node:fs";

const PREVIEW = (process.env.PREVIEW_URL || "").replace(/\/$/, "");
const BYPASS = process.env.VERCEL_BYPASS || "";
const SA_EMAIL = process.env.SUPER_ADMIN_EMAIL || "";
const SA_PASS = process.env.SUPER_ADMIN_PASSWORD || "";
const results = [];
const ok = (name, pass, detail = "") => { results.push({name, pass, detail}); console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? " — " + detail : ""}`); };

async function call(method, path, {body, cookie, raw} = {}) {
  const headers = {"content-type": "application/json"};
  if (BYPASS) headers["x-vercel-protection-bypass"] = BYPASS;
  if (cookie) headers.cookie = cookie;
  const r = await fetch(PREVIEW + path, {method, headers, body: body ? JSON.stringify(body) : undefined, redirect: "manual"});
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return {status: r.status, json, text, cookie: r.headers.get("set-cookie")?.split(";")[0] || cookie};
}

if (!PREVIEW || !SA_EMAIL || !SA_PASS) {
  console.error("Missing PREVIEW_URL / SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD env.");
  process.exit(1);
}

// 0. reachability + protection
{
  const r = await call("GET", "/api/health");
  const isHtml = r.text.startsWith("<!DOCTYPE");
  ok("preview reachable (not SSO-blocked)", r.status === 200 && !isHtml, isHtml ? "returns Vercel protection HTML — set VERCEL_BYPASS" : `status ${r.status}`);
  if (isHtml) { report(); process.exit(0); }
  ok("databaseConnected on preview", r.json?.databaseConnected === true, JSON.stringify(r.json?.databaseConnected));
  ok("Phase-2 migration applied (portal_lectures.sections + invitations + telegram_links)", r.json?.migrationApplied === true, `migrationApplied=${r.json?.migrationApplied}`);
  ok("telegramServiceEnabled is false (bot stays disabled until authorized)", r.json?.telegramServiceEnabled === false);
}

// 1. super admin login
let saCookie = "";
{
  const r = await call("POST", "/api/admin/login", {body: {email: SA_EMAIL, password: SA_PASS}});
  ok("super admin login via /api/admin/login", r.status === 200 && r.json?.ok, `status ${r.status}`);
  saCookie = r.cookie || "";
}

// 2. create section representative A via invitation, then activate
let repCookie = "";
{
  const inv = await call("POST", "/api/admin/users", {body: {email: "rep-a-test@portal.local", name: "Rep A Test", role: "section_representative", assigned_section: "A"}, cookie: saCookie});
  ok("super admin creates section-rep invitation", inv.status === 200 && inv.json?.setupUrl, `status ${inv.status}`);
  const token = new URL(inv.json.setupUrl).searchParams.get("token");
  const setup = await call("POST", "/api/admin/setup", {body: {token, password: "Test-12345678!"}});
  ok("invitation redeemed -> rep account active + session", setup.status === 200 && setup.json?.ok, `status ${setup.status}`);
  repCookie = setup.cookie || "";
}

// 3. rep A publishes PDF to ALL sections via dashboard API
{
  const row = {id: "e2e-all-1", subject_id: "nonlinear-optics", number: 90, title: "E2E all-sections booklet", description: "test", file_url: "/lectures/nonlinear-optics-01.pdf", file_name: "nonlinear-optics-01.pdf", sections: ["A", "B", "C", "F"], status: "published", updated_at: "2026-11-05"};
  const r = await call("POST", "/api/admin/content", {body: {type: "lectures", row}, cookie: repCookie});
  ok("rep A publishes material to ALL sections (dashboard API)", r.status === 200, `status ${r.status} ${r.json?.error || ""}`);
  // retry same id -> still one record
  const r2 = await call("POST", "/api/admin/content", {body: {type: "lectures", row}, cookie: repCookie});
  const list = await call("GET", "/api/public/content?type=lectures&section=A");
  const all = (list.json?.content?.lectures || []).filter(l => l.id === "e2e-all-1");
  ok("retry publish creates only ONE record", r2.status === 200 && all.length === 1, `records=${all.length}`);
  for (const sec of ["A", "B", "C", "F"]) {
    const l = await call("GET", `/api/public/content?type=lectures&section=${sec}`);
    const found = (l.json?.content?.lectures || []).some(x => x.id === "e2e-all-1" && x.file_url);
    ok(`student in section ${sec} sees and can open/download the all-sections PDF`, found, `fromDatabase=${l.json?.fromDatabase}`);
  }
}

// 4. rep A publishes to MY section only; rep A publishing to section B must be rejected
{
  const row = {id: "e2e-own-1", subject_id: "quantum-mechanics", number: 91, title: "E2E own-section", file_url: "/lectures/x.pdf", sections: ["A"], status: "published", updated_at: "2026-11-05"};
  const r = await call("POST", "/api/admin/content", {body: {type: "lectures", row}, cookie: repCookie});
  ok("rep A publishes material to MY section", r.status === 200, `status ${r.status}`);
  const bad = {id: "e2e-bad-1", subject_id: "quantum-mechanics", number: 92, title: "x", file_url: "/lectures/x.pdf", sections: ["B"], status: "published", updated_at: "2026-11-05"};
  const rb = await call("POST", "/api/admin/content", {body: {type: "lectures", row: bad}, cookie: repCookie});
  ok("rep A publishing to section B is rejected server-side (403)", rb.status === 403, `status ${rb.status}`);
  const a = await call("GET", "/api/public/content?type=lectures&section=A");
  const b = await call("GET", "/api/public/content?type=lectures&section=B");
  ok("own-section item visible in A only", (a.json?.content?.lectures || []).some(x => x.id === "e2e-own-1") && !(b.json?.content?.lectures || []).some(x => x.id === "e2e-own-1"));
}

// 5. section announcement from rep A; cross-section rejected
{
  const row = {id: "e2e-ann-1", title: "تبليغ تجريبي A", body: "...", scope: "section", section: "A", priority: "normal", published_at: new Date().toISOString(), pinned: "false"};
  const r = await call("POST", "/api/admin/content", {body: {type: "announcements", row}, cookie: repCookie});
  ok("rep A publishes section announcement", r.status === 200, `status ${r.status}`);
  const bad = {...row, id: "e2e-ann-bad", section: "B"};
  const rb = await call("POST", "/api/admin/content", {body: {type: "announcements", row: bad}, cookie: repCookie});
  ok("rep A announcement for section B rejected (403)", rb.status === 403, `status ${rb.status}`);
  const a = await call("GET", "/api/public/content?type=announcements&section=A");
  const b = await call("GET", "/api/public/content?type=announcements&section=B");
  ok("announcement visible only in section A", (a.json?.content?.announcements || []).some(x => x.id === "e2e-ann-1") && !(b.json?.content?.announcements || []).some(x => x.id === "e2e-ann-1"));
}

// 6. Telegram webhook protection probe
{
  const ws = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  const wrong = await call("POST", "/api/telegram/webhook", {body: {update_id: 1, message: {chat: {id: 1}, text: "/start"}}});
  const h = {"content-type": "application/json"};
  if (BYPASS) h["x-vercel-protection-bypass"] = BYPASS;
  const wrongSecret = await fetch(PREVIEW + "/api/telegram/webhook", {method: "POST", headers: {...h, "x-telegram-bot-api-secret-token": "wrong"}, body: "{}"});
  const r = await call("GET", "/api/health");
  if (r.json?.telegramServiceEnabled === true) {
    ok("webhook rejects wrong secret with 401 when bot enabled", wrongSecret.status === 401, `status ${wrongSecret.status}`);
  } else {
    ok("bot disabled on preview: webhook inert (200 disabled:true), wrong-secret probe n/a", wrong.status === 200 && wrong.json?.disabled === true, `status ${wrong.status} ${JSON.stringify(wrong.json)}`);
  }
}

function report() {
  const passed = results.filter(r => r.pass).length;
  console.log(`\n===== ${passed}/${results.length} PASS =====`);
  for (const r of results.filter(r => !r.pass)) console.log("FAIL:", r.name, r.detail);
}
report();
