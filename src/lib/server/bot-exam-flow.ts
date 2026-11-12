// Telegram wizard for upcoming exams/quizzes — separate from PAST question papers.
// Reuses the existing bot session state, publisher roles and notification preferences.
import {randomBytes} from "node:crypto";
import {q, qOne} from "./db.ts";
import {sendMessage} from "./telegram.ts";
import {canPublishMaterial, canUseTelegramPublishing, teacherSections, type AdminInfo} from "./rbac.ts";
import {validExamDay, validExamTime, validExamSchedule} from "./exam-validation.ts";
import {publishExam} from "./publish.ts";
import {PORTAL_BASE_URL} from "./flags.ts";

const SECTIONS = ["A","B","C","F"];
const kinds = [
  {value:"كوز يومي",label:"📝 كوز يومي"},
  {value:"Midterm",label:"📋 Midterm"},
  {value:"Final",label:"📑 Final"},
  {value:"امتحان شهري",label:"📆 امتحان شهري"},
  {value:"نصف السنة",label:"📖 نصف السنة"},
  {value:"امتحان شفوي",label:"🎤 امتحان شفوي"},
];
const skip = (text:string) => ["تخطي","تخطى","تخطَّ","-","بدون"].includes(text.trim());
const nav = {inline_keyboard: [[{text:"🏠 الرئيسية",callback_data:"nav:home"},{text:"❌ إلغاء",callback_data:"adm:cancel"}]]};
type Draft = Record<string,unknown>;

async function bot() { return import("./bot.ts"); }
async function subjectPicker(chatId:number,admin:AdminInfo) {
  const all=await q<{id:string;name:string}>("SELECT id,name FROM portal_subjects ORDER BY name");
  const list=admin.role==="teacher"?all.filter(x=>admin.assigned_subjects?.includes(x.id)):all;
  await sendMessage(chatId,list.length?"📚 اختر مادة الامتحان:":"ماكو مواد مخوّلة لحسابك.",
    {replyMarkup:{inline_keyboard:[...list.map(s=>[{text:s.name,callback_data:"exam:subject:"+s.id}]),...nav.inline_keyboard]}});
}
async function audiencePicker(chatId:number,admin:AdminInfo,subjectId:string) {
  const allowed=teacherSections(admin,subjectId)||[...SECTIONS];
  const rows=[
    {text:"🌐 جميع الشعب",sections:[...SECTIONS],key:"all"},
    ...SECTIONS.map(section=>({text:"شعبة "+section,sections:[section],key:section})),
  ].filter(x=>(admin.role!=="teacher"||x.sections.every(s=>allowed.includes(s as never)))&&
    canPublishMaterial(admin,subjectId,x.sections));
  await sendMessage(chatId,rows.length?"🎯 اختر الشعب المشمولة بالامتحان:":"لا توجد شعب مخوّلة لهذا الامتحان.",
    {replyMarkup:{inline_keyboard:[...rows.map(x=>[{text:x.text,callback_data:"exam:aud:"+x.key}]),...nav.inline_keyboard]}});
}
async function prompt(chatId:number,admin:AdminInfo,d:Draft) {
  const step=String(d.step||"");
  if(step==="subject")return subjectPicker(chatId,admin);
  if(step==="audience")return audiencePicker(chatId,admin,String(d.subjectId||""));
  if(step==="kind")return sendMessage(chatId,"📝 حدد نوع الامتحان:",{replyMarkup:{inline_keyboard:[
    ...kinds.map(k=>[{text:k.label,callback_data:"exam:kind:"+kinds.indexOf(k)}]),...nav.inline_keyboard]}});
  const texts:Record<string,string>={
    title:"✍️ اكتب عنوان الامتحان أو الكوز:",
    date:"📆 اكتب تاريخ الامتحان بصيغة YYYY-MM-DD، مثلاً: 2026-11-25",
    time:"🕘 اكتب وقت بدء الامتحان بتوقيت بغداد بصيغة 24 ساعة، مثلاً: 09:30",
    room:"🏫 اكتب القاعة، أو أرسل «تخطي» إذا ما تحددت.",
    topics:"📖 اكتب المواضيع الداخلة بالامتحان، أو «تخطي».",
    notes:"🗒 اكتب ملاحظات إضافية للطلاب، أو «تخطي».",
    publishing:"طلب النشر قيد المعالجة. لا تضغط نشر مرة ثانية.",
  };
  if(step==="status")return sendMessage(chatId,"📌 هل الموعد مؤكد لو مبدئي؟",{replyMarkup:{inline_keyboard:[
    [{text:"✅ مؤكد",callback_data:"exam:status:confirmed"}],
    [{text:"⏳ مبدئي",callback_data:"exam:status:provisional"}],
    ...nav.inline_keyboard]}});
  if(step==="confirm")return preview(chatId,d);
  await sendMessage(chatId,texts[step]||"المسودة غير مكتملة؛ ابدأ نشر امتحان جديد.",{replyMarkup:nav});
}

