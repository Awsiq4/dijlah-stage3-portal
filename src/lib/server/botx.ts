// Extended bot UX: role-aware home menus, student browsing, content management
// (إدارة منشوراتي), direct-PDF flow B, draft recovery. All mutations go through
// publish.ts services -> identical server-side authorization as the website.
import {q, qOne} from "./db.ts";
import {randomBytes} from "node:crypto";
import {sendMessage} from "./telegram.ts";
import {PORTAL_BASE_URL} from "./flags.ts";
import {assignmentDisplayDay,baghdadToday} from "../assignment-date.ts";
import type {AdminInfo} from "./rbac.ts";
import {canUseTelegramPublishing, SECTIONS} from "./rbac.ts";
import {
  listOwnContent, updateAnnouncementOwn, updateLectureMetaOwn, replaceLectureFileOwn,
  archiveContent, deleteOwnContent,
} from "./publish.ts";
import type {LinkedAdmin} from "./bot.ts";
import {isBotOwner} from "./registry.ts";
import {getLinkedAdmin, hasActiveFlow, adminMenu, resumeDraft, escapeHtml} from "./bot.ts";
import {EXAM_KINDS, listPastQuestions, listOwnQuestions, getOwnPastQuestion, modifyPastQuestion, questionBankReady, validExamKind} from "./bot-question-bank.ts";

const backHome = {inline_keyboard: [[{text: "🏠 القائمة الرئيسية", callback_data: "nav:home"}]]};
const PER_PAGE = 5;

// ---------- home menus ----------
export function homeMenuFor(admin: AdminInfo | null, isSubscriber: boolean, telegramUserId?: number) {
  const ownerBtn = telegramUserId && isBotOwner(telegramUserId) ? [[{text: "👑 لوحة المالك", callback_data: "own:home"}]] : [];
  if (admin && canUseTelegramPublishing(admin)) {
    return {inline_keyboard: [
      [{text: "📢 نشر تبليغ", callback_data: "adm:quick"}],
      [{text: "➕ إضافة محتوى", callback_data: "adm:new"}],
      [{text: admin.role === "super_admin" ? "🗂 إدارة المحتوى" : "🗂 إدارة منشوراتي", callback_data: "adm:my"}],
      [{text: "👀 تصفح المحتوى (كطالب)", callback_data: "stu:home"}],
      [{text: "👤 حسابي", callback_data: "adm:me"}],
      ...(admin.role === "super_admin" ? [[{text: "⚙️ لوحة المالك والحسابات", url: PORTAL_BASE_URL + "/admin"}], [{text: "📊 ملخص الإدارة", callback_data: "nav:owner"}]] : []),
        ...ownerBtn,
    ]};
  }
  return {inline_keyboard: [
    [{text: "📢 التبليغات", callback_data: "stu:ann"}],
    [{text: "📚 المحاضرات والملازم", callback_data: "stu:lec"}],
    [{text: "📂 الملخصات وبنك الأسئلة", callback_data: "stu:resources"}],
    [{text: "🗓 جدول شعبتي", callback_data: "stu:sched"}],
    [{text: "📝 الامتحانات والواجبات", callback_data: "stu:exams"}],
    [{text: "⚙️ إعدادات الإشعارات", callback_data: "stu:prefs"}],
    [{text: "❓ مساعدة", callback_data: "stu:help"}],
    ...ownerBtn,
  ]};
}

async function subscriberSection(chatId: number): Promise<string> {
  const row = await qOne<{section: string}>(`SELECT section FROM tg_subscribers WHERE chat_id=$1`, [chatId]);
  return row?.section || "";
}

