import {test} from "node:test";
import assert from "node:assert/strict";
import {mapPublicContent, mapAuthoritativeContent, mapTelegram} from "./public-map.ts";

test("public-map: snake_case rows map to camelCase client types", () => {
  const mapped = mapPublicContent({
    subjects: [{id: "s", name: "n", english_name: "EN", teacher: "t", description: "d", color: "#fff"}],
    lectures: [{id: "l", subject_id: "s", number: "2", title: "t", status: "published", file_url: "/f.pdf", file_name: "f.pdf", updated_at: "2026-11-05"}],
    announcements: [{id: "a", title: "t", body: "b", scope: "section", section: "A", subject_id: "s", author: "x", priority: "urgent", published_at: "2026-11-05", pinned: true}],
    exams: [{id: "e", subject_id: "s", title: "t", sections: '["A","B"]', status: "confirmed"}],
    assignments: [{id: "w", subject_id: "s", title: "t", sections: ["F"], status: "active"}],
    schedule: [{id: "c", section: "A", day: 6, start: "09:00", end: "10:35", kind: "practical", periods: '["09:00–09:45"]'}],
    telegram: [
      {kind: "general", key: "general", url: "https://t.me/general"},
      {kind: "section", key: "A", url: "https://t.me/A"},
      {kind: "section", key: "F", url: ""},
      {kind: "subject", key: "nonlinear-optics", url: "https://t.me/nlo"},
    ],
  });
  assert.equal(mapped.subjects[0].englishName, "EN");
  assert.equal(mapped.lectures[0].number, 2);
  assert.equal(mapped.lectures[0].fileUrl, "/f.pdf");
  assert.equal(mapped.announcements[0].pinned, true);
  assert.equal(mapped.announcements[0].priority, "urgent");
  assert.deepEqual(mapped.exams[0].sections, ["A", "B"]);
  assert.deepEqual(mapped.assignments[0].sections, ["F"]);
  assert.equal(mapped.schedule[0].kind, "practical");
  assert.deepEqual(mapped.schedule[0].periods, ["09:00–09:45"]);
  assert.equal(mapped.telegram.general, "https://t.me/general");
  assert.equal(mapped.telegram.sections.A, "https://t.me/A");
  assert.equal(mapped.telegram.sections.F, ""); // empty url never assigned
  assert.equal(mapped.telegram.subjects["nonlinear-optics"], "https://t.me/nlo");
});

test("public-map: telegram never invents missing channels (F stays empty)", () => {
  const tg = mapTelegram([{kind: "section", key: "A", url: "https://t.me/A"}]);
  assert.equal(tg.sections.F, "");
  assert.equal(tg.general, "");
});


test("authoritative section payload cannot retain stale entries from seed or another section",()=>{
  const first = mapAuthoritativeContent({
    subjects:[{id:"s",name:"مادة"}],
    lectures:[{id:"old-A",subject_id:"s",status:"published"}],
    announcements:[{id:"a-A",section:"A",scope:"section"}],
  });
  assert.equal(first.lectures.length,1);
  assert.equal(first.announcements.length,1);
  const second = mapAuthoritativeContent({
    subjects:[{id:"s",name:"مادة"}],
    lectures:[],announcements:[],assignments:[],exams:[],schedule:[],summaries:[],
  });
  assert.deepEqual(second.lectures,[]);
  assert.deepEqual(second.summaries,[]);
  assert.deepEqual(second.announcements,[]);
  assert.deepEqual(second.assignments,[]);
  assert.deepEqual(second.exams,[]);
  assert.deepEqual(second.schedule,[]);
  assert.equal(second.subjects.length,1);
  assert.equal(second.telegram.sections.A,"");
  assert.equal(second.lectures.find(x=>x.id==="old-A"),undefined);
});
