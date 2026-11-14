import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

process.env.DATABASE_URL = "postgres://pgmem:5432/test";
process.env.SESSION_SECRET = "x";
process.env.SUBSCRIPTION_SECRET = "x";
process.env.BOT_OWNER_ID = "424242";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const {newDb} = await import("pg-mem");
const {setPoolForTests, q, qOne, defaultQueryer} = await import("./db.ts");
const {bindInvitedStaff, getLinkedAdmin} = await import("./bot.ts");
const {registerUser, isBotOwner, esc} = await import("./registry.ts");
const {computeAnalytics, listUsers, setSetting, getSetting, ownerNotificationsEnabled, OWNER_NOTIFY_KEY} = await import("./analytics.ts");
const {classifyBotActivity} = await import("./owner-intelligence.ts");
const {getSectionStats, listSectionStudents, getEffectiveRoleCounts} = await import("./owner-sections.ts");

async function makeDb() {
  const mem = newDb();
  const {Pool} = mem.adapters.createPg();
  const pool = new Pool();
  const norm = (sql) => sql.split(/;\s*(?:\n|$)/)
    .filter(st => !st.includes("portal_admins_role_check") && !st.includes("tg_subscribers_section_check"))
    .map(st => st.replace(/\s*CHECK \(sections <@[^)]*\)/, ""));
  const base = readFileSync(path.join(root, "database/portal-schema.sql"), "utf8").replace("'super_admin','editor'", "'super_admin','editor','teacher','section_representative','general_representative'");
  const rbac = readFileSync(path.join(root, "database/portal-rbac.sql"), "utf8");
  let tg = readFileSync(path.join(root, "database/telegram-notifications.sql"), "utf8");
  tg = tg.replace("section TEXT NOT NULL CHECK (section IN ('A','B','C','F'))", "section TEXT CHECK (section IS NULL OR section IN ('A','B','C','F'))");
  const recovery = readFileSync(path.join(root, "database/portal-password-recovery.sql"), "utf8");
  const own = readFileSync(path.join(root, "database/portal-owner-analytics.sql"), "utf8");
  // pg-mem: no sequences / no DO blocks — emulate reg_seq with a plain column + counter table
  const ownPgmem = own.replace(/DO \$\$[\s\S]*?\$\$;/g, ""); // pg-mem supports sequences; skip only the DO backfill block
  for (const stmt of norm(base + ";" + rbac + ";" + tg + ";" + ownPgmem + ";" + recovery)) {
    const t = stmt.replace(/--[^\n]*/g, "").trim();
    if (t) await pool.query(t);
  }
  setPoolForTests(pool);
  return pool;
}

test("registration: first /start creates user with sequential number; repeats do not duplicate", async () => {
  const pool = await makeDb();
  const u1 = await registerUser(1001, 1001, "ahmed", "Ahmed", "Mohammed", "A");
  assert.equal(u1.isNew, true);
  assert.equal(u1.reg_seq, 1);
  const u1b = await registerUser(1001, 1001, "ahmed_new", "Ahmed", "M.", "A"); // repeat /start
  assert.equal(u1b.isNew, false);
  assert.equal(u1b.reg_seq, 1); // number never changes
  const u2 = await registerUser(1002, 1002, "sara", "Sara", "", "B");
  assert.equal(u2.reg_seq, 2);
  const count = await qOne(`SELECT count(*)::int AS c FROM tg_subscribers`);
  assert.equal(count.c, 2);
  // username updated on change
  const row = await qOne(`SELECT username, first_name FROM tg_subscribers WHERE chat_id=1001`);
  assert.equal(row.username, "ahmed_new");
  await pool.end();
});

test("registration: concurrent first-time registrations get unique sequence numbers", async () => {
  const pool = await makeDb();
  const results = await Promise.all([1, 2, 3, 4, 5].map(i => registerUser(2000 + i, 2000 + i, "u" + i, "U" + i, "", "A")));
  const seqs = results.map(r => r.reg_seq).sort((a, b) => a - b);
  assert.deepEqual(seqs, [1, 2, 3, 4, 5]);
  assert.ok(results.every(r => r.isNew));
  await pool.end();
});

