// Extended bot UX: role-aware home menus, student browsing, content management
// (إدارة منشوراتي), direct-PDF flow B, draft recovery. All mutations go through
// publish.ts services -> identical server-side authorization as the website.
import {q, qOne} from "./db.ts";
import {sendMessage} from "./telegram.ts";
import {PORTAL_BASE_URL} from "./flags.ts";
import type {AdminInfo} from "./rbac.ts";
import {isActive, canUseTelegramPublishing, SECTIONS} from "./rbac.ts";
import {
  listOwnContent, updateAnnouncementOwn, updateLectureMetaOwn, replaceLectureFileOwn,
  archiveContent, deleteOwnContent,
} from "./publish.ts";
import type {LinkedAdmin} from "./bot.ts";
import {getLinkedAdmin, hasActiveFlow, adminMenu} from "./bot.ts";

const backHome = {inline_keyboard: [[{text: "🏠 القائمة الرئيسية", callback_data: "nav:home"}, {text: "❌ إلغاء", callback_data: "adm:cancel"}]]};
const PER_PAGE = 5;

// ---------- home menus ----------
export function homeMenuFor(admin: LinkedAdmin | null, isSubscriber: boolean) {
  if (admin && canUseTelegramPublishing(admin)) {
    return {inline_keyboard: [
      [{text: "✍️ نشر جديد", callback_data: "adm:new"}],
      [{text: "🗂 إدارة منشوراتي", callback_data: "adm:my"}],
      [{text: "👀 تصفح المحتوى (كطالب)", callback_data: "stu:home"}],
      [{text: "👤 حسابي", callback_data: "adm:me"}],
    ]};
  }
  return {inline_keyboard: [
    [{text: "📢 التبليغات", callback_data: "stu:ann"}],
    [{text: "📚 المحاضرات والملازم", callback_data: "stu:lec"}],
    [{text: "🗓 جدول شعبتي", callback_data: "stu:sched"}],
    [{text: "📝 الامتحانات والواجبات", callback_data: "stu:exams"}],
    [{text: "⚙️ إعدادات الإشعارات", callback_data: "stu:prefs"}],
    [{text: "❓ مساعدة", callback_data: "stu:help"}],
  ]};
}

async function subscriberSection(chatId: number): Promise<string> {
  const row = await qOne<{section: string}>(`SELECT section FROM tg_subscribers WHERE chat_id=$1`, [chatId]);
  return row?.section || "A";
}

