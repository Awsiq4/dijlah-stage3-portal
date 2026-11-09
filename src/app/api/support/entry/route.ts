import {NextRequest,NextResponse} from "next/server";
import {randomBytes} from "node:crypto";
import {BOT_USERNAME,telegramServiceEnabled} from "@/lib/server/flags";
import {checkLoginRateLimit} from "@/lib/server/auth";
import {q} from "@/lib/server/db";
import {hash} from "@/lib/server/support";

export const dynamic="force-dynamic";
const types = ["support","idea","problem"];
const respond=(body:unknown,status=200)=>
  NextResponse.json(body,{status,headers:{"Cache-Control":"no-store, no-cache, must-revalidate","Pragma":"no-cache"}});

export async function POST(req:NextRequest) {
  try {
    if(req.headers.get("origin")!==req.nextUrl.origin || req.headers.get("x-support-entry")!=="1")
      return respond({error:"طلب غير مسموح."},403);
    if(!telegramServiceEnabled() || !/^[A-Za-z0-9_]{5,32}$/.test(BOT_USERNAME))
      return respond({error:"خدمة الدعم غير متاحة مؤقتًا."},503);
    const data=await req.json().catch(()=>null);
    if(!data || !types.includes(data.category))
      return respond({error:"اختر نوع الطلب."},400);
    const source=req.headers.get("x-vercel-forwarded-for")||req.headers.get("x-forwarded-for")||"unknown";
    const rateKey=hash((process.env.SESSION_SECRET||"support")+new Date().toISOString().slice(0,10)+source);
    if(!await checkLoginRateLimit("support:site-entry:"+rateKey,20,3600000))
      return respond({error:"محاولات كثيرة. جرّب بعد فترة."},429);
    // 160 bits, 27 characters base64url, plus 'sd_' fits Telegram's 64-char start payload.
    const token=randomBytes(20).toString("base64url");
    await q(
      "INSERT INTO support_site_entries(token_hash,category,expires_at) VALUES($1,$2,now()+interval '10 minutes')",
      [hash(token),data.category]
    );
    return respond({url:"https://t.me/"+BOT_USERNAME+"?start=sd_"+token});
  } catch {
    return respond({error:"تعذّر فتح الدعم. جرّب مرة ثانية."},500);
  }
}
