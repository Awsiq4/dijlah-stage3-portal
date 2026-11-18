import assert from "node:assert/strict";
import test from "node:test";
import {baghdadToday} from "./assignment-date.ts";
import {
  formatMidtermDate, formatMidtermTime, getClosestMidterm, getFirstSemesterMidterms, MIDTERM_SCHEDULE_ID,
} from "./midterms.ts";

function midterm(id, date, startTime = "12:30", status = "confirmed") {
  return {id, date, startTime, status, type: "Midterm", scheduleId: MIDTERM_SCHEDULE_ID, sections: ["A", "B", "C", "F"]};
}

test("selects this term's midterms for every section in local date and time order", () => {
  const first = midterm("first", "2026-11-28");
  const later = midterm("later", "2026-12-08");
  const earlierSameDay = midterm("earlier", "2026-11-28", "10:30");
  const exams = [later, first, {...first, type: "كوز يومي"}, earlierSameDay, {...first, scheduleId: undefined}];
  for (const section of ["A", "B", "C", "F"]) {
    assert.deepEqual(getFirstSemesterMidterms(exams, section), [earlierSameDay, first, later]);
  }
});

test("keeps today's exam through Baghdad midnight and skips canceled exams", () => {
  const first = midterm("first", "2026-11-28");
  const canceled = midterm("canceled", "2026-11-29", "12:30", "cancelled");
  const last = midterm("last", "2026-12-08");
  const exams = [first, canceled, last];
  const closestAt = utc => getClosestMidterm(exams, baghdadToday(new Date(utc)))?.id;
  assert.equal(closestAt("2026-11-27T20:59:59Z"), "first");
  assert.equal(closestAt("2026-11-28T20:59:59Z"), "first");
  assert.equal(closestAt("2026-11-28T21:00:00Z"), "last");
  assert.equal(closestAt("2026-12-08T20:59:59Z"), "last");
  assert.equal(closestAt("2026-12-08T21:00:00Z"), undefined);
});

test("displays the Baghdad exam date and time in Iraqi Arabic", () => {
  assert.equal(formatMidtermDate("2026-11-28"), "السبت ٢٨ تشرين الثاني");
  assert.equal(formatMidtermTime("12:30"), "١٢:٣٠ ظهرًا");
});
