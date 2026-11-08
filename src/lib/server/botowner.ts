// Private Telegram owner dashboard: live statistics, section drilldowns and user details.
// Every callback rechecks OWNER by Telegram user ID and is restricted to that private chat.
import {defaultQueryer} from "./db.ts";
import {sendMessage} from "./telegram.ts";
import {isBotOwner, esc} from "./registry.ts";
import {
  computeAnalytics, listUsers, getUser, ownerNotificationsEnabled,
  setSetting, OWNER_NOTIFY_KEY, type UserRow,
} from "./analytics.ts";
import {
  SECTION_KEYS, sectionLabel, getSectionStats, listSectionStudents,
  getEffectiveRoleCounts, getEffectiveRole, type SectionKey, type SectionStats,
} from "./owner-sections.ts";

const PER_PAGE = 8;
type BotButton = {text: string; callback_data: string};
const backHome = {inline_keyboard: [
  [{text: "🏫 إحصائيات الشعب", callback_data: "own:sections"}],
  [{text: "👑 لوحة المالك", callback_data: "own:home"}, {text: "🏠 الرئيسية", callback_data: "nav:home"}],
]};

const ROLE_AR: Record<string, string> = {
  owner: "مالك البوابة",
  super_admin: "مدير رئيسي",
  general_representative: "الممثل العام",
  section_representative: "ممثل شعبة",
  teacher: "تدريسي",
  student: "طالب",
  editor: "محرر",
  viewer: "مشاهد",
};

function roleLabel(role: string): string {
  return ROLE_AR[role] || role;
}
function fullName(u: UserRow): string {
  return ((u.first_name || "") + " " + (u.last_name || "")).trim() || u.username || "بدون اسم";
}
function userButton(u: UserRow, section?: SectionKey, page = 0): BotButton {
  const label = "#" + String(u.reg_seq ?? "—").padStart(6, "0") + " " + fullName(u);
  const suffix = section ? ":" + section + ":" + page : "";
  return {text: label.slice(0, 58), callback_data: "own:u:" + u.chat_id + suffix};
}
function dateInBaghdad(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "غير متوفر";
  return new Intl.DateTimeFormat("ar-IQ", {
    timeZone: "Asia/Baghdad", dateStyle: "medium", timeStyle: "short",
  }).format(d);
}
function formatUser(u: UserRow, actualRole: string): string {
  return [
    "👤 <b>" + esc(fullName(u)) + "</b>",
    "🔗 اليوزر: " + (u.username ? "@" + esc(u.username) : "لا يوجد يوزر"),
    "🆔 Telegram ID: <code>" + u.chat_id + "</code>",
    "🔢 رقم التسجيل: #" + String(u.reg_seq ?? "—").padStart(6, "0"),
    "🎓 الدور: " + esc(roleLabel(actualRole)),
    "🏫 الشعبة المسجلة: " + esc(u.section ? "شعبة " + u.section : "غير محددة"),
    "🔔 الاشتراك بالإشعارات: " + (u.status === "active" ? "مفعّل" : "متوقف"),
    "📅 تاريخ التسجيل: " + esc(dateInBaghdad(u.registered_at)),
    "🕒 آخر نشاط: " + esc(dateInBaghdad(u.last_activity_at)),
  ].join("\n");
}
function sectionTotal(sectionStats: Record<SectionKey, SectionStats>): number {
  return SECTION_KEYS.reduce((n, key) => n + sectionStats[key].total, 0);
}
function sectionButtons(sectionStats: Record<SectionKey, SectionStats>): BotButton[][] {
  const buttons: BotButton[][] = SECTION_KEYS.map(key => [{
    text: "👥 " + sectionLabel(key) + " — " + sectionStats[key].total + " طالب",
    callback_data: "own:sec:" + key + ":0",
  }]);
  buttons.push([{text: "📊 الإحصائيات العامة", callback_data: "own:stats"}]);
  buttons.push([{text: "👥 كل الحسابات", callback_data: "own:users:0"}]);
  buttons.push([{text: "👑 لوحة المالك", callback_data: "own:home"}]);
  return buttons;
}

