// Telegram bot: account linking + direct publishing flows.
// The bot uses the SAME publish service as the website (publish.ts) — one backend.
// Conversation state is persisted in portal_bot_state (survives serverless restarts).
import {randomBytes} from "node:crypto";
import {homeMenuFor} from "./botx.ts";
import {q, qOne, withTx} from "./db.ts";
import {sendMessage} from "./telegram.ts";
import {hashToken, isActive, canUseTelegramPublishing, teacherSections, type AdminInfo} from "./rbac.ts";
import {publishAnnouncement, publishLecture, updateAnnouncementOwn, updateLectureMetaOwn, replaceLectureFileOwn} from "./publish.ts";
import {BOT_TOKEN, PORTAL_BASE_URL} from "./flags.ts";
import {tgFetch} from "./telegram.ts";
import {uploadLecturePdf, isPdf, MAX_PDF_BYTES, storageConfigured} from "./storage.ts";


export type LinkedAdmin = AdminInfo & {link_id: number};

export async function getLinkedAdmin(telegramUserId: number): Promise<LinkedAdmin | null> {
  const row = await qOne<LinkedAdmin>(
    `SELECT a.id, a.email, a.role, a.is_active, a.status, a.name, a.assigned_section, a.assigned_subjects, a.perms, l.id AS link_id
     FROM portal_telegram_links l JOIN portal_admins a ON a.id = l.admin_id
     WHERE l.telegram_user_id=$1 AND l.revoked_at IS NULL AND a.is_active=true`,
    [telegramUserId]
  );
  if (!row || !isActive(row)) return null;
  return row;
}

// ---- /start link_<payload> : bind this Telegram user to the invited admin account ----
export async function handleLinkStart(chatId: number, userId: number, arg: string): Promise<void> {
  const raw = arg.replace(/^link_/, "");
  const digest = hashToken(raw);
  const admin = await withTx(async db => {
    // Serialize linking, unlinking and suspension against the same account row.
    const account = await db.qOne<AdminInfo>(
      `SELECT a.* FROM portal_admins a JOIN portal_link_tokens t ON t.admin_id=a.id
       WHERE t.token_hash=$1 AND t.used_at IS NULL AND t.expires_at>now() FOR UPDATE OF a`,
      [digest]
    );
    if (!account || !canUseTelegramPublishing(account)) return null;
    const used = await db.qOne(
      `UPDATE portal_link_tokens SET used_at=now()
       WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() RETURNING token_hash`, [digest]
    );
    if (!used) return null;
    const link = await db.qOne(
      `INSERT INTO portal_telegram_links (admin_id, telegram_user_id) VALUES ($1,$2)
       ON CONFLICT (telegram_user_id) DO UPDATE SET admin_id=EXCLUDED.admin_id, revoked_at=NULL, linked_at=now()
       WHERE portal_telegram_links.revoked_at IS NOT NULL OR portal_telegram_links.admin_id=EXCLUDED.admin_id
       RETURNING id`, [account.id, userId]
    );
    if (!link) return null;
    await db.q(`UPDATE portal_telegram_links SET revoked_at=now() WHERE admin_id=$1 AND telegram_user_id<>$2 AND revoked_at IS NULL`, [account.id, userId]);
    await db.q(`UPDATE portal_link_tokens SET used_at=now() WHERE admin_id=$1 AND used_at IS NULL`, [account.id]);
    await db.q(`INSERT INTO portal_audit (actor, action, detail) VALUES ($1,$2,$3)`, [account.email, "telegram.link.bound", {telegram_user_id: userId}]);
    return account;
  });
  if (!admin) {
    await sendMessage(chatId, "⚠️ تعذّر الربط. تحقق من صلاحية الرابط وأن حساب Telegram غير مربوط بحساب آخر.");
    return;
  }
  await sendMessage(chatId, `✅ تم ربط حساب Telegram بنجاح.\nالحساب: <b>${escapeHtml(admin.email)}</b>\nالدور: <b>${admin.role}</b>\n\nاستخدم /start لعرض قائمة النشر.`, {parseMode: "HTML", replyMarkup: adminMenu(admin)});
}