test("teacher Telegram binding requires the assigned ID, is idempotent and does not replace another account", async () => {
  const pool = await makeDb();
  try {
    const teacher = await qOne(
      `INSERT INTO portal_admins (email, password_hash, role, status, telegram_expected_id, telegram_expected_username)
       VALUES ('teacher@example.test', 'test', 'teacher', 'active', 2001, 'teacher') RETURNING id`
    );
    const other = await qOne(
      `INSERT INTO portal_admins (email, password_hash, role, status, telegram_expected_id)
       VALUES ('other@example.test', 'test', 'teacher', 'active', 2002) RETURNING id`
    );
    await q(`INSERT INTO portal_telegram_links (admin_id, telegram_user_id) VALUES ($1,2002)`, [teacher.id]);
    assert.equal(await getLinkedAdmin(2001), null);
    await bindInvitedStaff(9999);
    assert.equal(await getLinkedAdmin(9999), null);
    await bindInvitedStaff(2002);
    assert.equal((await getLinkedAdmin(2002)).id, teacher.id);
    assert.notEqual((await getLinkedAdmin(2002)).id, other.id);
    await bindInvitedStaff(2001);
    await bindInvitedStaff(2001);
    assert.equal((await getLinkedAdmin(2001)).id, teacher.id);
    assert.equal(await getLinkedAdmin(2002), null);
    assert.equal((await qOne(`SELECT count(*)::int AS count FROM portal_audit WHERE action='telegram.link.bound'`)).count, 1);
  } finally {
    await pool.end();
  }
});

test("both representative roles bind using their assigned Telegram ID", async () => {
  const pool = await makeDb();
  try {
    for (const [role, telegramId, section] of [
      ["section_representative", 3001, "A"],
      ["general_representative", 3002, null],
      ["viewer", 3003, null],
    ]) {
      await q(
        `INSERT INTO portal_admins (email, password_hash, role, status, assigned_section, telegram_expected_id)
         VALUES ($1, 'test', $2, 'active', $3, $4)`, [role + "@example.test", role, section, telegramId]
      );
      await bindInvitedStaff(telegramId);
      const linked = await getLinkedAdmin(telegramId);
      if (role === "viewer") {
        assert.equal(linked, null);
      } else {
        assert.equal(linked.role, role);
        assert.equal(linked.assigned_section, section);
      }
    }
  } finally {
    await pool.end();
  }
});

test("owner authorization: only BOT_OWNER_ID passes; esc() neutralizes HTML injection", () => {
  assert.equal(isBotOwner(424242), true);
  assert.equal(isBotOwner("424242"), true);
  assert.equal(isBotOwner(999), false);
  assert.equal(esc("<b>@evil</b>"), "&lt;b&gt;@evil&lt;/b&gt;");
});

test("analytics: counts, roles, sections, growth (Baghdad boundaries), zero-baseline safe", async () => {
  const pool = await makeDb();
  const now = Date.now();
  await pool.query(`INSERT INTO tg_subscribers (chat_id, section, role, status, reg_seq, registered_at, last_activity_at) VALUES
    (1,'A','student','active',1, now() - interval '1 hour', now() - interval '1 hour'),
    (2,'B','student','active',2, now() - interval '2 days', now() - interval '2 days'),
    (3,'A','teacher','active',3, now() - interval '10 days', now() - interval '10 days'),
    (4,NULL,'student','active',4, now() - interval '40 days', now() - interval '40 days')`);
  setPoolForTests(pool);
  const a = await computeAnalytics(defaultQueryer, new Date(now));
  assert.equal(a.total, 4);
  // In Baghdad shortly after midnight, "1 hour ago" belongs to yesterday.
  // Compute expected calendar-day counts instead of assuming daytime execution.
  const baghdadDay = timestamp => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(timestamp));
  const hourAgoDay = baghdadDay(now - 60 * 60 * 1000);
  assert.equal(a.newToday, hourAgoDay === baghdadDay(now) ? 1 : 0);
  assert.equal(a.newYesterday, hourAgoDay === baghdadDay(now - 24 * 60 * 60 * 1000) ? 1 : 0);
  assert.equal(a.new7d, 2);
  assert.equal(a.new30d, 3);
  assert.equal(a.active24h, 1);
  assert.equal(a.active7d, 2);
  assert.equal(a.active30d, 3);
  assert.equal(a.byRole.student, 3);
  assert.equal(a.byRole.teacher, 1);
  assert.equal(a.bySection.A, 1);
  assert.equal(a.bySection.B, 1);
  assert.equal(a.unassignedSection, 1);
  assert.equal(a.growth.prev7d, 1); // day -2 within prev 7d window? depends; just check pct is number|null without NaN
  assert.ok(a.growth.pct === null || Number.isFinite(a.growth.pct));
  await pool.end();
});