export function ownerMenu() {
  return {inline_keyboard: [
    [{text: "📊 إحصائيات البوت", callback_data: "own:stats"}],
    [{text: "🏫 إحصائيات الشعب وحسابات الطلاب", callback_data: "own:sections"}],
    [{text: "👥 جميع الحسابات", callback_data: "own:users:0"}],
    [{text: "🆕 أحدث المسجلين", callback_data: "own:recent:0"}],
    [{text: "📈 نمو المستخدمين", callback_data: "own:growth"}],
    [{text: "🔔 إعدادات الإشعارات", callback_data: "own:notif"}],
    [{text: "🏠 القائمة الرئيسية", callback_data: "nav:home"}],
  ]};
}

export async function handleOwnerCallback(chatId: number, userId: number, data: string): Promise<void> {
  if (!isBotOwner(userId) || chatId !== userId) {
    await sendMessage(chatId, "⛔ هذا القسم مخصص لحساب المالك فقط.");
    return;
  }
  if (data === "own:home") {
    await sendMessage(chatId, "👑 لوحة المالك:\nاختر الإحصائيات أو الشعبة لعرض حسابات الطلاب في أي وقت.", {replyMarkup: ownerMenu()});
    return;
  }
  if (data === "own:stats") {
    const [a, stats, roles] = await Promise.all([
      computeAnalytics(), getSectionStats(), getEffectiveRoleCounts(),
    ]);
    const roleLines = Object.entries(roles).map(([role, count]) =>
      "• " + esc(roleLabel(role)) + ": " + count).join("\n") || "—";
    const sectionLines = SECTION_KEYS.map(key =>
      "• " + sectionLabel(key) + ": <b>" + stats[key].total + "</b> طالب").join("\n");
    const msg = [
      "📊 <b>إحصائيات البوت التفصيلية</b>",
      "👥 إجمالي الحسابات: <b>" + a.total + "</b>",
      "🎓 إجمالي الطلاب (باستثناء حسابات الإدارة): <b>" + sectionTotal(stats) + "</b>",
      "🆕 تسجيلات اليوم: " + a.newToday + " · أمس: " + a.newYesterday,
      "📅 تسجيلات 7 أيام: " + a.new7d + " · 30 يومًا: " + a.new30d,
      "⚡ تفاعل خلال 24 ساعة: " + a.active24h + " · 7 أيام: " + a.active7d + " · 30 يومًا: " + a.active30d,
      "",
      "🏫 <b>الطلاب حسب الشعبة</b>",
      sectionLines,
      "",
      "👤 <b>الحسابات حسب الدور الفعلي</b>",
      roleLines,
      "",
      "اضغط على أي شعبة لعرض حسابات طلابها وتفاصيلهم.",
    ].join("\n");
    await sendMessage(chatId, msg, {parseMode: "HTML", replyMarkup: {inline_keyboard: sectionButtons(stats)}});
    return;
  }
  if (data === "own:sections") {
    const stats = await getSectionStats();
    const lines = SECTION_KEYS.map(key => {
      const x = stats[key];
      return "🏫 <b>" + sectionLabel(key) + "</b>\n" +
        "👥 الطلاب: " + x.total + " · 🆕 الجدد (7 أيام): " + x.new7d +
        "\n⚡ تفاعل (7 أيام): " + x.active7d + " · 🔔 اشتراك مفعّل: " + x.subscribed;
    });
    await sendMessage(chatId, [
      "🏫 <b>إحصائيات الشعب التفصيلية</b>",
      "🎓 إجمالي الطلاب: <b>" + sectionTotal(stats) + "</b>",
      "الأعداد تعتمد على حسابات الطلاب فقط، ولا تشمل المالك أو الحسابات الإدارية المرتبطة.",
      "",
      lines.join("\n\n"),
      "",
      "اضغط على الشعبة لتصفح حسابات طلابها بأسمائهم، ثم اضغط على اسم الطالب لعرض ملفه.",
    ].join("\n"), {parseMode: "HTML", replyMarkup: {inline_keyboard: sectionButtons(stats)}});
    return;
  }

  const sectionMatch = /^own:sec:(A|B|C|F|NA):([0-9]{1,4})$/.exec(data);
  if (sectionMatch) {
    const section = sectionMatch[1] as SectionKey;
    const requestedPage = Number(sectionMatch[2]);
    const [{rows, total, page}, stats] = await Promise.all([
      listSectionStudents(section, requestedPage, PER_PAGE),
      getSectionStats(),
    ]);
    const x = stats[section];
    const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
    const keyboard: BotButton[][] = rows.map(user => [userButton(user, section, page)]);
    const navigation: BotButton[] = [];
    if (page > 0) navigation.push({text: "⬅️ السابقة", callback_data: "own:sec:" + section + ":" + (page - 1)});
    if ((page + 1) * PER_PAGE < total) navigation.push({text: "التالية ➡️", callback_data: "own:sec:" + section + ":" + (page + 1)});
    if (navigation.length) keyboard.push(navigation);
    keyboard.push([{text: "🏫 كل الشعب", callback_data: "own:sections"}, {text: "👑 لوحة المالك", callback_data: "own:home"}]);
    await sendMessage(chatId, [
      "👥 <b>طلاب " + esc(sectionLabel(section)) + "</b>",
      "إجمالي الطلاب: <b>" + total + "</b> · الصفحة " + (page + 1) + "/" + totalPages,
      "🆕 جدد (7 أيام): " + x.new7d + " · ⚡ متفاعلون (7 أيام): " + x.active7d,
      "🔔 إشعارات مفعّلة: " + x.subscribed + " · متوقفة: " + x.stopped,
      "⚡ تفاعل (30 يومًا): " + x.active30d,
      "",
      rows.length ? "اضغط على اسم أي طالب لعرض حسابه:" : "لا توجد حسابات في هذه الشعبة.",
    ].join("\n"), {parseMode: "HTML", replyMarkup: {inline_keyboard: keyboard}});
    return;
  }

  if (data === "own:growth") {
    const a = await computeAnalytics();
    const g = a.growth;
    const pct = g.pct === null ? "جديد (لا توجد بيانات سابقة)" : (g.pct >= 0 ? "+" : "") + g.pct + "% " + (g.pct >= 0 ? "📈" : "📉");
    await sendMessage(chatId, [
      "📈 <b>نمو المستخدمين</b> (بتوقيت بغداد)",
      "اليوم: " + g.today,
      "هذا الأسبوع: " + g.thisWeek,
      "هذا الشهر: " + g.thisMonth,
      "آخر 7 أيام: " + g.last7d,
      "الـ7 أيام السابقة: " + g.prev7d,
      "التغير: " + pct,
      "أعلى يوم (30 يومًا): " + (g.peakDay ? esc(g.peakDay) + " (" + g.peakCount + ")" : "—"),
    ].join("\n"), {parseMode: "HTML", replyMarkup: backHome});
    return;
  }

  if (data.startsWith("own:users:") || data.startsWith("own:recent:")) {
    const kind = data.startsWith("own:users:") ? "own:users" : "own:recent";
    const rawPage = data.split(":")[2];
    if (!/^[0-9]{1,4}$/.test(rawPage)) return;
    const page = Number(rawPage);
    const {rows, total} = await listUsers(defaultQueryer, page, PER_PAGE);
    const keyboard: BotButton[][] = rows.map(u => [{
      ...userButton(u),
      text: (userButton(u).text + " · " + (u.section ? "شعبة " + u.section : "بلا شعبة")).slice(0, 60),
    }]);
    const nav: BotButton[] = [];
    if (page > 0) nav.push({text: "⬅️", callback_data: kind + ":" + (page - 1)});
    if ((page + 1) * PER_PAGE < total) nav.push({text: "➡️", callback_data: kind + ":" + (page + 1)});
    if (nav.length) keyboard.push(nav);
    keyboard.push([{text: "🔍 بحث", callback_data: "own:search"}, {text: "🏫 حسب الشعبة", callback_data: "own:sections"}]);
    keyboard.push([{text: "👑 لوحة المالك", callback_data: "own:home"}]);
    await sendMessage(chatId, rows.length
      ? (kind === "own:recent" ? "🆕 أحدث المسجلين" : "👥 جميع الحسابات") +
        " — صفحة " + (page + 1) + "/" + Math.max(1, Math.ceil(total / PER_PAGE)) +
        " (الإجمالي " + total + "):"
      : "لا توجد حسابات لهذه الصفحة.", {replyMarkup: {inline_keyboard: keyboard}});
    return;
  }
  if (data === "own:search") {
    await sendMessage(chatId, "🔍 أرسل الآن رقم Telegram ID أو @username أو الاسم أو رقم التسجيل:", {
      replyMarkup: {inline_keyboard: [[{text: "❌ إلغاء", callback_data: "own:home"}]]},
    });
    const {setFlowState} = await import("./bot.ts");
    await setFlowState(chatId, "ownersearch", {step: "q"});
    return;
  }

  const userMatch = /^own:u:([0-9]{1,20})(?::(A|B|C|F|NA):([0-9]{1,4}))?$/.exec(data);
  if (userMatch) {
    const uid = Number(userMatch[1]);
    if (!Number.isSafeInteger(uid)) return;
    const u = await getUser(defaultQueryer, uid);
    const role = isBotOwner(uid) ? "owner" : (await getEffectiveRole(uid)) || u?.role || "student";
    const returnButton: BotButton = userMatch[2]
      ? {text: "⬅️ العودة لطلاب " + sectionLabel(userMatch[2] as SectionKey),
        callback_data: "own:sec:" + userMatch[2] + ":" + userMatch[3]}
      : {text: "👥 كل الحسابات", callback_data: "own:users:0"};
    await sendMessage(chatId, u ? formatUser(u, role) : "⚠️ الحساب غير موجود.", {
      parseMode: "HTML",
      replyMarkup: {inline_keyboard: [
        [returnButton],
        [{text: "🏫 إحصائيات الشعب", callback_data: "own:sections"}, {text: "👑 لوحة المالك", callback_data: "own:home"}],
      ]},
    });
    return;
  }

  if (data === "own:notif") {
    const enabled = await ownerNotificationsEnabled();
    await sendMessage(chatId, "🔔 إشعارات المستخدمين الجدد: <b>" +
      (enabled ? "مفعّلة ✅" : "معطّلة ⛔") +
      "</b>\n(التعطيل لا يوقف التسجيل أو الإحصائيات)", {
      parseMode: "HTML",
      replyMarkup: {inline_keyboard: [
        [{text: enabled ? "⛔ تعطيل" : "✅ تفعيل", callback_data: "own:notif:toggle"}],
        [{text: "👑 لوحة المالك", callback_data: "own:home"}],
      ]},
    });
    return;
  }
  if (data === "own:notif:toggle") {
    const current = await ownerNotificationsEnabled();
    await setSetting(defaultQueryer, OWNER_NOTIFY_KEY, !current);
    await sendMessage(chatId, !current
      ? "✅ تم تفعيل إشعارات المستخدمين الجدد."
      : "⛔ تم تعطيل إشعارات المستخدمين الجدد (التسجيل مستمر).", {replyMarkup: backHome});
    return;
  }
}
