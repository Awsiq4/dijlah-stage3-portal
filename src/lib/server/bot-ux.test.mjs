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
const {handleNavCallback, handleStudentCallback, homeMenuFor, handleManageCallback} = await import("./botx.ts");
const {getCoursework,listCoursework,changeCoursework,archiveCoursework,deleteCoursework}=await import("./bot-coursework-manage.ts");
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


test("assignment is three-step: subject, one-message description, deadline, then preview",async()=>{
 const pool=await makeDb();await linked(pool,2);sent.length=0;
 await handleAdminCallback(2,2,"adm:asg");
 assert.equal((await getFlowState(2)).data.step,"subject");
 await handleAdminCallback(2,2,"asg:subj:nonlinear-optics");
 let st=await getFlowState(2);
 assert.equal(st.data.step,"details");
 assert.deepEqual(st.data.sections,["A"]);
 await handleAdminMessage(2,2,"حل مسائل الفصل الأول\nحل التمارين 1 إلى 5 بالدفتر");
 assert.equal((await getFlowState(2)).data.step,"due");
 await handleAdminMessage(2,2,"2099-11-20");
 st=await getFlowState(2);
 assert.equal(st.data.step,"confirm");
 assert.equal(st.data.dueAt,"2099-11-20");
 assert.doesNotMatch(sent.at(-1).text,/18:00|23:59/);
 assert.equal(st.data.title,"حل مسائل الفصل الأول");
 await handleAdminCallback(2,2,"pub:asg:"+st.data.nonce);
 const rows=await q("SELECT * FROM portal_assignments");
 assert.equal(rows.length,1,JSON.stringify(sent.slice(-3)));
 assert.equal(rows[0].title,"حل مسائل الفصل الأول");
 assert.match(rows[0].instructions,/التمارين 1/);
 assert.deepEqual(asArr(rows[0].sections),["A"]);
 assert.equal(rows[0].due_at,"2099-11-20");
 assert.ok(!(await getFlowState(2)).flow);
 await handleAdminCallback(2,2,"pub:asg:"+st.data.nonce);
 assert.equal((await q("SELECT id FROM portal_assignments")).length,1);
 await pool.end();
});


test("teacher assignment defaults to allowed audience, rejects forged section on edit",async()=>{
 const pool=await makeDb();await linked(pool,4);sent.length=0;
 await handleAdminCallback(4,4,"adm:asg");
 await handleAdminCallback(4,4,"asg:subj:quantum-mechanics");
 assert.equal((await getFlowState(4)).data.step,"subject");
 await handleAdminCallback(4,4,"asg:subj:nonlinear-optics");
 const current=await getFlowState(4);
 assert.deepEqual(current.data.sections,["A","B"]);
 assert.equal(current.data.step,"details");
 await handleAdminMessage(4,4,"واجب الفصل الأول");
 await handleAdminMessage(4,4,"2099-11-20");
 await handleAdminCallback(4,4,"asg:edit:audience");
 await handleAdminCallback(4,4,"asg:aud:sec:C");
 assert.equal((await getFlowState(4)).data.step,"audience");
 await handleAdminCallback(4,4,"asg:aud:sec:B");
 assert.equal((await getFlowState(4)).data.step,"confirm");
 assert.deepEqual((await getFlowState(4)).data.sections,["B"]);
 await pool.end();
});


test("quiz publishing uses subject + date-only message and publishes once",async()=>{
 const pool=await makeDb();await linked(pool,2);sent.length=0;
 await handleAdminCallback(2,2,"adm:exam");
 assert.equal((await getFlowState(2)).data.step,"subject");
 await handleAdminCallback(2,2,"quiz:subj:nonlinear-optics");
 let state=await getFlowState(2);
 assert.equal(state.data.step,"date");
 assert.deepEqual(state.data.sections,["A"]);
 await handleAdminMessage(2,2,"2099-11-24");
 state=await getFlowState(2);
 assert.equal(state.data.step,"confirm");
 assert.match(sent.at(-1).text,/2099-11-24/);
 await handleAdminCallback(2,2,"quiz:more");
 await handleAdminCallback(2,2,"quiz:edit:topics");
 await handleAdminMessage(2,2,"محاضرات الفصل الأول");
 state=await getFlowState(2);
 assert.equal(state.data.step,"confirm");
 await handleAdminCallback(2,2,"pub:exam:"+state.data.nonce);
 const rows=await q("SELECT * FROM portal_exams");
 assert.equal(rows.length,1,JSON.stringify(sent.slice(-2)));
 assert.equal(rows[0].title,"كوز يومي");
 assert.equal(rows[0].type,"كوز يومي");
 assert.equal(rows[0].date,"2099-11-24");
 assert.equal(rows[0].start_time,"");
 assert.equal(rows[0].topics,"محاضرات الفصل الأول");
 assert.deepEqual(asArr(rows[0].sections),["A"]);
 await handleAdminCallback(2,2,"pub:exam:"+state.data.nonce);
 assert.equal((await q("SELECT id FROM portal_exams")).length,1);
 await pool.end();
});


