import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {extname,join} from "node:path";
import {fileURLToPath} from "node:url";

// All student/admin/bot sources should use one Arabic term: الواجبات / واجب.
// Do not rename database fields or modify student-authored historical content.
const srcRoot=fileURLToPath(new URL("../",import.meta.url));
function allSourceFiles(dir) {
  return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
    const path=join(dir,entry.name);
    if(entry.isDirectory())return allSourceFiles(path);
    return entry.isFile()&&[".ts",".tsx"].includes(extname(path))?[path]:[];
  });
}

test("all site, admin and Telegram source labels say الواجبات instead of التكاليف",()=>{
  for(const path of allSourceFiles(srcRoot)){
    const code=readFileSync(path,"utf8");
    assert.doesNotMatch(code,/التكاليف|تكاليف|التكليف|تكليف/,path);
    assert.doesNotMatch(code,/الواجبات\s+والواجبات|واجبات\s+أو\s+واجبات/,path);
  }
});

test("major navigation labels and sharing metadata consistently use الواجبات",()=>{
  const files=[
    "../app/assignments/page.tsx",
    "../app/more/page.tsx",
    "../app/subjects/[id]/page.tsx",
    "../app/layout.tsx",
    "./server/botx.ts",
    "./server/bot-coursework-manage.ts",
  ];
  for(const file of files){
    const src=readFileSync(fileURLToPath(new URL(file,import.meta.url)),"utf8");
    assert.match(src,/الواجبات/,file);
  }
});