// ---- conversation state ----
type BotState = {chat_id: number; flow: string | null; data: Record<string, unknown>; expires_at: string};
async function getState(chatId: number): Promise<BotState | null> {
  const s = await qOne<BotState>(`SELECT * FROM portal_bot_state WHERE chat_id=$1 AND expires_at > now()`, [chatId]);
  return s || null;
}
export async function hasActiveFlow(chatId: number): Promise<boolean> {
  const s = await getState(chatId);
  return Boolean(s?.flow);
}
async function setState(chatId: number, flow: string | null, data: Record<string, unknown>): Promise<void> {
  await q(
    `INSERT INTO portal_bot_state (chat_id, flow, data, updated_at, expires_at) VALUES ($1,$2,$3,now(), now() + interval '24 hours')
     ON CONFLICT (chat_id) DO UPDATE SET flow=EXCLUDED.flow, data=EXCLUDED.data, updated_at=now(), expires_at=now() + interval '24 hours'`,
    [chatId, flow, JSON.stringify(data)]
  );
}
export async function getFlowState(chatId: number): Promise<{flow: string | null; data: Record<string, unknown>} | null> {
  return getState(chatId);
}
export async function setFlowState(chatId: number, flow: string, data: Record<string, unknown>): Promise<void> {
  await setState(chatId, flow, data);
}
async function clearState(chatId: number): Promise<void> {
  await q(`UPDATE portal_bot_state SET flow=NULL, data='{}', updated_at=now() WHERE chat_id=$1`, [chatId]);
}

// Audience choices per role (materials only; announcements keep the section policy)
function audienceKeyboard(admin: AdminInfo, subjectId = "") {
  const rows: {text: string; callback_data: string}[][] = [];
  if (admin.role === "section_representative") {
    rows.push([{text: `📌 شعبتي (${admin.assigned_section})`, callback_data: "lec:aud:own"}]);
    rows.push([{text: "🌐 جميع الشعب", callback_data: "lec:aud:all"}]);
  } else if (admin.role === "teacher") {
    const allowed = teacherSections(admin, subjectId) || ["A", "B", "C", "F"];
    if (allowed.length === 4) rows.push([{text: "🌐 جميع الشعب", callback_data: "lec:aud:all"}]);
    rows.push(...allowed.map(x => [{text: `شعبة ${x}`, callback_data: "lec:aud:sec:" + x}]));
  } else {
    rows.push([{text: "🌐 جميع الشعب", callback_data: "lec:aud:all"}]);
    rows.push(["A", "B", "C", "F"].map(x => ({text: `شعبة ${x}`, callback_data: "lec:aud:sec:" + x})));
  }
  return {inline_keyboard: rows};
}
function audienceLabel(sections: string[]): string {
  if (sections.length === 4) return "🌐 جميع الشعب (A, B, C, F)";
  return `شعبة ${sections.join(", ")}`;
}

