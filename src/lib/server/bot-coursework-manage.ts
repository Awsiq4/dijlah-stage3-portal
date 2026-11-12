// Management of already-published quizzes and coursework from the existing bot.
// This is deliberately separate from creating an exam/assignment and from the
// university Midterm/Final timetable. All writes are ownership + RBAC checked.
import {randomBytes} from "node:crypto";
import {q, qOne, withTx, type Queryer} from "./db.ts";
import {sendMessage} from "./telegram.ts";
import {audit} from "./content.ts";
import {canManageAllContent, canModifyContent, canWriteContentRecord, isActive, type AdminInfo} from "./rbac.ts";
import {validAudience} from "./publisher-audience.ts";
import {validExamDay,validExamTime,validExamSchedule} from "./exam-validation.ts";
import {assignmentDayAllowed,assignmentDisplayDay,baghdadToday} from "../assignment-date.ts";
import {safeFileUrl} from "../safe-url.ts";
import {PORTAL_BASE_URL} from "./flags.ts";

export type CourseworkKind = "a" | "q"; // assignment / daily quiz
export type CourseworkRow = Record<string,unknown> & {
  id:string; title:string; subject_id:string; sections:string[];
  created_by:number|null; archived_at:string|null;
};
type Field = "title"|"instructions"|"due_at"|"submission"|"attachment_url"|
  "date"|"start_time"|"room"|"topics"|"notes"|"status"|"sections";
type Result = {ok:true;row?:CourseworkRow}|{ok:false;error:string};
const FIELDS:Record<CourseworkKind,Field[]>={
  a:["title","instructions","due_at","submission","attachment_url","status","sections"],
  q:["title","date","start_time","room","topics","notes","status","sections"],
};
const NAMES:Record<Field,string>={
  title:"العنوان",instructions:"تعليمات التكليف",due_at:"آخر يوم للتسليم",
  submission:"طريقة التسليم",attachment_url:"رابط المرفق",
  date:"تاريخ الكوز",start_time:"وقت الكوز",room:"القاعة",
  topics:"المواضيع",notes:"ملاحظات",status:"الحالة",sections:"الشعب",
};
const ALL=["A","B","C","F"];
const PAGE_SIZE=6;
const nav={inline_keyboard:[[{text:"🏠 الرئيسية",callback_data:"nav:home"}]]};
const table=(kind:CourseworkKind)=>kind==="a"?"portal_assignments":"portal_exams";
const label=(kind:CourseworkKind)=>kind==="a"?"📋 الواجبات والتكاليف":"📝 الكوزات اليومية";
const ownerName=(row:CourseworkRow)=>row.archived_at?"مؤرشف":row.status==="cancelled"?"ملغى":row.status==="closed"?"منتهٍ":"منشور";
const formatValue=(field:Field,value:unknown):string=>field==="sections"?
  (Array.isArray(value)?value.join("، "):"") : field==="due_at"?
  assignmentDisplayDay(value) : String(value??"");
const same=(a:unknown,b:unknown):boolean=>JSON.stringify(a??null)===JSON.stringify(b??null);