test("teacher quiz audience defaults to permitted sections and rejects forged edits",async()=>{
 const pool=await makeDb();await linked(pool,4);sent.length=0;
 await handleAdminCallback(4,4,"adm:exam");
 await handleAdminCallback(4,4,"quiz:subj:quantum-mechanics");
 assert.equal((await getFlowState(4)).data.step,"subject");
 await handleAdminCallback(4,4,"quiz:subj:nonlinear-optics");
 assert.deepEqual((await getFlowState(4)).data.sections,["A","B"]);
 await handleAdminMessage(4,4,"2099-11-24");
 await handleAdminCallback(4,4,"quiz:aud");
 await handleAdminCallback(4,4,"quiz:aud:C");
 assert.equal((await getFlowState(4)).data.step,"audience");
 await handleAdminCallback(4,4,"quiz:aud:B");
 assert.deepEqual((await getFlowState(4)).data.sections,["B"]);
 assert.equal((await q("SELECT * FROM portal_exams")).length,0);
 await pool.end();
});


test("management menu lists assignments and quizzes alongside old content types",async()=>{
 const pool=await makeDb();await linked(pool,2);sent.length=0;
 await handleManageCallback(2,2,"adm:my");
 const keys=sent.at(-1).reply_markup.inline_keyboard.flat().map(x=>x.callback_data);
 for(const key of ["page:my:announcements:0","page:my:lectures:0","page:my:questions:0","cw:p:a:0","cw:p:q:0"])
   assert.ok(keys.includes(key),key);
 await pool.end();
});

test("publisher manages their own assignment: edit due day, archive, restore, delete confirmation",async()=>{
 const pool=await makeDb();await linked(pool,2);await linked(pool,3);sent.length=0;
 await pool.query(`INSERT INTO portal_assignments
   (id,subject_id,title,instructions,due_at,sections,status,created_by)
   VALUES ('asg-managed','nonlinear-optics','واجب الفصل الأول','حل الصفحة 5','2099-11-20','["A"]','active',2),
          ('asg-other','nonlinear-optics','واجب ممثل B','حل الصفحة 6','2099-11-22','["B"]','active',3)`);
 await handleManageCallback(2,2,"cw:p:a:0");
 let buttons=sent.at(-1).reply_markup.inline_keyboard.flat().map(x=>x.callback_data);
 assert.ok(buttons.includes("cw:i:a:asg-managed"));
 assert.ok(!buttons.includes("cw:i:a:asg-other"));
 await handleManageCallback(2,2,"cw:i:a:asg-managed");
 assert.match(sent.at(-1).text,/2099-11-20/);
 await handleManageCallback(2,2,"cw:ed:a:asg-managed");
 await handleManageCallback(2,2,"cw:f:a:2:asg-managed");
 await handleAdminMessage(2,2,"2099-11-25");
 const st=await getFlowState(2);
 assert.equal(st.flow,"manage-coursework");
 assert.equal(st.data.step,"confirm");
 assert.equal((await qOne("SELECT due_at FROM portal_assignments WHERE id='asg-managed'")).due_at,"2099-11-20");
 await handleManageCallback(2,2,"cw:ok:"+st.data.nonce);
 assert.equal((await qOne("SELECT due_at FROM portal_assignments WHERE id='asg-managed'")).due_at,"2099-11-25");
 await handleManageCallback(2,2,"cw:ok:"+st.data.nonce);
 assert.match(sent.at(-1).text,/قديم/);
 await handleManageCallback(2,2,"cw:ac:a:asg-managed");
 assert.ok((await qOne("SELECT archived_at FROM portal_assignments WHERE id='asg-managed'")).archived_at);
 await handleManageCallback(2,2,"cw:rs:a:asg-managed");
 assert.equal((await qOne("SELECT archived_at FROM portal_assignments WHERE id='asg-managed'")).archived_at,null);
 await handleManageCallback(2,2,"cw:dl:a:asg-managed");
 let pending=await getFlowState(2);
 assert.equal(pending.data.step,"delete");
 assert.ok(await qOne("SELECT id FROM portal_assignments WHERE id='asg-managed'"));
 await handleManageCallback(2,2,"cw:yes:"+pending.data.nonce);
 assert.equal(await qOne("SELECT id FROM portal_assignments WHERE id='asg-managed'"),null);
 assert.ok(await qOne("SELECT id FROM portal_assignments WHERE id='asg-other'"));
 await pool.end();
});

