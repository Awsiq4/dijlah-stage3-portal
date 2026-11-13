// Fast quiz-only publishing. Midterm/Final belong to the university schedule
// and are managed by the portal owner through the website, never here.
import {randomBytes} from "node:crypto";
import {q,qOne} from "./db.ts";
import {sendMessage} from "./telegram.ts";
import {canUseTelegramPublishing, type AdminInfo} from "./rbac.ts";
import {defaultAudience,validAudience,PUBLISH_SECTIONS} from "./publisher-audience.ts";
import {validExamDay,validExamSchedule} from "./exam-validation.ts";
import {courseworkUrl, publishExam} from "./publish.ts";
import {PORTAL_BASE_URL} from "./flags.ts";

type Draft=Record<string,unknown>;
const nav={inline_keyboard:[[{text:"🏠 الرئيسية",callback_data:"nav:home"},{text:"❌ إلغاء",callback_data:"adm:cancel"}]]};
const empty=(text:string)=>["-","تخطي","تخطى","بدون"].includes(text.trim());
async function bot(){return import("./bot.ts");}
async function subjects(chatId:number,admin:AdminInfo) {
  const all=await q<{id:string;name:string}>("SELECT id,name FROM portal_subjects ORDER BY name");
  const available=admin.role==="teacher"?all.filter(s=>admin.assigned_subjects?.includes(s.id)):all;
  await sendMessage(chatId,available.length?"📝 اختر مادة الكوز:":"ماكو مواد متاحة للنشر.",{
    replyMarkup:{inline_keyboard:[...available.map(s=>[{text:s.name,callback_data:"quiz:subj:"+s.id}]),...nav.inline_keyboard]}
  });
}
async function askDate(chatId:number) {
  await sendMessage(chatId,"📅 أرسل تاريخ الكوز فقط (بتوقيت بغداد):\nمثال: 2099-11-25",{replyMarkup:nav});
}
function parseDate(text:string):{date:string;start_time:string}|null {
  const date=text.trim();
  return validExamDay(date) && Date.parse(date+"T23:59:59+03:00")>Date.now()
    ? {date,start_time:""} : null;
}
async function preview(chatId:number,d:Draft) {
  const {setFlowState}=await bot();
  const nonce=randomBytes(8).toString("hex");
  await setFlowState(chatId,"exam",{...d,step:"confirm",nonce});
  const row=await qOne<{name:string}>("SELECT name FROM portal_subjects WHERE id=$1",[String(d.subjectId)]);
  const text="📝 معاينة الكوز\n\n📘 "+(row?.name||d.subjectId)+
    "\n📅 "+String(d.date||"")+
    "\n🎯 "+(Array.isArray(d.sections)?d.sections.join("، "):"")+
    (d.title&&d.title!==("كوز يومي — "+(row?.name||d.subjectId))?"\n✏️ "+d.title:"")+
    (d.room?"\n🏫 "+d.room:"")+
    (d.topics?"\n📖 "+d.topics:"")+
    (d.notes?"\n🗒 "+d.notes:"");
  await sendMessage(chatId,text,{replyMarkup:{inline_keyboard:[
    [{text:"✅ نشر الكوز",callback_data:"pub:exam:"+nonce}],
    [{text:"🎯 تغيير الشعب",callback_data:"quiz:aud"},{text:"✏️ تعديل التفاصيل",callback_data:"quiz:more"}],
    ...nav.inline_keyboard,
  ]}});
}
async function audience(chatId:number,admin:AdminInfo,subjectId:string) {
  const choices=[
    {label:"🌐 جميع الشعب",key:"all",secs:[...PUBLISH_SECTIONS]},
    ...PUBLISH_SECTIONS.map(s=>({label:"شعبة "+s,key:s,secs:[s]}))
  ].filter(x=>validAudience(admin,subjectId,x.secs));
  await sendMessage(chatId,"🎯 اختَر الجمهور، أو ارجع للمعاينة:",{replyMarkup:{inline_keyboard:[
    ...choices.map(x=>[{text:x.label,callback_data:"quiz:aud:"+x.key}]),
    [{text:"🔙 المعاينة",callback_data:"quiz:preview"}],...nav.inline_keyboard
  ]}});
}
async function details(chatId:number) {
  await sendMessage(chatId,"✏️ التفاصيل الإضافية اختيارية. اختَر الشيء اللي تريد تعدله:",{replyMarkup:{inline_keyboard:[
    [{text:"📅 التاريخ",callback_data:"quiz:edit:date"},{text:"✏️ العنوان",callback_data:"quiz:edit:title"}],
    [{text:"🏫 القاعة",callback_data:"quiz:edit:room"},{text:"📖 المواضيع",callback_data:"quiz:edit:topics"}],
    [{text:"🗒 ملاحظات",callback_data:"quiz:edit:notes"}],
    [{text:"🔙 رجوع للمعاينة",callback_data:"quiz:preview"}],...nav.inline_keyboard
  ]}});
}
export async function startExamFlow(chatId:number,userId:number) {
  const {getLinkedAdmin,setFlowState}=await bot();
  const admin=await getLinkedAdmin(userId);
  if(!admin||!canUseTelegramPublishing(admin)){
    await sendMessage(chatId,"⛔ الحساب غير مخوّل لنشر الكوزات.");return;
  }
  const d={step:"subject",draftId:"quiz-tg-"+randomBytes(12).toString("hex"),type:"كوز يومي",status:"confirmed"};
  await setFlowState(chatId,"exam",d);
  await subjects(chatId,admin);
}
export async function resumeExamDraft(chatId:number,userId:number) {
  const {getLinkedAdmin,getFlowState}=await bot();
  const admin=await getLinkedAdmin(userId),state=await getFlowState(chatId);
  if(!admin||state?.flow!=="exam")return;
  const d=state.data,step=String(d.step||"");
  if(step==="subject")await subjects(chatId,admin);
  else if(step==="date"||step==="datetime")await askDate(chatId);
  else if(step==="confirm")await preview(chatId,d);
  else if(step==="audience")await audience(chatId,admin,String(d.subjectId||""));
  else if(step==="more")await details(chatId);
  else if(step.startsWith("edit:"))await sendMessage(chatId,"✏️ أرسل القيمة الجديدة، أو «تخطي» لحذف التفاصيل الاختيارية.",{replyMarkup:nav});
  else await sendMessage(chatId,"المسودة قيد الإجراء.",{replyMarkup:nav});
}
export async function handleExamCallback(chatId:number,userId:number,data:string,onPublished?: (eventIds:number[])=>void) {
  if(data==="adm:exam")return startExamFlow(chatId,userId);
  const {getLinkedAdmin,getFlowState,setFlowState}=await bot();
  const admin=await getLinkedAdmin(userId),state=await getFlowState(chatId);
  if(!admin||!canUseTelegramPublishing(admin)||state?.flow!=="exam"){
    await sendMessage(chatId,"المسودة غير متاحة. افتح «نشر كوز» من جديد.",{replyMarkup:nav});return;
  }
  const d=state.data,step=String(d.step||"");
  if(data.startsWith("exam:")) {
    await sendMessage(chatId,"الخطوات القديمة استُبدلت بنظام الكوز السريع. استخدم قائمة النشر الجديدة.",{replyMarkup:nav});return;
  }
  if(data.startsWith("quiz:subj:")) {
    if(step!=="subject")return;
    const subjectId=data.slice(10);
    const subject=await qOne<{id:string}>("SELECT id FROM portal_subjects WHERE id=$1",[subjectId]);
    const sections=defaultAudience(admin,subjectId);
    if(!subject||!validAudience(admin,subjectId,sections)){
      await sendMessage(chatId,"المادة مو ضمن صلاحيات حسابك.");return;
    }
    await setFlowState(chatId,"exam",{...d,subjectId,sections,step:"date"});
    await askDate(chatId);return;
  }
  if(data==="quiz:aud") {
    if(step!=="confirm")return;
    await setFlowState(chatId,"exam",{...d,step:"audience",nonce:undefined});
    await audience(chatId,admin,String(d.subjectId));return;
  }
  if(data.startsWith("quiz:aud:")) {
    if(step!=="audience")return;
    const key=data.slice("quiz:aud:".length);
    const sections=key==="all"?[...PUBLISH_SECTIONS]:PUBLISH_SECTIONS.includes(key as typeof PUBLISH_SECTIONS[number])?[key]:[];
    if(!validAudience(admin,String(d.subjectId),sections)) {
      await sendMessage(chatId,"ما تملك صلاحية النشر لهذه الشعبة.");return;
    }
    await preview(chatId,{...d,sections});return;
  }
  if(data==="quiz:more") {
    if(step!=="confirm")return;
    await setFlowState(chatId,"exam",{...d,step:"more",nonce:undefined});
    await details(chatId);return;
  }
  if(data==="quiz:preview") {
    if(step!=="more"&&step!=="audience")return;
    await preview(chatId,d);return;
  }
  if(data.startsWith("quiz:edit:")) {
    if(step!=="more")return;
    const key=data.slice("quiz:edit:".length);
    if(!["date","datetime","title","room","topics","notes"].includes(key))return;
    await setFlowState(chatId,"exam",{...d,step:"edit:"+(key==="datetime"?"date":key)});
    await sendMessage(chatId,key==="date"||key==="datetime"?"📅 اكتب التاريخ الجديد: YYYY-MM-DD":
      "✏️ أرسل القيمة الجديدة (أو تخطي لحذف التفاصيل):",{replyMarkup:nav});
    return;
  }
  if(data.startsWith("pub:exam:")) {
    if(step!=="confirm"||data!=="pub:exam:"+d.nonce){
      await sendMessage(chatId,"هذا زر قديم؛ استخدم المعاينة الحالية.");return;
    }
    const claims=await q<{chat_id:number}>(`UPDATE portal_bot_state SET data=$3
      WHERE chat_id=$1 AND data->>'nonce'=$2 AND data->>'step'='confirm' RETURNING chat_id`,
      [chatId,String(d.nonce),JSON.stringify({...d,step:"publishing"})]);
    if(!claims.length)return;
    try {
      const fresh=await getLinkedAdmin(userId);
      const sections=Array.isArray(d.sections)?d.sections.map(String):[];
      const input={
        id:String(d.draftId||""),subjectId:String(d.subjectId||""),sections,
        title:String(d.title||"كوز يومي"),type:"كوز يومي",
        date:String(d.date||""),start_time:"",
        room:String(d.room||""),topics:String(d.topics||""),notes:String(d.notes||""),
        status:"confirmed",source:"telegram" as const,
      };
      if(!fresh||!validAudience(fresh,input.subjectId,sections)||
        validExamSchedule({...input,subject_id:input.subjectId})) {
        await preview(chatId,d);
        await sendMessage(chatId,"⚠️ راجع الموعد أو الصلاحيات قبل النشر.");return;
      }
      const result=await publishExam(fresh,input);
      if(result.ok) {
        await setFlowState(chatId,"",{});
        if(result.notificationEvents?.length)onPublished?.(result.notificationEvents);
        await sendMessage(chatId,result.inserted?"✅ تم نشر الكوز للشعب المحددة.\n🔗 "+PORTAL_BASE_URL+courseworkUrl("exams",result.id,sections.length < PUBLISH_SECTIONS.length ? sections[0] : undefined):
          "ℹ️ هذا الكوز منشور من قبل؛ ما كررناه.",{replyMarkup:{inline_keyboard:[
            [{text:"📝 نشر كوز آخر",callback_data:"adm:exam"}],...nav.inline_keyboard]}});
      } else {
        await preview(chatId,d);
        await sendMessage(chatId,"⛔ تعذّر النشر: "+result.error,{replyMarkup:nav});
      }
    }catch{
      await preview(chatId,d);
      await sendMessage(chatId,"ما انحفظ الكوز؛ المسودة محفوظة وتگدر تعيد المحاولة.",{replyMarkup:nav});
    }
  }
}
export async function handleExamMessage(chatId:number,userId:number,text:string){
  const {getLinkedAdmin,getFlowState}=await bot();
  const admin=await getLinkedAdmin(userId),state=await getFlowState(chatId);
  if(!admin||!canUseTelegramPublishing(admin)||state?.flow!=="exam")return;
  const d=state.data,step=String(d.step||"");
  if(step==="date"||step==="datetime") {
    const parsed=parseDate(text);
    if(!parsed){await sendMessage(chatId,"⚠️ التاريخ غير صحيح أو مضى. مثال: 2099-11-25");return;}
    await preview(chatId,{...d,...parsed,title:"كوز يومي"});return;
  }
  if(step.startsWith("edit:")) {
    const key=step.slice(5),value=text.trim();
    if(key==="date"||key==="datetime"){
      const parsed=parseDate(value);
      if(!parsed){await sendMessage(chatId,"⚠️ اكتب تاريخاً قادماً مثل 2099-11-25");return;}
      await preview(chatId,{...d,...parsed});return;
    }
    if(!["title","room","topics","notes"].includes(key))return;
    if(!value||value.length>(key==="room"?120:key==="title"?180:3000)){
      await sendMessage(chatId,"النص غير صالح أو طويل جداً.");return;
    }
    if(key==="title"&&empty(value)){await preview(chatId,{...d,title:"كوز يومي"});return;}
    await preview(chatId,{...d,[key]:empty(value)?"":value});return;
  }
}