export function validManageKind(value:string):value is CourseworkKind {return value==="a"||value==="q";}
function permitted(admin:AdminInfo,kind:CourseworkKind,row:CourseworkRow):boolean {
  if(!isActive(admin)||!canModifyContent(admin,row))return false;
  if(kind==="q" && row.type!=="كوز يومي")return false;
  return canWriteContentRecord(admin,kind==="a"?"assignments":"exams",row);
}
export async function listCoursework(admin:AdminInfo,kind:CourseworkKind,page=0):
  Promise<{rows:CourseworkRow[];total:number}> {
  if(!isActive(admin))return {rows:[],total:0};
  const privileged=canManageAllContent(admin.role);
  const conditions=[...(kind==="q"?["type='كوز يومي'"]:[]),...(!privileged?["created_by=$1"]:[])];
  const base:unknown[]=privileged?[]:[admin.id];
  const where=conditions.length?"WHERE "+conditions.join(" AND "):"";
  const name=table(kind);
  const total=(await qOne<{n:number}>(`SELECT count(*)::int AS n FROM ${name} ${where}`,base))?.n||0;
  const current=Math.min(Math.max(page,0),1000);
  const rows=await q<CourseworkRow>(`SELECT * FROM ${name} ${where}
     ORDER BY id DESC LIMIT $${base.length+1} OFFSET $${base.length+2}`,
     [...base,PAGE_SIZE,current*PAGE_SIZE]);
  return {rows:rows.filter(row=>permitted(admin,kind,row)),total};
}
export async function getCoursework(admin:AdminInfo,kind:CourseworkKind,id:string,
    db:Queryer={q,qOne}):Promise<CourseworkRow|null>{
  if(!isActive(admin)||!id||id.length>160)return null;
  const row=await db.qOne<CourseworkRow>(`SELECT * FROM ${table(kind)} WHERE id=$1`,[id]);
  return row&&permitted(admin,kind,row)?row:null;
}
function cleanValue(kind:CourseworkKind,field:Field,input:unknown):{value:unknown;error?:string}{
  if(!FIELDS[kind].includes(field))return {value:null,error:"الحقل غير متاح"};
  if(field==="sections"){
    if(!Array.isArray(input)||!input.length||new Set(input).size!==input.length||
       !input.every(s=>typeof s==="string"&&ALL.includes(s)))return {value:null,error:"شعب غير صالحة"};
    return {value:input};
  }
  const s=String(input??"").trim();
  const max:Partial<Record<Field,number>>={
    title:180,instructions:3000,submission:500,attachment_url:1000,
    room:120,topics:3000,notes:3000,
  };
  if(max[field]&&s.length>max[field]!)return {value:null,error:"النص أطول من المسموح"};
  if((field==="title"||field==="instructions")&&!s)return {value:null,error:"هذا الحقل ما يصير فارغ"};
  if(field==="due_at"&&!assignmentDayAllowed(s))return {value:null,error:"اكتب تاريخ اليوم أو بعده YYYY-MM-DD، بدون ساعة"};
  if(field==="date"&&(!validExamDay(s)||s<baghdadToday()))return {value:null,error:"اكتب تاريخاً صحيحاً اليوم أو بعده YYYY-MM-DD"};
  if(field==="start_time"&&!validExamTime(s))return {value:null,error:"اكتب الوقت HH:mm بتوقيت بغداد"};
  if(field==="status"){
    const available=kind==="a"?["active","closed","cancelled"]:["confirmed","provisional","cancelled"];
    if(!available.includes(s))return {value:null,error:"الحالة غير صالحة"};
  }
  if(field==="attachment_url" && s && (!/^https:\/\//i.test(s)||!safeFileUrl(s)))return {value:null,error:"أرسل رابط HTTPS صالحاً"};
  return {value:s};
}
export async function changeCoursework(admin:AdminInfo,kind:CourseworkKind,id:string,
 field:Field,raw:unknown,expected:unknown):Promise<Result> {
  if(!isActive(admin))return {ok:false,error:"الحساب غير مفعل"};
  const {value,error}=cleanValue(kind,field,raw);
  if(error)return {ok:false,error};
  return withTx<Result>(async tx=>{
    const row=await getCoursework(admin,kind,id,tx);
    if(!row)return {ok:false,error:"المنشور غير موجود أو ما عندك صلاحية"};
    if(!same(row[field],expected))return {ok:false,error:"تغيرت بيانات المنشور من حساب آخر. افتح المنشور مجدداً"};
    const proposed={...row,[field]:value} as CourseworkRow;
    if(!permitted(admin,kind,proposed))return {ok:false,error:"التعديل خارج صلاحية حسابك"};
    if(field==="sections"&&!validAudience(admin,String(row.subject_id),value as string[]))
      return {ok:false,error:"الشعب مو ضمن صلاحياتك"};
    if(kind==="q"){
      const scheduleError=validExamSchedule(proposed,false);
      if(scheduleError)return {ok:false,error:scheduleError};
    }
    await tx.q(`UPDATE ${table(kind)} SET ${field}=$2 WHERE id=$1`,[id,field==="sections"?JSON.stringify(value):value]);
    await audit(admin.email||`admin#${admin.id}`,"content.edit.telegram.coursework",
      {kind,id,field},tx);
    return {ok:true,row:proposed};
  }).catch(()=>({ok:false,error:"تعذّر حفظ التعديل، حاول مرة ثانية"}));
}
export async function archiveCoursework(admin:AdminInfo,kind:CourseworkKind,id:string,
 archive:boolean):Promise<Result>{
  if(!isActive(admin))return {ok:false,error:"الحساب غير مفعل"};
  return withTx<Result>(async tx=>{
    const row=await getCoursework(admin,kind,id,tx);
    if(!row)return {ok:false,error:"المنشور غير موجود أو ما عندك صلاحية"};
    if(Boolean(row.archived_at)===archive)return {ok:true,row};
    await tx.q(`UPDATE ${table(kind)} SET archived_at=$2 WHERE id=$1`,
      [id,archive?new Date().toISOString():null]);
    await audit(admin.email||`admin#${admin.id}`,
      archive?"content.archive.telegram.coursework":"content.restore.telegram.coursework",{kind,id},tx);
    return {ok:true,row:{...row,archived_at:archive?new Date().toISOString():null}};
  }).catch(()=>({ok:false,error:"تعذّرت العملية"}));
}
export async function deleteCoursework(admin:AdminInfo,kind:CourseworkKind,id:string):Promise<Result>{
  if(!isActive(admin))return {ok:false,error:"الحساب غير مفعل"};
  return withTx<Result>(async tx=>{
    const row=await getCoursework(admin,kind,id,tx);
    if(!row)return {ok:false,error:"المنشور غير موجود أو ما عندك صلاحية"};
    await tx.q(`DELETE FROM ${table(kind)} WHERE id=$1`,[id]);
    await audit(admin.email||`admin#${admin.id}`,
      "content.delete.telegram.coursework",{kind,id,title:row.title},tx);
    return {ok:true};
  }).catch(()=>({ok:false,error:"تعذّر الحذف"}));
}
const short=(text:unknown,length=110)=>String(text??"").slice(0,length);
function itemButtons(kind:CourseworkKind,id:string,archived:boolean){
  return {inline_keyboard:[
    [{text:"✏️ تعديل",callback_data:`cw:ed:${kind}:${id}`}],
    [{text:archived?"♻️ استعادة":"🗄 أرشفة",callback_data:`cw:${archived?"rs":"ac"}:${kind}:${id}`}],
    [{text:"🗑 حذف نهائي",callback_data:`cw:dl:${kind}:${id}`}],
    [{text:"🔙 منشوراتي",callback_data:`cw:p:${kind}:0`}],
    ...nav.inline_keyboard,
  ]};
}
async function showItem(chatId:number,admin:AdminInfo,kind:CourseworkKind,id:string){
  const row=await getCoursework(admin,kind,id);
  if(!row){await sendMessage(chatId,"⚠️ المنشور غير موجود أو ما عندك صلاحية عليه.",{replyMarkup:nav});return;}
  const sections=Array.isArray(row.sections)?row.sections.join("، "):"—";
  const body=kind==="a"?
    `📄 التعليمات: ${short(row.instructions,900)}\n📅 آخر يوم للتسليم: ${assignmentDisplayDay(row.due_at)}\n📨 التسليم: ${short(row.submission)||"غير محدد"}\n📎 مرفق: ${row.attachment_url?"موجود":"لا يوجد"}`:
    `📅 اليوم: ${short(row.date)}\n🕘 الوقت: ${short(row.start_time)}\n🏫 القاعة: ${short(row.room)||"غير محددة"}\n📖 المواضيع: ${short(row.topics,900)||"غير محددة"}\n🗒 الملاحظات: ${short(row.notes,300)||"لا توجد"}`;
  await sendMessage(chatId,`${label(kind)}\n\n${short(row.title,180)}\n📘 المادة: ${short(row.subject_id,100)}
🎯 الشعب: ${sections}\n📌 الحالة: ${ownerName(row)}\n${body}\n\n🔗 ${PORTAL_BASE_URL}/${kind==="a"?"assignments":"exams"}`,
      {replyMarkup:itemButtons(kind,id,Boolean(row.archived_at))});
}
function fieldButtons(kind:CourseworkKind,id:string) {
  return {inline_keyboard:[
    ...FIELDS[kind].map((field,index)=>[{text:"✏️ "+NAMES[field],callback_data:`cw:f:${kind}:${index}:${id}`}]),
    [{text:"🔙 المنشور",callback_data:`cw:i:${kind}:${id}`}],...nav.inline_keyboard,
  ]};
}
async function showList(chatId:number,admin:AdminInfo,kind:CourseworkKind,page:number) {
  const current=Math.max(0,Math.min(1000,page));
  const {rows,total}=await listCoursework(admin,kind,current);
  const rowsKeyboard=rows.map(row=>[{text:`${kind==="a"?"📋":"📝"} ${short(row.title,26)}${row.archived_at?" 🗄":""}`,
    callback_data:`cw:i:${kind}:${row.id}`}]);
  const pages=[];
  if(current>0)pages.push({text:"⬅️ السابق",callback_data:`cw:p:${kind}:${current-1}`});
  if((current+1)*PAGE_SIZE<total)pages.push({text:"التالي ➡️",callback_data:`cw:p:${kind}:${current+1}`});
  await sendMessage(chatId,rows.length?`${label(kind)} — صفحة ${current+1} (المجموع ${total})`:
    "لا توجد منشورات من هذا النوع ضمن صلاحياتك.",{replyMarkup:{inline_keyboard:[
    ...rowsKeyboard,...(pages.length?[pages]:[]),
    [{text:"🔙 إدارة منشوراتي",callback_data:"adm:my"}],...nav.inline_keyboard,
  ]}});
}
function stateButtons(kind:CourseworkKind){
  const statuses=kind==="a"?[
    ["✅ نشط","active"],["📦 منتهٍ","closed"],["🚫 ملغى","cancelled"]
  ]:[["✅ مؤكد","confirmed"],["⏳ مبدئي","provisional"],["🚫 ملغى","cancelled"]];
  return statuses;
}
type ManageState={flow:string|null;data:Record<string,unknown>}|null;
async function presentProposed(chatId:number,data:Record<string,unknown>,next:unknown){
  const {setFlowState}=await import("./bot.ts");
  const nonce=randomBytes(8).toString("hex");
  const d:Record<string,unknown>={...data,step:"confirm",nonce,nextValue:next};
  await setFlowState(chatId,"manage-coursework",d);
  const field=String(d.field) as Field;
  await sendMessage(chatId,`✏️ تأكيد تعديل ${NAMES[field]}\n\nقبل: ${formatValue(field,d.oldValue)||"—"}\nبعد: ${formatValue(field,next)||"—"}\n\nما راح ينحفظ إلا بعد التأكيد.`,
    {replyMarkup:{inline_keyboard:[
      [{text:"✅ حفظ التعديل",callback_data:"cw:ok:"+nonce}],
      [{text:"❌ إلغاء",callback_data:`cw:i:${d.kind}:${d.id}`}],
    ]}});
}
export async function handleCourseworkMessage(chatId:number,userId:number,text:string){
  const {getLinkedAdmin,getFlowState}=await import("./bot.ts");
  const admin=await getLinkedAdmin(userId),state=await getFlowState(chatId);
  if(!admin||state?.flow!=="manage-coursework"||state.data.step!=="input")return;
  const d=state.data,field=String(d.field) as Field;
  if(String(d.actor)!==String(admin.id)) {
    await sendMessage(chatId,"⛔ هاي المسودة تخص ناشراً آخر.");return;
  }
  if(!FIELDS[d.kind as CourseworkKind]?.includes(field))return;
  const value=text.trim();
  if(!value){await sendMessage(chatId,"اكتب قيمة غير فارغة، أو اختر إلغاء.");return;}
  const clearable:Field[]=["submission","attachment_url","room","topics","notes"];
  const input=clearable.includes(field)&&["تخطي","تخطى","بدون","-"].includes(value)?"":value;
  const cleaned=cleanValue(d.kind as CourseworkKind,field,input);
  if(cleaned.error){await sendMessage(chatId,"⚠️ "+cleaned.error);return;}
  await presentProposed(chatId,d,cleaned.value);
}
export async function resumeCourseworkEdit(chatId:number,userId:number){
  const {getLinkedAdmin,getFlowState}=await import("./bot.ts");
  const admin=await getLinkedAdmin(userId),state=await getFlowState(chatId);
  if(!admin||state?.flow!=="manage-coursework")return;
  const d=state.data,field=String(d.field) as Field;
  if(String(d.actor)!==String(admin.id))return;
  if(d.step==="input"){
    await sendMessage(chatId,`✏️ أرسل ${NAMES[field]} الجديد. ${field==="due_at"?"مثال: 2026-11-20 (بدون ساعة)":field==="date"?"مثال: 2026-11-20":field==="start_time"?"مثال: 09:30":""}`);
  } else if(d.step==="confirm")await presentProposed(chatId,d,d.nextValue);
  else if(d.step==="delete")await sendMessage(chatId,"هناك تأكيد حذف مفتوح. استخدم زر التأكيد أو الإلغاء.");
}
export async function handleCourseworkCallback(chatId:number,userId:number,data:string){
  const {getLinkedAdmin,getFlowState,setFlowState}=await import("./bot.ts");
  const admin=await getLinkedAdmin(userId);
  if(!admin||!isActive(admin)) {await sendMessage(chatId,"⛔ حسابك غير مخوّل.",{replyMarkup:nav});return;}
  if(data.startsWith("cw:p:")){
    const [, ,kind,page]=data.split(":");
    if(validManageKind(kind))await showList(chatId,admin,kind,Number(page)||0);
    return;
  }
  if(data.startsWith("cw:i:")){
    const [, ,kind,...ids]=data.split(":");
    if(!validManageKind(kind))return;
    await setFlowState(chatId,"",{});
    await showItem(chatId,admin,kind,ids.join(":"));return;
  }
  if(data.startsWith("cw:ed:")){
    const [, ,kind,...ids]=data.split(":");
    if(!validManageKind(kind))return;
    const id=ids.join(":");
    if(!await getCoursework(admin,kind,id)){await sendMessage(chatId,"هذا المنشور مو ضمن صلاحياتك.");return;}
    await sendMessage(chatId,"اختَر الحقل اللي تريد تعدّله:",{replyMarkup:fieldButtons(kind,id)});return;
  }
  if(data.startsWith("cw:f:")){
    const [, ,kind,index,...ids]=data.split(":");
    if(!validManageKind(kind))return;
    const id=ids.join(":"),field=FIELDS[kind][Number(index)];
    if(!field)return;
    const row=await getCoursework(admin,kind,id);
    if(!row){await sendMessage(chatId,"هذا المنشور مو ضمن صلاحياتك.");return;}
    const d={kind,id,field,oldValue:row[field],step:"input",actor:admin.id};
    if(field==="sections"){
      const options=[{key:"all",sections:[...ALL]},...ALL.map(section=>({key:section,sections:[section]}))]
        .filter(x=>validAudience(admin,String(row.subject_id),x.sections));
      await setFlowState(chatId,"manage-coursework",{...d,step:"choice"});
      await sendMessage(chatId,"🎯 اختَر الشعب الجديدة:",{replyMarkup:{inline_keyboard:[
        ...options.map(x=>[{text:x.key==="all"?"🌐 جميع الشعب":"شعبة "+x.key,
          callback_data:`cw:v:${x.key}`}]),
        [{text:"❌ إلغاء",callback_data:`cw:i:${kind}:${id}`}],
      ]}});return;
    }
    if(field==="status"){
      await setFlowState(chatId,"manage-coursework",{...d,step:"choice"});
      await sendMessage(chatId,"📌 اختَر الحالة الجديدة:",{replyMarkup:{inline_keyboard:[
        ...stateButtons(kind).map(([name,value])=>[{text:name,callback_data:"cw:v:"+value}]),
        [{text:"❌ إلغاء",callback_data:`cw:i:${kind}:${id}`}],
      ]}});return;
    }
    await setFlowState(chatId,"manage-coursework",d);
    await sendMessage(chatId,`✏️ اكتب ${NAMES[field]} الجديد.${field==="due_at"?"\n📅 تاريخ فقط YYYY-MM-DD بدون ساعة.":field==="date"?"\n📅 YYYY-MM-DD":field==="start_time"?"\n🕘 HH:mm (بتوقيت بغداد)":""}${["submission","attachment_url","room","topics","notes"].includes(field)?"\nأرسل «بدون» لمسح الحقل.":""}`,
      {replyMarkup:{inline_keyboard:[[{text:"❌ إلغاء",callback_data:`cw:i:${kind}:${id}`}] ]}});
    return;
  }
  if(data.startsWith("cw:v:")){
    const state=await getFlowState(chatId),d=state?.data;
    if(state?.flow!=="manage-coursework"||d?.step!=="choice"||String(d.actor)!==String(admin.id))return;
    const kind=d.kind as CourseworkKind,field=d.field as Field;
    const key=data.slice("cw:v:".length);
    const value=field==="sections"?(key==="all"?[...ALL]:[key]):key;
    const clean=cleanValue(kind,field,value);
    if(clean.error){await sendMessage(chatId,"⚠️ "+clean.error);return;}
    const row=await getCoursework(admin,kind,String(d.id));
    if(!row)return;
    if(field==="sections"&&!validAudience(admin,String(row.subject_id),clean.value as string[])){
      await sendMessage(chatId,"هذه الشعبة خارج صلاحياتك.");return;
    }
    await presentProposed(chatId,d,clean.value);return;
  }
  if(data.startsWith("cw:ok:")){
    const state=await getFlowState(chatId),d=state?.data;
    if(state?.flow!=="manage-coursework"||d?.step!=="confirm"||
       data!=="cw:ok:"+d.nonce||String(d.actor)!==String(admin.id)){
      await sendMessage(chatId,"هذا تأكيد قديم. افتح المنشور مجدداً.");return;
    }
    const kind=d.kind as CourseworkKind,id=String(d.id),field=d.field as Field;
    const result=await changeCoursework(admin,kind,id,field,d.nextValue,d.oldValue);
    if(result.ok) {
      await setFlowState(chatId,"",{});
      await sendMessage(chatId,"✅ تم حفظ التعديل.",{replyMarkup:{inline_keyboard:[
        [{text:"📄 عرض المنشور",callback_data:`cw:i:${kind}:${id}`}],...nav.inline_keyboard,
      ]}});
    }else await sendMessage(chatId,"⛔ "+result.error);
    return;
  }
  if(data.startsWith("cw:ac:")||data.startsWith("cw:rs:")){
    const [,action,kind,...ids]=data.split(":");
    if(!validManageKind(kind))return;
    const result=await archiveCoursework(admin,kind,ids.join(":"),action==="ac");
    await sendMessage(chatId,result.ok?(action==="ac"?"🗄 تمت الأرشفة؛ اختفى من صفحات الطلاب.":"♻️ تمت الاستعادة."):
      "⛔ "+result.error,{replyMarkup:{inline_keyboard:[[{text:"🔙 رجوع",callback_data:`cw:i:${kind}:${ids.join(":")}`}],...nav.inline_keyboard]}});
    return;
  }
  if(data.startsWith("cw:dl:")){
    const [, ,kind,...ids]=data.split(":");
    if(!validManageKind(kind))return;
    const id=ids.join(":"),row=await getCoursework(admin,kind,id);
    if(!row){await sendMessage(chatId,"المنشور مو موجود أو مو ضمن صلاحياتك.");return;}
    const nonce=randomBytes(8).toString("hex");
    await setFlowState(chatId,"manage-coursework",{step:"delete",kind,id,nonce,actor:admin.id});
    await sendMessage(chatId,`⚠️ حذف نهائي؟\n${short(row.title)}\nهذا الحذف لا يمكن التراجع عنه.`,
      {replyMarkup:{inline_keyboard:[
        [{text:"🗑 نعم، حذف نهائي",callback_data:"cw:yes:"+nonce}],
        [{text:"❌ إلغاء",callback_data:`cw:i:${kind}:${id}`}],
      ]}});
    return;
  }
  if(data.startsWith("cw:yes:")){
    const state=await getFlowState(chatId),d=state?.data;
    if(state?.flow!=="manage-coursework"||d?.step!=="delete"||
      data!=="cw:yes:"+d.nonce||String(d.actor)!==String(admin.id)){
      await sendMessage(chatId,"هذا تأكيد قديم. افتح المنشور مجدداً.");return;
    }
    const kind=d.kind as CourseworkKind;
    const result=await deleteCoursework(admin,kind,String(d.id));
    if(result.ok){
      await setFlowState(chatId,"",{});
      await sendMessage(chatId,"🗑 تم حذف المنشور نهائياً.",{replyMarkup:{inline_keyboard:[
        [{text:"🗂 إدارة منشوراتي",callback_data:"adm:my"}],...nav.inline_keyboard,
      ]}});
    }else await sendMessage(chatId,"⛔ "+result.error);
  }
}
