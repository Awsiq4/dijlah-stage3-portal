import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

process.env.DATABASE_URL = "postgres://pgmem:5432/test";
process.env.SESSION_SECRET = "pgmem-secret";
process.env.SUBSCRIPTION_SECRET = "pgmem-sub";
process.env.TELEGRAM_BOT_ENABLED = "true";
process.env.TELEGRAM_BOT_TOKEN = "000:test";
process.env.TELEGRAM_BOT_USERNAME = "test_bot";
process.env.TELEGRAM_WEBHOOK_SECRET = "whsec";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const {newDb} = await import("pg-mem");
const {setPoolForTests, q} = await import("./db.ts");
const {createEvent} = await import("./notify.ts");

async function makeDb() {
  const mem = newDb();
  const {Pool} = mem.adapters.createPg();
  const pool = new Pool();
  const norm = (sql) => sql.split(/;\s*(?:\n|$)/)
    .filter(st => !st.includes("portal_admins_role_check"))
    .map(st => st.replace(/\s*CHECK \(sections <@[^)]*\)/, "")).join(";");
  let base = readFileSync(path.join(root, "database/portal-schema.sql"), "utf8");
  base = base.replace("CHECK (role IN ('super_admin','editor','viewer'))",
    "CHECK (role IN ('super_admin','editor','viewer','general_representative','section_representative','teacher'))");
  const rbac = readFileSync(path.join(root, "database/portal-rbac.sql"), "utf8");
  const tg = readFileSync(path.join(root, "database/telegram-notifications.sql"), "utf8");
  for (const stmt of norm(base + ";" + rbac + ";" + tg).split(/;\s*(?:\n|$)/)) {
    const t = stmt.replace(/--[^\n]*/g, "").trim();
    if (t) await pool.query(t);
  }
  setPoolForTests(pool);
  // subscribers: A (all prefs on), B (all on), C (announcements off), F stopped
  const subs = [
    [1001, "A", "active", {}],
    [1002, "B", "active", {}],
    [1003, "C", "active", {announcements: false}],
    [1004, "F", "stopped", {}],
  ];
  for (const [chat, section, status, prefs] of subs) {
    await pool.query(
      `INSERT INTO tg_subscribers (chat_id, section, status, prefs) VALUES ($1,$2,$3,$4)`,
      [chat, section, status, JSON.stringify(prefs)]
    );
  }
  return pool;
}

test("notifications: section A announcement reaches only eligible A subscribers", async () => {
  const pool = await makeDb();
  const r = await createEvent({type: "announcement", refId: "ann-1", version: 1, title: "t", scope: "section", section: "A", priority: "normal"});
  assert.equal(r.created, true);
  const d = await q(`SELECT s.chat_id FROM tg_deliveries d JOIN tg_subscribers s ON s.id=d.subscriber_id WHERE d.event_id=$1 ORDER BY s.chat_id`, [r.eventId]);
  assert.deepEqual(d.map(x => Number(x.chat_id)), [1001]); // only A; C excluded by pref? no—C is section C anyway; F stopped
  await pool.end();
});

test("notifications: all-sections material reaches eligible subscribers in A, B, C, F (prefs respected)", async () => {
  const pool = await makeDb();
  const r = await createEvent({type: "lecture", refId: "lec-1", version: 1, title: "t", scope: "general", priority: "normal"});
  const d = await q(`SELECT s.chat_id, s.prefs FROM tg_deliveries d JOIN tg_subscribers s ON s.id=d.subscriber_id WHERE d.event_id=$1 ORDER BY s.chat_id`, [r.eventId]);
  assert.deepEqual(d.map(x => Number(x.chat_id)), [1001, 1002, 1003]); // F stopped excluded
  await pool.end();
});

test("notifications: C subscriber with announcements=false gets lectures but not announcements", async () => {
  const pool = await makeDb();
  const lec = await createEvent({type: "lecture", refId: "lec-9", version: 1, title: "t", scope: "general"});
  const ann = await createEvent({type: "announcement", refId: "ann-9", version: 1, title: "t", scope: "general"});
  const lecD = await q(`SELECT count(*)::int AS c FROM tg_deliveries WHERE event_id=$1 AND subscriber_id=(SELECT id FROM tg_subscribers WHERE chat_id=1003)`, [lec.eventId]);
  const annD = await q(`SELECT count(*)::int AS c FROM tg_deliveries WHERE event_id=$1 AND subscriber_id=(SELECT id FROM tg_subscribers WHERE chat_id=1003)`, [ann.eventId]);
  assert.equal(lecD[0].c, 1);
  assert.equal(annD[0].c, 0);
  await pool.end();
});

test("notifications: duplicate event key is idempotent (no duplicate deliveries)", async () => {
  const pool = await makeDb();
  const a = await createEvent({type: "exam", refId: "e1", version: 1, title: "t", scope: "general"});
  const b = await createEvent({type: "exam", refId: "e1", version: 1, title: "t", scope: "general"});
  // pg-mem misreports RETURNING rowCount on DO NOTHING; the real guarantee is one row in tg_events
  const c = await q(`SELECT count(*)::int AS c FROM tg_events`);
  assert.equal(c[0].c, 1);
  const d = await q(`SELECT count(*)::int AS c FROM tg_deliveries`);
  assert.equal(d[0].c, 3); // created once -> one delivery per eligible subscriber, no duplicates
  await pool.end();
});