async function preview(chatId:number,d:Draft) {
  const {setFlowState}=await bot();
  const nonce=randomBytes(8).toString("hex");
  await setFlowState(chatId,"exam",{...d,step:"confirm",nonce,previewed:true});
  const sub=await qOne<{name:string}>("SELECT name FROM portal_subjects WHERE id=$1",[String(d.subjectId||"")]);
  const audience=Array.isArray(d.sections) ? d.sections.join("، ") : "";
  const body="📝 معاينة موعد الامتحان\n\n📘 المادة: "+(sub?.name||d.subjectId)+
    "\n🗂 النوع: "+String(d.type||"")+"\n✍️ العنوان: "+String(d.title||"")+
    "\n🎯 الشعب: "+audience+"\n📅 التاريخ: "+String(d.date||"")+
    "\n🕘 الوقت (بغداد): "+String(d.start_time||"")+
    "\n🏫 القاعة: "+String(d.room||"غير محددة")+
    "\n📖 المواضيع: "+String(d.topics||"غير محددة")+
    "\n🗒 ملاحظات: "+String(d.notes||"لا توجد")+
    "\n📌 الحالة: "+(d.status==="confirmed"?"مؤكد":"مبدئي");
  await sendMessage(chatId,body,{replyMarkup:{inline_keyboard:[
    [{text:"✅ نشر الامتحان",callback_data:"pub:exam:"+nonce}],
    [{text:"✏️ تعديل العنوان",callback_data:"exam:edit:title"},{text:"📆 تعديل التاريخ",callback_data:"exam:edit:date"}],
    [{text:"🕘 تعديل الوقت",callback_data:"exam:edit:time"},{text:"🎯 تغيير الشعب",callback_data:"exam:edit:audience"}],
    [{text:"🗂 تغيير النوع",callback_data:"exam:edit:kind"},{text:"🏫 تعديل القاعة",callback_data:"exam:edit:room"}],
    [{text:"📖 تعديل المواضيع",callback_data:"exam:edit:topics"},{text:"🗒 تعديل الملاحظات",callback_data:"exam:edit:notes"}],
    [{text:"📌 تغيير التأكيد",callback_data:"exam:edit:status"}],
    ...nav.inline_keyboard]}});
}

export async function startExamFlow(chatId:number,userId:number) {
  const {getLinkedAdmin,setFlowState}=await bot();
  const admin=await getLinkedAdmin(userId);
  if(!admin||!canUseTelegramPublishing(admin)){
    await sendMessage(chatId,"⛔ هذا الحساب لا يملك صلاحية نشر الامتحانات.");return;
  }
  const draft={step:"subject",draftId:"exam-tg-"+chatId+"-"+Date.now()};
  await setFlowState(chatId,"exam",draft);
  await subjectPicker(chatId,admin);
}

export async function resumeExamDraft(chatId:number,userId:number) {
  const {getLinkedAdmin,getFlowState}=await bot();
  const admin=await getLinkedAdmin(userId),state=await getFlowState(chatId);
  if(admin&&state?.flow==="exam") await prompt(chatId,admin,state.data);
}