test("user search by id/username/name/reg_seq + pagination", async () => {
  const pool = await makeDb();
  for (let i = 1; i <= 10; i++) await registerUser(3000 + i, 3000 + i, "user" + i, "User" + i, "X", "A");
  const byName = await listUsers(defaultQueryer, 0, 8, {q: "User5"});
  assert.equal(byName.total, 1);
  assert.equal(byName.rows[0].username, "user5");
  const byReg = await listUsers(defaultQueryer, 0, 8, {q: "3"});
  assert.ok(byReg.rows.some(r => r.reg_seq === 3));
  const page1 = await listUsers(defaultQueryer, 1, 8);
  assert.equal(page1.rows.length, 2);
  assert.equal(page1.total, 10);
  await pool.end();
});

test("notification preference persists and defaults to enabled; disabling keeps registration working", async () => {
  const pool = await makeDb();
  assert.equal(await ownerNotificationsEnabled(defaultQueryer), true);
  await setSetting(defaultQueryer, OWNER_NOTIFY_KEY, false);
  assert.equal(await ownerNotificationsEnabled(defaultQueryer), false);
  assert.equal(await getSetting(defaultQueryer, OWNER_NOTIFY_KEY, true), false);
  const u = await registerUser(5001, 5001, "x", "X", "", "A");
  assert.equal(u.isNew, true); // registration unaffected by notif setting
  await pool.end();
});


test("owner section breakdown: zero-count sections, pagination and user details list exclude owner and linked staff", async () => {
  const pool = await makeDb();
  await registerUser(424242, 424242, "owner", "Portal", "Owner", "A");
  const admin = await pool.query(
    "INSERT INTO portal_admins (email, password_hash, role, status, is_active, name) " +
    "VALUES ('editor@test.example','hash','editor','active',true,'Editor') RETURNING id"
  );
  await registerUser(9001, 9001, "staff", "Teacher", "Account", "A");
  await pool.query("INSERT INTO portal_telegram_links (admin_id, telegram_user_id) VALUES ($1,$2)",
    [admin.rows[0].id, 9001]);

  for (let i = 0; i < 10; i++)
    await registerUser(1000 + i, 1000 + i, "student" + i, "Student", String(i), "A");
  await registerUser(2001, 2001, "b1", "Student", "B", "B");
  await registerUser(2002, 2002, "b2", "Student", "B2", "B");
  await registerUser(3001, 3001, "c1", "Student", "C", "C");
  await registerUser(4001, 4001, "f1", "Student", "F", "F");
  await registerUser(5001, 5001, "unknown", "Unknown", "", null);
  await pool.query("UPDATE tg_subscribers SET status='stopped' WHERE chat_id=1000");
  await pool.query("UPDATE tg_subscribers SET last_activity_at=now()-interval '40 days' WHERE chat_id=1001");

  const stats = await getSectionStats(defaultQueryer);
  assert.equal(stats.A.total, 10); // neither Telegram owner nor linked instructor counts as student
  assert.equal(stats.A.subscribed, 9);
  assert.equal(stats.A.stopped, 1);
  assert.equal(stats.A.active7d, 9);
  assert.equal(stats.B.total, 2);
  assert.equal(stats.C.total, 1);
  assert.equal(stats.F.total, 1);
  assert.equal(stats.NA.total, 1);

  const page0 = await listSectionStudents("A", 0, 8, defaultQueryer);
  const page1 = await listSectionStudents("A", 1, 8, defaultQueryer);
  assert.equal(page0.total, 10);
  assert.equal(page0.rows.length, 8);
  assert.equal(page1.rows.length, 2);
  assert.equal(new Set([...page0.rows, ...page1.rows].map(r => r.chat_id)).size, 10);
  assert.ok(![...page0.rows, ...page1.rows].some(r => [424242, 9001].includes(Number(r.chat_id))));
  const missing = await listSectionStudents("NA", 0, 8, defaultQueryer);
  assert.equal(missing.total, 1);
  assert.equal(Number(missing.rows[0].chat_id), 5001);

  const roles = await getEffectiveRoleCounts(defaultQueryer);
  assert.equal(roles.owner, 1);
  assert.equal(roles.editor, 1);
  assert.equal(roles.student, 15);
  await assert.rejects(() => listSectionStudents("INVALID", 0, 8, defaultQueryer));
  await pool.end();
});