// ---------- student browsing ----------
export async function handleStudentCallback(chatId: number, userId: number, data: string): Promise<void> {
  const sec = await subscriberSection(chatId);
  if (data === "stu:home") {
    const admin = await getLinkedAdmin(userId);
    await sendMessage(chatId, "مرحبًا بك في بوابة المرحلة الثالثة 🌟\nاختر من القائمة:", {replyMarkup: homeMenuFor(null, true)});
    return;
  }
  if (data === "stu:ann") {
    const rows = await q<Record<string, unknown>>(`SELECT title, section, published_at FROM portal_announcements WHERE archived_at IS NULL AND (scope='general' OR section='all' OR section=$1) ORDER BY published_at DESC LIMIT 8`, [sec]);
    const text = rows.length ? rows.map(r => `📢 ${r.title} — ${r.section === "all" ? "جميع الشعب" : "شعبة " + r.section}`).join("\n") : "لا توجد تبليغات حاليًا.";
    await sendMessage(chatId, `📢 التبليغات (شعبتك: ${sec}):\n\n${text}\n\n🔗 الموقع: ${PORTAL_BASE_URL}/announcements`, {replyMarkup: backHome});
    return;
  }
  if (data === "stu:lec") {
    const subs = await q<{id: string; name: string}>(`SELECT id, name FROM portal_subjects ORDER BY name`);
    await sendMessage(chatId, "📚 اختر المادة لعرض المحاضرات والملازم:", {replyMarkup: {inline_keyboard: [...subs.map(s => [{text: s.name, callback_data: "stu:lec:" + s.id}]), [{text: "🏠 القائمة الرئيسية", callback_data: "nav:home"}]]}});
    return;
  }
  if (data.startsWith("stu:lec:")) {
    const subj = data.slice(8);
    const rows = await q<Record<string, unknown>>(`SELECT number, title, file_url FROM portal_lectures WHERE archived_at IS NULL AND status='published' AND subject_id=$1 AND (sections IS NULL OR sections @> $2::jsonb OR sections::text LIKE '%'||$3||'%') ORDER BY number`, [subj, JSON.stringify([sec]), sec]);
    // portable fallback: filter in JS if @> unsupported
    const all = await q<Record<string, unknown>>(`SELECT number, title, file_url, sections FROM portal_lectures WHERE archived_at IS NULL AND status='published' AND subject_id=$1 ORDER BY number`, [subj]);
    const vis = all.filter(r => !Array.isArray(r.sections) || r.sections.includes(sec));
    const text = vis.length ? vis.map(r => `• محاضرة ${r.number}: ${r.title} — ${PORTAL_BASE_URL}/subjects/${subj}`).join("\n") : "لا توجد محاضرات منشورة لهذه المادة بعد.";
    void rows;
    await sendMessage(chatId, `📚 محاضرات وملازم المادة:\n\n${text}`, {replyMarkup: backHome});
    return;
  }
  if (data === "stu:sched") {
    const rows = await q<Record<string, unknown>>(`SELECT day, start, "end", subject_id, room, kind FROM portal_schedule WHERE section=$1 ORDER BY day, start LIMIT 12`, [sec]);
    const DAYS: Record<string, string> = {"6": "السبت", "0": "الأحد", "1": "الاثنين", "2": "الثلاثاء", "3": "الأربعاء"};
    const text = rows.length ? rows.map(r => `${DAYS[String(r.day)] || r.day} ${r.start}–${r.end} — ${r.subject_id} ${r.room ? "· " + r.room : ""}`).join("\n") : "لا يوجد جدول منشور لشعبتك بعد.";
    await sendMessage(chatId, `🗓 جدول شعبة ${sec}:\n\n${text}\n\n🔗 ${PORTAL_BASE_URL}/schedule`, {replyMarkup: backHome});
    return;
  }
  if (data === "stu:exams") {
    const exams = await q<Record<string, unknown>>(`SELECT title, date, type, room FROM portal_exams WHERE archived_at IS NULL AND (sections IS NULL OR sections::text LIKE '%'||$1||'%') ORDER BY date LIMIT 8`, [sec]);
    const asg = await q<Record<string, unknown>>(`SELECT title, due_at FROM portal_assignments WHERE archived_at IS NULL AND (sections IS NULL OR sections::text LIKE '%'||$1||'%') ORDER BY due_at LIMIT 8`, [sec]);
    const text = [
      exams.length ? "📝 الامتحانات:\n" + exams.map(e => `• ${e.title} — ${e.date} ${e.room ? "· " + e.room : ""}`).join("\n") : "",
      asg.length ? "📄 الواجبات:\n" + asg.map(a => `• ${a.title} — حتى ${a.due_at}`).join("\n") : "",
    ].filter(Boolean).join("\n\n") || "لا توجد امتحانات أو واجبات معلنة لشعبتك حاليًا.";
    await sendMessage(chatId, text + `\n\n🔗 ${PORTAL_BASE_URL}/exams`, {replyMarkup: backHome});
    return;
  }
  if (data === "stu:prefs") { await sendMessage(chatId, "⚙️ إعدادات الإشعارات — استخدم /settings أو الأزرار أدناه:", {replyMarkup: {inline_keyboard: [[{text: "🔔 تفعيل/تعطيل التبليغات", callback_data: "pref:announcements"}], [{text: "📚 تفعيل/تعطيل المحاضرات", callback_data: "pref:lectures"}], [{text: "📝 تفعيل/تعطيل الامتحانات", callback_data: "pref:exams"}], [{text: "📄 تفعيل/تعطيل الواجبات", callback_data: "pref:assignments"}], [{text: "🗓 تفعيل/تعطيل تغييرات الجدول", callback_data: "pref:schedule"}], [{text: "🔄 تغيير الشعبة", callback_data: "stu:sec"}], [{text: "🚫 إلغاء الاشتراك", callback_data: "stu:stop"}], [{text: "🏠 القائمة الرئيسية", callback_data: "nav:home"}]]}}); return; }
  if (data === "stu:sec") { await sendMessage(chatId, "اختر شعبتك الدراسية:", {replyMarkup: {inline_keyboard: SECTIONS.map(s => [{text: "شعبة " + s, callback_data: "sec:" + s}])}}); return; }
  if (data === "stu:stop") { await q(`UPDATE tg_subscribers SET status='stopped', updated_at=now() WHERE chat_id=$1`, [chatId]); await sendMessage(chatId, "🚫 تم إيقاف الإشعارات. يمكنك العودة في أي وقت عبر /start.", {replyMarkup: homeMenuFor(await getLinkedAdmin(userId), false)}); return; }
  if (data === "stu:help") {
    await sendMessage(chatId, "❓ كيف تستخدم البوت؟\n\n• تصفح المحتوى من القائمة الرئيسية.\n• changing الشعبة أو تفضيلات الإشعارات من «إعدادات الإشعارات».\n• لإيقاف الإشعارات: /stop أو من الإعدادات.\n\nللمسؤولين: استخدم «نشر جديد» من قائمة الناشر.", {replyMarkup: backHome});
    return;
  }
}

