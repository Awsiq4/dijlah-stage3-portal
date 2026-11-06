import {test} from "node:test";
import assert from "node:assert/strict";
import {buildUpsert, sanitizeRow, TELEGRAM_KINDS} from "./content-schema.ts";

test("sql injection: unknown columns are dropped, values stay bound parameters", () => {
  const {sql, params} = buildUpsert("schedule", {
    id: "x'; DROP TABLE portal_admins;--",
    section: "A", day: 6, start: "09:00", end: "10:00",
    evil: "1", "room) VALUES (1)--": "x",
  });
  assert.ok(!sql.includes("evil"));
  assert.ok(!sql.includes("DROP"));
  assert.match(sql, /^INSERT INTO portal_schedule \("id","section","day","start","end"\) VALUES \(\$1,\$2,\$3,\$4,\$5\)/);
  assert.deepEqual(params, ["x'; DROP TABLE portal_admins;--", "A", 6, "09:00", "10:00"]);
});

test("sql injection: identifiers are always quoted (reserved word end)", () => {
  const {sql} = buildUpsert("schedule", {id: "a", section: "B", day: 0, start: "09:00", end: "10:35"});
  assert.ok(sql.includes('"end"'));
  assert.ok(sql.includes('EXCLUDED."end"'));
});

test("validation: required fields enforced, enums enforced, ints coerced", () => {
  assert.throws(() => sanitizeRow("schedule", {section: "A", day: 6, start: "09:00", end: "10:00"}), /id/);
  assert.throws(() => sanitizeRow("schedule", {id: "a", section: "Z", day: 6, start: "1", end: "2"}), /غير مسموحة/);
  assert.throws(() => sanitizeRow("lectures", {id: "a", subject_id: "s", number: "abc", title: "t"}), /عددًا صحيحًا/);
  assert.throws(() => sanitizeRow("announcements", {id: "a", title: "t", priority: "mega"}), /غير مسموحة/);
  assert.throws(() => sanitizeRow("exams", {id: "a", title: "t", sections: "{bad json"}), /JSON/);
  const row = sanitizeRow("lectures", {id: "l1", subject_id: "s", number: "3", title: "t", status: "draft", extra: "dropped"});
  assert.equal(row.number, 3);
  assert.equal(row.status, "draft");
  assert.ok(!("extra" in row));
});

test("json fields accept objects and valid JSON strings, reject garbage", () => {
  const r1 = sanitizeRow("schedule", {id: "a", section: "A", day: 1, start: "s", end: "e", periods: ["09:00–09:45"]});
  assert.deepEqual(r1.periods, ["09:00–09:45"]);
  const r2 = sanitizeRow("exams", {id: "a", title: "t", sections: '["A","B"]'});
  assert.deepEqual(r2.sections, ["A", "B"]);
  assert.equal(sanitizeRow("exams", {id: "a", title: "t", sections: ""}).sections, null);
});

test("telegram kinds allowlist", () => {
  assert.deepEqual([...TELEGRAM_KINDS], ["general", "section", "subject"]);
});

test("every writable type has a fixed table and id-primary upsert", () => {
  for (const type of ["subjects", "lectures", "announcements", "exams", "assignments", "schedule"]) {
    const {sql} = buildUpsert(type, {id: "x", ...(type === "schedule" ? {section: "A", day: 1, start: "s", end: "e"} : {}), ...(type === "lectures" ? {subject_id: "s", number: 1, title: "t"} : {}), ...(type === "announcements" || type === "exams" || type === "assignments" ? {title: "t"} : {}), ...(type === "subjects" ? {name: "n"} : {})});
    assert.ok(sql.startsWith(`INSERT INTO portal_${type} `));
    assert.ok(sql.includes("ON CONFLICT (id) DO UPDATE SET"));
  }
});