export function adminMenu(admin?: AdminInfo) {
  return admin ? homeMenuFor(admin, true) : {inline_keyboard: [[{text: "🏠 القائمة الرئيسية", callback_data: "nav:home"}]]};
}
const navigation = {inline_keyboard: [[{text: "🏠 القائمة الرئيسية", callback_data: "nav:home"}, {text: "❌ إلغاء", callback_data: "adm:cancel"}]]};
const confirmKeyboard = (kind: string, nonce: string) => ({inline_keyboard: [
  [{text: "✅ نشر الآن", callback_data: `pub:${kind}:${nonce}`}],
  [{text: "✏️ تعديل العنوان", callback_data: `draft:title:${nonce}`}, {text: kind === "ann" ? "✏️ تعديل النص" : "📎 تغيير الملف", callback_data: `draft:${kind === "ann" ? "body" : "file"}:${nonce}`}],
  ...(kind === "lec" ? [[{text: "تغيير المادة", callback_data: `draft:subject:${nonce}`}, {text: "تغيير الجمهور", callback_data: `draft:audience:${nonce}`}]] : []),
  [{text: "🏠 القائمة الرئيسية", callback_data: "nav:home"}, {text: "❌ إلغاء", callback_data: "adm:cancel"}],
]});
export function escapeHtml(value: unknown): string { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
export async function resumeDraft(chatId: number, userId: number): Promise<void> {
  const admin = await getLinkedAdmin(userId);
  const state = await getState(chatId);
  if (!admin || !state?.flow) { await sendMessage(chatId, "انتهت صلاحية المسودة. ابدأ نشرًا جديدًا.", {replyMarkup: adminMenu(admin || undefined)}); return; }
  const d = state.data;
  if (d.step === "publishing") { await sendMessage(chatId, "طلب النشر قيد المعالجة. لا تعِد النشر؛ تحقق من إدارة منشوراتي.", {replyMarkup: adminMenu(admin)}); return; }
  if (d.step === "confirm") { await previewDraft(chatId, state.flow, d); return; }
  if (d.step === "subject") { await askSubjects(chatId, admin, state.flow === "ann" ? "ann:subj:" : "lec:subj:"); return; }
  if (d.step === "audience") { await sendMessage(chatId, "اختر الشعبة:", {replyMarkup: audienceKeyboard(admin, String(d.subjectId || ""))}); return; }
  if (state.flow === "pendingpdf") { await sendMessage(chatId, "الملف محفوظ. هل نبدأ نشره؟", {replyMarkup: {inline_keyboard: [[{text: "إنشاء ملزمة", callback_data: "pdf:new"}], ...navigation.inline_keyboard]}}); return; }
  const prompt = state.flow === "repfile" || d.step === "file" ? "أرسل ملف PDF." : d.step === "body" ? "اكتب نص التبليغ." : d.step === "desc" ? "اكتب الوصف الجديد، أو أرسل تخطي." : "اكتب العنوان.";
  await sendMessage(chatId, prompt, {replyMarkup: navigation});
}
async function askSubjects(chatId: number, admin: AdminInfo, prefix: string) {
  const all = await q<{id: string; name: string}>(`SELECT id, name FROM portal_subjects ORDER BY name`);
  const subjects = admin.role === "teacher" ? all.filter(x => admin.assigned_subjects?.includes(x.id)) : all;
  await sendMessage(chatId, subjects.length ? "اختر المادة:" : "لا توجد مواد مسندة لحسابك. تواصل مع إدارة البوابة.", {replyMarkup: {inline_keyboard: [...subjects.map(x => [{text: x.name, callback_data: prefix + x.id}]), ...navigation.inline_keyboard]}});
}
async function previewDraft(chatId: number, flow: string, d: Record<string, unknown>) {
  const nonce = randomBytes(8).toString("hex");
  await setState(chatId, flow, {...d, step: "confirm", nonce});
  const subject = d.subjectId ? await qOne<{name: string}>(`SELECT name FROM portal_subjects WHERE id=$1`, [d.subjectId]) : null;
  const scope = d.scope === "section" ? `شعبة ${d.section}` : d.scope === "teacher" ? `شعبة ${d.section === "all" ? "جميع الشعب" : d.section}` : "جميع الشعب";
  const details = flow === "ann" ? `${d.body || ""}\nالجمهور: ${scope}` : `الجمهور: ${audienceLabel((d.sections as string[]) || [])}\nالملف محفوظ وجاهز للنشر.`;
  await sendMessage(chatId, `معاينة قبل النشر\n${subject?.name || ""}\n${d.title || ""}\n\n${details}`, {replyMarkup: confirmKeyboard(flow, nonce)});
}

// ---- message handling (steps of the flows) ----
export type TgDocument = {file_id: string; file_name?: string; mime_type?: string; file_size?: number};
export async function handleAdminMessage(chatId: number, userId: number, text: string, document?: TgDocument): Promise<void> {
  const admin = await getLinkedAdmin(userId);
  if (!admin) return;
  const state = await getState(chatId);
  if (state?.data.step !== "file" && state?.flow !== "repfile" && document) { await sendMessage(chatId, "الخطوة الحالية تحتاج اختيارًا أو نصًا. أكملها أولًا، أو ألغِ المسودة.", {replyMarkup: navigation}); return; }
  if (!state?.flow) { await sendMessage(chatId, "مرحباً بك في بوابة المرحلة الثالثة 🌟", {replyMarkup: adminMenu(admin)}); return; }

  if (text.length > 3000 || ((state.data.step === "title") && (!text.trim() || text.length > 180))) { await sendMessage(chatId, "اكتب عنوانًا من 1 إلى 180 حرفًا، ونصًا لا يتجاوز 3000 حرف.", {replyMarkup: navigation}); return; }
  if (state.flow === "ann") {
    const d = state.data;
    if (d.step === "title") { if (d.body) { await previewDraft(chatId, "ann", {...d, title: text}); return; } await setState(chatId, "ann", {...d, step: "body", title: text}); await sendMessage(chatId, "اكتب نص التبليغ:", {replyMarkup: navigation}); return; }
    if (d.step === "body") {
      await previewDraft(chatId, "ann", {...d, body: text});
      return;
    }
  }
  if (state.flow === "editann") {
    const d = state.data;
    if (d.step === "title") { await setState(chatId, "editann", {...d, step: "body", title: ["تخطَّ", "تخطي", "تخطى"].includes(text.trim()) ? undefined : text}); await sendMessage(chatId, "✏️ النص الجديد (أرسل «تخطَّ» للإبقاء على الحالي):"); return; }
    if (d.step === "body") {
      const r = await updateAnnouncementOwn(admin, String(d.id), {title: d.title as string | undefined, body: ["تخطَّ", "تخطي", "تخطى"].includes(text.trim()) ? undefined : text});
      if (r.ok) await clearState(chatId);
      await sendMessage(chatId, r.ok ? "✅ تم تعديل التبليغ." : `⛔ ${r.error}`, {replyMarkup: adminMenu(admin)});
      return;
    }
  }
  if (state.flow === "editmeta") {
    const d = state.data;
    if (d.step === "title") { await setState(chatId, "editmeta", {...d, step: "desc", title: ["تخطَّ", "تخطي", "تخطى"].includes(text.trim()) ? undefined : text}); await sendMessage(chatId, "✏️ الوصف الجديد (أرسل «تخطَّ» للإبقاء):"); return; }
    if (d.step === "desc") {
      const r = await updateLectureMetaOwn(admin, String(d.id), {title: d.title as string | undefined, description: ["تخطَّ", "تخطي", "تخطى"].includes(text.trim()) ? undefined : text});
      if (r.ok) await clearState(chatId);
      await sendMessage(chatId, r.ok ? "✅ تم تعديل بيانات المادة." : `⛔ ${r.error}`, {replyMarkup: adminMenu(admin)});
      return;
    }
  }
  if (state.flow === "repfile") {
    if (!document) { await sendMessage(chatId, "⚠️ أرسل ملف PDF."); return; }
    if (document.mime_type !== "application/pdf") { await sendMessage(chatId, "⚠️ الملف ليس PDF."); return; }
    if ((document.file_size || 0) > MAX_PDF_BYTES) { await sendMessage(chatId, "⚠️ أكبر من 20MB — استبدله من لوحة الويب."); return; }
    if (!storageConfigured()) { await sendMessage(chatId, "⚠️ التخزين غير مهيأ — استخدم لوحة الويب."); return; }
    try {
      const g = await tgFetch<{file_path: string}>("getFile", {file_id: document.file_id});
      if (!g.ok || !g.result?.file_path) { await sendMessage(chatId, "⚠️ تعذر قراءة الملف."); return; }
      const dl = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${g.result.file_path}`);
      if (!dl.ok) throw new Error("download failed");
      const buf = Buffer.from(await dl.arrayBuffer());
      if (buf.length > MAX_PDF_BYTES) { await sendMessage(chatId, "الملف أكبر من 20MB."); return; }
      if (!isPdf(buf)) { await sendMessage(chatId, "⚠️ ليس PDF صالحًا."); return; }
      const {url} = await uploadLecturePdf(buf, document.file_name || "lecture.pdf");
      const r = await replaceLectureFileOwn(admin, String(state.data.id), url, document.file_name || "lecture.pdf");
      if (r.ok) await clearState(chatId);
      const lecture = await qOne<{subject_id: string}>(`SELECT subject_id FROM portal_lectures WHERE id=$1`, [state.data.id]);
      await sendMessage(chatId, r.ok ? `✅ تم استبدال الملف: ${PORTAL_BASE_URL}/subjects/${lecture?.subject_id || ""}` : `⛔ ${r.error}`, {replyMarkup: adminMenu(admin)});
    } catch { await sendMessage(chatId, "⚠️ فشل الاستبدال."); }
    return;
  }
  if (state.flow === "lec") {
    const d = state.data;
    if (d.step === "title") {
      const next = {...d, title: text, step: "file"};
      if (d.fileUrl) { await previewDraft(chatId, "lec", next); return; }
      await setState(chatId, "lec", next);
      if (d.pendingDoc) { await handleAdminMessage(chatId, userId, "", d.pendingDoc as TgDocument); return; }
      await sendMessage(chatId, "أرسل ملف PDF هنا (حتى 20MB).", {replyMarkup: navigation}); return;
    }
    if (d.step === "file") {
      if (document) {
        if (document.mime_type !== "application/pdf") { await sendMessage(chatId, "⚠️ الملف ليس PDF. أرسل ملف PDF أو رابط ملف محفوظ."); return; }
        if ((document.file_size || 0) > MAX_PDF_BYTES) { await sendMessage(chatId, "⚠️ الملف أكبر من 20MB — ارفعه من لوحة الويب."); return; }
        if (!storageConfigured()) { await sendMessage(chatId, "⚠️ تخزين الملفات غير مهيأ على الخادم. استخدم لوحة الويب لرفع الملف."); return; }
        try {
          const g = await tgFetch<{file_path: string}>("getFile", {file_id: document.file_id});
          if (!g.ok || !g.result?.file_path) { await sendMessage(chatId, "⚠️ تعذر قراءة الملف من Telegram."); return; }
          const dl = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${g.result.file_path}`);
          if (!dl.ok) { await sendMessage(chatId, "⚠️ تعذر تنزيل الملف من Telegram. أعد إرساله."); return; }
          const buf = Buffer.from(await dl.arrayBuffer());
          if (buf.length > MAX_PDF_BYTES) { await sendMessage(chatId, "⚠️ الملف أكبر من 20MB — ارفعه من لوحة الويب."); return; }
          if (!isPdf(buf)) { await sendMessage(chatId, "⚠️ الملف ليس PDF صالحًا."); return; }
          const {url} = await uploadLecturePdf(buf, document.file_name || "lecture.pdf");
          await previewDraft(chatId, "lec", {...d, fileUrl: url, pendingDoc: undefined});
        } catch { await sendMessage(chatId, "⚠️ فشل رفع الملف — جرّب من لوحة الويب."); }
        return;
      }
      if (!/^\/[A-Za-z0-9_\-./]+$/.test(text) && !/^https:\/\//.test(text)) { await sendMessage(chatId, "⚠️ الرابط غير صالح. أرسل رابطًا يبدأ بـ / أو https://"); return; }
      await previewDraft(chatId, "lec", {...d, fileUrl: text});
      return;
    }
  }
}

