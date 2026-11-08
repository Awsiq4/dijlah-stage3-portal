// Owner-only dashboard: stats, growth, user management (list/search/detail), notification settings.
// Every entry point re-checks isBotOwner() server-side.
import {q} from "./db.ts";
import {sendMessage} from "./telegram.ts";
import {isBotOwner, esc} from "./registry.ts";
import {computeAnalytics, listUsers, getUser, ownerNotificationsEnabled, setSetting, OWNER_NOTIFY_KEY, type UserRow} from "./analytics.ts";

const PER_PAGE = 8;
const backHome = {inline_keyboard: [[{text: "👑 لوحة المالك", callback_data: "own:home"}, {text: "🏠 القائمة الرئيسية", callback_data: "nav:home"}]]};

export function ownerMenu() {
  return {inline_keyboard: [
    [{text:"🎫 إدارة الدعم والاقتراحات",callback_data:"sup:list:0"}],
    [{text: "📊 إحصائيات البوت", callback_data: "own:stats"}],
    [{text: "👥 إدارة المستخدمين", callback_data: "own:users:0"}],
    [{text: "🆕 أحدث المسجلين", callback_data: "own:recent:0"}],
    [{text: "📈 نمو المستخدمين", callback_data: "own:growth"}],
    [{text: "🔔 إعدادات الإشعارات", callback_data: "own:notif"}],
    [{text: "🏠 القائمة الرئيسية", callback_data: "nav:home"}],
  ]};
}

function fmtUser(u: UserRow): string {
  const name = `${u.first_name} ${u.last_name}`.trim() || "—";
  return `👤 ${esc(name)}\n🔗 ${u.username ? "@" + esc(u.username) : "لا يوجد username"}\n🆔 <code>${u.chat_id}</code> · 🔢 #${String(u.reg_seq ?? "—").padStart(6, "0")}\n🎓 ${esc(u.role)} · 🏫 ${esc(u.section || "غير محدد")}\n📅enda ${esc(new Intl.DateTimeFormat("ar-IQ", {timeZone: "Asia/Baghdad", dateStyle: "medium", timeStyle: "short"}).format(new Date(u.registered_at)))}\n🕒 آخر نشاط: ${esc(new Intl.DateTimeFormat("ar-IQ", {timeZone: "Asia/Baghdad", dateStyle: "medium", timeStyle: "short"}).format(new Date(u.last_activity_at)))}`;
}

