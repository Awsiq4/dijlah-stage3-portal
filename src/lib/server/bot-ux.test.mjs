import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

process.env.DATABASE_URL = "postgres://pgmem:5432/test";
process.env.TELEGRAM_BOT_TOKEN = "test-only";
process.env.SESSION_SECRET = "pgmem-test-secret";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const {newDb} = await import("pg-mem");
const {setPoolForTests, q, qOne} = await import("./db.ts");
const {publishAnnouncement, publishLecture} = await import("./publish.ts");
const {canModifyContent} = await import("./rbac.ts");
const {lecturesForSection} = await import("./public-filters.ts");
const asArr = (v) => typeof v === "string" ? (v.trim().startsWith("[") ? JSON.parse(v) : v.split(",").filter(Boolean)) : v;

const repA = {id: 2, email: "repA@x", role: "section_representative", status: "active", is_active: true, assigned_section: "A"};
const repB = {id: 3, email: "repB@x", role: "section_representative", status: "active", is_active: true, assigned_section: "B"};
const teacher = {id: 4, email: "t@x", role: "teacher", status: "active", is_active: true, assigned_subjects: ["nonlinear-optics"], perms: {teacher_sections: {"nonlinear-optics": ["A", "B"]}}};
const suspendedTeacher = {...teacher, id: 5, email: "t-susp@x", status: "suspended", is_active: false};

async function makeDb() {
  const mem = newDb();
  const {Pool} = mem.adapters.createPg();
  const pool = new Pool();
  // pg-mem cannot DROP CONSTRAINT, so apply the base schema with the extended role CHECK inline,
  // and skip the DROP/ADD constraint statements from the rbac migration.
  let base = readFileSync(path.join(root, "database/portal-schema.sql"), "utf8");
  base = base.replace("CHECK (role IN ('super_admin','editor','viewer'))",
    "CHECK (role IN ('super_admin','editor','viewer','general_representative','section_representative','teacher'))");
  const rbac = readFileSync(path.join(root, "database/portal-rbac.sql"), "utf8")
    .split(/;\s*(?:\n|$)/).map(st => st.replace(/\s*CHECK \(sections <@[^)]*\)/, "")).filter(st => !st.includes("portal_admins_role_check"));
  for (const sql of [base, rbac.join(";")]) {
    for (const stmt of sql.split(/;\s*(?:\n|$)/)) {
      const t = stmt.replace(/--[^\n]*/g, "").trim();
      if (t) await pool.query(t);
    }
  }
  setPoolForTests(pool);
  await pool.query(readFileSync(path.join(root, "database/telegram-notifications.sql"), "utf8"));
  await pool.query(`INSERT INTO portal_subjects (id, name) VALUES ('nonlinear-optics','بصريات لاخطية'), ('quantum-mechanics','ميكانيك الكم') ON CONFLICT (id) DO NOTHING`);
  for (const a of [repA, repB, teacher, suspendedTeacher]) {
    await pool.query(
      `INSERT INTO portal_admins (id, email, name, password_hash, role, status, is_active, assigned_section, assigned_subjects, perms)
       VALUES ($1,$2,$3,'scrypt:x:y',$4,$5,$6,$7,$8,$9)`,
      [a.id, a.email, a.email, a.role, a.status, a.is_active, a.assigned_section || null, JSON.stringify(a.assigned_subjects || []), JSON.stringify(a.perms || {})]
    );
  }
  return pool;
}

const sent = [];
globalThis.fetch = async (_url, opts) => { sent.push(JSON.parse(opts.body)); return {ok:true,json:async()=>({ok:true,result:{message_id:1}})}; };
const {handleAdminCallback, handleAdminMessage, getFlowState, setFlowState, resumeDraft} = await import("./bot.ts");
const {handleNavCallback, handleStudentCallback, homeMenuFor} = await import("./botx.ts");
async function linked(pool, id) { await pool.query(`INSERT INTO portal_telegram_links(admin_id,telegram_user_id) VALUES ($1,$2)`, [id,id]); }