// ---------- student browsing ----------
export async function handleStudentCallback(chatId: number, userId: number, data: string): Promise<void> {
  const sec = await subscriberSection(chatId);
  if (!sec && !["stu:home", "stu:help", "stu:sec"].includes(data)) { await sendMessage(chatId, "اختر شعبتك أولًا:", {replyMarkup: {inline_keyboard: SECTIONS.map(x => [{text: "شعبة " + x, callback_data: "sec:" + x}])}}); return; }
  if (data === "stu:home") {
    const admin = await getLinkedAdmin(userId);
    await sendMessage(chatId, "مرحبًا بك في بوابة المرحلة الثالثة 🌟\nاختر من القائمة:", {replyMarkup: homeMenuFor(null, true, userId)});
    return;
  }
  if (data === "stu:ann") {
    const rows = await q<Record<string, unknown>>(`SELECT id, title, section, published_at FROM portal_announcements WHERE archived_at IS NULL AND (scope='general' OR section='all' OR section=$1) ORDER BY published_at DESC LIMIT 8`, [sec]);
    const text = rows.length ? rows.map(r => `📢 ${r.title} — ${r.section === "all" ? "جميع الشعب" : "شعبة " + r.section}`).join("\n") : "لا توجد تبليغات حاليًا.";
    await sendMessage(chatId, `📢 التبليغات (شعبتك: ${sec}):\n\n${text}\n\n🔗 الموقع: ${PORTAL_BASE_URL}/announcements`, {replyMarkup: {inline_keyboard: [...rows.map(r => [{text: String(r.title).slice(0, 45), callback_data: "stu:read:" + r.id}]), ...backHome.inline_keyboard]}});
    return;
  }
  if (data.startsWith("stu:read:")) {
    const row = await qOne<{title: string; body: string}>(`SELECT title, body FROM portal_announcements WHERE id=$1 AND archived_at IS NULL AND (scope='general' OR section='all' OR section=$2)`, [data.slice(9), sec]);
    await sendMessage(chatId, row ? `${escapeHtml(row.title)}\n\n${row.body}`.slice(0, 3900) : "التبليغ غير متاح لشعبتك.", {replyMarkup: backHome}); return;
  }
  if (data === "stu:lec") {
    const subs = await q<{id: string; name: string}>(`SELECT id, name FROM portal_subjects ORDER BY name`);
    await sendMessage(chatId, "📚 اختر المادة لعرض المحاضرات والملازم:", {replyMarkup: {inline_keyboard: [...subs.map(s => [{text: s.name, callback_data: "stu:lec:" + s.id}]), [{text: "🏠 القائمة الرئيسية", callback_data: "nav:home"}]]}});
    return;
  }
  if (data.startsWith("stu:lec:")) {
    const subj = data.slice(8);
    const all = await q<Record<string, unknown>>(`SELECT id, number, title, file_url, sections FROM portal_lectures WHERE archived_at IS NULL AND status='published' AND subject_id=$1 AND material_kind='lecture' ORDER BY number`, [subj]);
    const vis = all.filter(r => !Array.isArray(r.sections) || r.sections.includes(sec));
    const text = vis.length ? vis.map(r => `• محاضرة ${r.number}: ${r.title} — ${PORTAL_BASE_URL}/subjects/${subj}`).join("\n") : "لا توجد محاضرات منشورة لهذه المادة بعد.";

    await sendMessage(chatId, `📚 محاضرات وملازم المادة:\n\n${text}`.slice(0, 3500), {replyMarkup: {inline_keyboard: [...vis.slice(0, 20).map(r => [{text: "📎 " + String(r.title).slice(0, 40), url: new URL(String(r.file_url), PORTAL_BASE_URL).toString()}]), ...backHome.inline_keyboard]}});
    return;
  }
  if (data === "stu:resources") {
    await sendMessage(chatId, "📂 المصادر الدراسية — اختر القسم:", {replyMarkup: {inline_keyboard: [
      [{text: "📝 الملخصات والملفات المساعدة", callback_data: "stu:summaries"}],
      [{text: "📑 بنك أسئلة الامتحانات السابقة", callback_data: "stu:bank"}],
      ...backHome.inline_keyboard,
    ]}});
    return;
  }
  if (data === "stu:summaries" || data === "stu:bank") {
    const subs = await q<{id: string; name: string}>(`SELECT id, name FROM portal_subjects ORDER BY name`);
    await sendMessage(chatId, data === "stu:bank" ? "📑 اختر المادة لعرض الأسئلة السابقة:" : "📝 اختر المادة لعرض الملخصات:", {replyMarkup: {inline_keyboard: [
      ...subs.map(s => [{text: s.name, callback_data: (data === "stu:bank" ? "stu:bank:" : "stu:summaries:") + s.id}]), ...backHome.inline_keyboard,
    ]}});
    return;
  }
  if (data.startsWith("stu:summaries:")) {
    const subjectId = data.slice("stu:summaries:".length);
    const rows = await q<{id:string;title:string;file_url:string;sections:string[]}>(`SELECT id,title,file_url,sections FROM portal_lectures
      WHERE subject_id=$1 AND material_kind='summary' AND status='published' AND archived_at IS NULL ORDER BY created_at DESC LIMIT 50`, [subjectId]);
    const visible = rows.filter(row => Array.isArray(row.sections) && row.sections.includes(sec)).slice(0, 20);
    await sendMessage(chatId, visible.length ? "📝 ملخصات المادة — اختر الملف:" : "لا توجد ملخصات منشورة لشعبتك حالياً.", {replyMarkup: {inline_keyboard: [
      ...visible.map(row => [{text: "📎 " + row.title.slice(0, 38), url: row.file_url}]), ...backHome.inline_keyboard,
    ]}});
    return;
  }
  if (data.startsWith("stu:bank:")) {
    const rest = data.slice("stu:bank:".length);
    const [subjectId, kind] = rest.split(":");
    const exists = await qOne<{id:string}>(`SELECT id FROM portal_subjects WHERE id=$1`, [subjectId]);
    if (!exists) { await sendMessage(chatId, "المادة غير موجودة.", {replyMarkup: backHome}); return; }
    if (!kind) {
      await sendMessage(chatId, "📑 بنك الأسئلة — حدد نوع الامتحان:", {replyMarkup: {inline_keyboard: [
        ...Object.entries(EXAM_KINDS).map(([k,label])=>[{text: label, callback_data: "stu:bank:" + subjectId + ":" + k}]),
        ...backHome.inline_keyboard,
      ]}});
      return;
    }
    if (!validExamKind(kind)) return;
    const rows = await listPastQuestions(subjectId, sec, kind);
    await sendMessage(chatId, rows.length ? `📑 أسئلة ${EXAM_KINDS[kind]} السابقة — اختر الملف:` : await questionBankReady()
      ? "لا توجد أسئلة منشورة من هذا النوع لشعبتك حالياً."
      : "⏳ بنك الأسئلة قيد الإعداد.", {replyMarkup: {inline_keyboard: [
      ...rows.map(item=>[{text: "📎 " + item.title.slice(0, 40),
        url: `${PORTAL_BASE_URL}/questions/${encodeURIComponent(item.id)}?section=${encodeURIComponent(sec)}`}]),
      [{text: "🔙 أنواع الامتحانات", callback_data: "stu:bank:" + subjectId}],
      ...backHome.inline_keyboard,
    ]}});
    return;
  }
  if (data === "stu:sched") {
    await sendMessage(chatId, "أي جدول تريد؟", {replyMarkup: {inline_keyboard: [[{text: "اليوم", callback_data: "stu:sched:today"}, {text: "غدًا", callback_data: "stu:sched:tomorrow"}], [{text: "الأسبوع كاملًا", callback_data: "stu:sched:week"}], ...backHome.inline_keyboard]}}); return;
  }
  if (data.startsWith("stu:sched:")) {
    const rows = await q<Record<string, unknown>>(`SELECT s.day, s.start, s."end", COALESCE(p.name,s.subject_id) AS subject_id, s.room, s.kind FROM portal_schedule s LEFT JOIN portal_subjects p ON p.id=s.subject_id WHERE s.section=$1 ORDER BY s.day, s.start`, [sec]);
    const DAYS: Record<string, string> = {"6": "السبت", "0": "الأحد", "1": "الاثنين", "2": "الثلاثاء", "3": "الأربعاء", "4": "الخميس", "5": "الجمعة"};
    const weekday = new Intl.DateTimeFormat("en-US", {timeZone:"Asia/Baghdad", weekday:"short"}).format(new Date());
    const today = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(weekday);
    const visible = data.endsWith(":week") ? rows : rows.filter(r => Number(r.day) === (today + (data.endsWith(":tomorrow") ? 1 : 0)) % 7);
    const text = visible.length ? visible.map(r => `${DAYS[String(r.day)] || r.day} ${r.start}–${r.end} — ${r.subject_id} ${r.room ? "· " + r.room : ""}`).join("\n") : "لا توجد محاضرات لهذا اليوم أو لم يُنشر الجدول بعد.";
    await sendMessage(chatId, `🗓 جدول شعبة ${sec}:\n\n${text}\n\n🔗 ${PORTAL_BASE_URL}/schedule`, {replyMarkup: backHome});
    return;
  }
  if (data === "stu:exams") {
    // Exam dates are YYYY-MM-DD TEXT, not PostgreSQL DATE. Compare with a
    // Baghdad calendar-day TEXT parameter to avoid text >= date SQL errors.
    const exams = await q<Record<string, unknown>>(`SELECT title, date, type, room FROM portal_exams
      WHERE archived_at IS NULL AND status <> 'cancelled'
      AND sections @> $1::jsonb AND date >= $2::text
      ORDER BY date, start_time LIMIT 8`, [JSON.stringify([sec]),baghdadToday()]);
    const asg = await q<Record<string, unknown>>(`SELECT title, due_at FROM portal_assignments
      WHERE archived_at IS NULL AND status = 'active'
      AND sections @> $1::jsonb AND LEFT(due_at,10) >= $2::text
      ORDER BY due_at LIMIT 8`, [JSON.stringify([sec]),baghdadToday()]);
    const text = [
      exams.length ? "📝 الامتحانات:\n" + exams.map(e => `• ${e.title} — ${e.date} ${e.room ? "· " + e.room : ""}`).join("\n") : "",
      asg.length ? "📄 الواجبات:\n" + asg.map(a => `• ${a.title} — حتى ${assignmentDisplayDay(a.due_at)}`).join("\n") : "",
    ].filter(Boolean).join("\n\n") || "لا توجد امتحانات أو واجبات معلنة لشعبتك حاليًا.";
    await sendMessage(chatId, text + `\n\n🔗 ${PORTAL_BASE_URL}/exams`, {replyMarkup: backHome});
    return;
  }
  if (data === "stu:prefs") { await sendMessage(chatId, "⚙️ إعدادات الإشعارات — استخدم /settings أو الأزرار أدناه:", {replyMarkup: {inline_keyboard: [[{text: "🔔 تفعيل/تعطيل التبليغات", callback_data: "pref:announcements"}], [{text: "📚 تفعيل/تعطيل المحاضرات", callback_data: "pref:lectures"}], [{text: "📝 تفعيل/تعطيل الامتحانات", callback_data: "pref:exams"}], [{text: "📄 تفعيل/تعطيل الواجبات", callback_data: "pref:assignments"}], [{text: "🗓 تفعيل/تعطيل تغييرات الجدول", callback_data: "pref:schedule"}], [{text: "🔄 تغيير الشعبة", callback_data: "stu:sec"}], [{text: "🚫 إلغاء الاشتراك", callback_data: "stu:stop"}], [{text: "🏠 القائمة الرئيسية", callback_data: "nav:home"}]]}}); return; }
  if (data === "stu:sec") { await sendMessage(chatId, "اختر شعبتك الدراسية:", {replyMarkup: {inline_keyboard: SECTIONS.map(s => [{text: "شعبة " + s, callback_data: "sec:" + s}])}}); return; }
  if (data === "stu:stop") { await q(`UPDATE tg_subscribers SET status='stopped', updated_at=now() WHERE chat_id=$1`, [chatId]); await sendMessage(chatId, "🚫 تم إيقاف الإشعارات. يمكنك العودة في أي وقت عبر /start.", {replyMarkup: homeMenuFor(await getLinkedAdmin(userId), false, userId)}); return; }
  if (data === "stu:help") {
    await sendMessage(chatId, "❓ كيف تستخدم البوت؟\n\n• تصفح المحتوى من القائمة الرئيسية.\n• تغيير الشعبة أو تفضيلات الإشعارات من «إعدادات الإشعارات».\n• لإيقاف الإشعارات: /stop أو من الإعدادات.\n\nللمسؤولين: استخدم «نشر جديد» من قائمة الناشر.", {replyMarkup: backHome});
    return;
  }
}

