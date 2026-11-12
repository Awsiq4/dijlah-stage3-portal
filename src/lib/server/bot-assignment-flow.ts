// Assignment publishing wizard for the EXISTING Telegram bot.
// Separate flow from lecture/announcement publishing; uses the same RBAC and DB service.
import {randomBytes} from "node:crypto";
import {q, qOne} from "./db.ts";
import {sendMessage, tgFetch} from "./telegram.ts";
import {canPublishMaterial, canUseTelegramPublishing, teacherSections, type AdminInfo} from "./rbac.ts";
import {publishAssignment} from "./publish.ts";
import {BOT_TOKEN, PORTAL_BASE_URL} from "./flags.ts";
import {materialMime, validMaterialFile, storageConfigured, MAX_PDF_BYTES, uploadLectureFile} from "./storage.ts";
import {safeFileUrl} from "../safe-url.ts";
import type {TgDocument} from "./bot.ts";

const ALL = ["A", "B", "C", "F"];
const nav = {inline_keyboard: [[{text:"🏠 القائمة الرئيسية",callback_data:"nav:home"}, {text:"❌ إلغاء",callback_data:"adm:cancel"}]]};
const skipped = (s: string) => ["تخطي","تخطى","تخطَّ","-","بدون"].includes(s.trim());
type Draft = Record<string, unknown>;

async function botMethods() {
  return import("./bot.ts");
}

function dueDateBaghdad(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [year,month,day,hour,minute] = match.slice(1).map(Number);
  const calendar = new Date(Date.UTC(year, month-1, day, hour, minute));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month-1 ||
      calendar.getUTCDate() !== day || calendar.getUTCHours() !== hour ||
      calendar.getUTCMinutes() !== minute) return null;
  const iso = match[1]+"-"+match[2]+"-"+match[3]+"T"+match[4]+":"+match[5]+":00+03:00";
  return Date.parse(iso) > Date.now() ? iso : null;
}

async function subjectOptions(chatId: number, admin: AdminInfo) {
  const subjects = await q<{id:string;name:string}>("SELECT id,name FROM portal_subjects ORDER BY name");
  const options = admin.role === "teacher" ? subjects.filter(s=>admin.assigned_subjects?.includes(s.id)) : subjects;
  await sendMessage(chatId, options.length ? "📚 اختر مادة الواجب أو التكليف:" : "ماكو مواد متاحة لحسابك.", {
    replyMarkup:{inline_keyboard:[...options.map(s=>[{text:s.name,callback_data:"asg:subj:"+s.id}]), ...nav.inline_keyboard]}
  });
}

async function audienceOptions(chatId: number, admin: AdminInfo, subjectId: string) {
  const teacherAllowed = teacherSections(admin,subjectId) || [...ALL];
  const choices: {text:string;callback_data:string;sections:string[]}[] = [
    {text:"🌐 جميع الشعب",callback_data:"asg:aud:all",sections:[...ALL]},
    ...ALL.map(section=>({text:"شعبة "+section,callback_data:"asg:aud:sec:"+section,sections:[section]})),
  ];
  const visible = choices.filter(choice=>
    (admin.role !== "teacher" || choice.sections.every(s=>teacherAllowed.includes(s as never))) &&
    canPublishMaterial(admin,subjectId,choice.sections)
  );
  await sendMessage(chatId, "🎯 اختر الشعب المعنية بالتكليف:", {
    replyMarkup:{inline_keyboard:[...visible.map(x=>[{text:x.text,callback_data:x.callback_data}]),...nav.inline_keyboard]}
  });
}

