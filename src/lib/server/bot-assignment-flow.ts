// Assignment publishing wizard for the EXISTING Telegram bot.
// Separate flow from lecture/announcement publishing; uses the same RBAC and DB service.
import {randomBytes} from "node:crypto";
import {q, qOne} from "./db.ts";
import {sendMessage, tgFetch} from "./telegram.ts";
import {canUseTelegramPublishing, type AdminInfo} from "./rbac.ts";
import {defaultAudience,validAudience} from "./publisher-audience.ts";
import {publishAssignment} from "./publish.ts";
import {BOT_TOKEN, PORTAL_BASE_URL} from "./flags.ts";
import {materialMime, validMaterialFile, storageConfigured, MAX_PDF_BYTES, uploadLectureFile} from "./storage.ts";
import {safeFileUrl} from "../safe-url.ts";
import type {TgDocument} from "./bot.ts";
import {assignmentDayAllowed, assignmentDisplayDay} from "../assignment-date.ts";

const ALL = ["A", "B", "C", "F"];
const nav = {inline_keyboard: [[{text:"🏠 القائمة الرئيسية",callback_data:"nav:home"}, {text:"❌ إلغاء",callback_data:"adm:cancel"}]]};
const skipped = (s: string) => ["تخطي","تخطى","تخطَّ","-","بدون"].includes(s.trim());
type Draft = Record<string, unknown>;

async function botMethods() {
  return import("./bot.ts");
}

function dueDateBaghdad(value: string): string | null {
  const day=value.trim();
  return assignmentDayAllowed(day) ? day : null;
}

async function subjectOptions(chatId: number, admin: AdminInfo) {
  const subjects = await q<{id:string;name:string}>("SELECT id,name FROM portal_subjects ORDER BY name");
  const options = admin.role === "teacher" ? subjects.filter(s=>admin.assigned_subjects?.includes(s.id)) : subjects;
  await sendMessage(chatId, options.length ? "📚 اختر مادة الواجب:" : "ماكو مواد متاحة لحسابك.", {
    replyMarkup:{inline_keyboard:[...options.map(s=>[{text:s.name,callback_data:"asg:subj:"+s.id}]), ...nav.inline_keyboard]}
  });
}

async function audienceOptions(chatId: number, admin: AdminInfo, subjectId: string) {
  const teacherAllowed = [...ALL];
  const choices: {text:string;callback_data:string;sections:string[]}[] = [
    {text:"🌐 جميع الشعب",callback_data:"asg:aud:all",sections:[...ALL]},
    ...ALL.map(section=>({text:"شعبة "+section,callback_data:"asg:aud:sec:"+section,sections:[section]})),
  ];
  const visible = choices.filter(choice=>
    choice.sections.every(s=>teacherAllowed.includes(s as never)) &&
    validAudience(admin,subjectId,choice.sections)
  );
  await sendMessage(chatId, "🎯 اختيار الجمهور — تگدر ترجع للمعاينة:", {
    replyMarkup:{inline_keyboard:[...visible.map(x=>[{text:x.text,callback_data:x.callback_data}]),
    [{text:"🔙 المعاينة",callback_data:"asg:preview"}],...nav.inline_keyboard]}
  });
}

async function prompt(chatId: number, d: Draft, admin: AdminInfo) {
  switch(d.step) {
    case "subject": await subjectOptions(chatId,admin); return;
    case "audience": await audienceOptions(chatId,admin,String(d.subjectId||"")); return;
    case "details": await sendMessage(chatId,"✍️ أرسل نص الواجب برسالة وحدة. أول سطر راح يكون العنوان، وبقية النص تفاصيل الواجب.",{replyMarkup:nav}); return;
    case "due": await sendMessage(chatId,"📅 اختَر يوم التسليم فقط (بدون ساعة).\nاكتب التاريخ بهذا الشكل: 2026-11-20",{replyMarkup:nav}); return;
    case "submission": await sendMessage(chatId,"📨 اكتب طريقة التسليم (مثلاً ورقياً بالمحاضرة، أو عبر المنصة). أرسل «تخطي» إذا غير محددة.",{replyMarkup:nav}); return;
    case "attachment": await sendMessage(chatId,"📎 اختيارياً: أرسل ملف PDF/PPTX (حتى 20MB) أو رابط المرفق، أو أرسل «تخطي».",{replyMarkup:nav}); return;
    case "confirm": await showPreview(chatId,d); return;
    case "more": await showDetailsMenu(chatId); return;
    case "publishing": await sendMessage(chatId,"الطلب قيد النشر؛ لا تعِد الإرسال. راجع قسم الواجبات.",{replyMarkup:nav}); return;
    default: await sendMessage(chatId,"المسودة غير مكتملة. افتح نشر واجب من جديد.",{replyMarkup:nav});
  }
}

async function showDetailsMenu(chatId:number) {
  await sendMessage(chatId,"✏️ هاي التفاصيل اختيارية. اختَر فقط اللي تحتاجه:",{replyMarkup:{inline_keyboard:[
    [{text:"📄 تعديل النص",callback_data:"asg:edit:details"},{text:"📅 تعديل الموعد",callback_data:"asg:edit:due"}],
    [{text:"📨 طريقة التسليم",callback_data:"asg:edit:submission"},{text:"📎 مرفق PDF/رابط",callback_data:"asg:edit:attachment"}],
    [{text:"🔙 المعاينة",callback_data:"asg:preview"}],...nav.inline_keyboard,
  ]}});
}

