import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

process.env.DATABASE_URL = "postgres://pgmem:5432/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const filters = await import("./public-filters.ts");
const {newDb} = await import("pg-mem");
const {setPoolForTests, defaultQueryer} = await import("./db.ts");
const {getPublicContent} = await import("./public.ts");
const {mapPublicContent} = await import("../public-map.ts");

test("filters: published-only lectures, section targeting, exams/assignments by sections[]", () => {
  assert.deepEqual(filters.publishedLectures([{status: "published"}, {status: "draft"}]).length, 1);
  const anns = [
    {scope: "general", section: "all"},
    {scope: "section", section: "A"},
    {scope: "section", section: "B"},
    {scope: "teacher", section: "A"},
  ];
  assert.equal(filters.announcementsForSection(anns, "A").length, 3); // general + A + teacher-A
  assert.equal(filters.announcementsForSection(anns, "B").length, 2); // general + B
  const exams = [{sections: ["A", "B"]}, {sections: ["C"]}, {sections: []}];
  assert.equal(filters.sectionedForSection(exams, "A").length, 1); // mirrors client: sections.includes(section)
  assert.equal(filters.sectionedForSection(exams, "F").length, 0);
  assert.equal(filters.scheduleForSection([{section: "A"}, {section: "C"}], "C").length, 1);
  assert.equal(filters.validSection("Z"), "A");
  assert.equal(filters.validSection("F"), "F");
});

test("public layer (pg-mem): only published rows, section targeting correct, drafts never exposed", async () => {
  const mem = newDb();
  const {Pool} = mem.adapters.createPg();
  const pool = new Pool();
  const norm = (sql) => sql.split(/;\s*(?:\n|$)/)
    .filter(st => !st.includes("portal_admins_role_check"))
    .map(st => st.replace(/\s*CHECK \(sections <@[^)]*\)/, ""))
    .join(";");
  let schema = readFileSync(path.join(root, "database/portal-schema.sql"), "utf8");
  schema = schema.replace("CHECK (role IN ('super_admin','editor','viewer'))", "CHECK (role IN ('super_admin','editor','viewer','general_representative','section_representative','teacher'))");
  const rbac = readFileSync(path.join(root, "database/portal-rbac.sql"), "utf8");
  for (const stmt of norm(schema + ";" + rbac).split(/;\s*(?:\n|$)/)) {
    const t = stmt.replace(/--[^\n]*/g, "").trim();
    if (t) await pool.query(t);
  }
  setPoolForTests(pool);
  await pool.query(`INSERT INTO portal_subjects (id,name) VALUES ('subj','مادة')`);
  await pool.query(`INSERT INTO portal_lectures (id,subject_id,number,title,status) VALUES ('pub','subj',1,'منشورة','published')`);
  await pool.query(`INSERT INTO portal_lectures (id,subject_id,number,title,status) VALUES ('drf','subj',2,'مسودة','draft')`);
  await pool.query(`INSERT INTO portal_lectures (id,subject_id,number,title,status,material_kind,sections) VALUES
    ('summary-a','subj',1,'ملخص A','published','summary','["A"]'),
    ('summary-draft','subj',1,'ملخص مسودة','draft','summary','["A"]')`);
  await pool.query(`INSERT INTO portal_announcements (id,title,scope,section) VALUES ('a-gen','عام','general','all')`);
  await pool.query(`INSERT INTO portal_announcements (id,title,scope,section) VALUES ('a-A','شعبة A','section','A')`);
  await pool.query(`INSERT INTO portal_announcements (id,title,scope,section) VALUES ('a-B','شعبة B','section','B')`);
  await pool.query(`INSERT INTO portal_exams (id,title,sections) VALUES ('e-AB','امتحان AB','["A","B"]')`);
  await pool.query(`INSERT INTO portal_exams (id,title,sections) VALUES ('e-C','امتحان C','["C"]')`);
  await pool.query(`INSERT INTO portal_schedule (id,section,day,start,"end") VALUES ('s-A', 'A', 6, '09:00','10:35')`);
  await pool.query(`INSERT INTO portal_schedule (id,section,day,start,"end") VALUES ('s-C', 'C', 6, '09:00','10:35')`);

  const pubA = await getPublicContent("all", "A", defaultQueryer);
  assert.equal(pubA.fromDatabase, true);
  const c = pubA.content;
  assert.deepEqual(c.lectures.map(l => l.id), ["pub"]);
  assert.deepEqual(c.summaries.map(l => l.id), ["summary-a"]); // draft excluded
  assert.deepEqual(c.announcements.map(a => a.id).sort(), ["a-A", "a-gen"]); // B excluded for section A
  assert.deepEqual(c.exams.map(e => e.id), ["e-AB"]); // C exam excluded
  assert.deepEqual(c.questions, []); // additive bank migration may not be installed
  assert.deepEqual(c.schedule.map(x => x.id), ["s-A"]);

  const pubB = await getPublicContent("all", "B", defaultQueryer);
  assert.deepEqual(pubB.content.summaries, []);
  assert.deepEqual(pubB.content.announcements.map(a => a.id).sort(), ["a-B", "a-gen"]);
  assert.deepEqual(pubB.content.exams.map(e => e.id), ["e-AB"]);
  assert.equal(pubB.content.schedule.length, 0);

  // client mapping: snake_case -> camelCase PortalData shape
  const mapped = mapPublicContent(c);
  assert.equal(mapped.lectures[0].subjectId, "subj");
  assert.equal(mapped.announcements[0].publishedAt !== undefined, true);
  assert.equal(mapped.schedule[0].section, "A");
  assert.equal(mapped.subjects[0].englishName !== undefined, true);
  // A private admin login email must never be the owner's public byline:
  // cover current ownership, legacy posts without created_by, and another publisher.
  await pool.query(`INSERT INTO portal_admins (id,email,name,password_hash,role)
    VALUES (90,'owner@private.test','','hash','super_admin'),
           (91,'teacher@private.test','Dr Example','hash','teacher')`);
  await pool.query(`INSERT INTO portal_announcements(id,title,scope,section,author,created_by) VALUES
    ('owner-current','مالك جديد','general','all','owner@private.test',90),
    ('owner-legacy','مالك قديم','general','all','owner@private.test',NULL),
    ('teacher-post','تدريسي','teacher','A','Dr Example',91)`);
  const authors = (await getPublicContent("announcements", "A", defaultQueryer)).content.announcements;
  assert.equal(authors.find(a => a.id === "owner-current").author,"Aws Faris");
  assert.equal(authors.find(a => a.id === "owner-legacy").author,"Aws Faris");
  assert.equal(authors.find(a => a.id === "teacher-post").author,"Dr Example");
  assert.equal(authors.find(a => a.id === "a-gen").author,"");
  await pool.end();
});
