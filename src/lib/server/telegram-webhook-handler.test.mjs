import {test} from "node:test";
import assert from "node:assert/strict";
import {registerHooks} from "node:module";
import {fileURLToPath,pathToFileURL} from "node:url";
import path from "node:path";

// Resolve the production Next/TypeScript aliases without rewriting route logic.
// All network and database operations below are forbidden test doubles.
const sourceRoot=fileURLToPath(new URL("../../",import.meta.url));
registerHooks({resolve(specifier,context,nextResolve){
  if(specifier.startsWith("@/"))return nextResolve(pathToFileURL(path.join(sourceRoot,specifier.slice(2)+".ts")).href,context);
  if(specifier==="next/server")return nextResolve("next/server.js",context);
  return nextResolve(specifier,context);
}});
process.env.DATABASE_URL="postgres://synthetic.invalid/test";
process.env.TELEGRAM_BOT_ENABLED="true";
process.env.TELEGRAM_BOT_TOKEN="synthetic-test-token";
process.env.TELEGRAM_BOT_USERNAME="synthetic_bot";
process.env.TELEGRAM_WEBHOOK_SECRET="synthetic-webhook-secret";
process.env.BOT_OWNER_ID="10";
const {NextRequest}=await import("next/server.js");
const {setPoolForTests}=await import("./db.ts");
const {POST}=await import("../../app/api/telegram/webhook/route.ts");
const {MAX_TELEGRAM_UPDATE_BYTES}=await import("./telegram-update.ts");
let effects=0;
setPoolForTests({query:async()=>{effects++;throw new Error("database must not be touched");},connect:async()=>{effects++;throw new Error("database must not be touched");}});
globalThis.fetch=async()=>{effects++;throw new Error("network must not be touched");};
const request=(body,secret="synthetic-webhook-secret",headers={})=>new NextRequest("https://portal.example.invalid/api/telegram/webhook",{
  method:"POST",headers:{"content-type":"application/json",...(secret===null?{}:{"x-telegram-bot-api-secret-token":secret}),...headers},body});

test("actual Telegram webhook route rejects absent and forged secrets before side effects",async()=>{
  for(const secret of [null,"forged-secret"]){
    const response=await POST(request("{}",secret));
    assert.equal(response.status,401);
  }
  assert.equal(effects,0);
});
test("actual Telegram webhook route rejects malformed and oversized authenticated bodies before side effects",async()=>{
  assert.equal((await POST(request("{"))).status,400);
  assert.equal((await POST(request("{}",undefined,{"content-length":String(MAX_TELEGRAM_UPDATE_BYTES+1)}))).status,413);
  assert.equal((await POST(request("x".repeat(MAX_TELEGRAM_UPDATE_BYTES+1)))).status,413);
  assert.equal(effects,0);
});
test("actual Telegram webhook route ignores group, missing-sender and cross-user updates before side effects",async()=>{
  for(const value of [
    {update_id:1,message:{chat:{id:10,type:"group"},from:{id:10},text:"/start"}},
    {update_id:2,message:{chat:{id:10,type:"private"},text:"/start"}},
    {update_id:3,message:{chat:{id:10,type:"private"},from:{id:11},text:"/start"}},
    {update_id:4,callback_query:{id:"synthetic",from:{id:11},message:{chat:{id:10,type:"private"}},data:"own:users:0"}},
  ]){
    assert.equal((await POST(request(JSON.stringify(value)))).status,200);
  }
  assert.equal(effects,0);
});


test("actual Telegram owner callbacks reject another user and owner in another private destination",async()=>{
  const {handleOwnerCallback}=await import("./botowner.ts");
  const originalFetch=globalThis.fetch;
  const messages=[];
  globalThis.fetch=async(_url,options)=>{
    messages.push(JSON.parse(options.body));
    return {ok:true,json:async()=>({ok:true,result:{message_id:1}})};
  };
  try {
    await handleOwnerCallback(11,11,"own:users:0");
    await handleOwnerCallback(11,10,"own:users:0");
    assert.equal(messages.length,2);
    assert.ok(messages.every(message=>message.text.includes("المالك فقط")));
    assert.equal(effects,0,"unauthorized owner actions must not query user data");
  } finally {globalThis.fetch=originalFetch;}
});
