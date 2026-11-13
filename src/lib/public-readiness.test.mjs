import {test} from "node:test";
import assert from "node:assert/strict";
import {hasVerifiedSection,shouldRevalidate} from "./public-readiness.ts";

test("navigation inside a loaded section stays immediately ready",()=>{
  // Moving across Home, Subjects, Lectures, Announcements and Assignments
  // must not trigger a loading overlay for the same verified section.
  for(const route of ["/","/subjects","/subjects/optoelectronics",
    "/lectures/one","/questions/one","/announcements","/assignments","/exams","/this-week"]) {
    assert.equal(hasVerifiedSection(true,"ready","A","A"),true,route);
  }
});
test("first load and section switches remain protected from old/stale data",()=>{
  assert.equal(hasVerifiedSection(false,"ready","A","A"),false);
  assert.equal(hasVerifiedSection(true,"loading",null,"A"),false);
  assert.equal(hasVerifiedSection(true,"error",null,"A"),false);
  assert.equal(hasVerifiedSection(true,"ready","A","B"),false);
  assert.equal(hasVerifiedSection(true,"ready","F","A"),false);
});
test("background refresh retains verified data and throttles requests",()=>{
  assert.equal(hasVerifiedSection(true,"ready","A","A"),true);
  assert.equal(shouldRevalidate(1_000,119_000),false);
  assert.equal(shouldRevalidate(1_000,121_000),true);
  assert.equal(shouldRevalidate(0,130_000),true);
});