async function showPreview(chatId: number, d: Draft) {
  const {setFlowState} = await botMethods();
  const nonce = randomBytes(8).toString("hex");
  const next = {...d,step:"confirm",nonce};
  await setFlowState(chatId,"asg",next);
  const subject = await qOne<{name:string}>("SELECT name FROM portal_subjects WHERE id=$1",[String(d.subjectId||"")]);
  const sections = Array.isArray(d.sections) ? d.sections.join("، ") : "";
  const due = assignmentDisplayDay(d.dueAt);
  const text = "📋 معاينة الواجب قبل النشر\n\n📘 المادة: " + (subject?.name || d.subjectId) +
    "\n🎯 الشعب: " + sections + "\n✍️ العنوان: " + String(d.title||"") +
    "\n📄 التعليمات: " + String(d.instructions||"") + "\n🗓 آخر موعد: " + due +
    (d.submission ? "\n📨 طريقة التسليم: " + String(d.submission) : "") +
    (d.attachmentUrl ? "\n📎 يوجد مرفق" : "");
  await sendMessage(chatId,text,{replyMarkup:{inline_keyboard:[
    [{text:"✅ نشر الواجب",callback_data:"pub:asg:"+nonce}],
    [{text:"🎯 تغيير الشعب",callback_data:"asg:edit:audience"},{text:"✏️ تفاصيل إضافية",callback_data:"asg:more"}],
    ...nav.inline_keyboard,
  ]}});
}

export async function startAssignmentFlow(chatId: number, userId: number) {
  const {getLinkedAdmin,setFlowState} = await botMethods();
  const admin = await getLinkedAdmin(userId);
  if (!admin || !canUseTelegramPublishing(admin)) {
    await sendMessage(chatId,"⛔ حسابك غير مخوّل لنشر الواجبات."); return;
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
    const sections=defaultAudience(admin,subjectId);
    if (!subject || !validAudience(admin,subjectId,sections)) {
      await sendMessage(chatId,"لا تملك صلاحية النشر لهذه المادة."); return;
    }
    const next = {...d,subjectId,sections,step:"details"};
    await setFlowState(chatId,"asg",next);await prompt(chatId,next,admin);return;
  }
  if (data.startsWith("asg:aud:")) {
    if (d.step !== "audience") return;
    const choice = data.slice("asg:aud:".length);
    const sections = choice==="all" ? [...ALL] : choice.startsWith("sec:") ? [choice.slice(4)] : [];
    if (!validAudience(admin,String(d.subjectId||""),sections)) {
      await sendMessage(chatId,"هذا الجمهور غير مسموح لحسابك."); return;
    }
    await showPreview(chatId,{...d,sections});return;
  }
  if (data === "asg:more") {
    if (d.step !== "confirm") return;
    await setFlowState(chatId,"asg",{...d,step:"more",nonce:undefined});
    await showDetailsMenu(chatId);return;
  }
  if (data === "asg:preview") {
    if (d.step !== "audience" && d.step !== "more") return;
    await showPreview(chatId,d);return;
  }
  if (data.startsWith("asg:edit:")) {
    if (d.step !== "confirm" && d.step !== "more") return;
    const step = data.slice("asg:edit:".length);
    if (!["details","due","submission","attachment","audience"].includes(step)) return;
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
      if (!fresh || !validAudience(fresh,String(d.subjectId||""),sections)) {
        await setFlowState(chatId,"",{});await sendMessage(chatId,"⛔ تم تغيير الصلاحيات؛ لم يُنشر الواجب.");return;
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
          ? "✅ تم نشر الواجب للطلاب.\n🔗 "+PORTAL_BASE_URL+"/assignments"
          : "ℹ️ الواجب منشور مسبقاً، ولم تتم إعادة نشره.",
          {replyMarkup:{inline_keyboard:[[ {text:"📋 نشر واجب آخر",callback_data:"adm:asg"} ],...nav.inline_keyboard]}});
      } else {
        await showPreview(chatId,d);
        await sendMessage(chatId,"⛔ لم يُنشر الواجب: "+res.error,{replyMarkup:nav});
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
  if (step==="details") {
    if (!text.trim()) {await sendMessage(chatId,"اكتب نص الواجب أولاً.");return;}
    const full=text.trim();
    const title=full.split(/\n/)[0].replace(/\s+/g," ").slice(0,180);
    const next={...d,title,instructions:full,step:"due"};
    if(d.dueAt)await showPreview(chatId,next);
    else {await setFlowState(chatId,"asg",next);await prompt(chatId,next,admin);}
    return;
  }
  if (step==="due") {
    const due=dueDateBaghdad(text);
    if(!due){await sendMessage(chatId,"⚠️ اكتب تاريخاً صحيحاً (اليوم أو بعده)، بدون ساعة. مثال: 2026-11-20");return;}
    await showPreview(chatId,{...d,dueAt:due});return;
  }
  if (step==="submission") {
    await showPreview(chatId,{...d,submission:skipped(text)?"":text.trim()});return;
  }
}