async function prompt(chatId: number, d: Draft, admin: AdminInfo) {
  switch(d.step) {
    case "subject": await subjectOptions(chatId,admin); return;
    case "audience": await audienceOptions(chatId,admin,String(d.subjectId||"")); return;
    case "title": await sendMessage(chatId,"✍️ اكتب عنوان الواجب أو التكليف:",{replyMarkup:nav}); return;
    case "instructions": await sendMessage(chatId,"📋 اكتب تعليمات التكليف وما المطلوب من الطالب:",{replyMarkup:nav}); return;
    case "due": await sendMessage(chatId,"🗓 اكتب آخر موعد للتسليم بتوقيت بغداد بهذا الشكل:\n2026-11-20 18:00",{replyMarkup:nav}); return;
    case "submission": await sendMessage(chatId,"📨 اكتب طريقة التسليم (مثلاً ورقياً بالمحاضرة، أو عبر المنصة). أرسل «تخطي» إذا غير محددة.",{replyMarkup:nav}); return;
    case "attachment": await sendMessage(chatId,"📎 اختيارياً: أرسل ملف PDF/PPTX (حتى 20MB) أو رابط المرفق، أو أرسل «تخطي».",{replyMarkup:nav}); return;
    case "confirm": await showPreview(chatId,d); return;
    case "publishing": await sendMessage(chatId,"الطلب قيد النشر؛ لا تعِد الإرسال. راجع قسم الواجبات.",{replyMarkup:nav}); return;
    default: await sendMessage(chatId,"المسودة غير مكتملة. افتح نشر تكليف من جديد.",{replyMarkup:nav});
  }
}

async function showPreview(chatId: number, d: Draft) {
  const {setFlowState} = await botMethods();
  const nonce = randomBytes(8).toString("hex");
  const next = {...d,step:"confirm",nonce};
  await setFlowState(chatId,"asg",next);
  const subject = await qOne<{name:string}>("SELECT name FROM portal_subjects WHERE id=$1",[String(d.subjectId||"")]);
  const sections = Array.isArray(d.sections) ? d.sections.join("، ") : "";
  const due = String(d.dueAt||"").replace("T"," ").replace(":00+03:00"," (بغداد)");
  const text = "📋 معاينة التكليف قبل النشر\n\n📘 المادة: " + (subject?.name || d.subjectId) +
    "\n🎯 الشعب: " + sections + "\n✍️ العنوان: " + String(d.title||"") +
    "\n📄 التعليمات: " + String(d.instructions||"") + "\n🗓 آخر موعد: " + due +
    "\n📨 طريقة التسليم: " + (String(d.submission||"") || "غير محددة") +
    "\n📎 مرفق: " + (d.attachmentUrl ? "نعم" : "لا");
  await sendMessage(chatId,text,{replyMarkup:{inline_keyboard:[
    [{text:"✅ نشر التكليف",callback_data:"pub:asg:"+nonce}],
    [{text:"✏️ تعديل العنوان",callback_data:"asg:edit:title"},{text:"📋 تعديل التعليمات",callback_data:"asg:edit:instructions"}],
    [{text:"🗓 تعديل الموعد",callback_data:"asg:edit:due"},{text:"🎯 تغيير الشعب",callback_data:"asg:edit:audience"}],
    [{text:"📨 تعديل التسليم",callback_data:"asg:edit:submission"},{text:"📎 تعديل المرفق",callback_data:"asg:edit:attachment"}],
    ...nav.inline_keyboard,
  ]}});
}

export async function startAssignmentFlow(chatId: number, userId: number) {
  const {getLinkedAdmin,setFlowState} = await botMethods();
  const admin = await getLinkedAdmin(userId);
  if (!admin || !canUseTelegramPublishing(admin)) {
    await sendMessage(chatId,"⛔ حسابك غير مخوّل لنشر التكاليف."); return;
  }
  const data = {step:"subject",draftId:"asg-tg-"+chatId+"-"+Date.now()};
  await setFlowState(chatId,"asg",data);
  await subjectOptions(chatId,admin);
}

export async function resumeAssignmentDraft(chatId: number, userId: number) {
  const {getLinkedAdmin,getFlowState} = await botMethods();
  const admin = await getLinkedAdmin(userId);
  const state = await getFlowState(chatId);
  if (!admin || !state || state.flow !== "asg") return;
  await prompt(chatId,state.data,admin);
}

