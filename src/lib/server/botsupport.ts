// Website-gated support inside the EXISTING Telegram bot.
// No public /support command and no support button on ordinary student menus.
// Ticket history is stored in the pre-existing support tables, independent from /start.
import {randomUUID} from "node:crypto";
import {q,qOne} from "./db.ts";
import {BOT_OWNER_ID,BOT_TOKEN,QSTASH_TOKEN,QSTASH_URL,PORTAL_BASE_URL,WORKER_SECRET} from "./flags.ts";
import {sendMessage,tgFetch} from "./telegram.ts";
import {registerUser,notifyOwnerNewUser,isBotOwner} from "./registry.ts";
import {checkLoginRateLimit} from "./auth.ts";
import {
  hash,ticketNumber,categories,statuses,telegramActor,
  createTicket,getTicket,listTickets,reply,changeStatus,attachment,
  type Actor,type Attachment,
} from "./support.ts";

type Sender={id?:number;first_name?:string;last_name?:string;username?:string};
export type SupportTelegramMessage={
  text?:string;caption?:string;
  photo?:Array<{file_id:string;file_size?:number;width?:number;height?:number}>;
  document?:{file_id:string;file_name?:string;mime_type?:string;file_size?:number};
};
type Draft={mode:"create"|"student_reply"|"owner_reply"|"owner_search";category?:string;ticketId?:number};
type SupportKeyboard={inline_keyboard:Array<Array<{text:string;callback_data:string}>>};

const heading:Record<string,string>={support:"💬 تواصل مع الدعم",idea:"💡 اقترح فكرة",problem:"🐞 بلّغ عن مشكلة"};
const ownerID=()=>/^[1-9][0-9]{0,16}$/.test(BOT_OWNER_ID)?Number(BOT_OWNER_ID):0;
const validTicket=(id:number)=>Number.isSafeInteger(id)&&id>0;
const isPrivate=(chatId:number,userId:number)=>Number.isSafeInteger(chatId)&&chatId===userId&&chatId>0;
const displayTime=(d:Date|string)=>new Intl.DateTimeFormat("ar-IQ",{timeZone:"Asia/Baghdad",dateStyle:"short",timeStyle:"short"}).format(new Date(d));
const safeName=(s:unknown)=>String(s??"").replace(/[\r\n<>]/g," ").slice(0,120);
function buttons(rows:Array<Array<{text:string;callback_data:string}>>):SupportKeyboard{return {inline_keyboard:rows};}
function cancelButtons(){return buttons([[{text:"❌ إلغاء",callback_data:"sup:cancel"}]]);}
const ticketButtons=(id:number,owner:boolean,closed=false):SupportKeyboard=>buttons([
  ...(!closed?[[{text:owner?"💬 الرد على الطالب":"↩️ الرد على الإدارة",callback_data:(owner?"sup:o:reply:":"sup:s:reply:")+id}]]:[]),
  ...(owner?[[{text:"⏳ قيد المعالجة",callback_data:"sup:o:status:"+id+":progress"},{text:"✅ تم الحل",callback_data:"sup:o:status:"+id+":resolved"}]]:[]),
  ...(closed?[[{text:"🔄 إعادة فتح الطلب",callback_data:(owner?"sup:o:status:":"sup:s:reopen:")+id+(owner?":progress":"")}]]:[]),
  [{text:owner?"🎫 إدارة الطلبات":"📋 طلباتي",callback_data:owner?"sup:o:home":"sup:s:list:0"}],
]);
const listBack=(owner:boolean)=>buttons([[{text:owner?"🎫 إدارة الدعم":"📋 طلباتي",callback_data:owner?"sup:o:home":"sup:s:list:0"}]]);
async function putDraft(chatId:number,data:Draft,minutes=45){
 await q(`INSERT INTO support_drafts(chat_id,data,expires_at)
   VALUES($1,$2,$3)
   ON CONFLICT(chat_id) DO UPDATE SET data=EXCLUDED.data,expires_at=EXCLUDED.expires_at`,
   [chatId,JSON.stringify(data),new Date(Date.now()+minutes*60000)]);
}
async function currentDraft(chatId:number):Promise<Draft|null>{
 const row=await qOne<{data:Draft|string}>(`SELECT data FROM support_drafts
   WHERE chat_id=$1 AND expires_at>now()`,[chatId]);
 if(!row)return null;
 return typeof row.data==="string"?JSON.parse(row.data) as Draft:row.data;
}
export async function clearSupportDraft(chatId:number){
 await q("DELETE FROM support_drafts WHERE chat_id=$1",[chatId]);
}

