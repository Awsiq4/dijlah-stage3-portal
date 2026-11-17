import {test} from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_URL = "postgres://pgmem:5432/synthetic-security-test";
process.env.TELEGRAM_BOT_TOKEN = "synthetic-test-token";
const {newDb} = await import("pg-mem");
const {setPoolForTests} = await import("./db.ts");
const {getOwnPastQuestion, modifyPastQuestion, listOwnQuestions} = await import("./bot-question-bank.ts");

const teacher = {id:1,email:"teacher@example.invalid",role:"teacher",status:"active",is_active:true,
  assigned_subjects:["laser"],perms:{teacher_sections:{laser:["A"]}}};
const rep = {id:2,email:"rep@example.invalid",role:"section_representative",status:"active",is_active:true,assigned_section:"A"};
async function questionDb() {
  const mem = newDb();
  mem.public.registerFunction({name:"to_regclass",args:["text"],returns:"text",implementation:value=>value});
  const {Pool} = mem.adapters.createPg();
  const pool = new Pool();
  await pool.query(`CREATE TABLE portal_admins (
    id bigint PRIMARY KEY,email text,role text,status text,is_active boolean,name text,
    assigned_subjects jsonb,assigned_section text,perms jsonb);
    CREATE TABLE portal_past_questions (
    id text PRIMARY KEY, subject_id text, exam_kind text, title text,academic_year text,
    file_url text,file_name text,created_by bigint,sections jsonb,created_at timestamptz DEFAULT now(),archived_at timestamptz);
    CREATE TABLE portal_audit (actor text,action text,detail jsonb);
    INSERT INTO portal_past_questions(id,subject_id,exam_kind,title,created_by,sections)
    VALUES ('teacher-file','laser','final','Synthetic teacher file',1,'["A"]'),
           ('rep-file','laser','final','Synthetic rep file',2,'["A"]');`);
  setPoolForTests(pool);
  for(const admin of [teacher,rep,{...teacher,id:99,role:"super_admin"}]) await persistAdmin(pool,admin);
  return pool;
}

async function persistAdmin(pool,admin) {
  await pool.query(`INSERT INTO portal_admins(id,email,role,status,is_active,assigned_subjects,assigned_section,perms)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET role=EXCLUDED.role,
    status=EXCLUDED.status,is_active=EXCLUDED.is_active,assigned_subjects=EXCLUDED.assigned_subjects,
    assigned_section=EXCLUDED.assigned_section,perms=EXCLUDED.perms`,
    [admin.id,admin.email,admin.role,admin.status,admin.is_active,JSON.stringify(admin.assigned_subjects||[]),admin.assigned_section||null,JSON.stringify(admin.perms||{})]);
}

for (const [description, admin, id] of [
  ["removed teacher subject", {...teacher,assigned_subjects:[]}, "teacher-file"],
  ["removed teacher section", {...teacher,perms:{teacher_sections:{laser:["B"]}}}, "teacher-file"],
  ["reassigned representative section", {...rep,assigned_section:"B"}, "rep-file"],
  ["viewer downgrade", {...teacher,role:"viewer"}, "teacher-file"],
  ["cross-owner access", rep, "teacher-file"],
]) {
  test(`Telegram question management rejects ${description}`, async()=>{
    const pool = await questionDb();
    try {
      await persistAdmin(pool,admin);
      const results=[];
      for (const action of ["archive","restore","delete"]) {
        results.push(await modifyPastQuestion(admin,id,action));
      }
      assert.deepEqual(results,[false,false,false],"revoked scope must block archive, restore and deletion");
      assert.equal(await getOwnPastQuestion(admin,id),null);
      assert.equal((await listOwnQuestions(admin)).some(row=>row.id===id),false);
      assert.equal((await pool.query("SELECT id FROM portal_past_questions WHERE id=$1",[id])).rows.length,1);
    } finally { await pool.end(); }
  });
}
test("Telegram question management preserves authorized ownership and owner administration",async()=>{
  const pool=await questionDb();
  try {
    assert.equal((await getOwnPastQuestion(teacher,"teacher-file")).id,"teacher-file");
    assert.equal(await modifyPastQuestion(teacher,"teacher-file","archive"),true);
    assert.equal(await modifyPastQuestion(teacher,"teacher-file","restore"),true);
    assert.equal(await modifyPastQuestion({...teacher,id:99,role:"super_admin"},"rep-file","delete"),true);
  } finally {await pool.end();}
});


test("Telegram question mutation ignores cached teacher privileges after persisted role revocation",async()=>{
  const pool=await questionDb();
  try {
    await persistAdmin(pool,{...teacher,role:"viewer"});
    assert.equal(await modifyPastQuestion(teacher,"teacher-file","delete"),false);
    assert.equal((await pool.query("SELECT id FROM portal_past_questions WHERE id='teacher-file'")).rows.length,1);
  } finally {await pool.end();}
});