export async function handleAssignmentCallback(chatId: number,userId: number,data: string,onPublished?: (ids:number[])=>void) {
  if (data === "adm:asg") { await startAssignmentFlow(chatId,userId); return; }
  const {getLinkedAdmin,getFlowState,setFlowState} = await botMethods();
  const admin = await getLinkedAdmin(userId);
  const state = await getFlowState(chatId);
  if (!admin || !canUseTelegramPublishing(admin) || state?.flow !== "asg") {
    await sendMessage(chatId,"هذه المسودة غير متاحة. افتح قائمة النشر من جديد.",{replyMarkup:nav}); return;
  }
  const d = state.data;
  if (data.startsWith("asg:subj:")) {
    if (d.step !== "subject") return;
    const subjectId = data.slice("asg:subj:".length);
    const subject = await qOne<{id:string}>("SELECT id FROM portal_subjects WHERE id=$1",[subjectId]);
    if (!subject || (admin.role==="teacher" && !admin.assigned_subjects?.includes(subjectId))) {
      await sendMessage(chatId,"لا تملك صلاحية النشر لهذه المادة."); return;
    }
    const next = {...d,subjectId,step:"audience"};
    await setFlowState(chatId,"asg",next);await prompt(chatId,next,admin);return;
  }
  if (data.startsWith("asg:aud:")) {
    if (d.step !== "audience") return;
    const choice = data.slice("asg:aud:".length);
    const sections = choice==="all" ? [...ALL] : choice.startsWith("sec:") ? [choice.slice(4)] : [];
    if (!sections.length || !sections.every(s=>ALL.includes(s)) ||
        !canPublishMaterial(admin,String(d.subjectId||""),sections)) {
      await sendMessage(chatId,"هذا الجمهور غير مسموح لحسابك."); return;
    }
    const next = {...d,sections,step: d.title ? "confirm" : "title"};
    await setFlowState(chatId,"asg",next);await prompt(chatId,next,admin);return;
  }
  if (data.startsWith("asg:edit:")) {
    if (d.step !== "confirm") return;
    const step = data.slice("asg:edit:".length);
    if (!["title","instructions","due","submission","attachment","audience"].includes(step)) return;
    const next = {...d,step,nonce:undefined};
    await setFlowState(chatId,"asg",next);await prompt(chatId,next,admin);return;
  }
  if (data.startsWith("pub:asg:")) {
    if (d.step !== "confirm" || data !== "pub:asg:"+d.nonce) {
      await sendMessage(chatId,"هذا الزر قديم. افتح المعاينة الحالية.");return;
    }
    const claimed = await q<{chat_id:number}>(`UPDATE portal_bot_state SET data=$3 WHERE chat_id=$1
      AND data->>'nonce'=$2 AND data->>'step'='confirm' RETURNING chat_id`,
      [chatId,String(d.nonce),JSON.stringify({...d,step:"publishing"})]);
    if (!claimed.length) return;
    try {
      const fresh = await getLinkedAdmin(userId);
      const sections = Array.isArray(d.sections) ? d.sections.map(String) : [];
      if (!fresh || !canPublishMaterial(fresh,String(d.subjectId||""),sections)) {
        await setFlowState(chatId,"",{});await sendMessage(chatId,"⛔ تم تغيير الصلاحيات؛ لم يُنشر التكليف.");return;
      }
      const res = await publishAssignment(fresh,{
        id:String(d.draftId||""),subjectId:String(d.subjectId||""),
        sections,title:String(d.title||""),instructions:String(d.instructions||""),
        due_at:String(d.dueAt||""),submission:String(d.submission||""),
        attachment_url:String(d.attachmentUrl||""),source:"telegram",
      });
      if (res.ok) {
        await setFlowState(chatId,"",{});
        if (res.notificationEvents?.length) onPublished?.(res.notificationEvents);
        await sendMessage(chatId,res.inserted
          ? "✅ تم نشر التكليف للطلاب.\n🔗 "+PORTAL_BASE_URL+"/assignments"
          : "ℹ️ التكليف منشور مسبقاً، ولم تتم إعادة نشره.",
          {replyMarkup:{inline_keyboard:[[ {text:"📋 نشر تكليف آخر",callback_data:"adm:asg"} ],...nav.inline_keyboard]}});
      } else {
        await showPreview(chatId,d);
        await sendMessage(chatId,"⛔ لم يُنشر التكليف: "+res.error,{replyMarkup:nav});
      }
    } catch (error) {
      await showPreview(chatId,d);
      await sendMessage(chatId,"تعذّر الحفظ الآن؛ مسودتك محفوظة. جرّب مرة ثانية.",{replyMarkup:nav});
    }
  }
}

