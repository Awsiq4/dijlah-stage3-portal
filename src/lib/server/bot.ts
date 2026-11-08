// Telegram bot: account linking + direct publishing flows.
// The bot uses the SAME publish service as the website (publish.ts) — one backend.
// Conversation state is persisted in portal_bot_state (survives serverless restarts).
import {q, qOne} from "./db.ts";
import {sendMessage} from "./telegram.ts";
import {hashToken, tokenUsable, isActive, canUseTelegramPublishing, teacherSections, type AdminInfo} from "./rbac.ts";
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
  // short single-use token: looked up ONLY by its SHA-256 hash (never stored raw)
  const tok = await qOne<{token_hash: string; expires_at: string; used_at: string | null; admin_id: number}>(
    `SELECT token_hash, expires_at, used_at, admin_id FROM portal_link_tokens WHERE token_hash=$1`,
    [hashToken(raw)]
  );
  if (!tok || !tokenUsable(tok)) {
    await sendMessage(chatId, "⚠️ رابط الربط غير صالح أو مستخدم مسبقًا أو منتهي الصلاحية. اطلب رابطًا جديدًا من لوحة الإدارة.");
    return;
  }
  const conflict = await qOne<{admin_id: number}>(`SELECT admin_id FROM portal_telegram_links WHERE telegram_user_id=$1 AND revoked_at IS NULL`, [userId]);
  if (conflict && conflict.admin_id !== tok.admin_id) {
    await sendMessage(chatId, "⚠️ هذا حساب Telegram مربوط بحساب آخر نشط. ألغِ الربط من الحساب الآخر أولًا.");
    return;
  }
  await q(
    `INSERT INTO portal_telegram_links (admin_id, telegram_user_id) VALUES ($1,$2)
     ON CONFLICT (telegram_user_id) DO UPDATE SET admin_id=EXCLUDED.admin_id, revoked_at=NULL, linked_at=now()`,
    [tok.admin_id, userId]
  );
  await q(`UPDATE portal_telegram_links SET revoked_at=now() WHERE admin_id=$1 AND telegram_user_id<>$2 AND revoked_at IS NULL`, [tok.admin_id, userId]);
  await q(`UPDATE portal_link_tokens SET used_at=now() WHERE token_hash=$1`, [tok.token_hash]);
  const admin = await qOne<AdminInfo>(`SELECT id, email, role, status, is_active, name, assigned_section, assigned_subjects, perms FROM portal_admins WHERE id=$1`, [tok.admin_id]);
  if (!admin || !canUseTelegramPublishing(admin)) { await sendMessage(chatId, "⚠️ الحساب غير مخوّل للنشر عبر Telegram."); return; }
  await q(`INSERT INTO portal_audit (actor, action, detail) VALUES ($1,$2,$3)`, [admin.email, "telegram.link.bound", {telegram_user_id: userId}]);
  await sendMessage(chatId, `✅ تم ربط حساب Telegram بنجاح.\nالحساب: <b>${admin.email}</b>\nالدور: <b>${admin.role}</b>\n\nاستخدم /start لعرض قائمة النشر.`, {parseMode: "HTML", replyMarkup: adminMenu()});
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
    `INSERT INTO portal_bot_state (chat_id, flow, data, updated_at, expires_at) VALUES ($1,$2,$3,now(), now() + interval '30 minutes')
     ON CONFLICT (chat_id) DO UPDATE SET flow=EXCLUDED.flow, data=EXCLUDED.data, updated_at=now(), expires_at=now() + interval '30 minutes'`,
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
function audienceKeyboard(admin: AdminInfo) {
  const rows: {text: string; callback_data: string}[][] = [];
  if (admin.role === "section_representative") {
    rows.push([{text: `📌 شعبتي (${admin.assigned_section})`, callback_data: "lec:aud:own"}]);
    rows.push([{text: "🌐 جميع الشعب", callback_data: "lec:aud:all"}]);
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

export function adminMenu() {
  return {inline_keyboard: [
    [{text: "📢 نشر تبليغ", callback_data: "adm:ann"}],
    [{text: "📚 إضافة محاضرة", callback_data: "adm:lec"}],
    [{text: "👤 حسابي", callback_data: "adm:me"}],
  ]};
}
const confirmKeyboard = (kind: string) => ({inline_keyboard: [
  [{text: "✅ نشر الآن", callback_data: `pub:${kind}`}, {text: "✏️ تعديل", callback_data: `adm:${kind}`}, {text: "❌ إلغاء", callback_data: "adm:cancel"}],
]});

// ---- message handling (steps of the flows) ----
export type TgDocument = {file_id: string; file_name?: string; mime_type?: string; file_size?: number};
export async function handleAdminMessage(chatId: number, userId: number, text: string, document?: TgDocument): Promise<void> {
  const admin = await getLinkedAdmin(userId);
  if (!admin) return;
  const state = await getState(chatId);
  if (!state?.flow) { await sendMessage(chatId, "مرحباً بك في بوابة المرحلة الثالثة 🌟", {replyMarkup: adminMenu()}); return; }

  if (state.flow === "ann") {
    const d = state.data;
    if (d.step === "title") { await setState(chatId, "ann", {...d, step: "body", title: text}); await sendMessage(chatId, "📝 اكتب الآن نص التبليغ:"); return; }
    if (d.step === "body") {
      await setState(chatId, "ann", {...d, step: "confirm", body: text});
      const scope = admin.role === "section_representative" ? `شعبة ${admin.assigned_section}` : "عام";
      await sendMessage(chatId, `👁️ معاينة التبليغ:\n\n<b>${d.title}</b>\n${text}\n\nالنطاق: ${scope}`, {parseMode: "HTML", replyMarkup: confirmKeyboard("ann")});
      return;
    }
  }
  if (state.flow === "editann") {
    const d = state.data;
    if (d.step === "title") { await setState(chatId, "editann", {...d, step: "body", title: text === "تخطَّ" ? undefined : text}); await sendMessage(chatId, "✏️ النص الجديد (أرسل «تخطَّ» للإبقاء على الحالي):"); return; }
    if (d.step === "body") {
      const r = await updateAnnouncementOwn(admin, String(d.id), {title: d.title as string | undefined, body: text === "تخطَّ" ? undefined : text});
      await clearState(chatId);
      await sendMessage(chatId, r.ok ? "✅ تم تعديل التبليغ." : `⛔ ${r.error}`, {replyMarkup: adminMenu()});
      return;
    }
  }
  if (state.flow === "editmeta") {
    const d = state.data;
    if (d.step === "title") { await setState(chatId, "editmeta", {...d, step: "desc", title: text === "تخطَّ" ? undefined : text}); await sendMessage(chatId, "✏️ الوصف الجديد (أرسل «تخطَّ» للإبقاء):"); return; }
    if (d.step === "desc") {
      const r = await updateLectureMetaOwn(admin, String(d.id), {title: d.title as string | undefined, description: text === "تخطَّ" ? undefined : text});
      await clearState(chatId);
      await sendMessage(chatId, r.ok ? "✅ تم تعديل بيانات المادة." : `⛔ ${r.error}`, {replyMarkup: adminMenu()});
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
      const buf = Buffer.from(await dl.arrayBuffer());
      if (!isPdf(buf)) { await sendMessage(chatId, "⚠️ ليس PDF صالحًا."); return; }
      const {url} = await uploadLecturePdf(buf, document.file_name || "lecture.pdf");
      const r = await replaceLectureFileOwn(admin, String(state.data.id), url, document.file_name || "lecture.pdf");
      await clearState(chatId);
      await sendMessage(chatId, r.ok ? `✅ تم استبدال الملف — الرابط ثابت: ${PORTAL_BASE_URL}/subjects/` : `⛔ ${r.error}`, {replyMarkup: adminMenu()});
    } catch { await sendMessage(chatId, "⚠️ فشل الاستبدال."); }
    return;
  }
  if (state.flow === "lec") {
    const d = state.data;
    if (d.step === "title") { await setState(chatId, "lec", {...d, step: "file", title: text}); await sendMessage(chatId, "📎 أرسل ملف الملزمة بصيغة PDF هنا مباشرة (حتى 20MB). سأرفعه وأعرض لك معاينة قبل تأكيد النشر. يمكنك أيضًا إرسال رابط PDF محفوظ."); return; }
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
          await setState(chatId, "lec", {...d, step: "confirm", fileUrl: url});
          await sendMessage(chatId, `👁️ معاينة المحاضرة:\n\nالمادة: <b>${d.subjectId}</b>\nالعنوان: <b>${d.title}</b>\n🎯 الجمهور: <b>${audienceLabel((d.sections as string[]) || ["A","B","C","F"])}</b>\nالملف: ✅ محفوظ ${(buf.length / 1024).toFixed(0)} KB`, {parseMode: "HTML", replyMarkup: confirmKeyboard("lec")});
        } catch { await sendMessage(chatId, "⚠️ فشل رفع الملف — جرّب من لوحة الويب."); }
        return;
      }
      if (!/^\/[A-Za-z0-9_\-./]+$/.test(text) && !/^https:\/\//.test(text)) { await sendMessage(chatId, "⚠️ الرابط غير صالح. أرسل رابطًا يبدأ بـ / أو https://"); return; }
      await setState(chatId, "lec", {...d, step: "confirm", fileUrl: text});
      await sendMessage(chatId, `👁️ معاينة المحاضرة:\n\nالمادة: <b>${d.subjectId}</b>\nالعنوان: <b>${d.title}</b>\n🎯 الجمهور: <b>${audienceLabel((d.sections as string[]) || ["A","B","C","F"])}</b>\nالملف: ${text}`, {parseMode: "HTML", replyMarkup: confirmKeyboard("lec")});
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
    await setState(chatId, "ann", {step: "title", draftId: `ann-tg-${chatId}-${Date.now()}`});
    await sendMessage(chatId, "📢 عنوان التبليغ:");
    return;
  }
  if (data === "adm:lec") {
    // reps (general/section) may publish materials for ANY subject; teachers only their assigned subjects
    let subjects: {id: string; name: string}[];
    if (admin.role === "teacher") {
      subjects = (admin.assigned_subjects || []).map(id => ({id, name: id}));
    } else {
      subjects = await q<{id: string; name: string}>(`SELECT id, name FROM portal_subjects ORDER BY name`);
    }
    if (!subjects.length) { await sendMessage(chatId, "⚠️ لا توجد مواد."); return; }
    await setState(chatId, "lec", {step: "subject", draftId: `lec-tg-${chatId}-${Date.now()}`});
    const kb = {inline_keyboard: subjects.map(x => [{text: x.name, callback_data: "lec:subj:" + x.id}])};
    await sendMessage(chatId, "📚 اختر المادة:", {replyMarkup: kb});
    return;
  }
  if (data.startsWith("lec:subj:")) {
    const subjectId = data.slice(9);
    const state = await getState(chatId);
    await setState(chatId, "lec", {...(state?.data || {}), step: "audience", subjectId});
    await sendMessage(chatId, "🎯 اختر الجمهور (الشعب):", {replyMarkup: audienceKeyboard(admin)});
    return;
  }
  if (data.startsWith("lec:aud:")) {
    const aud = data.slice(8); // own | all | sec:X
    const sections = aud === "all" ? ["A", "B", "C", "F"] : aud === "own" ? [String(admin.assigned_section)] : [aud.slice(4)];
    const state = await getState(chatId);
    await setState(chatId, "lec", {...(state?.data || {}), step: "title", sections});
    await sendMessage(chatId, "✏️ عنوان المادة/الملزمة:");
    return;
  }
  if (data === "adm:me") {
    await sendMessage(chatId, `👤 <b>${admin.name || admin.email}</b>\nالدور: ${admin.role}${admin.assigned_section ? `\nالشعبة: ${admin.assigned_section}` : ""}${admin.assigned_subjects?.length ? `\nالمواد: ${admin.assigned_subjects.join(", ")}` : ""}`, {parseMode: "HTML"});
    return;
  }
  if (data === "adm:cancel") { await clearState(chatId); await sendMessage(chatId, "❌ تم الإلغاء.", {replyMarkup: adminMenu()}); return; }

  if (data === "pub:ann" || data === "pub:lec") {
    const state = await getState(chatId);
    if (!state?.flow) return;
    const d = state.data;
    if (data === "pub:ann") {
      // re-check permissions immediately before publishing
      const scope = admin.role === "section_representative" ? "section" : "general";
      const section = admin.role === "section_representative" ? String(admin.assigned_section) : "all";
      const r = await publishAnnouncement(admin, {id: String(d.draftId || undefined), title: String(d.title || ""), body: String(d.body || ""), scope, section, priority: "normal", source: "telegram"});
      await clearState(chatId);
      await sendMessage(chatId, r.ok
        ? (r.inserted ? `✅ تم نشر التبليغ.\n🔗 /announcements` : "ℹ️ هذا التبليغ منشور مسبقًا (لا تكرار).")
        : `⛔ تعذر النشر: ${r.error}`, {replyMarkup: adminMenu()});
      return;
    }
    if (data === "pub:lec") {
      // re-check EVERYTHING on final confirmation: link, account status, role, subject, audience
      const fresh = await getLinkedAdmin(userId);
      if (!fresh) { await clearState(chatId); await sendMessage(chatId, "⛔ تم إلغاء الربط أو تعليق الحساب — لا يمكن النشر.", {replyMarkup: adminMenu()}); return; }
      const sections = Array.isArray(d.sections) && d.sections.length ? d.sections.map(String) : ["A", "B", "C", "F"];
      const count = await qOne<{c: number}>(`SELECT count(*)::int AS c FROM portal_lectures WHERE subject_id=$1`, [String(d.subjectId)]);
      const r = await publishLecture(fresh, {id: String(d.draftId || undefined), subjectId: String(d.subjectId), number: (count?.c || 0) + 1, title: String(d.title || ""), fileUrl: String(d.fileUrl || ""), sections, source: "telegram"});
      await clearState(chatId);
      await sendMessage(chatId, r.ok
        ? (r.inserted ? `✅ تم نشر المادة في <b>${d.subjectId}</b>\n🎯 الجمهور: ${audienceLabel(sections)}\n🔗 ${PORTAL_BASE_URL}/subjects/${d.subjectId}` : "ℹ️ هذا النشر منشور مسبقًا (لا تكرار).")
        : `⛔ تعذر النشر: ${r.error}`, {parseMode: "HTML", replyMarkup: adminMenu()});
      return;
    }
  }
}