// ---------- manage own content ----------
export async function handleManageCallback(chatId: number, userId: number, data: string): Promise<void> {
  const admin = await getLinkedAdmin(userId);
  if (!admin || !canUseTelegramPublishing(admin)) { await sendMessage(chatId, "⚠️ حسابك غير مخوّل لإدارة المنشورات.", {replyMarkup: backHome}); return; }
  if (data.startsWith("cw:")) {
    const {handleCourseworkCallback}=await import("./bot-coursework-manage.ts");
    await handleCourseworkCallback(chatId,userId,data);return;
  }

  if (data === "adm:my") {
    await sendMessage(chatId, "🗂 إدارة منشوراتي — اختر النوع:", {replyMarkup: {inline_keyboard: [
      [{text: "📢 تبليغاتي", callback_data: "page:my:announcements:0"}],
      [{text: "📚 محاضراتي وملخصاتي", callback_data: "page:my:lectures:0"}],
      [{text: "📋 الواجبات", callback_data: "cw:p:a:0"}],
      [{text: "📝 الكوزات اليومية", callback_data: "cw:p:q:0"}],
      [{text: "📑 أسئلة الامتحانات السابقة", callback_data: "page:my:questions:0"}],
      [{text: "🏠 القائمة الرئيسية", callback_data: "nav:home"}],
    ]}});
    return;
  }
  if (data.startsWith("page:my:questions:")) {
    const page = Math.max(0, Number(data.split(":")[3]) || 0);
    const rows = await listOwnQuestions(admin, page);
    await sendMessage(chatId, rows.length ? `📑 بنك الأسئلة — صفحة ${page + 1}:` : "لا توجد أسئلة سابقة أضفتها.", {replyMarkup: {inline_keyboard: [
      ...rows.map(item => [{text: EXAM_KINDS[item.exam_kind] + " · " + item.title.slice(0, 28), callback_data: "it:q:" + item.id}]),
      ...(rows.length === 12 ? [[{text:"➡️ التالي",callback_data:"page:my:questions:"+(page+1)}]] : []),
      ...(page ? [[{text:"⬅️ السابق",callback_data:"page:my:questions:"+(page-1)}]] : []),
      ...backHome.inline_keyboard,
    ]}});
    return;
  }
  if (data.startsWith("page:my:")) {
    const [, , type, pageStr] = data.split(":");
    const page = Number(pageStr);
    if ((type !== "announcements" && type !== "lectures") || !Number.isSafeInteger(page) || page < 0 || page > 1000) return;
    const {rows, total} = await listOwnContent(admin, type, page, PER_PAGE);
    const kb: {text: string; callback_data: string}[][] = rows.map(r => [{text: `${type === "announcements" ? "📢" : "📚"} ${String(r.title).slice(0, 30)}${r.archived_at ? " (مؤرشف)" : ""}`, callback_data: `it:${type}:${r.id}`}]);
    const nav: {text: string; callback_data: string}[] = [];
    if (page > 0) nav.push({text: "⬅️ السابق", callback_data: `page:my:${type}:${page - 1}`});
    if ((page + 1) * PER_PAGE < total) nav.push({text: "➡️ التالي", callback_data: `page:my:${type}:${page + 1}`});
    nav.push({text: "🏠 القائمة الرئيسية", callback_data: "nav:home"});
    kb.push(nav);
    await sendMessage(chatId, rows.length ? `صفحة ${page + 1} — الإجمالي ${total}. اختر عنصرًا:` : "لا توجد منشورات بعد.", {replyMarkup: {inline_keyboard: kb}});
    return;
  }
  if (data.startsWith("it:q:")) {
    const id = data.slice("it:q:".length);
    const item = await getOwnPastQuestion(admin, id);
    if (!item) { await sendMessage(chatId, "العنصر غير متاح في هذه الصفحة.", {replyMarkup: backHome}); return; }
    await sendMessage(chatId, `📑 ${item.title}\n${EXAM_KINDS[item.exam_kind]} · ${item.subject_id}\n${item.archived_at ? "مؤرشف" : "منشور"}`, {replyMarkup: {inline_keyboard: [
      [{text: "📎 عرض الملف", url: item.file_url}],
      [{text: item.archived_at ? "♻️ استعادة" : "🗄 أرشفة", callback_data: "qmanage:" + (item.archived_at ? "restore" : "archive") + ":" + id}],
      [{text: "🗑 حذف نهائي", callback_data: "qmanage:confirm:" + id}],
      ...backHome.inline_keyboard,
    ]}});
    return;
  }
  if (data.startsWith("qmanage:")) {
    const [, action, id] = data.split(":");
    if (action === "confirm") {
      await sendMessage(chatId, "⚠️ الحذف نهائي ولا يمكن التراجع عنه. هل أنت متأكد؟", {replyMarkup: {inline_keyboard: [
        [{text: "🗑 نعم، حذف نهائي", callback_data: "qmanage:delete:" + id}],
        [{text: "❌ إلغاء", callback_data: "it:q:" + id}],
      ]}});
      return;
    }
    if (action !== "archive" && action !== "restore" && action !== "delete") return;
    const result = await modifyPastQuestion(admin, id, action);
    await sendMessage(chatId, result ? "✅ تم تحديث أسئلة الامتحان." : "⛔ تعذّر التنفيذ أو لا تملك الصلاحية.", {replyMarkup: backHome});
    return;
  }
  if (data.startsWith("it:arch:")) {
    const [, , type, id] = data.split(":");
    const row = (await listOwnContent(admin, type as "announcements" | "lectures", 0, 100)).rows.find(r => r.id === id);
    const r = await archiveContent(admin, type as "announcements" | "lectures", id, !row?.archived_at);
    await sendMessage(chatId, r.ok ? (row?.archived_at ? "♻️ تمت الاستعادة." : "🗄 تمت الأرشفة — اختفى من الموقع مؤقتًا." ) : `⛔ ${r.error}`, {replyMarkup: backHome});
    return;
  }
  if (data.startsWith("it:del:")) {
    const [, , type, id] = data.split(":");
    const row = (await listOwnContent(admin, type as "announcements" | "lectures", 0, 100)).rows.find(r => r.id === id);
    if (!row) { await sendMessage(chatId, "⚠️ العنصر غير موجود.", {replyMarkup: backHome}); return; }
    const aud = type === "lectures" ? "الجمهور: " + (Array.isArray(row.sections) && row.sections.length === 4 ? "جميع الشعب" : (row.sections as string[]).join(",")) : "الجمهور: شعبة " + row.section;
    await sendMessage(chatId, `🗑 حذف نهائي؟\n\n<b>${escapeHtml(row.title)}</b>\n${aud}\n\n⚠️ لا يمكن التراجع عن الحذف النهائي.`, {parseMode: "HTML", replyMarkup: {inline_keyboard: [
      [{text: "✅ نعم، احذف نهائيًا", callback_data: `it:delok:${type}:${id}`}],
      [{text: "🗄 أرشفة بدلًا من الحذف", callback_data: `it:arch:${type}:${id}`}],
      [{text: "❌ إلغاء", callback_data: `it:${type}:${id}`}],
    ]}});
    return;
  }
  if (data.startsWith("it:delok:")) {
    const [, , type, id] = data.split(":");
    const r = await deleteOwnContent(admin, type as "announcements" | "lectures", id);
    await sendMessage(chatId, r.ok ? "🗑 تم الحذف نهائيًا." : `⛔ ${r.error}`, {replyMarkup: {inline_keyboard: [[{text: "🗂 منشوراتي", callback_data: "adm:my"}], [{text: "🏠 القائمة الرئيسية", callback_data: "nav:home"}]]}});
    return;
  }
  if (data.startsWith("it:rep:")) {
    const [, , id] = data.split(":");
    await sendMessage(chatId, "📎 أرسل ملف PDF أو PPTX الجديد الآن — سيستبدل الملف الحالي مع بقاء نفس رابط المحاضرة.", {replyMarkup: backHome});
    // store pending replace in bot state
    const {setFlowState} = await import("./bot.ts");
    await setFlowState(chatId, "repfile", {id});
    return;
  }
  if (data.startsWith("it:edit:")) {
    const [, , type, id] = data.split(":");
    const {setFlowState} = await import("./bot.ts");
    await setFlowState(chatId, type === "announcements" ? "editann" : "editmeta", {id, step: "title"});
    await sendMessage(chatId, "✏️ العنوان الجديد (أرسل «تخطَّ» للإبقاء على الحالي):", {replyMarkup: backHome});
    return;
  }
  if (data.startsWith("it:")) {
    const [, type, id] = data.split(":");
    const {rows} = await listOwnContent(admin, type as "announcements" | "lectures", 0, 100);
    const row = rows.find(r => r.id === id);
    if (!row) { await sendMessage(chatId, "⚠️ هذا العنصر غير موجود أو ليس ملكك.", {replyMarkup: backHome}); return; }
    const aud = type === "lectures" ? (Array.isArray(row.sections) && row.sections.length === 4 ? "🌐 جميع الشعب" : "شعبة " + (row.sections as string[]).join(",")) : (row.section === "all" ? "🌐 جميع الشعب" : "شعبة " + row.section);
    const text = `${type === "announcements" ? "📢" : "📚"} <b>${escapeHtml(row.title)}</b>\nالجمهور: ${aud}${row.archived_at ? "\n🗄 الحالة: مؤرشف" : ""}${type === "lectures" ? `\n🔗 ${PORTAL_BASE_URL}/subjects/${row.subject_id}` : ""}`;
    const kb = {inline_keyboard: [
      [{text: "✏️ تعديل", callback_data: `it:edit:${type}:${id}`}],
      [{text: row.archived_at ? "♻️ استعادة" : "🗄 أرشفة", callback_data: `it:arch:${type}:${id}`}],
      ...(type === "lectures" ? [[{text: "📎 استبدال الملف", callback_data: `it:rep:${id}`}]] : []),
      [{text: "🗑 حذف نهائي", callback_data: `it:del:${type}:${id}`}],
      [{text: "🔙 رجوع", callback_data: `page:my:${type}:0`}],
    ]};
    await sendMessage(chatId, text, {parseMode: "HTML", replyMarkup: kb});
    return;
  }

}