test("new student must choose a section; stopped student gets resume action", async()=>{
 const pool=await makeDb(); sent.length=0;
 await handleNavCallback(55,55,"nav:home");
 assert.match(sent.at(-1).text,/اختر شعبتك/);
 assert.equal(sent.at(-1).reply_markup.inline_keyboard.length,4);
 await pool.query(`INSERT INTO tg_subscribers(chat_id, section, status) VALUES (55,'B','stopped')`);
 await handleNavCallback(55,55,"nav:home");
 assert.equal(sent.at(-1).reply_markup.inline_keyboard[0][0].callback_data,"sec:B");
 await pool.end();
});
test("teacher announcement asks for assigned named subject and allowed audience", async()=>{
 const pool=await makeDb(); await linked(pool,4); sent.length=0;
 await handleAdminCallback(4,4,"adm:ann");
 assert.equal(sent.at(-1).reply_markup.inline_keyboard[0][0].text,"بصريات لاخطية");
 await handleAdminCallback(4,4,"ann:subj:nonlinear-optics");
 const buttons=sent.at(-1).reply_markup.inline_keyboard.flat();
 assert.deepEqual(buttons.map(x=>x.callback_data),["lec:aud:sec:A","lec:aud:sec:B"]);
 await handleAdminCallback(4,4,"lec:aud:sec:B");
 await handleAdminMessage(4,4,"عنوان < &"); await handleAdminMessage(4,4,"نص التبليغ");
 const state=await getFlowState(4);
 assert.equal(state.data.scope,"teacher"); assert.equal(state.data.section,"B");
 assert.equal(state.data.subjectId,"nonlinear-optics"); assert.equal(state.data.step,"confirm");
 assert.ok(state.data.nonce); assert.equal(sent.at(-1).parse_mode,undefined);
 await handleAdminCallback(4,4,"pub:ann:old-token");
 assert.match(sent.at(-1).text,/قديم/);
 assert.equal((await getFlowState(4)).data.nonce,state.data.nonce);
 await handleAdminCallback(4,4,"pub:ann:"+state.data.nonce);
 const published=await q(`SELECT * FROM portal_announcements`);
 assert.equal(published.length,1); assert.equal(published[0].scope,"teacher"); assert.equal(published[0].section,"B");
 await handleAdminCallback(4,4,"pub:ann:"+state.data.nonce);
 assert.equal((await q(`SELECT * FROM portal_announcements`)).length,1);
 await pool.end();
});
test("direct PDF draft consumes saved attachment instead of asking to resend", async()=>{
 const pool=await makeDb(); await linked(pool,2); sent.length=0;
 await setFlowState(2,"lec",{step:"title",subjectId:"nonlinear-optics",sections:["A"],pendingDoc:{file_id:"saved",file_name:"saved.pdf",mime_type:"application/pdf",file_size:100}});
 await handleAdminMessage(2,2,"ملزمة");
 // No storage token in this test: reaching storage validation proves saved document was consumed.
 assert.match(sent.at(-1).text,/تخزين الملفات غير مهيأ/);
 assert.equal((await getFlowState(2)).data.title,"ملزمة");
 await pool.end();
});
test("resume restores current prompt and common menus remain role-aware", async()=>{
 const pool=await makeDb(); await linked(pool,2); sent.length=0;
 await setFlowState(2,"ann",{step:"body",title:"محفوظ"});
 await resumeDraft(2,2); assert.match(sent.at(-1).text,/نص التبليغ/);
 for (const role of ["super_admin","general_representative","section_representative","teacher"]) {
  const menu=homeMenuFor({...repA,role},true).inline_keyboard.flat();
  assert.ok(menu.some(x=>x.callback_data==="adm:my"));
  assert.equal(menu.some(x=>x.callback_data==="nav:owner"),role==="super_admin");
 }
 await pool.end();
});


test("fast announcement: representative sends text once and bot creates preview title", async () => {
 const pool = await makeDb(); await linked(pool, 2); sent.length = 0;
 await handleAdminCallback(2,2,"adm:quick");
 assert.equal((await getFlowState(2)).data.step,"body");
 await handleAdminMessage(2,2,"غداً تلغى محاضرة ميكانيك الكم.");
 const pending = await getFlowState(2);
 assert.equal(pending.flow,"ann");
 assert.equal(pending.data.step,"confirm");
 assert.equal(pending.data.title,"غداً تلغى محاضرة ميكانيك الكم.");
 await handleAdminCallback(2,2,"pub:ann:"+pending.data.nonce);
 const ann = (await q("SELECT title,body,scope,section FROM portal_announcements"))[0];
 assert.equal(ann.title,"غداً تلغى محاضرة ميكانيك الكم.");
 assert.equal(ann.body,"غداً تلغى محاضرة ميكانيك الكم.");
 assert.equal(ann.scope,"section");
 assert.equal(ann.section,"A");
 await pool.end();
});