export async function handleAssignmentMessage(chatId:number,userId:number,text:string,document?:TgDocument) {
  const {getLinkedAdmin,getFlowState,setFlowState} = await botMethods();
  const admin = await getLinkedAdmin(userId);
  const state = await getFlowState(chatId);
  if (!admin || state?.flow!=="asg" || !canUseTelegramPublishing(admin)) return;
  const d = state.data, step=String(d.step||"");
  if (step==="attachment") {
    if (document) {
      const filename = document.file_name || "";
      if (!materialMime(filename) || !document.file_size || document.file_size > MAX_PDF_BYTES || !storageConfigured()) {
        await sendMessage(chatId,"⚠️ أرسل PDF/PPTX صالحاً بحجم أقل من 20MB، أو رابطاً، أو «تخطي».");return;
      }
      try {
        const get = await tgFetch<{file_path:string}>("getFile",{file_id:document.file_id});
        if (!get.ok || !get.result?.file_path) throw Error("getFile");
        const url = "https://api.telegram.org/file/bot"+BOT_TOKEN+"/"+get.result.file_path;
        const response = await fetch(url,{redirect:"error"});
        if (!response.ok) throw Error("download");
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length>MAX_PDF_BYTES || !validMaterialFile(bytes,filename)) throw Error("invalid material");
        const saved = await uploadLectureFile(bytes,filename);
        await showPreview(chatId,{...d,attachmentUrl:saved.url});
      } catch {
        await sendMessage(chatId,"⚠️ تعذر حفظ المرفق، أعد إرسال الملف أو الرابط. بقيت المسودة محفوظة.",{replyMarkup:nav});
      }
      return;
    }
    const value = skipped(text) ? "" : text.trim();
    if (value && (!safeFileUrl(value) || !/^https:\/\//i.test(value))) {
      await sendMessage(chatId,"⚠️ الرابط لازم يبدأ بـ https:// أو أرسل «تخطي».",{replyMarkup:nav});return;
    }
    await showPreview(chatId,{...d,attachmentUrl:value});return;
  }
  if (document) {
    await sendMessage(chatId,"هذه الخطوة تحتاج نصاً. أرسل الملف عندما يطلب البوت المرفق.",{replyMarkup:nav});return;
  }
  if (text.length>3000) {await sendMessage(chatId,"النص طويل جداً؛ الحد 3000 حرف.");return;}
  if (step==="title") {
    if (!text.trim()||text.length>180) {await sendMessage(chatId,"عنوان التكليف يجب أن يكون من 1 إلى 180 حرفاً.");return;}
    const next={...d,title:text.trim(),step:"instructions"};
    if (d.dueAt) await showPreview(chatId,next); else {await setFlowState(chatId,"asg",next);await prompt(chatId,next,admin);}return;
  }
  if (step==="instructions") {
    if (!text.trim()) {await sendMessage(chatId,"اكتب تعليمات التكليف.");return;}
    const next={...d,instructions:text.trim(),step:"due"};
    if (d.dueAt) await showPreview(chatId,next); else {await setFlowState(chatId,"asg",next);await prompt(chatId,next,admin);}return;
  }
  if (step==="due") {
    const due = dueDateBaghdad(text);
    if (!due) {await sendMessage(chatId,"⚠️ الموعد غير صالح أو انتهى. اكتب مثلاً 2026-11-20 18:00 (بتوقيت بغداد).");return;}
    const next={...d,dueAt:due,step:"submission"};
    if (d.submission !== undefined) await showPreview(chatId,next);
    else {await setFlowState(chatId,"asg",next);await prompt(chatId,next,admin);}return;
  }
  if (step==="submission") {
    const next={...d,submission:skipped(text)?"":text.trim(),step:"attachment"};
    if (d.attachmentUrl !== undefined) await showPreview(chatId,next);
    else {await setFlowState(chatId,"asg",next);await prompt(chatId,next,admin);}return;
  }
}
