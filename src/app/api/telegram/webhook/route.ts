import {NextRequest, NextResponse} from "next/server";
import {WEBHOOK_SECRET, TELEGRAM_BOT_ENABLED, telegramServiceEnabled, SUBSCRIPTION_SECRET, botConfigured, webhookAuthorized} from "@/lib/server/flags";
import {verifySubscribeToken} from "@/lib/server/tokens";
import {q, qOne} from "@/lib/server/db";
import {sendMessage, tgFetch} from "@/lib/server/telegram";
import {getLinkedAdmin, handleLinkStart, handleAdminMessage, handleAdminCallback, hasActiveFlow, adminMenu} from "@/lib/server/bot";
import {handleStudentCallback, handleManageCallback, handleNavCallback} from "@/lib/server/botx";

export const dynamic = "force-dynamic";

const SECTIONS = ["A", "B", "C", "F"] as const;
const PREF_LABELS: Record<string, string> = {lectures: "المحاضرات", exams: "الامتحانات والكوزات", announcements: "التبليغات", schedule: "تغييرات الجدول", assignments: "الواجبات"};

const HELP = `🤖 بوت إشعارات بوابة طلبة المرحلة الثالثة

الأوامر المتاحة:
/start — الاشتراك وتأكيد الشعبة
/section — تغيير الشعبة الدراسية
/settings — إعدادات الإشعارات
/status — حالة الاشتراك الحالية
/stop — إيقاف الإشعارات
/help — هذه المساعدة

الخصوصية: بياناتكقتصر على معرف محادثتك وشعبتك، ويمكنك إلغاء الاشتراك في أي وقت.`;

function sectionKeyboard() {
  return {inline_keyboard: SECTIONS.map(s => [{text: `شعبة ${s}`, callback_data: `sec:${s}`}]), one_time_keyboard: true};
}
function prefsKeyboard(prefs: Record<string, boolean>) {
  return {
    inline_keyboard: Object.entries(PREF_LABELS).map(([k, label]) => [{
      text: `${prefs[k] === false ? "❌" : "✅"} ${label}`,
      callback_data: `pref:${k}`,
    }]),
  };
}

async function upsertSubscriber(chatId: number, userId: number | undefined, username: string | undefined, section: string) {
  await q(
    `INSERT INTO tg_subscribers (chat_id, user_id, username, section, status, consent_at)
     VALUES ($1,$2,$3,$4,'active', now())
     ON CONFLICT (chat_id) DO UPDATE SET user_id=EXCLUDED.user_id, username=EXCLUDED.username, section=EXCLUDED.section, status='active', updated_at=now()`,
    [chatId, userId ?? null, username ?? null, section]
  );
  await q(`INSERT INTO tg_audit (action, detail) VALUES ($1,$2)`, ["subscriber.upsert", {chat_id: chatId, section}]);
}

async function handleCommand(chatId: number, text: string, arg: string) {
  const cmd = text.split(" ")[0].split("@")[0];
  if (cmd === "/start") {
    const payload = arg ? verifySubscribeToken(arg, SUBSCRIPTION_SECRET) : null;
    if (arg && !payload) {
      await sendMessage(chatId, "⚠️ رابط الاشتراك غير صالح أو منتهي الصلاحية. افتح صفحة «تفعيل الإشعارات» من البوابة مجددًا.");
      return;
    }
    const section = payload?.section || "A";
    await upsertSubscriber(chatId, undefined, undefined, section);
    await sendMessage(chatId, `✅ تم تفعيل إشعارات البوابة بنجاح!\nالشعبة: <b>${section}</b>\n\nسيصلك كل جديد: المحاضرات، الامتحانات، التبليغات، الواجبات، وتغييرات الجدول.\n\nلتغيير الشعبة استخدم /section، وللإعدادات /settings، وللعرض /status، وللإيقاف /stop.`, {parseMode: "HTML"});
    return;
  }
  if (cmd === "/help") { await sendMessage(chatId, HELP); return; }
  if (cmd === "/section") {
    await sendMessage(chatId, "اختر شعبتك الدراسية:", {replyMarkup: sectionKeyboard()});
    return;
  }
  if (cmd === "/settings") {
    const row = await qOne<{prefs: Record<string, boolean>}>(
      `SELECT prefs FROM tg_subscribers WHERE chat_id=$1 AND status='active'`, [chatId]
    );
    if (!row) { await sendMessage(chatId, "أنت غير مشترك حاليًا. استخدم /start للاشتراك أولًا."); return; }
    await sendMessage(chatId, "⚙️ إعدادات الإشعارات — اضغط للتبديل:", {replyMarkup: prefsKeyboard(row.prefs || {})});
    return;
  }
  if (cmd === "/status") {
    const row = await qOne<{section: string; status: string; prefs: Record<string, boolean>}>(`SELECT section, status, prefs FROM tg_subscribers WHERE chat_id=$1`, [chatId]);
    if (!row) { await sendMessage(chatId, "ℹ️ أنت غير مشترك. استخدم /start للاشتراك."); return; }
    const prefs = Object.entries(row.prefs || {}).map(([k, v]) => `${PREF_LABELS[k] || k}: ${v === false ? "❌" : "✅"}`).join("\n");
    await sendMessage(chatId, `ℹ️ حالة الاشتراك:\nالحالة: ${row.status === "active" ? "✅ مفعّل" : "⛔ متوقف"}\nالشعبة: <b>${row.section}</b>\n\n${prefs}`, {parseMode: "HTML"});
    return;
  }
  if (cmd === "/stop") {
    await q(`UPDATE tg_subscribers SET status='stopped', updated_at=now() WHERE chat_id=$1`, [chatId]);
    await q(`INSERT INTO tg_audit (action, detail) VALUES ($1,$2)`, ["subscriber.stopped", {chat_id: chatId, via: "/stop"}]);
    await sendMessage(chatId, "⛔ تم إيقاف الإشعارات. يمكنك العودة في أي وقت عبر /start.");
    return;
  }
  await sendMessage(chatId, HELP);
}

