import {NextRequest, NextResponse} from "next/server";
import {WEBHOOK_SECRET, telegramServiceEnabled, timingSafeEqual, SUBSCRIPTION_SECRET, botConfigured} from "@/lib/server/flags";
import {verifySubscribeToken} from "@/lib/server/tokens";
import {q, qOne} from "@/lib/server/db";
import {sendMessage} from "@/lib/server/telegram";

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
    if (WEBHOOK_SECRET) {
      const header = req.headers.get("x-telegram-bot-api-secret-token") || "";
      if (!timingSafeEqual(header, WEBHOOK_SECRET)) return new NextResponse("unauthorized", {status: 401});
    }
    if (!telegramServiceEnabled() && !botConfigured()) return NextResponse.json({ok: true, disabled: true});
    const update = await req.json().catch(() => null);
    if (!update || typeof update !== "object") return NextResponse.json({ok: true});
    const message = update.message;
    const callback = update.callback_query;
    if (message?.chat?.id && message.text) {
      const text = String(message.text);
      if (text.startsWith("/")) {
        const arg = text.split(" ").slice(1).join(" ").trim();
        await handleCommand(Number(message.chat.id), text, arg);
      }
    } else if (callback?.message?.chat?.id && callback.data) {
      await handleCallback(Number(callback.message.chat.id), String(callback.data));
      await sendMessage(Number(callback.from?.id || callback.message.chat.id), "✅ تم.").catch(() => undefined);
    }
    return NextResponse.json({ok: true});
  } catch (err) {
    console.error("telegram webhook error", err instanceof Error ? err.message : err);
    return NextResponse.json({ok: true});
  }
}
