import {test} from "node:test";
import assert from "node:assert/strict";
import {validAssignmentDay,baghdadToday,assignmentDayAllowed,assignmentDisplayDay} from "./assignment-date.ts";

test("assignment deadline accepts calendar day only, never a clock time",()=>{
  for(const valid of ["2026-11-12","2028-02-29","2099-12-31"])
    assert.equal(validAssignmentDay(valid),true);
  for(const invalid of ["2026-11-12 18:00","2026-11-12T18:00:00+03:00",
      "12-11-2026","2026-02-30","2026-13-03","2026-2-3",""])
    assert.equal(validAssignmentDay(invalid),false);
});

test("today is valid in Baghdad and yesterday is rejected, regardless of hour",()=>{
  // Baghdad on Nov 12 while UTC is Nov 11.
  const utc=new Date("2026-11-11T22:30:00Z");
  assert.equal(baghdadToday(utc),"2026-11-12");
  assert.equal(assignmentDayAllowed("2026-11-12",utc),true);
  assert.equal(assignmentDayAllowed("2026-11-11",utc),false);
  assert.equal(assignmentDayAllowed("2026-11-13",utc),true);
});

test("legacy timestamps are shown only as dates without leaking old hours",()=>{
  assert.equal(assignmentDisplayDay("2026-11-20T18:00:00+03:00"),"2026-11-20");
  assert.equal(assignmentDisplayDay("2026-11-20"),"2026-11-20");
  assert.equal(assignmentDisplayDay(""),"غير محدد");
});

test("student week follows the Saturday boundary in Baghdad and the selected section", async () => {
  const {studentWeek} = await import("./student-week.ts");
  const now = new Date("2026-11-13T21:30:00Z");
  const result = studentWeek({
    assignments: [
      {id:"all", title:"واجب عام", dueAt:"2026-11-14T00:00:00+03:00", sections:["A","B","C","F"]},
      {id:"other", title:"واجب ب", dueAt:"2026-11-15", sections:["B"]},
      {id:"past-week", dueAt:"2026-11-13", sections:["A"]},
    ],
    exams: [
      {id:"quiz", type:"كوز يومي", date:"2026-11-15", startTime:"10:00", sections:["A"], status:"cancelled"},
      {id:"midterm", type:"Midterm", date:"2026-11-15", sections:["A"]},
    ],
    schedule: [{id:"moved", section:"A", day:0, status:"moved", start:"09:00"}],
  }, "A", now);
  assert.equal(result.today, "2026-11-14");
  assert.deepEqual([result.dates[0], result.dates.at(-1)], ["2026-11-14", "2026-11-20"]);
  assert.deepEqual(result.items.map(item => item.id), ["all", "moved", "quiz"]);
  assert.equal(result.items[0].time, undefined);
  assert.equal(result.items[2].status, "cancelled");
});