// ---------- manage own content ----------
export async function handleManageCallback(chatId: number, userId: number, data: string): Promise<void> {
  const admin = await getLinkedAdmin(userId);
  if (!admin || !isActive(admin)) { await sendMessage(chatId, "⚠️ حسابك غير مربوط أو معلّق.", {replyMarkup: backHome}); return; }

  if (data === "adm:my") {
    await sendMessage(chatId, "🗂 إدارة منشوراتي — اختر النوع:", {replyMarkup: {inline_keyboard: [
      [{text: "📢 تبليغاتي", callback_data: "page:my:announcements:0"}],
      [{text: "📚 موادي/ملازمي", callback_data: "page:my:lectures:0"}],
      [{text: "🏠 القائمة الرئيسية", callback_data: "nav:home"}],
    ]}});
    return;
  }
  if (data.startsWith("page:my:")) {
    const [, , type, pageStr] = data.split(":");
    const page = Number(pageStr) || 0;
    const {rows, total} = await listOwnContent(admin, type as "announcements" | "lectures", page, PER_PAGE);
    const kb: {text: string; callback_data: string}[][] = rows.map(r => [{text: `${type === "announcements" ? "📢" : "📚"} ${String(r.title).slice(0, 30)}${r.archived_at ? " (مؤرشف)" : ""}`, callback_data: `it:${type}:${r.id}`}]);
    const nav: {text: string; callback_data: string}[] = [];
    if (page > 0) nav.push({text: "⬅️ السابق", callback_data: `page:my:${type}:${page - 1}`});
    if ((page + 1) * PER_PAGE < total) nav.push({text: "➡️ التالي", callback_data: `page:my:${type}:${page + 1}`});
    nav.push({text: "🏠 القائمة الرئيسية", callback_data: "nav:home"});
    kb.push(nav);
    await sendMessage(chatId, rows.length ? `page ${page + 1} — الإجمالي ${total}. اختر عنصرًا:` : "لا توجد منشورات بعد.", {replyMarkup: {inline_keyboard: kb}});
    return;
  }
  if (data.startsWith("it:arch:")) {
    const [, , type, id] = data.split(":");
    const row = (await listOwnContent(admin, type as "announcements" | "lectures", 0, 100)).rows.find(r => r.id === id);
    const r = await archiveContent(admin, type as "announcements" | "lectures", id, !row?.archived_at);
    await sendMessage(chatId, r.ok ? (row?.archived_at ? "♻️ تمت الاستعادة." : "🗄 تمت الأرشفة — اختفى من الموقع temporarily." ) : `⛔ ${r.error}`, {replyMarkup: backHome});
    return;
  }
  if (data.startsWith("it:del:")) {
    const [, , type, id] = data.split(":");
    const row = (await listOwnContent(admin, type as "announcements" | "lectures", 0, 100)).rows.find(r => r.id === id);
    if (!row) { await sendMessage(chatId, "⚠️ العنصر غير موجود.", {replyMarkup: backHome}); return; }
    const aud = type === "lectures" ? "الجمهور: " + (Array.isArray(row.sections) && row.sections.length === 4 ? "جميع الشعب" : (row.sections as string[]).join(",")) : "الجمهور: شعبة " + row.section;
    await sendMessage(chatId, `🗑 حذف نهائي؟\n\n<b>${row.title}</b>\n${aud}\n\n⚠️ لا يمكن التراجع عن الحذف النهائي.`, {parseMode: "HTML", replyMarkup: {inline_keyboard: [
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
    await sendMessage(chatId, "📎 أرسل ملف PDF الجديد الآن — سيستبدل الملف الحالي مع بقاء نفس رابط المحاضرة.", {replyMarkup: backHome});
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
    const text = `${type === "announcements" ? "📢" : "📚"} <b>${row.title}</b>\nالجمهور: ${aud}${row.archived_at ? "\n🗄 الحالة: مؤرشف" : ""}${type === "lectures" ? `\n🔗 ${PORTAL_BASE_URL}/subjects/${row.subject_id}` : ""}`;
    const kb = {inline_keyboard: [
      [{text: "✏️ تعديل", callback_data: `it:edit:${type}:${id}`}],
      [{text: row.archived_at ? "♻️ استعادة" : "🗄 أرشفة", callback_data: `it:arch:${type}:${id}`}],
      ...(type === "lectures" ? [[{text: "📎 استبدال ملف PDF", callback_data: `it:rep:${id}`}]] : []),
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
  if (data === "nav:home") {
    if (admin && (await hasActiveFlow(chatId))) {
      // draft recovery: resume or discard
      await sendMessage(chatId, "📝 لديك مسودة غير منتهية. ماذا تريد؟", {replyMarkup: {inline_keyboard: [
        [{text: "▶️ استئناف المسودة", callback_data: "flow:resume"}],
        [{text: "🗑 تجاهل المسودة", callback_data: "flow:discard"}],
      ]}});
      return;
    }
    await sendMessage(chatId, "🏠 القائمة الرئيسية:", {replyMarkup: homeMenuFor(admin, true)});
    return;
  }
  if (data === "flow:discard") {
    const {setFlowState} = await import("./bot.ts");
    await setFlowState(chatId, "", {});
    await sendMessage(chatId, "🗑 تم تجاهل المسودة.", {replyMarkup: homeMenuFor(admin, true)});
    return;
  }
  if (data === "flow:resume") {
    await sendMessage(chatId, "▶️ استؤنفت المسودة — أكمل الخطوة الحالية.", {replyMarkup: homeMenuFor(admin, true)});
    return;
  }
  if (data === "adm:new") {
    await sendMessage(chatId, "✍️ نشر جديد — اختر النوع:", {replyMarkup: {inline_keyboard: [
      [{text: "📢 تبليغ", callback_data: "adm:ann"}],
      [{text: "📚 محاضرة / ملزمة (PDF)", callback_data: "adm:lec"}],
      [{text: "🏠 رجوع", callback_data: "nav:home"}],
    ]}});
    return;
  }
  // Flow B: a PDF sent directly (no active flow) -> offer to start a material draft
  if (document && admin && !(await hasActiveFlow(chatId))) {
    await sendMessage(chatId, `📎 استلمت ملف PDF${document.file_name ? `: ${document.file_name}` : ""}.\nهل تريد إنشاء «محاضرة/ملزمة» جديدة بهذا الملف؟`, {replyMarkup: {inline_keyboard: [
      [{text: "✅ نعم، إنشاء مادة بهذا الملف", callback_data: "pdf:new"}],
      [{text: "❌ لا", callback_data: "nav:home"}],
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
    await setFlowState(chatId, "lec", {step: "subject", draftId: `lec-tg-${chatId}-${Date.now()}`, pendingDoc: doc});
    const subjects = admin?.role === "teacher" ? (admin.assigned_subjects || []).map(id => ({id, name: id})) : await q<{id: string; name: string}>(`SELECT id, name FROM portal_subjects ORDER BY name`);
    await sendMessage(chatId, "📚 اختر المادة:", {replyMarkup: {inline_keyboard: (subjects || []).map(x => [{text: x.name, callback_data: "lec:subj:" + x.id}])}});
    return;
  }
}