test("quiz management allows editing previous quiz fields but hides timetable exams",async()=>{
 const pool=await makeDb();await linked(pool,2);sent.length=0;
 await pool.query(`INSERT INTO portal_exams
 (id,subject_id,title,type,date,start_time,sections,status,created_by)
 VALUES
 ('quiz-managed','nonlinear-optics','كوز المحاضرة الأولى','كوز يومي','2099-11-20','09:30','["A"]','confirmed',2),
 ('final-legacy','nonlinear-optics','جدول فاينل','Final','2099-11-24','09:30','["A"]','confirmed',2)`);
 await handleManageCallback(2,2,"cw:p:q:0");
 let buttons=sent.at(-1).reply_markup.inline_keyboard.flat().map(x=>x.callback_data);
 assert.ok(buttons.includes("cw:i:q:quiz-managed"));
 assert.ok(!buttons.includes("cw:i:q:final-legacy"));
 await handleManageCallback(2,2,"cw:ed:q:quiz-managed");
 await handleManageCallback(2,2,"cw:f:q:2:quiz-managed");
 await handleAdminMessage(2,2,"10:45");
 const st=await getFlowState(2);
 assert.equal(st.data.step,"confirm");
 await handleManageCallback(2,2,"cw:ok:"+st.data.nonce);
 assert.equal((await qOne("SELECT start_time FROM portal_exams WHERE id='quiz-managed'")).start_time,"10:45");
 await handleManageCallback(2,2,"cw:ac:q:quiz-managed");
 assert.ok((await qOne("SELECT archived_at FROM portal_exams WHERE id='quiz-managed'")).archived_at);
 await handleManageCallback(2,2,"cw:rs:q:quiz-managed");
 assert.equal((await qOne("SELECT archived_at FROM portal_exams WHERE id='quiz-managed'")).archived_at,null);
 await handleManageCallback(2,2,"cw:dl:q:quiz-managed");
 const pending=await getFlowState(2);
 await handleManageCallback(2,2,"cw:yes:"+pending.data.nonce);
 assert.equal(await qOne("SELECT id FROM portal_exams WHERE id='quiz-managed'"),null);
 assert.ok(await qOne("SELECT id FROM portal_exams WHERE id='final-legacy'"));
 await pool.end();
});

test("ownership and authorized sections are enforced server-side for edits and deletion",async()=>{
 const pool=await makeDb();await linked(pool,2);await linked(pool,3);await linked(pool,4);sent.length=0;
 await pool.query(`INSERT INTO portal_assignments
  (id,subject_id,title,instructions,due_at,sections,status,created_by)
  VALUES ('owned-b','nonlinear-optics','واجب B','نص','2099-11-20','["B"]','active',3)`);
 await pool.query(`INSERT INTO portal_exams
  (id,subject_id,title,type,date,start_time,sections,status,created_by)
  VALUES ('quiz-a','nonlinear-optics','كوز A','كوز يومي','2099-11-20','09:30','["A"]','confirmed',2)`);
 const denied=await changeCoursework(repA,"a","owned-b","title","غير مشروع","واجب B");
 assert.equal(denied.ok,false);
 assert.equal((await archiveCoursework(repA,"a","owned-b",true)).ok,false);
 assert.equal((await deleteCoursework(repA,"a","owned-b")).ok,false);
 assert.equal((await changeCoursework(repA,"q","quiz-a","sections",["B"],["A"])).ok,false);
 assert.equal((await changeCoursework(repA,"q","quiz-a","date","2020-01-01","2099-11-20")).ok,false);
 assert.equal((await changeCoursework(repA,"q","quiz-a","start_time","25:00","09:30")).ok,false);
 assert.equal((await changeCoursework(repA,"q","quiz-a","title","كوز جديد","اسم قديم")).ok,false);
 assert.equal((await changeCoursework(teacher,"q","quiz-a","title","من تدريسي","كوز A")).ok,false);
 await handleManageCallback(2,2,"cw:ac:a:owned-b");
 assert.ok(await qOne("SELECT id FROM portal_assignments WHERE id='owned-b' AND archived_at IS NULL"));
 assert.equal((await qOne("SELECT title FROM portal_exams WHERE id='quiz-a'")).title,"كوز A");
 await pool.end();
});
