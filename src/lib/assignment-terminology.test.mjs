import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

// The same student-facing concept must always be labelled "الواجبات"
// in the site, admin workspace and Telegram publishing/management menus.
const files=[
  "../app/assignments/page.tsx",
  "../app/subjects/[id]/page.tsx",
  "../app/more/page.tsx",
  "../app/page.tsx",
  "../app/admin/assignment-form.tsx",
  "../app/admin/content-navigation.tsx",
  "./server/botx.ts",
  "./server/bot-assignment-flow.ts",
  "./server/bot-coursework-manage.ts",
  "./server/publish.ts",
];

test("site and bot never call assignments التكاليف or تكليف",()=>{
  for(const path of files) {
    const src=readFileSync(fileURLToPath(new URL(path,import.meta.url)),"utf8");
    assert.doesNotMatch(src,/التكاليف|تكاليف|التكليف|تكليف/,path);
    assert.doesNotMatch(src,/الواجبات\s+والواجبات|واجبات\s+أو\s+واجبات/,path);
  }
});

test("major student navigation and Telegram management clearly say الواجبات",()=>{
  for(const path of ["../app/assignments/page.tsx","../app/more/page.tsx",
    "../app/subjects/[id]/page.tsx","./server/botx.ts",
    "./server/bot-coursework-manage.ts"]) {
    const src=readFileSync(fileURLToPath(new URL(path,import.meta.url)),"utf8");
    assert.match(src,/الواجبات/,path);
  }
});