test("owner analytics logs only safe classified interactions, never message contents or owner actions", () => {
  const privateChat = {type: "private", id: 1001};
  const makeMessage = (text) => ({update_id: 1, message: {chat: privateChat, text, from: {id: 1001}}});
  assert.deepEqual(classifyBotActivity(makeMessage("/start")), {feature: "start", action: "start"});
  assert.deepEqual(classifyBotActivity(makeMessage("/settings")), {feature: "settings", action: "open_preferences"});
  assert.equal(classifyBotActivity(makeMessage("my private diary notes")), null);
  assert.equal(classifyBotActivity(makeMessage("/analytics_off")), null);
  assert.equal(classifyBotActivity(makeMessage("/privacy")), null);
  const makeCallback = data => ({
    update_id: 2, callback_query: {from: {id: 1001}, message: {chat: privateChat}, data},
  });
  assert.deepEqual(classifyBotActivity(makeCallback("stu:lec")), {feature: "lectures", action: "open_subject_list"});
  assert.deepEqual(classifyBotActivity(makeCallback("stu:lec:quantum_mechanics")), {feature: "lectures", action: "select_subject", subjectId: "quantum_mechanics"});
  assert.deepEqual(classifyBotActivity(makeCallback("stu:lec:unsafe<token>")), {feature: "lectures", action: "browse_lectures"});
  assert.deepEqual(classifyBotActivity(makeCallback("sec:B")), {feature: "section", action: "select_section"});
  assert.equal(classifyBotActivity(makeCallback("own:users:0")), null);
  assert.equal(classifyBotActivity(makeCallback("adm:my")), null);
  assert.equal(classifyBotActivity(makeCallback("leak-private-id-token")), null);
  assert.equal(classifyBotActivity({message: {chat: {id: -1001, type: "group"}, text: "/start"}}), null);
});


// Keep owner-only usage analytics operational, without the old student controls.
// Student privacy details remain available when the student requests /privacy.
test("Telegram student help has no usage analytics toggle and does not auto-send a tracking message", () => {
  const webhook = readFileSync(path.join(root, "src/app/api/telegram/webhook/route.ts"), "utf8");
  const studentHelp = webhook.slice(webhook.indexOf("const HELP = "), webhook.indexOf("function sectionKeyboard()"));
  assert.doesNotMatch(studentHelp, /analytics_(?:off|on)|تتبع الاستخدام|تحليلات الاستخدام/);
  assert.doesNotMatch(webhook, /cmd === "\/analytics_(?:on|off)"/);
  assert.doesNotMatch(webhook, /خصوصيتك مهمة:/);
  assert.match(webhook, /if \(cmd === "\/privacy"\)/);
  assert.match(webhook, /await recordBotActivity\(update\)/);
  const activity = readFileSync(path.join(root, "src/lib/server/owner-intelligence.ts"), "utf8");
  assert.match(activity, /INSERT INTO tg_student_activity/);
  assert.match(activity, /analytics_opt_out=false/); // Honor users who previously opted out.
});