// ---------- navigation + draft recovery + Flow B ----------
export async function handleNavCallback(chatId: number, userId: number, data: string, document?: {file_id: string; file_name?: string; mime_type?: string; file_size?: number}): Promise<void> {
  const admin = await getLinkedAdmin(userId);
  if ((data.startsWith("adm:") || data === "pdf:new") && (!admin || !canUseTelegramPublishing(admin))) {
    await sendMessage(chatId, "⚠️ حسابك غير مخوّل للنشر.", {replyMarkup: backHome});
    return;
  }
  if (data === "nav:owner") {
    if (admin?.role !== "super_admin") return;
    const counts = await qOne<{admins: number; lectures: number; announcements: number; subscribers: number}>(`SELECT (SELECT count(*) FROM portal_admins) AS admins, (SELECT count(*) FROM portal_lectures) AS lectures, (SELECT count(*) FROM portal_announcements) AS announcements, (SELECT count(*) FROM tg_subscribers WHERE status='active') AS subscribers`);
    await sendMessage(chatId, `ملخص الإدارة\nالحسابات: ${counts?.admins}\nالملازم: ${counts?.lectures}\nالتبليغات: ${counts?.announcements}\nالمشتركون النشطون: ${counts?.subscribers}`, {replyMarkup: homeMenuFor(admin, true, userId)}); return;
  }
  if (data === "nav:home") {
    const subscriber = await qOne<{section: string; status: string}>(`SELECT section, status FROM tg_subscribers WHERE chat_id=$1`, [chatId]);
    if (!admin && !isBotOwner(userId) && (!subscriber || !subscriber.section)) { await sendMessage(chatId, "أهلًا بك! اختر شعبتك لتفعيل الإشعارات وعرض محتواها:", {replyMarkup: {inline_keyboard: SECTIONS.map(x => [{text: "شعبة " + x, callback_data: "sec:" + x}])}}); return; }
    if (!admin && subscriber?.status !== "active") { await sendMessage(chatId, "إشعاراتك متوقفة. تقدر تتصفح أو تعيد تفعيلها:", {replyMarkup: {inline_keyboard: [[{text: "🔔 إعادة تفعيل الإشعارات", callback_data: "sec:" + subscriber?.section}], ...homeMenuFor(null, false).inline_keyboard]}}); return; }

    if (admin && (await hasActiveFlow(chatId))) {
      // draft recovery: resume or discard
      await sendMessage(chatId, "📝 لديك مسودة غير منتهية. ماذا تريد؟", {replyMarkup: {inline_keyboard: [
        [{text: "▶️ استئناف المسودة", callback_data: "flow:resume"}],
        [{text: "🗑 تجاهل المسودة", callback_data: "flow:discard"}],
      ]}});
      return;
    }
    await sendMessage(chatId, `🏠 القائمة الرئيسية${subscriber ? " — شعبة " + subscriber.section : ""}:`, {replyMarkup: homeMenuFor(admin, true, userId)});
    return;
  }
  if (data === "flow:discard") {
    const {setFlowState} = await import("./bot.ts");
    await setFlowState(chatId, "", {});
    await sendMessage(chatId, "🗑 تم تجاهل المسودة.", {replyMarkup: homeMenuFor(admin, true, userId)});
    return;
  }
  if (data === "flow:resume") {
    await resumeDraft(chatId, userId);
    return;
  }
  if (data === "adm:new") {
    await sendMessage(chatId, "➕ شنو تريد تنشر؟", {replyMarkup: {inline_keyboard: [
      [{text: "📚 محاضرة أو ملخص", callback_data: "adm:materials"}],
      [{text: "📋 واجب", callback_data: "adm:asg"}],
      [{text: "📝 كوز يومي", callback_data: "adm:exam"}],
      [{text: "📑 أسئلة امتحانات سابقة", callback_data: "adm:questions"}],
      [{text: "🏠 الرئيسية", callback_data: "nav:home"}],
    ]}});
    return;
  }
  if (data === "adm:materials") {
    await sendMessage(chatId,"📚 اختر نوع الملف:",{replyMarkup:{inline_keyboard:[
      [{text:"📘 محاضرة / ملزمة",callback_data:"adm:lec"}],
      [{text:"📄 ملخص / ملف مساعد",callback_data:"adm:summary"}],
      [{text:"🔙 رجوع",callback_data:"adm:new"}],
    ]}});
    return;
  }
  // Flow B: a PDF/PPTX sent directly (no active flow) -> offer to start a material draft
  if (document && admin && !(await hasActiveFlow(chatId))) {
    await sendMessage(chatId, `📎 استلمت ملفًا${document.file_name ? `: ${document.file_name}` : ""}.\nهل تريد إنشاء «محاضرة/ملزمة» جديدة بهذا الملف؟`, {replyMarkup: {inline_keyboard: [
      [{text: "✅ نعم، إنشاء مادة بهذا الملف", callback_data: "pdf:new"}],
      [{text: "❌ لا", callback_data: "flow:discard"}],
    ]}});
    const {setFlowState} = await import("./bot.ts");
    await setFlowState(chatId, "pendingpdf", {file_id: document.file_id, file_name: document.file_name, mime_type: document.mime_type, file_size: document.file_size});
    return;
  }
  if (data === "pdf:new") {
    const {setFlowState, getFlowState} = await import("./bot.ts");
    const st = await getFlowState(chatId);
    const doc = (st?.data || {}) as {file_id?: string; file_name?: string};
    if (!doc.file_id) { await sendMessage(chatId, "⚠️ انتهت صلاحية الملف — أرسله من جديد."); return; }
    // start lec flow with the file pre-attached
    await setFlowState(chatId, "lec", {step: "subject", draftId: `lec-tg-${randomBytes(12).toString("hex")}`, pendingDoc: doc});
    const all = await q<{id: string; name: string}>(`SELECT id, name FROM portal_subjects ORDER BY name`);
    const subjects = admin?.role === "teacher" ? all.filter(x => admin.assigned_subjects?.includes(x.id)) : all;
    await sendMessage(chatId, "📚 اختر المادة:", {replyMarkup: {inline_keyboard: (subjects || []).map(x => [{text: x.name, callback_data: "lec:subj:" + x.id}])}});
    return;
  }
}