export async function redeemSiteSupport(chatId:number,userId:number,rawToken:string,from?:Sender){
 if(!isPrivate(chatId,userId))return;
 if(!/^[A-Za-z0-9_-]{27}$/.test(rawToken||"")){
   await sendMessage(chatId,"⚠️ رابط الدعم غير صالح. افتح قسم الدعم من الموقع مرة ثانية.");
   return;
 }
 const row=await qOne<{category:string}>(`UPDATE support_site_entries
   SET used_at=now(),used_by=$2
   WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now()
   RETURNING category`,[hash(rawToken),userId]);
 if(!row){
   // A Telegram redelivery from the same user must not accidentally erase an
   // already-open draft, but no other account may replay the consumed token.
   const prior=await qOne<{category:string}>(`SELECT category FROM support_site_entries
     WHERE token_hash=$1 AND used_by=$2 AND used_at>now()-interval '2 minutes'`,
     [hash(rawToken),userId]);
   const draft=await currentDraft(chatId);
   if(prior&&draft?.mode==="create"&&draft.category===prior.category){
     await sendMessage(chatId,(heading[draft.category]||"الدعم")+"\nاكتب رسالتك هنا 👇",{replyMarkup:cancelButtons()});
     return;
   }
   await sendMessage(chatId,"⚠️ الرابط منتهي أو مستخدم. افتح «الدعم والاقتراحات» من الموقع من جديد.");
   return;
 }
 const reg=await registerUser(chatId,userId,from?.username,from?.first_name,from?.last_name,null);
 if(reg.isNew) await notifyOwnerNewUser({...reg,username:from?.username,first_name:from?.first_name,last_name:from?.last_name});
 await putDraft(chatId,{mode:"create",category:row.category},120);
 await sendMessage(chatId,(heading[row.category]||"الدعم والاقتراحات")+"\n\nاكتب رسالتك هنا 👇\nتگدر ترسل صورة هم.",{replyMarkup:cancelButtons()});
}