export async function handleOwnerCallback(chatId: number, userId: number, data: string): Promise<void> {
  if (!isBotOwner(userId)) {
    await sendMessage(chatId, "⛔ هذا القسم للمالك فقط.");
    return;
  }
  if (data === "own:home") {
    await sendMessage(chatId, "👑 لوحة المالك:", {replyMarkup: ownerMenu()});
    return;
  }
  if (data === "own:stats") {
    const a = await computeAnalytics();
    const roles = Object.entries(a.byRole).map(([r, c]) => `• ${esc(r)}: ${c}`).join("\n") || "—";
    const secs = Object.entries(a.bySection).map(([s, c]) => `• شعبة ${esc(s)}: ${c}`).join("\n") || "—";
    await sendMessage(chatId,
      `📊 <b>إحصائيات البوت</b>\n\n👥 إجمالي المسجلين: <b>${a.total}</b>\n🆕 اليوم: ${a.newToday} · أمس: ${a.newYesterday} · 7 أيام: ${a.new7d} · 30 يومًا: ${a.new30d}\n⚡ نشطون: 24h ${a.active24h} · 7d ${a.active7d} · 30d ${a.active30d}\n\n🎓 حسب الدور:\n${roles}\n\n🏫 حسب الشعبة (طلاب):\n${secs}\n❔ بدون شعبة: ${a.unassignedSection}`,
      {parseMode: "HTML", replyMarkup: backHome});
    return;
  }
  if (data === "own:growth") {
    const a = await computeAnalytics();
    const g = a.growth;
    const pct = g.pct === null ? "جديد (لا توجد بيانات سابقة)" : `${g.pct >= 0 ? "+" : ""}${g.pct}% ${g.pct >= 0 ? "📈" : "📉"}`;
    await sendMessage(chatId,
      `📈 <b>نمو المستخدمين</b> (بتوقيت بغداد)\n\nاليوم: ${g.today}\nهذا الأسبوع: ${g.thisWeek}\nهذا الشهر: ${g.thisMonth}\nآخر 7 أيام: ${g.last7d}\nالـ7 أيام السابقة: ${g.prev7d}\nالتغير: ${pct}\nأعلى يوم (30 يومًا): ${g.peakDay ? esc(g.peakDay) + " (" + g.peakCount + ")" : "—"}`,
      {parseMode: "HTML", replyMarkup: backHome});
    return;
  }
  if (data.startsWith("own:users:") || data.startsWith("own:recent:")) {
    const kind = data.startsWith("own:users:") ? "own:users" : "own:recent";
    const page = Number(data.split(":")[2]) || 0;
    const {rows, total} = await listUsers(await import("./db.ts").then(m => m.defaultQueryer), page, PER_PAGE);
    const kb: {text: string; callback_data: string}[][] = rows.map(u => [{text: `#${String(u.reg_seq ?? "?").padStart(6, "0")} ${(`${u.first_name} ${u.last_name}`.trim() || u.username || u.chat_id)}`, callback_data: `own:u:${u.chat_id}`}]);
    const nav: {text: string; callback_data: string}[] = [];
    if (page > 0) nav.push({text: "⬅️", callback_data: `${kind}:${page - 1}`});
    if ((page + 1) * PER_PAGE < total) nav.push({text: "➡️", callback_data: `${kind}:${page + 1}`});
    nav.push({text: "🔍 بحث", callback_data: "own:search"});
    nav.push({text: "👑 لوحة المالك", callback_data: "own:home"});
    kb.push(nav);
    await sendMessage(chatId, rows.length ? `${kind === "own:recent" ? "🆕 أحدث المسجلين" : "👥 المستخدمون"} — صفحة ${page + 1}/${Math.max(1, Math.ceil(total / PER_PAGE))} (الإجمالي ${total}):` : "لا يوجد مستخدمون بعد.", {replyMarkup: {inline_keyboard: kb}});
    return;
  }
  if (data === "own:search") {
    await sendMessage(chatId, "🔍 أرسل الآن: رقم TG أو @username أو الاسم أو رقم التسجيل:", {replyMarkup: {inline_keyboard: [[{text: "❌ إلغاء", callback_data: "own:home"}]]}});
    const {setFlowState} = await import("./bot.ts");
    await setFlowState(chatId, "ownersearch", {step: "q"});
    return;
  }
  if (data.startsWith("own:u:")) {
    const uid = Number(data.split(":")[2]);
    const u = await getUser(await import("./db.ts").then(m => m.defaultQueryer), uid);
    await sendMessage(chatId, u ? fmtUser(u) : "⚠️ المستخدم غير موجود.", {parseMode: "HTML", replyMarkup: backHome});
    return;
  }
  if (data === "own:notif") {
    const enabled = await ownerNotificationsEnabled();
    await sendMessage(chatId, `🔔 إشعارات المستخدمين الجدد: <b>${enabled ? "مفعّلة ✅" : "معطّلة ⛔"}</b>\n(التعطيل لا يوقف التسجيل أو الإحصائيات)`, {
      parseMode: "HTML",
      replyMarkup: {inline_keyboard: [
        [{text: enabled ? "⛔ تعطيل" : "✅ تفعيل", callback_data: "own:notif:toggle"}],
        [{text: "👑 لوحة المالك", callback_data: "own:home"}],
      ]},
    });
    return;
  }
  if (data === "own:notif:toggle") {
    const cur = await ownerNotificationsEnabled();
    await setSetting(await import("./db.ts").then(m => m.defaultQueryer), OWNER_NOTIFY_KEY, !cur);
    await sendMessage(chatId, !cur ? "✅ تم تفعيل إشعارات المستخدمين الجدد." : "⛔ تم تعطيل إشعارات المستخدمين الجدد (التسجيل يستمر).", {replyMarkup: backHome});
    return;
  }
}