async function handleCallback(chatId: number, data: string) {
  if (data.startsWith("sec:")) {
    const section = data.slice(4);
    if (!SECTIONS.includes(section as never)) return;
    await q(`UPDATE tg_subscribers SET section=$2, updated_at=now() WHERE chat_id=$1`, [chatId, section]);
    await q(`INSERT INTO tg_audit (action, detail) VALUES ($1,$2)`, ["subscriber.section", {chat_id: chatId, section}]);
    await sendMessage(chatId, `✅ تم تغيير شعبتك إلى <b>${section}</b>.`, {parseMode: "HTML"});
    return;
  }
  if (data.startsWith("pref:")) {
    const key = data.slice(5);
    const row = await qOne<{prefs: Record<string, boolean>}>(`SELECT prefs FROM tg_subscribers WHERE chat_id=$1`, [chatId]);
    if (!row) return;
    const prefs = {...(row.prefs || {}), [key]: (row.prefs || {})[key] === false};
    await q(`UPDATE tg_subscribers SET prefs=$2, updated_at=now() WHERE chat_id=$1`, [chatId, JSON.stringify(prefs)]);
    await sendMessage(chatId, "⚙️ تم تحديث الإعدادات:", {replyMarkup: prefsKeyboard(prefs)});
  }
}

export async function POST(req: NextRequest) {
  try {
    // TELEGRAM_BOT_ENABLED is authoritative: disabled -> ignore everything.
    // When enabled, the webhook secret header is MANDATORY (no secret configured -> reject all).
    const auth = webhookAuthorized(req.headers.get("x-telegram-bot-api-secret-token"), {botEnabled: TELEGRAM_BOT_ENABLED && botConfigured(), webhookSecret: WEBHOOK_SECRET});
    if (auth === "disabled") return NextResponse.json({ok: true, disabled: true});
    if (auth === "unauthorized") return new NextResponse("unauthorized", {status: 401});
    if (!telegramServiceEnabled()) return NextResponse.json({ok: true, disabled: true}); // enabled+configured but DB missing -> inert
    const update = await req.json().catch(() => null);
    if (!update || typeof update !== "object") return NextResponse.json({ok: true});
    const message = update.message;
    const callback = update.callback_query;
    if (message?.chat?.id && (message.text || message.document)) {
      const text = String(message.text || message.caption || "");
      const arg = text.split(" ").slice(1).join(" ").trim();
      if (text.startsWith("/start") && arg.startsWith("link_")) {
        await handleLinkStart(Number(message.chat.id), Number(message.from?.id || message.chat.id), arg);
      } else if (text.startsWith("/")) {
        // a linked admin mid-flow may send a file URL starting with "/" — route by active flow first
        const admin = message.from?.id ? await getLinkedAdmin(Number(message.from.id)) : null;
        if (admin && ["/start", "/menu"].includes(text.trim().split("@")[0])) {
          await handleNavCallback(Number(message.chat.id), Number(message.from.id), "nav:home");
        } else if (["/start", "/menu"].includes(text.trim().split("@")[0])) {
          await handleNavCallback(Number(message.chat.id), Number(message.from?.id || message.chat.id), "nav:home");
        } else if (admin && (await hasActiveFlow(Number(message.chat.id)))) {
          await handleAdminMessage(Number(message.chat.id), Number(message.from.id), text, message.document ? {file_id: String(message.document.file_id), file_name: message.document.file_name, mime_type: message.document.mime_type, file_size: message.document.file_size} : undefined);
        } else {
          await handleCommand(Number(message.chat.id), text, arg);
        }
      } else {
        // non-command message from a linked admin account -> publishing flow state machine
        const admin = message.from?.id ? await getLinkedAdmin(Number(message.from.id)) : null;
        const doc = message.document ? {file_id: String(message.document.file_id), file_name: message.document.file_name, mime_type: message.document.mime_type, file_size: message.document.file_size} : undefined;
        if (admin && doc && !(await hasActiveFlow(Number(message.chat.id)))) {
          await handleNavCallback(Number(message.chat.id), Number(message.from.id), "doc", doc); // Flow B offer
        } else if (admin) {
          await handleAdminMessage(Number(message.chat.id), Number(message.from.id), text, doc);
        }
      }
    } else if (callback?.message?.chat?.id && callback.data) {
      const data = String(callback.data);
      const userId = Number(callback.from?.id || callback.message.chat.id);
      if (data.startsWith("stu:") ) {
        await handleStudentCallback(Number(callback.message.chat.id), userId, data);
      } else if (data === "adm:my" || data.startsWith("it:") || data.startsWith("page:my:")) {
        await handleManageCallback(Number(callback.message.chat.id), userId, data);
      } else if (data.startsWith("nav:") || data === "flow:resume" || data === "flow:discard" || data === "adm:new" || data === "pdf:new") {
        await handleNavCallback(Number(callback.message.chat.id), userId, data);
      } else if (data.startsWith("adm:") || data.startsWith("pub:") || data.startsWith("lec:")) {
        await handleAdminCallback(Number(callback.message.chat.id), userId, data);
      } else {
        await handleCallback(Number(callback.message.chat.id), data);
      }
      await tgFetch("answerCallbackQuery", {callback_query_id: String(callback.id)});
    }
    return NextResponse.json({ok: true});
  } catch (err) {
    console.error("telegram webhook error", err instanceof Error ? err.message : err);
    return NextResponse.json({ok: true});
  }
}