async function receivedPhoto(message:SupportTelegramMessage):Promise<{attachment?:Attachment;fileId?:string}> {
 let fileId:string|undefined;
 let size:number|undefined;
 let filename="support-photo.jpg";
 let mime="image/jpeg";
 if(message.photo?.length){
   const best=[...message.photo].reverse().find(x=>!x.file_size||x.file_size<=2097152);
   if(!best)throw new Error("الصورة كبيرة. أرسل صورة أقل من 2MB.");
   fileId=best.file_id;size=best.file_size;
 }else if(message.document?.mime_type==="image/png"||message.document?.mime_type==="image/jpeg"){
   fileId=message.document.file_id;
   size=message.document.file_size;
   mime=message.document.mime_type;
   filename=(message.document.file_name||"support-photo").slice(0,85);
 }else if(message.document){
   throw new Error("أرسل نصًا أو صورة بصيغة JPG/PNG فقط.");
 }
 if(!fileId)return {};
 if(size&&size>2097152)throw new Error("الصورة كبيرة. الحد 2MB.");
 const lookup=await tgFetch<{file_path:string;file_size?:number}>("getFile",{file_id:fileId});
 if(!lookup.ok||!lookup.result?.file_path)throw new Error("تعذر استلام الصورة. حاول إرسالها مرة ثانية.");
 if(lookup.result.file_size&&lookup.result.file_size>2097152)throw new Error("الصورة كبيرة. الحد 2MB.");
 const path=lookup.result.file_path;
 if(!/^[A-Za-z0-9/_\-.]{1,200}$/.test(path)||path.includes(".."))throw new Error("ملف غير صالح.");
 const control=new AbortController();
 const timer=setTimeout(()=>control.abort(),12000);
 try{
   const response=await fetch("https://api.telegram.org/file/bot"+BOT_TOKEN+"/"+path,{signal:control.signal,cache:"no-store"});
   if(!response.ok)throw new Error("فشل تحميل الصورة.");
   const bytes=Buffer.from(await response.arrayBuffer());
   if(!bytes.length||bytes.length>2097152)throw new Error("الصورة غير صالحة أو أكبر من 2MB.");
   const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
   const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
   if(!png&&!jpeg)throw new Error("الصورة غير صالحة.");
   return {attachment:{name:filename,mime:png?"image/png":"image/jpeg",base64:bytes.toString("base64")},fileId};
 } finally {clearTimeout(timer);}
}
async function saveFileId(ticketId:number,author:string,key:string,fileId?:string) {
 if(!fileId)return;
 await q(`UPDATE support_attachments SET telegram_file_id=$4 WHERE message_id IN
   (SELECT id FROM support_messages WHERE ticket_id=$1 AND author=$2 AND request_key=$3)`,
   [ticketId,author,key,fileId]);
}
async function queue(key:string,id:number,recipient:number,text:string,markup?:SupportKeyboard,mediaFileId?:string) {
 if(!validTicket(id)||!Number.isSafeInteger(recipient)||recipient<=0)return;
 await q(`INSERT INTO support_jobs(event_key,recipient,ticket_id,text,reply_markup,media_file_id)
   VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(event_key) DO NOTHING`,
   [key,recipient,id,text.slice(0,3700),markup?JSON.stringify(markup):null,mediaFileId||null]);
}
async function ticketRecipient(id:number):Promise<number|null> {
 const row=await qOne<{telegram_id:string|null}>(`SELECT i.telegram_id::text AS telegram_id
   FROM support_tickets t JOIN support_identities i ON i.id=t.identity_id
   WHERE t.id=$1`,[id]);
 const parsed=Number(row?.telegram_id);
 return parsed>0&&Number.isSafeInteger(parsed)?parsed:null;
}
async function newOwnerNotification(id:number,category:string,body:string,mediaFileId?:string){
 const owner=ownerID();
 if(!owner)return;
 const row=await qOne<{
   telegram_id:string|null;first_name:string|null;last_name:string|null;
   username:string|null;reg_seq:number|null;section:string|null;created_at:string;
 }>(`SELECT i.telegram_id::text AS telegram_id,s.first_name,s.last_name,s.username,
    s.reg_seq,s.section,t.created_at
   FROM support_tickets t JOIN support_identities i ON i.id=t.identity_id
   LEFT JOIN tg_subscribers s ON s.chat_id=i.telegram_id WHERE t.id=$1`,[id]);
 const name=[row?.first_name,row?.last_name].filter(Boolean).map(safeName).join(" ")||"غير متوفر";
 const username=row?.username?"@"+safeName(row.username):"غير متوفر";
 const msg=[
  "🔔 طلب دعم جديد", "🎫 "+ticketNumber(id),
  "👤 الاسم: "+name,
  "🔗 اليوزر: "+username,
  "🆔 Telegram ID: "+(row?.telegram_id||"غير متوفر"),
  "🔢 تسلسله بالبوت: "+(row?.reg_seq==null?"غير متوفر":"#"+String(row.reg_seq).padStart(6,"0")),
  "🏫 الشعبة: "+(row?.section||"غير محددة"),
  "📂 النوع: "+(categories[category]||"الدعم"),
  "📅 وقت الإرسال: "+displayTime(row?.created_at||new Date()),
  "📝 الرسالة: "+body.slice(0,mediaFileId?360:700),
 ].join("\n");
 const keys=buttons([
  [{text:"💬 الرد",callback_data:"sup:o:reply:"+id}],
  [{text:"⏳ قيد المعالجة",callback_data:"sup:o:status:"+id+":progress"},
   {text:"✅ تم الحل",callback_data:"sup:o:status:"+id+":resolved"}],
  [{text:"📖 عرض الطلب",callback_data:"sup:o:open:"+id},
   {text:"🎫 طلبات الدعم",callback_data:"sup:o:home"}],
 ]);
 await queue("new:"+id,id,owner,msg,keys,mediaFileId);
}

