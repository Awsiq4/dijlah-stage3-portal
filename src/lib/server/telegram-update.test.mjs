import {test} from "node:test";
import assert from "node:assert/strict";
import {privateTelegramUpdate, readTelegramUpdateBody, TelegramUpdateBodyError, MAX_TELEGRAM_UPDATE_BYTES} from "./telegram-update.ts";
const msg=()=>({update_id:1,message:{chat:{id:10,type:"private"},from:{id:10,username:"synthetic"},text:"/start"}});
const cb=()=>({update_id:2,callback_query:{id:"synthetic-callback",from:{id:10},message:{chat:{id:10,type:"private"}},data:"pub:lec:nonce"}});
test("Telegram update validation preserves supported private text, attachment and callback shapes",()=>{
  for (const value of [msg(),cb(),{...msg(),message:{...msg().message,document:{file_id:"safe-file",file_name:"x.pdf",file_size:50}}}])
    assert.equal(privateTelegramUpdate(value),value);
});
test("Telegram update validation rejects missing, unsafe and cross-user identities before dispatch",()=>{
  const values=[null,[],{...msg(),update_id:-1},{...msg(),update_id:"1"},
    {...msg(),message:{...msg().message,from:undefined}},
    {...msg(),message:{...msg().message,from:{id:11}}},
    {...msg(),message:{...msg().message,chat:{id:10,type:"group"}}},
    {...cb(),callback_query:{...cb().callback_query,from:{id:11}}},
    {...cb(),callback_query:{...cb().callback_query,data:"ع".repeat(33)}},
    {...msg(),message:{...msg().message,document:{file_id:{unsafe:1}}}},
    {...msg(),message:{...msg().message,photo:[null]}},
    {...msg(),callback_query:cb().callback_query}];
  for (const value of values) assert.equal(privateTelegramUpdate(value),null);
});
test("Telegram body reader parses bounded JSON and rejects invalid JSON",async()=>{
  assert.deepEqual(await readTelegramUpdateBody(new Request("https://test.invalid",{method:"POST",body:JSON.stringify(msg())})),msg());
  await assert.rejects(()=>readTelegramUpdateBody(new Request("https://test.invalid",{method:"POST",body:"{"})),e=>e instanceof TelegramUpdateBodyError&&e.status===400);
});
test("Telegram body reader enforces declared and streamed size limits",async()=>{
  await assert.rejects(()=>readTelegramUpdateBody(new Request("https://test.invalid",{method:"POST",body:"{}",headers:{"content-length":String(MAX_TELEGRAM_UPDATE_BYTES+1)}})),e=>e.status===413);
  let cancelled=false;
  const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(MAX_TELEGRAM_UPDATE_BYTES));controller.enqueue(new Uint8Array(1));},cancel(){cancelled=true;}});
  await assert.rejects(()=>readTelegramUpdateBody(new Request("https://test.invalid",{method:"POST",body:stream,duplex:"half"})),e=>e.status===413);
  assert.equal(cancelled,true);
});