export async function handleExamCallback(chatId:number,userId:number,data:string,onPublished?: (eventIds:number[])=>void) {
  if(data==="adm:exam")return startExamFlow(chatId,userId);
  const {getLinkedAdmin,getFlowState,setFlowState}=await bot();
  const admin=await getLinkedAdmin(userId),state=await getFlowState(chatId);
  if(!admin||!canUseTelegramPublishing(admin)||state?.flow!=="exam") {
    await sendMessage(chatId,"المسودة غير متاحة. افتح نشر امتحان جديد.",{replyMarkup:nav});return;
  }
  const d=state.data,step=String(d.step||"");
  if(data.startsWith("exam:subject:")) {
    if(step!=="subject")return;
    const subjectId=data.slice("exam:subject:".length);
    const subject=await qOne<{id:string}>("SELECT id FROM portal_subjects WHERE id=$1",[subjectId]);
    if(!subject||(admin.role==="teacher"&&!admin.assigned_subjects?.includes(subjectId))) {
      await sendMessage(chatId,"لا توجد صلاحية لهذه المادة.");return;
    }
    const next={...d,subjectId,step:"audience"};
    await setFlowState(chatId,"exam",next);await prompt(chatId,admin,next);return;
  }
  if(data.startsWith("exam:aud:")) {
    if(step!=="audience")return;
    const value=data.slice("exam:aud:".length);
    const sections=value==="all"?[...SECTIONS]:SECTIONS.includes(value)?[value]:[];
    if(!sections.length||!canPublishMaterial(admin,String(d.subjectId||""),sections)){
      await sendMessage(chatId,"هاي الشعبة مو ضمن صلاحياتك.");return;
    }
    const next={...d,sections,step:d.previewed?"confirm":"kind"};
    await setFlowState(chatId,"exam",next);await prompt(chatId,admin,next);return;
  }
  if(data.startsWith("exam:kind:")) {
    if(step!=="kind")return;
    const index=Number(data.slice("exam:kind:".length));
    if(!Number.isInteger(index)||index<0||index>=kinds.length)return;
    const next={...d,type:kinds[index].value,step:d.previewed?"confirm":"title"};
    await setFlowState(chatId,"exam",next);await prompt(chatId,admin,next);return;
  }
  if(data.startsWith("exam:status:")) {
    if(step!=="status")return;
    const status=data.slice("exam:status:".length);
    if(status!=="confirmed"&&status!=="provisional")return;
    await preview(chatId,{...d,status});return;
  }
  if(data.startsWith("exam:edit:")) {
    if(step!=="confirm")return;
    const edit=data.slice("exam:edit:".length);
    if(!["audience","kind","title","date","time","room","topics","notes","status"].includes(edit))return;
    const next={...d,step:edit,nonce:undefined};
    await setFlowState(chatId,"exam",next);await prompt(chatId,admin,next);return;
  }
  if(data.startsWith("pub:exam:")) {
    if(step!=="confirm"||data!=="pub:exam:"+d.nonce) {
      await sendMessage(chatId,"زر نشر قديم. افتح المعاينة الحالية.");return;
    }
    const claimed=await q<{chat_id:number}>(`UPDATE portal_bot_state SET data=$3
       WHERE chat_id=$1 AND data->>'nonce'=$2 AND data->>'step'='confirm' RETURNING chat_id`,
       [chatId,String(d.nonce),JSON.stringify({...d,step:"publishing"})]);
    if(!claimed.length)return;
    try {
      const fresh=await getLinkedAdmin(userId);
      const sections=Array.isArray(d.sections)?d.sections.map(String):[];
      const input={
        id:String(d.draftId||""),subjectId:String(d.subjectId||""),sections,
        title:String(d.title||""),type:String(d.type||""),date:String(d.date||""),
        start_time:String(d.start_time||""),room:String(d.room||""),
        topics:String(d.topics||""),notes:String(d.notes||""),
        status:String(d.status||"provisional"),source:"telegram" as const,
      };
      if(!fresh||!canPublishMaterial(fresh,input.subjectId,sections)||validExamSchedule({...input,subject_id:input.subjectId})) {
        await setFlowState(chatId,"exam",d);
        await sendMessage(chatId,"⛔ البيانات أو الصلاحيات تغيّرت. راجع المعاينة قبل النشر.");return;
      }
      const result=await publishExam(fresh,input);
      if(result.ok) {
        await setFlowState(chatId,"",{});
        if(result.notificationEvents?.length)onPublished?.(result.notificationEvents);
        await sendMessage(chatId,result.inserted?
          "✅ تم نشر موعد الامتحان للشعب المحددة.\n🔗 "+PORTAL_BASE_URL+"/exams":
          "ℹ️ الموعد منشور سابقاً؛ ما أعدنا نشره.",
          {replyMarkup:{inline_keyboard:[[ {text:"📝 نشر امتحان آخر",callback_data:"adm:exam"} ],...nav.inline_keyboard]}});
      } else {
        await preview(chatId,d);
        await sendMessage(chatId,"⛔ تعذّر نشر الامتحان: "+result.error,{replyMarkup:nav});
      }
    } catch {
      await preview(chatId,d);
      await sendMessage(chatId,"تعذّر الحفظ؛ مسودتك محفوظة وتگدر تعيد المحاولة.",{replyMarkup:nav});
    }
  }
}

export async function handleExamMessage(chatId:number,userId:number,text:string) {
  const {getLinkedAdmin,getFlowState,setFlowState}=await bot();
  const admin=await getLinkedAdmin(userId),state=await getFlowState(chatId);
  if(!admin||!canUseTelegramPublishing(admin)||state?.flow!=="exam")return;
  const d=state.data,step=String(d.step||"");
  if(!["title","date","time","room","topics","notes"].includes(step)) {
    await prompt(chatId,admin,d);return;
  }
  const value=text.trim();
  if(!value||value.length>3000) {
    await sendMessage(chatId,"اكتب نصاً صالحاً لا يتجاوز 3000 حرف.");return;
  }
  if(step==="title"&&value.length>180) {
    await sendMessage(chatId,"العنوان يجب ألا يتجاوز 180 حرفاً.");return;
  }
  if(step==="date"&&!validExamDay(value)) {
    await sendMessage(chatId,"⚠️ التاريخ غير صحيح. مثال: 2026-11-25");return;
  }
  if(step==="time"&&!validExamTime(value)) {
    await sendMessage(chatId,"⚠️ الوقت غير صحيح. مثال: 09:30 بتوقيت بغداد.");return;
  }
  if(step==="room"&&value.length>120) {
    await sendMessage(chatId,"اسم القاعة طويل جداً.");return;
  }
  const field=step==="time"?"start_time":step;
  const next={...d,[field]:["room","topics","notes"].includes(step)&&skip(value)?"":value};
  if(d.previewed) {await preview(chatId,next);return;}
  const stages:Record<string,string>={title:"date",date:"time",time:"room",room:"topics",topics:"notes",notes:"status"};
  const upcoming={...next,step:stages[step]};
  await setFlowState(chatId,"exam",upcoming);
  await prompt(chatId,admin,upcoming);
}