export async function receiveSupportMessage(chatId:number,userId:number,updateId:number,message:SupportTelegramMessage):Promise<boolean>{
 if(!isPrivate(chatId,userId))return false;
 const d=await currentDraft(chatId);
 if(!d)return false;
 const text=String(message.text||message.caption||"").trim();
 if(text.startsWith("/"))return false; // /start and other bot commands retain their normal meaning
 if(!text&&!message.photo?.length&&!message.document)return false;
 if(!Number.isSafeInteger(updateId)||updateId<0)return false;
 if(d.mode==="owner_reply"||d.mode==="owner_search"){
   if(!isBotOwner(userId)) {await clearSupportDraft(chatId);return false;}
 }
 try{
  if(d.mode==="owner_search"){
   if(!text){await sendMessage(chatId,"اكتب اسم الطالب أو رقمه.");return true;}
   await clearSupportDraft(chatId);
   await showOwnerList(chatId,"pending",0,text);
   return true;
  }
  const {attachment:file,fileId}=await receivedPhoto(message);
  const body=(text|| (file?"صورة مرفقة":"")).slice(0,3000);
  if(!body){await sendMessage(chatId,"اكتب رسالة أو أرسل صورة.");return true;}
  const key="tg:update:"+updateId;
  if(d.mode==="create"){
   const actor=await telegramActor(userId);
   const category=d.category||"support";
   if(!categories[category]){await clearSupportDraft(chatId);return true;}
   const subject=body.replace(/\s+/g," ").slice(0,90);
   const result=await createTicket(actor,{category,subject,body,key,file,source:"telegram"});
   await saveFileId(result.id,"student:"+actor.identity,key,fileId);
   await clearSupportDraft(chatId);
   await newOwnerNotification(result.id,category,body,fileId);
   await sendMessage(chatId,"✅ تم استلام طلبك\n🎫 "+ticketNumber(result.id)+"\nراح يوصلك رد الإدارة هنا.",{
     replyMarkup:ticketButtons(result.id,false),
   });
   return true;
  }
  const id=d.ticketId;
  if(!id||!validTicket(id)){await clearSupportDraft(chatId);return true;}
  const owner=d.mode==="owner_reply";
  const actor:Actor=owner?{owner:true,telegramId:userId,permissions:[]}:await telegramActor(userId);
  const detail=await getTicket(actor,id); // enforce ownership or owner role before every mutation
  if(owner&&!(await ticketRecipient(id))){
    await clearSupportDraft(chatId);
    await sendMessage(chatId,"⚠️ هذا الطلب قديم من الموقع وما مرتبط بحساب Telegram، لذلك ما نكدر نرسل رد عبر البوت.");
    return true;
  }
  await reply(actor,id,body,key,false,file);
  await saveFileId(id,owner?"owner":"student:"+actor.identity!,key,fileId);
  await clearSupportDraft(chatId);
  if(owner){
    const recipient=await ticketRecipient(id);
    if(recipient)await queue("reply:"+id+":"+key,id,recipient,
     "💬 رد جديد من إدارة البوابة\n🎫 "+ticketNumber(id)+"\n\n"+body.slice(0,1200),
     ticketButtons(id,false),fileId);
    await sendMessage(chatId,"✅ تم حفظ ردّك على "+ticketNumber(id)+"، وجارٍ إرساله للطالب.",{
      replyMarkup:ticketButtons(id,true),
    });
  }else{
    await queue("studentreply:"+id+":"+key,id,ownerID(),
      "🔔 رد جديد من الطالب\n🎫 "+ticketNumber(id)+"\n\n"+body.slice(0,1200),
      ticketButtons(id,true),fileId);
    await sendMessage(chatId,"✅ وصل ردك للإدارة. راح نرد عليك هنا.",{replyMarkup:ticketButtons(id,false)});
  }
  return true;
 }catch(e){
  const msg=e instanceof Error?e.message:"تعذر إكمال الطلب.";
  await sendMessage(chatId,"⚠️ "+msg.slice(0,200)+"\nجرّب مرة ثانية أو اضغط إلغاء.",{replyMarkup:cancelButtons()});
  return true;
 }
}

