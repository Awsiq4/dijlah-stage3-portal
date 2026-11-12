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