// ---- callback handling (menus, subject picker, confirm) ----
export async function handleAdminCallback(chatId: number, userId: number, data: string): Promise<void> {
  const admin = await getLinkedAdmin(userId);
  if (!admin) { await sendMessage(chatId, "⚠️ حساب Telegram غير مربوط. استخدم «ربط حساب Telegram» من إعدادات الحساب في الموقع."); return; }

  if (data === "adm:ann") {
    if (!canUseTelegramPublishing(admin)) { await sendMessage(chatId, "⚠️ حسابك معلّق — تم سحب صلاحيات النشر فوراً."); return; }
    await setState(chatId, "ann", {scope: admin.role === "teacher" ? "teacher" : admin.role === "section_representative" ? "section" : "general", section: admin.assigned_section || "all", step: admin.role === "teacher" ? "subject" : "title", draftId: `ann-tg-${chatId}-${Date.now()}`});
    if (admin.role === "teacher") { await askSubjects(chatId, admin, "ann:subj:"); return; }
    await sendMessage(chatId, "عنوان التبليغ:", {replyMarkup: navigation});
    return;
  }
  if (data === "adm:lec") {
    await setState(chatId, "lec", {step: "subject", draftId: `lec-tg-${chatId}-${Date.now()}`});
    await askSubjects(chatId, admin, "lec:subj:");
    return;
  }
  if (data.startsWith("lec:subj:") || data.startsWith("ann:subj:")) {
    const subjectId = data.slice(9);
    const state = await getState(chatId);
    if (!state || (state.flow !== "lec" && state.flow !== "ann") || (admin.role === "teacher" && !admin.assigned_subjects?.includes(subjectId))) { await sendMessage(chatId, "هذا الاختيار غير متاح. افتح القائمة مجددًا.", {replyMarkup: adminMenu(admin)}); return; }
    await setState(chatId, state.flow, {...state.data, step: "audience", subjectId});
    await sendMessage(chatId, "🎯 اختر الجمهور (الشعب):", {replyMarkup: audienceKeyboard(admin, subjectId)});
    return;
  }
  if (data.startsWith("lec:aud:")) {
    const aud = data.slice(8); // own | all | sec:X
    const sections = aud === "all" ? ["A", "B", "C", "F"] : aud === "own" ? [String(admin.assigned_section)] : [aud.slice(4)];
    const state = await getState(chatId);
    if (!state || (state.flow !== "ann" && state.flow !== "lec")) return;
    const allowed = admin.role === "teacher" ? teacherSections(admin, String(state.data.subjectId)) : null;
    if (allowed && !sections.every(s => allowed.includes(s as never))) { await resumeDraft(chatId, userId); return; }
    await setState(chatId, state.flow, {...state.data, step: "title", sections, section: aud === "all" ? "all" : sections[0]});
    await sendMessage(chatId, "اكتب العنوان:", {replyMarkup: navigation});
    return;
  }
  if (data === "adm:me") {
    const names = await q<{id:string;name:string}>(`SELECT id,name FROM portal_subjects`);
    await sendMessage(chatId, `👤 <b>${escapeHtml(admin.name || admin.email)}</b>\nالدور: ${{super_admin:"مالك البوابة",general_representative:"ممثل عام",section_representative:"ممثل شعبة",teacher:"تدريسي",editor:"محرر"}[admin.role] || "ناشر"}${admin.assigned_section ? `\nالشعبة: ${admin.assigned_section}` : ""}${admin.assigned_subjects?.length ? `\nالمواد: ${escapeHtml(names.filter(x => admin.assigned_subjects?.includes(x.id)).map(x => x.name).join("، "))}` : ""}`, {parseMode: "HTML"});
    return;
  }
  if (data === "adm:cancel") { await clearState(chatId); await sendMessage(chatId, "❌ تم الإلغاء.", {replyMarkup: adminMenu(admin)}); return; }

  if (data.startsWith("draft:")) {
    const state = await getState(chatId);
    if (!state || !["ann", "lec"].includes(state.flow || "")) return;
    const [, field, nonce] = data.split(":");
    if (state.data.step !== "confirm" || nonce !== state.data.nonce) { await sendMessage(chatId, "زر قديم. افتح المسودة مجددًا.", {replyMarkup: adminMenu(admin)}); return; }
    if (!["title", "body", "file", "subject", "audience"].includes(field)) return;
    await setState(chatId, state.flow!, {...state.data, nonce: undefined, step: field, ...(field === "file" ? {fileUrl: undefined, pendingDoc: undefined} : {})});
    await resumeDraft(chatId, userId); return;
  }
  if (data.startsWith("pub:")) {
    const state = await getState(chatId);
    const [, kind, nonce] = data.split(":");
    if (!state?.flow || state.flow !== kind || state.data.step !== "confirm" || !nonce || nonce !== state.data.nonce) {
      await sendMessage(chatId, "هذا الزر قديم أو انتهت صلاحيته. افتح المسودة من القائمة الرئيسية.", {replyMarkup: adminMenu(admin)}); return;
    }
    const claimed = await q(`UPDATE portal_bot_state SET data=$3 WHERE chat_id=$1 AND data->>'nonce'=$2 AND data->>'step'='confirm' RETURNING chat_id`, [chatId, nonce, JSON.stringify({...state.data, step: "publishing"})]);
    if (!claimed.length) return;
    const d = state.data;
    try {
    if (kind === "ann") {
      // re-check permissions immediately before publishing
      const scope = admin.role === "teacher" ? "teacher" : admin.role === "section_representative" ? "section" : "general";
      const section = admin.role === "section_representative" ? String(admin.assigned_section) : admin.role === "teacher" ? String(d.section) : "all";
      const r = await publishAnnouncement(admin, {id: String(d.draftId || undefined), title: String(d.title || ""), body: String(d.body || ""), scope, section, subjectId: d.subjectId as string | undefined, priority: "normal", source: "telegram"});
      if (r.ok) await clearState(chatId); else if (state.flow === "ann" || state.flow === "lec") await previewDraft(chatId, state.flow, state.data);
      await sendMessage(chatId, r.ok
        ? (r.inserted ? `✅ تم نشر التبليغ.\n🔗 ${PORTAL_BASE_URL}/announcements` : "ℹ️ هذا التبليغ منشور مسبقًا (لا تكرار).")
        : `⛔ تعذر النشر: ${r.error}`, {replyMarkup: adminMenu(admin)});
      return;
    }
    if (kind === "lec") {
      // re-check EVERYTHING on final confirmation: link, account status, role, subject, audience
      const fresh = await getLinkedAdmin(userId);
      if (!fresh) { await clearState(chatId); await sendMessage(chatId, "⛔ تم إلغاء الربط أو تعليق الحساب — لا يمكن النشر.", {replyMarkup: adminMenu(admin)}); return; }
      const sections = Array.isArray(d.sections) && d.sections.length ? d.sections.map(String) : ["A", "B", "C", "F"];
      const count = await qOne<{c: number}>(`SELECT count(*)::int AS c FROM portal_lectures WHERE subject_id=$1 AND material_kind='lecture'`, [String(d.subjectId)]);
      const r = await publishLecture(fresh, {id: String(d.draftId || undefined), subjectId: String(d.subjectId), number: (count?.c || 0) + 1, title: String(d.title || ""), fileUrl: String(d.fileUrl || ""), sections, source: "telegram"});
      if (r.ok) await clearState(chatId); else if (state.flow === "ann" || state.flow === "lec") await previewDraft(chatId, state.flow, state.data);
      await sendMessage(chatId, r.ok
        ? (r.inserted ? `✅ تم نشر المادة في <b>${escapeHtml(d.subjectId)}</b>\n🎯 الجمهور: ${audienceLabel(sections)}\n🔗 ${PORTAL_BASE_URL}/subjects/${escapeHtml(d.subjectId)}` : "ℹ️ هذا النشر منشور مسبقًا (لا تكرار).")
        : `⛔ تعذر النشر: ${r.error}`, {parseMode: "HTML", replyMarkup: adminMenu(admin)});
      return;
    }
    } catch {
      await previewDraft(chatId, state.flow, d);
      await sendMessage(chatId, "تعذر حفظ النشر الآن. مسودتك محفوظة، ويمكنك إعادة المحاولة.");
    }
  }
}