async function showStudentList(chatId:number,userId:number,page:number){
 const actor=await telegramActor(userId);
 const data=await listTickets(actor,{page:String(page)});
 const rows=data.rows.filter(t=>t.source==="telegram"||t.source==="web"); // existing linked historical tickets are also accessible
 const kb=rows.map(t=>[{text:ticketNumber(t.id)+" · "+safeName(t.subject).slice(0,32),callback_data:"sup:s:open:"+t.id}]);
 const nav:Array<{text:string;callback_data:string}>=[];
 if(page>0)nav.push({text:"⬅️ السابقة",callback_data:"sup:s:list:"+(page-1)});
 if((page+1)*10<data.total)nav.push({text:"التالية ➡️",callback_data:"sup:s:list:"+(page+1)});
 if(nav.length)kb.push(nav);
 await sendMessage(chatId,"📋 طلباتي ("+data.total+")"+(rows.length?"":"\nما عندك طلبات محفوظة."),{
   replyMarkup:buttons(kb.length?kb:[[{text:"🏠 الرئيسية",callback_data:"nav:home"}]]),
 });
}
async function showOwnerList(chatId:number,group:string,page:number,search=""){
 if(!["pending","waiting","done"].includes(group))group="pending";
 if(!Number.isSafeInteger(page)||page<0||page>999)page=0;
 const data=await listTickets({owner:true,permissions:[]},{page:String(page),...(search?{q:search}:{inbox:group})});
 const items=data.rows.map(t=>[{
   text:ticketNumber(t.id)+" · "+safeName([t.first_name,t.last_name].filter(Boolean).join(" ")||t.username||"طالب")+" · "+(t.effective_section||"—"),
   callback_data:"sup:o:open:"+t.id,
 }]);
 const nav:Array<{text:string;callback_data:string}>=[];
 if(page>0)nav.push({text:"⬅️ السابقة",callback_data:"sup:o:list:"+group+":"+(page-1)});
 if(!search&&(page+1)*10<data.total)nav.push({text:"التالية ➡️",callback_data:"sup:o:list:"+group+":"+(page+1)});
 if(nav.length)items.push(nav);
 items.push([{text:"🎫 لوحة الدعم",callback_data:"sup:o:home"}]);
 await sendMessage(chatId,
   (search?"🔍 نتائج البحث":group==="pending"?"📥 بانتظار ردّك":group==="waiting"?"💬 بانتظار الطالب":"✅ الطلبات المكتملة")+
   " — "+data.total+" طلب", {replyMarkup:buttons(items)});
}
async function showOwnerFilterList(chatId:number,kind:"section"|"category",value:string,page:number){
 if(!Number.isSafeInteger(page)||page<0||page>999)return;
 if(kind==="section"&&!["A","B","C","F","NA"].includes(value))return;
 if(kind==="category"&&!Object.hasOwn(categories,value))return;
 const data=await listTickets({owner:true,permissions:[]},{[kind]:value,page:String(page)});
 const title=kind==="section"?(value==="NA"?"بدون شعبة":"شعبة "+value):categories[value];
 const rows=data.rows.map(t=>[{text:ticketNumber(t.id)+" · "+
   safeName([t.first_name,t.last_name].filter(Boolean).join(" ")||t.username||"طالب"),
   callback_data:"sup:o:open:"+t.id}]);
 const nav:Array<{text:string;callback_data:string}>=[];
 if(page>0)nav.push({text:"⬅️",callback_data:"sup:o:filter:"+kind+":"+value+":"+(page-1)});
 if((page+1)*10<data.total)nav.push({text:"➡️",callback_data:"sup:o:filter:"+kind+":"+value+":"+(page+1)});
 if(nav.length)rows.push(nav);
 rows.push([{text:"⬅️ اختيار آخر",callback_data:"sup:o:choose:"+kind}]);
 await sendMessage(chatId,"📋 "+title+" — "+data.total+" طلب",{replyMarkup:buttons(rows)});
}
async function showOwnerFilterChoices(chatId:number,kind:"section"|"category"){
 const options=kind==="section"
   ?[...["A","B","C","F"].map(v=>({value:v,label:"شعبة "+v})),{value:"NA",label:"بدون شعبة"}]
   :Object.entries(categories).map(([value,label])=>({value,label}));
 await sendMessage(chatId,kind==="section"?"🏫 اختر الشعبة:":"📂 اختر نوع الطلب:",{
   replyMarkup:buttons([
    ...options.map(x=>[{text:x.label,callback_data:"sup:o:filter:"+kind+":"+x.value+":0"}]),
    [{text:"🎫 لوحة الدعم",callback_data:"sup:o:home"}],
   ]),
 });
}
async function showOwnerDashboard(chatId:number){
 const r=await listTickets({owner:true,permissions:[]},{inbox:"pending",page:"0"});
 const counts=r.inboxCounts||{pending:0,waiting:0,done:0};
 const fresh=await qOne<{n:number}>("SELECT count(*)::int AS n FROM support_tickets WHERE status='new'");
 await sendMessage(chatId,"🎫 إدارة الدعم\n🆕 الطلبات الجديدة: "+(fresh?.n||0)+"\nاختر القسم:",{
  replyMarkup:buttons([
   [{text:"📥 بانتظار ردي ("+counts.pending+")",callback_data:"sup:o:list:pending:0"}],
   [{text:"💬 بانتظار الطالب ("+counts.waiting+")",callback_data:"sup:o:list:waiting:0"}],
   [{text:"✅ المكتملة ("+counts.done+")",callback_data:"sup:o:list:done:0"}],
   [{text:"🏫 حسب الشعبة",callback_data:"sup:o:choose:section"},
    {text:"📂 حسب النوع",callback_data:"sup:o:choose:category"}],
   [{text:"🔍 البحث عن طلب",callback_data:"sup:o:search"}],
   [{text:"👑 لوحة المالك",callback_data:"own:home"}],
  ]),
 });
}
async function showTicket(chatId:number,userId:number,id:number,owner:boolean){
 const actor:Actor=owner?{owner:true,permissions:[]}:await telegramActor(userId);
 const data=await getTicket(actor,id);
 const t=data.ticket;
 const student=data.studentProfile;
 const lines=[
  "🎫 "+ticketNumber(id)+" · "+(statuses[t.status]||t.status),
  "📂 "+(categories[t.category]||"طلب دعم"),
 ];
 if(owner)lines.push(
   "👤 "+(student?[student.first_name,student.last_name].filter(Boolean).join(" ")||"غير متوفر":"زائر غير معروف"),
   "🔗 "+(student?.username?"@"+safeName(student.username):"غير متوفر"),
   "🆔 "+(student?.telegram_id||"غير مرتبط"),
   "🔢 "+(student?.reg_seq==null?"غير متوفر":"#"+String(student.reg_seq).padStart(6,"0")),
   "🏫 "+(student?.section||t.section||"غير محددة")
 );
 const last=data.messages.filter(m=>!m.internal).slice(-8);
 for(const m of last){
   lines.push("","— "+(m.sender_type==="student"?"الطالب":"الإدارة")+" · "+displayTime(m.created_at)+" —",m.body.slice(0,550));
 }
 if(data.messages.filter(m=>!m.internal).length>8)lines.push("… عرضت آخر 8 رسائل فقط.");
 const media=await q<{id:string}>(`SELECT a.id FROM support_attachments a
   JOIN support_messages m ON m.id=a.message_id
   WHERE m.ticket_id=$1 AND a.telegram_file_id IS NOT NULL
   ORDER BY m.id DESC LIMIT 3`,[id]);
 const kb=ticketButtons(id,owner,t.status==="closed"||t.status==="resolved").inline_keyboard;
 if(media.length)kb.unshift(...media.map((row,i)=>[{text:"🖼️ عرض صورة "+(i+1),callback_data:"sup:f:"+row.id}]));
 await sendMessage(chatId,lines.join("\n").slice(0,3800),{replyMarkup:buttons(kb)});
}
export async function handleSupportCallback(chatId:number,userId:number,data:string){
 if(!isPrivate(chatId,userId))return;
 if(data==="sup:cancel"){
   await clearSupportDraft(chatId);
   await sendMessage(chatId,"تم الإلغاء. تگدر تستخدم البوت بشكل طبيعي.",{
     replyMarkup:buttons([[{text:"🏠 الرئيسية",callback_data:"nav:home"}]]),
   });
   return;
 }
 const isOwnerAction=data.startsWith("sup:o:");
 if(isOwnerAction&&!isBotOwner(userId)){
   await sendMessage(chatId,"⛔ هذا القسم خاص بالمالك فقط.");
   return;
 }
 if(data==="sup:o:home"){await showOwnerDashboard(chatId);return;}
 const filterChoices=/^sup:o:choose:(section|category)$/.exec(data);
 if(filterChoices){await showOwnerFilterChoices(chatId,filterChoices[1] as "section"|"category");return;}
 const filterList=/^sup:o:filter:(section|category):([A-Za-z_]{1,15}):([0-9]{1,3})$/.exec(data);
 if(filterList){await showOwnerFilterList(chatId,filterList[1] as "section"|"category",filterList[2],Number(filterList[3]));return;}
 if(data==="sup:o:search"){
   await putDraft(chatId,{mode:"owner_search"},20);
   await sendMessage(chatId,"🔍 اكتب اسم الطالب أو يوزره أو رقم التذكرة:",{replyMarkup:cancelButtons()});
   return;
 }
 const ownerList=/^sup:o:list:(pending|waiting|done):([0-9]{1,3})$/.exec(data);
 if(ownerList){await showOwnerList(chatId,ownerList[1],Number(ownerList[2]));return;}
 const studentList=/^sup:s:list:([0-9]{1,3})$/.exec(data);
 if(studentList){await showStudentList(chatId,userId,Number(studentList[1]));return;}
 const ownerStatus=/^sup:o:status:([0-9]{1,12}):(new|progress|awaiting|resolved|closed)$/.exec(data);
 if(ownerStatus){
   const id=Number(ownerStatus[1]);
   if(!validTicket(id))return;
   await changeStatus({owner:true,permissions:[]},id,ownerStatus[2]);
   const recipient=await ticketRecipient(id);
   if(recipient)await queue("status:"+id+":"+ownerStatus[2]+":"+Date.now(),id,recipient,
     "🎫 "+ticketNumber(id)+"\nحالة الطلب: "+statuses[ownerStatus[2]],
     ticketButtons(id,false,["closed","resolved"].includes(ownerStatus[2])));
   await sendMessage(chatId,"✅ تم تحديث حالة "+ticketNumber(id)+".",{replyMarkup:ticketButtons(id,true)});
   return;
 }
 const idMatch=/^sup:(o:open|o:reply|s:open|s:reply|s:reopen):([0-9]{1,12})$/.exec(data);
 if(idMatch){
   const mode=idMatch[1],id=Number(idMatch[2]);
   if(!validTicket(id))return;
   const owner=mode.startsWith("o:");
   if(owner&&!isBotOwner(userId))return;
   const actor:Actor=owner?{owner:true,permissions:[]}:await telegramActor(userId);
   const t=(await getTicket(actor,id)).ticket;
   if(mode==="s:reopen"){
     await changeStatus(actor,id,"progress");
     await putDraft(chatId,{mode:"student_reply",ticketId:id},45);
     await sendMessage(chatId,"اكتب ردك على "+ticketNumber(id)+" 👇",{replyMarkup:cancelButtons()});
     return;
   }
   if(mode.endsWith(":reply")){
     if(["closed","resolved"].includes(t.status)){
       await sendMessage(chatId,"هذا الطلب مكتمل. إذا تريد ترد، افتحه من جديد.",{
         replyMarkup:buttons([[{text:"🔄 إعادة فتح",callback_data:owner?"sup:o:status:"+id+":progress":"sup:s:reopen:"+id}]]),
       });
       return;
     }
     if(owner&&!(await ticketRecipient(id))){
       await sendMessage(chatId,"⚠️ هذا الطلب القديم ما مرتبط بحساب Telegram، ما نكدر نرد عليه من البوت.");
       return;
     }
     await putDraft(chatId,{mode:owner?"owner_reply":"student_reply",ticketId:id},45);
     await sendMessage(chatId,"💬 اكتب ردك على "+ticketNumber(id)+" 👇",{replyMarkup:cancelButtons()});
     return;
   }
   await showTicket(chatId,userId,id,owner);
   return;
 }
 const photo=/^sup:f:([0-9a-f-]{36})$/.exec(data);
 if(photo){
   const actor:Actor=isBotOwner(userId)?{owner:true,permissions:[]}:await telegramActor(userId);
   await attachment(actor,photo[1]); // existing authorization check
   const file=await qOne<{telegram_file_id:string|null}>(`SELECT telegram_file_id
     FROM support_attachments WHERE id=$1`,[photo[1]]);
   if(!file?.telegram_file_id){
     await sendMessage(chatId,"الصورة غير متاحة على Telegram.");return;
   }
   const result=await tgFetch("sendPhoto",{chat_id:chatId,photo:file.telegram_file_id});
   if(!result.ok)await sendMessage(chatId,"تعذّر فتح الصورة حالياً.");
   return;
 }
}