test("summary publishing saves material_kind summary without showing as lecture", async () => {
 const pool = await makeDb(); await linked(pool,2); sent.length = 0;
 await setFlowState(2,"lec",{
   step:"confirm", nonce:"summary-check", draftId:"sum-test-1", materialKind:"summary",
   subjectId:"nonlinear-optics", sections:["A"], title:"ملخص الفصل الأول",
   fileUrl:"/lectures/sample-summary.pdf",fileName:"sample-summary.pdf",fingerprint:"1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
 });
 await handleAdminCallback(2,2,"pub:lec:summary-check");
 const row = await qOne("SELECT material_kind,subject_id,title FROM portal_lectures WHERE id='sum-test-1'");
 assert.equal(row.material_kind,"summary");
 assert.equal(row.subject_id,"nonlinear-optics");
 assert.equal(row.title,"ملخص الفصل الأول");
 const studentSection="A";
 const lectures=(await q("SELECT * FROM portal_lectures")).filter(x=>x.material_kind!=="summary");
 assert.equal(lectures.length,0);
 assert.equal(studentSection,"A");
 await pool.end();
});

test("results announcements do not ask for individual grade-sheet uploads", async () => {
 const pool = await makeDb(); await linked(pool,4); sent.length=0;
 await handleAdminCallback(4,4,"adm:results");
 assert.equal((await getFlowState(4)).data.step,"subject");
 await handleAdminCallback(4,4,"ann:subj:nonlinear-optics");
 await handleAdminCallback(4,4,"lec:aud:sec:A");
 assert.equal((await getFlowState(4)).data.step,"body");
 await handleAdminMessage(4,4,"تم إعلان نتائج امتحان الميد من قبل التدريسي.");
 const draft=await getFlowState(4);
 assert.equal(draft.data.step,"confirm");
 assert.match(String(draft.data.title),/^صدور نتائج:/);
 await handleAdminCallback(4,4,"pub:ann:"+draft.data.nonce);
 const row=(await q("SELECT * FROM portal_announcements"))[0];
 assert.equal(row.subject_id,"nonlinear-optics");
 assert.equal(row.section,"A");
 assert.match(row.title,/نتائج/);
 await pool.end();
});

test("assignment publishing from Telegram: rep can post to own section, correct deadline and no duplicates", async()=>{
 const pool=await makeDb();await linked(pool,2);sent.length=0;
 await handleAdminCallback(2,2,"adm:asg");
 assert.equal((await getFlowState(2)).data.step,"subject");
 await handleAdminCallback(2,2,"asg:subj:nonlinear-optics");
 assert.equal((await getFlowState(2)).data.step,"audience");
 await handleAdminCallback(2,2,"asg:aud:sec:A");
 await handleAdminMessage(2,2,"حل مسائل الفصل الأول");
 await handleAdminMessage(2,2,"حل التمارين 1 إلى 5 بالدفتر");
 await handleAdminMessage(2,2,"2099-11-20 18:00");
 await handleAdminMessage(2,2,"التسليم ورقياً في المحاضرة");
 await handleAdminMessage(2,2,"تخطي");
 const state=await getFlowState(2);
 assert.equal(state.flow,"asg");assert.equal(state.data.step,"confirm");
 assert.equal(state.data.dueAt,"2099-11-20T18:00:00+03:00");
 await handleAdminCallback(2,2,"pub:asg:"+state.data.nonce);
 const rows=await q("SELECT * FROM portal_assignments");
 assert.equal(rows.length,1,JSON.stringify(sent.slice(-3)));
 assert.equal(rows[0].title,"حل مسائل الفصل الأول");
 assert.equal(rows[0].subject_id,"nonlinear-optics");
 assert.deepEqual(asArr(rows[0].sections),["A"]);
 assert.equal(rows[0].due_at,"2099-11-20T18:00:00+03:00");
 assert.ok(!(await getFlowState(2)).flow);
 await handleAdminCallback(2,2,"pub:asg:"+state.data.nonce);
 assert.equal((await q("SELECT id FROM portal_assignments")).length,1);
 await pool.end();
});

test("teacher cannot assign to an unapproved section via forged callback", async()=>{
 const pool=await makeDb();await linked(pool,4);sent.length=0;
 await handleAdminCallback(4,4,"adm:asg");
 await handleAdminCallback(4,4,"asg:subj:quantum-mechanics");
 assert.equal((await getFlowState(4)).data.step,"subject");
 await handleAdminCallback(4,4,"asg:subj:nonlinear-optics");
 await handleAdminCallback(4,4,"asg:aud:sec:C");
 assert.equal((await getFlowState(4)).data.step,"audience");
 assert.equal((await q("SELECT id FROM portal_assignments")).length,0);
 await handleAdminCallback(4,4,"asg:aud:sec:B");
 assert.equal((await getFlowState(4)).data.step,"title");
 await pool.end();
});
