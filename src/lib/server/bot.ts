// Telegram bot: account linking + direct publishing flows.
// The bot uses the SAME publish service as the website (publish.ts) — one backend.
// Conversation state is persisted in portal_bot_state (survives serverless restarts).
import {q, qOne} from "./db.ts";
import {sendMessage} from "./telegram.ts";
import {hashToken, tokenUsable, isActive, canUseTelegramPublishing, type AdminInfo} from "./rbac.ts";
import {publishAnnouncement, publishLecture} from "./publish.ts";
import {BOT_TOKEN} from "./flags.ts";
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
  await sendMessage(chatId, `✅ تم ربط حساب Telegram بنجاح.\nالحساب: <b>${admin.email}</b>\nالدور: <b>${admin.role}</b>\n\nاستخدم /start لعرض قائمة النشر.`, {parseMode: "HTML"});
}

// ---- conversation state ----
type BotState = {chat_id: number; flow: string | null; data: Record<string, unknown>; expires_at: string};
async function getState(chatId: number): Promise<BotState | null> {
  const s = await qOne<BotState>(`SELECT * FROM portal_bot_state WHERE chat_id=$1 AND expires_at > now()`, [chatId]);
  return s || null;
}
async function setState(chatId: number, flow: string | null, data: Record<string, unknown>): Promise<void> {
  await q(
    `INSERT INTO portal_bot_state (chat_id, flow, data, updated_at, expires_at) VALUES ($1,$2,$3,now(), now() + interval '30 minutes')
     ON CONFLICT (chat_id) DO UPDATE SET flow=EXCLUDED.flow, data=EXCLUDED.data, updated_at=now(), expires_at=now() + interval '30 minutes'`,
    [chatId, flow, JSON.stringify(data)]
  );
}
async function clearState(chatId: number): Promise<void> {
  await q(`UPDATE portal_bot_state SET flow=NULL, data='{}', updated_at=now() WHERE chat_id=$1`, [chatId]);
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
  if (state.flow === "lec") {
    const d = state.data;
    if (d.step === "title") { await setState(chatId, "lec", {...d, step: "file", title: text}); await sendMessage(chatId, "📎 أرسل رابط ملف PDF (مثال: /lectures/xxx.pdf) — أو ارفع الملف من لوحة الويب وأرسل الرابط هنا."); return; }
    if (d.step === "file") {
      if (document) {
        if (document.mime_type !== "application/pdf") { await sendMessage(chatId, "⚠️ الملف ليس PDF. أرسل ملف PDF أو رابط ملف محفوظ."); return; }
        if ((document.file_size || 0) > MAX_PDF_BYTES) { await sendMessage(chatId, "⚠️ الملف أكبر من 20MB — ارفعه من لوحة الويب."); return; }
        if (!storageConfigured()) { await sendMessage(chatId, "⚠️ تخزين الملفات غير مهيأ على الخادم. استخدم لوحة الويب لرفع الملف."); return; }
        try {
          const g = await tgFetch<{file_path: string}>("getFile", {file_id: document.file_id});
          if (!g.ok || !g.result?.file_path) { await sendMessage(chatId, "⚠️ تعذر قراءة الملف من Telegram."); return; }
          const dl = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${g.result.file_path}`);
          const buf = Buffer.from(await dl.arrayBuffer());
          if (!isPdf(buf)) { await sendMessage(chatId, "⚠️ الملف ليس PDF صالحًا."); return; }
          const {url} = await uploadLecturePdf(buf, document.file_name || "lecture.pdf");
          await setState(chatId, "lec", {...d, step: "confirm", fileUrl: url});
          await sendMessage(chatId, `👁️ معاينة المحاضرة:\n\nالمادة: <b>${d.subjectId}</b>\nالعنوان: <b>${d.title}</b>\nالملف: ✅ محفوظ ${(buf.length / 1024).toFixed(0)} KB`, {parseMode: "HTML", replyMarkup: confirmKeyboard("lec")});
        } catch { await sendMessage(chatId, "⚠️ فشل رفع الملف — جرّب من لوحة الويب."); }
        return;
      }
      if (!/^\/[A-Za-z0-9_\-./]+$/.test(text) && !/^https:\/\//.test(text)) { await sendMessage(chatId, "⚠️ الرابط غير صالح. أرسل رابطًا يبدأ بـ / أو https://"); return; }
      await setState(chatId, "lec", {...d, step: "confirm", fileUrl: text});
      await sendMessage(chatId, `👁️ معاينة المحاضرة:\n\nالمادة: <b>${d.subjectId}</b>\nالعنوان: <b>${d.title}</b>\nالملف: ${text}`, {parseMode: "HTML", replyMarkup: confirmKeyboard("lec")});
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
    await setState(chatId, "ann", {step: "title"});
    await sendMessage(chatId, "📢 عنوان التبليغ:");
    return;
  }
  if (data === "adm:lec") {
    const subjects = admin.assigned_subjects || [];
    if (!subjects.length) { await sendMessage(chatId, "⚠️ لا توجد مواد مسندة لحسابك."); return; }
    await setState(chatId, "lec", {step: "subject"});
    const kb = {inline_keyboard: subjects.map(s => [{text: s, callback_data: "lec:subj:" + s}])};
    await sendMessage(chatId, "\ud83d\udcda \u0627\u062e\u062a\u0631 \u0627\u0644\u0645\u0627\u062f\u0629:", {replyMarkup: kb});
    return;
  }
  if (data.startsWith("lec:subj:")) {
    const subjectId = data.slice(9);
    await setState(chatId, "lec", {step: "title", subjectId});
    await sendMessage(chatId, "✏️ عنوان المحاضرة:");
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
      const r = await publishAnnouncement(admin, {title: String(d.title || ""), body: String(d.body || ""), scope, section, priority: "normal", source: "telegram"});
      await clearState(chatId);
      await sendMessage(chatId, r.ok
        ? (r.inserted ? `✅ تم نشر التبليغ.\n🔗 /announcements` : "ℹ️ هذا التبليغ منشور مسبقًا (لا تكرار).")
        : `⛔ تعذر النشر: ${r.error}`, {replyMarkup: adminMenu()});
      return;
    }
    if (data === "pub:lec") {
      const count = await qOne<{c: number}>(`SELECT count(*)::int AS c FROM portal_lectures WHERE subject_id=$1`, [String(d.subjectId)]);
      const r = await publishLecture(admin, {subjectId: String(d.subjectId), number: (count?.c || 0) + 1, title: String(d.title || ""), fileUrl: String(d.fileUrl || ""), source: "telegram"});
      await clearState(chatId);
      await sendMessage(chatId, r.ok
        ? (r.inserted ? `✅ تم نشر المحاضرة في مادة ${d.subjectId}.` : "ℹ️ هذه المحاضرة منشورة مسبقًا (لا تكرار).")
        : `⛔ تعذر النشر: ${r.error}`, {replyMarkup: adminMenu()});
      return;
    }
  }
}