async function scheduleWorker(delaySeconds=0){
 if(!QSTASH_TOKEN||!QSTASH_URL||!WORKER_SECRET)return;
 try{
   await fetch(QSTASH_URL+"/publish",{
     method:"POST",
     headers:{"authorization":"Bearer "+QSTASH_TOKEN,"content-type":"application/json",
       ...(delaySeconds?{"Upstash-Delay":Math.ceil(delaySeconds)+"s"}:{})},
     body:JSON.stringify({url:PORTAL_BASE_URL+"/api/telegram/worker",
       headers:{"x-worker-secret":WORKER_SECRET}}),
   });
 }catch{/* webhook delivery still handles immediate attempts */}
}
export async function drainSupportQueue(limit=12):Promise<{sent:number;retried:number;failed:number}>{
 const due=await q<{id:number;recipient:string|number;ticket_id:number;text:string;
   reply_markup:SupportKeyboard|null;media_file_id:string|null;attempts:number}>(`
     UPDATE support_jobs j SET attempts=j.attempts+1,next_at=now()+interval '3 minutes'
     WHERE j.id IN (
       SELECT id FROM support_jobs
       WHERE sent_at IS NULL AND failed=false AND next_at<=now()
       ORDER BY next_at,id LIMIT $1 FOR UPDATE SKIP LOCKED
     )
     RETURNING j.id,j.recipient,j.ticket_id,j.text,j.reply_markup,j.media_file_id,j.attempts
   `,[Math.min(Math.max(limit,1),30)]);
 let sent=0,retried=0,failed=0;
 for(const job of due){
   const recipient=Number(job.recipient);
   const result=job.media_file_id
     ?await tgFetch("sendPhoto",{chat_id:recipient,photo:job.media_file_id,
       caption:job.text.slice(0,1000),reply_markup:job.reply_markup||undefined})
     :await sendMessage(recipient,job.text,{replyMarkup:job.reply_markup||undefined});
   if(result.ok){
     await q("UPDATE support_jobs SET sent_at=now() WHERE id=$1",[job.id]);sent++;
   }else if(result.error?.code===403||job.attempts>=6){
     await q("UPDATE support_jobs SET failed=true WHERE id=$1",[job.id]);failed++;
   }else{
     const delay=Math.min(3600,Math.max(90,90*(2**Math.min(job.attempts,5)),(result.retryAfter||0)));
     await q("UPDATE support_jobs SET next_at=now()+($2||' seconds')::interval WHERE id=$1",[job.id,String(delay)]);
     await scheduleWorker(delay+5);
     retried++;
   }
 }
 return {sent,retried,failed};
}
export async function wakeSupportDelivery(){
 await scheduleWorker(0);
 return drainSupportQueue(10);
}
