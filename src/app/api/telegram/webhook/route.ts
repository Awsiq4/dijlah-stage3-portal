import {after, NextRequest, NextResponse} from "next/server";
import {WEBHOOK_SECRET, TELEGRAM_BOT_ENABLED, telegramServiceEnabled, SUBSCRIPTION_SECRET, botConfigured, webhookAuthorized} from "@/lib/server/flags";
import {issueOwnerEnrollment} from "@/lib/server/owner-mfa";
import {verifySubscribeToken} from "@/lib/server/tokens";
import {q, qOne} from "@/lib/server/db";
import {sendMessage, tgFetch, syncBotCommands} from "@/lib/server/telegram";
import {drainQueue} from "@/lib/server/notify";
import {getLinkedAdmin, bindInvitedStaff, handleLinkStart, handleAdminMessage, handleAdminCallback, hasActiveFlow, adminMenu} from "@/lib/server/bot";
import {handleStudentCallback, handleManageCallback, handleNavCallback} from "@/lib/server/botx";
import {handleOwnerCallback} from "@/lib/server/botowner";
import {registerUser, notifyOwnerNewUser, touchActivity, isBotOwner} from "@/lib/server/registry";
import {listUsers} from "@/lib/server/analytics";
import {getFlowState, setFlowState} from "@/lib/server/bot";
import {recordBotActivity} from "@/lib/server/owner-intelligence";
import {redeemSiteSupport,clearSupportDraft,receiveSupportMessage,handleSupportCallback,wakeSupportDelivery} from "@/lib/server/botsupport";

export const dynamic = "force-dynamic";

const SECTIONS = ["A", "B", "C", "F"] as const;
const PREF_LABELS: Record<string, string> = {lectures: "المحاضرات", exams: "الامتحانات والكوزات", announcements: "التبليغات", schedule: "تغييرات الجدول", assignments: "الواجبات"};

const HELP = `🤖 بوت بوابة طلبة المرحلة الثالثة

/start — فتح البوت وتأكيد الشعبة
/section — تغيير الشعبة الدراسية
/settings — إعدادات الإشعارات
/status — حالة الاشتراك
/stop — إيقاف الإشعارات
/help — مساعدة
/privacy — شنو البيانات المخزونة عنك؟
/analytics_off — إيقاف تتبع الاستخدام وحذف سجله
/analytics_on — تفعيل تتبع الاستخدام من جديد

🔒 الخصوصية: نحفظ معلومات الحساب التي تصلنا من Telegram والشعبة وإعدادات التنبيه وتواريخ النشاط. نسجل فقط نوع التفاعل مع أقسام البوت لتحسين الخدمة وإعداد إحصائيات مجمّعة ولوحة المالك. لا نسجل نصوص المحادثات الدراسية العادية. عند تقديم طلب دعم نحفظ رسائل الطلب والصور المرفقة حتى نتمكن من الرد عليها، وتظهر فقط لصاحب الطلب والمالك. نستخدم سجلًا تحليليًا لآخر 90 يومًا وننظّف السجلات الأقدم دوريًا خلال تشغيل البوت، ويمكن إيقافه وحذف سجله في أي وقت باستخدام /analytics_off.`;

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

async function handleCommand(chatId: number, text: string, arg: string, from?: {id?: number; username?: string; first_name?: string; last_name?: string}) {
  const cmd = text.split(" ")[0].split("@")[0];
  if (cmd === "/start") {
    const payload = arg ? verifySubscribeToken(arg, SUBSCRIPTION_SECRET) : null;
    if (arg && !payload) {
      await sendMessage(chatId, "⚠️ رابط الاشتراك غير صالح أو منتهي الصلاحية. افتح صفحة «تفعيل الإشعارات» من البوابة مجددًا.");
      return;
    }
    const section = payload?.section ?? null;
    // register on every /start (idempotent; owner notified only for genuinely new users)
    const reg = await registerUser(chatId, from?.id, from?.username, from?.first_name, from?.last_name, section);
    if (reg.isNew) await notifyOwnerNewUser({...reg, section: section ?? undefined, username: from?.username, first_name: from?.first_name, last_name: from?.last_name});
    if (section) await upsertSubscriber(chatId, from?.id, from?.username, section);
    if (!payload) { await sendMessage(chatId, "اختر شعبتك لتفعيل الإشعارات:", {replyMarkup: sectionKeyboard()}); return; }
    await sendMessage(chatId, `✅ تم تفعيل إشعارات البوابة بنجاح!\nالشعبة: <b>${section}</b>\n\nسيصلك كل جديد: المحاضرات، الامتحانات، التبليغات، الواجبات، وتغييرات الجدول.\n\nلتغيير الشعبة استخدم /section، وللإعدادات /settings، وللعرض /status، وللإيقاف /stop.`, {parseMode: "HTML"});
    return;
  }
  if (cmd === "/help") { await sendMessage(chatId, HELP); return; }
  if (cmd === "/privacy") {
    const me = await qOne<{analytics_opt_out: boolean}>(`SELECT analytics_opt_out FROM tg_subscribers WHERE chat_id=$1`, [chatId]);
    await sendMessage(chatId, "🔒 بياناتك في البوت تشمل اسم حساب Telegram واليوزر والآيدي والشعبة وإعدادات الإشعارات وتواريخ التسجيل والنشاط. نسجل أنواع الأزرار والأقسام المستخدمة في التحليلات، بدون نص المحادثات الدراسية العادية. عند فتح طلب دعم من الموقع، نحفظ رسائلك وصورك داخل التذكرة لعرضها على المالك والرد عليها. إيقاف التحليلات لا يحذف تذاكر الدعم. نحتفظ بسجل تفاعل محدود وننظّف الأحداث الأقدم من 90 يومًا دوريًا أثناء تشغيل البوت.\n\nحالة التتبع: " + (me?.analytics_opt_out ? "متوقف" : "مفعّل") + "\n\n/analytics_off — حذف بيانات التفاعل وإيقاف تسجيلها\n/analytics_on — تفعيلها مجددًا.");
    return;
  }
  if (cmd === "/analytics_off") {
    await q(`UPDATE tg_subscribers SET analytics_opt_out=true WHERE chat_id=$1`, [chatId]);
    await q(`DELETE FROM tg_student_activity WHERE chat_id=$1`, [chatId]);
    await q(`DELETE FROM tg_student_section_changes WHERE chat_id=$1`, [chatId]);
    await sendMessage(chatId, "✅ تم إيقاف تتبع استخدامك وحذف سجل التفاعل. اشتراكك والشعبة وإعدادات الإشعارات تظل شغالة بشكل طبيعي.");
    return;
  }
  if (cmd === "/analytics_on") {
    await q(`UPDATE tg_subscribers SET analytics_opt_out=false WHERE chat_id=$1`, [chatId]);
    await sendMessage(chatId, "✅ تم تفعيل تحليلات الاستخدام من الآن، بدون استرجاع السجل المحذوف.");
    return;
  }
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

async function handleCallback(chatId: number, data: string, from?: {id?: number; username?: string; first_name?: string; last_name?: string}) {
  if (data.startsWith("sec:")) {
    const section = data.slice(4);
    if (!SECTIONS.includes(section as never)) return;
    const reg = await registerUser(chatId, from?.id ?? chatId, from?.username, from?.first_name, from?.last_name, section);
    if (reg.isNew) await notifyOwnerNewUser({...reg, section, username: from?.username, first_name: from?.first_name, last_name: from?.last_name});
    await upsertSubscriber(chatId, from?.id ?? chatId, from?.username, section);
    await q(`INSERT INTO tg_audit (action, detail) VALUES ($1,$2)`, ["subscriber.section", {chat_id: chatId, section}]);
    await sendMessage(chatId, `✅ تم تغيير شعبتك إلى <b>${section}</b>.`, {parseMode: "HTML", replyMarkup: {inline_keyboard: [[{text: "🏠 القائمة الرئيسية", callback_data: "nav:home"}]]}});
    return;
  }
  if (data.startsWith("pref:")) {
    const key = data.slice(5);
    const row = await qOne<{prefs: Record<string, boolean>}>(`SELECT prefs FROM tg_subscribers WHERE chat_id=$1`, [chatId]);
    if (!row) { await sendMessage(chatId, "اختر شعبتك أولًا لتفعيل الإشعارات:", {replyMarkup: sectionKeyboard()}); return; }
    if (!Object.hasOwn(PREF_LABELS, key)) return;
    const prefs = {...Object.fromEntries(Object.keys(PREF_LABELS).map(k => [k, true])), ...(row.prefs || {}), [key]: (row.prefs || {})[key] === false};
    await q(`UPDATE tg_subscribers SET prefs=$2, updated_at=now() WHERE chat_id=$1`, [chatId, JSON.stringify(prefs)]);
    await sendMessage(chatId, "⚙️ تم تحديث الإعدادات:", {replyMarkup: prefsKeyboard(prefs)});
  }
}

export async function POST(req: NextRequest) {
  let replyChat: number | undefined;
  try {
    // TELEGRAM_BOT_ENABLED is authoritative: disabled -> ignore everything.
    // When enabled, the webhook secret header is MANDATORY (no secret configured -> reject all).
    const auth = webhookAuthorized(req.headers.get("x-telegram-bot-api-secret-token"), {botEnabled: TELEGRAM_BOT_ENABLED && botConfigured(), webhookSecret: WEBHOOK_SECRET});
    if (auth === "disabled") return NextResponse.json({ok: true, disabled: true});
    if (auth === "unauthorized") return new NextResponse("unauthorized", {status: 401});
    if (!telegramServiceEnabled()) return NextResponse.json({ok: true, disabled: true}); // enabled+configured but DB missing -> inert
    const update = await req.json().catch(() => null);
    if (!update || typeof update !== "object") return NextResponse.json({ok: true});
    const chatId0 = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id ?? update.edited_message?.chat?.id;
    if (chatId0) await touchActivity(Number(chatId0));
    const message = update.message;
    const callback = update.callback_query;
    // A Telegram photo is passed to the publishing flow as a JPEG document.
    // Support-ticket photos are handled first and remain on their existing path.
    const photo = Array.isArray(message?.photo) ? message.photo.at(-1) : null;
    const attachment = message?.document
      ? {file_id: String(message.document.file_id), file_name: message.document.file_name,
          mime_type: message.document.mime_type, file_size: message.document.file_size}
      : photo ? {file_id: String(photo.file_id), file_name: "exam-photo-" + String(photo.file_unique_id || photo.file_id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) + ".jpg",
          mime_type: "image/jpeg", file_size: photo.file_size}
      : undefined;
    replyChat = Number(message?.chat?.id || callback?.message?.chat?.id) || undefined;
    if ((message?.chat?.type || callback?.message?.chat?.type) !== "private") return NextResponse.json({ok: true});
    if (message?.chat?.id && (message.text || message.document || message.photo)) {
      const text = String(message.text || message.caption || "");
      const arg = text.split(" ").slice(1).join(" ").trim();
      if (text.trim().split("@")[0] === "/mfa_setup" && message.from?.id && message.from.id === message.chat.id) {
        const code = await issueOwnerEnrollment(Number(message.from.id));
        if (code) await sendMessage(Number(message.chat.id),
          "🔐 رمز إعداد التحقق بخطوتين صالح لعشر دقائق. أدخله فقط في صفحة تسجيل دخول البوابة.\n\n" + code);
      } else if (text.startsWith("/start") && arg.startsWith("sd_")) {
        await redeemSiteSupport(Number(message.chat.id),Number(message.from?.id || message.chat.id),arg.slice(3),message.from);
      } else if (text.startsWith("/start") && arg.startsWith("link_")) {
        await handleLinkStart(Number(message.chat.id), Number(message.from?.id || message.chat.id), arg);
      } else if (text.startsWith("/")) {
        // a linked admin mid-flow may send a file URL starting with "/" — route by active flow first
        const admin = message.from?.id ? await getLinkedAdmin(Number(message.from.id)) : null;
        if (["/start", "/menu"].includes(text.trim().split("@")[0])) {
          after(()=>syncBotCommands().then(()=>undefined));
          if (Number(message.from?.id) === Number(message.chat.id)) {
            await bindInvitedStaff(Number(message.from.id));
          }
          await clearSupportDraft(Number(message.chat.id)); // only transient typing; saved tickets are untouched
          // every /start registers the user (idempotent; owner notified only when genuinely new)
          const reg = await registerUser(Number(message.chat.id), Number(message.from?.id || message.chat.id), message.from?.username, message.from?.first_name, message.from?.last_name, null);
          if (reg.isNew) {
            await notifyOwnerNewUser({...reg, username: message.from?.username, first_name: message.from?.first_name, last_name: message.from?.last_name});
            await sendMessage(Number(message.chat.id), "🔒 خصوصيتك مهمة: البوت يحتفظ ببيانات حسابك والشعبة ونوع استخدام أقسام البوت لغرض تحسين الخدمة وإحصائيات الإدارة فقط، بدون تخزين نصوص المحادثات الدراسية العادية. رسائل الدعم المرسلة من رابط الموقع تُحفظ داخل التذكرة ليتمكن المالك من الرد. تعرض التحليلات آخر 90 يومًا، ويُنظّف السجل الأقدم دوريًا، ويمكنك إيقافه وحذفه في أي وقت عبر /analytics_off. التفاصيل: /privacy");
          }
          await handleNavCallback(Number(message.chat.id), Number(message.from?.id || message.chat.id), "nav:home");
        } else if (admin && (await hasActiveFlow(Number(message.chat.id)))) {
          await handleAdminMessage(Number(message.chat.id), Number(message.from.id), text, attachment);
        } else {
          await handleCommand(Number(message.chat.id), text, arg, message.from);
        }
      } else if (await receiveSupportMessage(Number(message.chat.id),Number(message.from?.id || message.chat.id),Number(update.update_id),message)) {
        // Saved tickets and replies are independent of /start or academic navigation.
      } else {
        // owner search flow
        const st = await getFlowState(Number(message.chat.id));
        if (st?.flow === "ownersearch" && st.data?.step === "q" && isBotOwner(Number(message.from?.id || 0))) {
          const {rows, total} = await listUsers((await import("@/lib/server/db")).defaultQueryer, 0, 8, {q: text});
          await setFlowState(Number(message.chat.id), "", {});
          const kb = rows.map(u => [{text: `#${String(u.reg_seq ?? "?").padStart(6, "0")} ${(`${u.first_name} ${u.last_name}`.trim() || u.username || u.chat_id)}`, callback_data: `own:u:${u.chat_id}`}]);
          kb.push([{text: "👑 لوحة المالك", callback_data: "own:home"}]);
          await sendMessage(Number(message.chat.id), rows.length ? `🔍 نتائج البحث عن «${text}» (${total}):` : "لا نتائج.", {replyMarkup: {inline_keyboard: kb}});
          return NextResponse.json({ok: true});
        }
        // non-command message from a linked admin account -> publishing flow state machine
        const admin = message.from?.id ? await getLinkedAdmin(Number(message.from.id)) : null;
        const doc = attachment;
        if (admin && doc && !(await hasActiveFlow(Number(message.chat.id)))) {
          await handleNavCallback(Number(message.chat.id), Number(message.from.id), "doc", doc); // Flow B offer
        } else if (admin) {
          await handleAdminMessage(Number(message.chat.id), Number(message.from.id), text, doc);
        } else {
          await sendMessage(Number(message.chat.id), "اختر من الأزرار حتى أساعدك:", {replyMarkup: {inline_keyboard: [[{text: "🏠 القائمة الرئيسية", callback_data: "nav:home"}]]}});
        }
      }
    } else if (callback?.message?.chat?.id && callback.data) {
      await tgFetch("answerCallbackQuery", {callback_query_id: String(callback.id)});
      const data = String(callback.data);
      const userId = Number(callback.from?.id || callback.message.chat.id);
      if (data.startsWith("sup:")) {
        await handleSupportCallback(Number(callback.message.chat.id),userId,data);
      } else if (data.startsWith("own:")) {
        await handleOwnerCallback(Number(callback.message.chat.id), userId, data);
      } else if (data.startsWith("stu:") ) {
        await handleStudentCallback(Number(callback.message.chat.id), userId, data);
      } else if (data === "adm:my" || data.startsWith("it:") || data.startsWith("qmanage:") || data.startsWith("page:my:") || data.startsWith("cw:")) {
        await handleManageCallback(Number(callback.message.chat.id), userId, data);
      } else if (data.startsWith("nav:") || data === "flow:resume" || data === "flow:discard" || (data === "adm:new" || data === "adm:materials") || data === "pdf:new") {
        await handleNavCallback(Number(callback.message.chat.id), userId, data);
      } else if (data.startsWith("draft:") || data.startsWith("ann:") || data.startsWith("adm:") || data.startsWith("pub:") || data.startsWith("lec:") || data.startsWith("q:kind:") || data.startsWith("asg:") || data.startsWith("exam:") || data.startsWith("quiz:")) {
        await handleAdminCallback(Number(callback.message.chat.id), userId, data, eventIds => {
          after(() => drainQueue(200, eventIds).then(() => undefined));
        });
      } else {
        await handleCallback(Number(callback.message.chat.id), data, callback.from);
      }
      // Keep publisher chats visually tidy: once a menu choice opens the next
      // screen, remove its now-obsolete inline buttons. Do not touch student,
      // owner, support, or final-publish confirmation buttons (retries stay safe).
      const publishingNavigation = data === "adm:new" || data === "adm:materials" ||
        data === "adm:cancel" || data === "adm:quick" || data === "adm:ann" ||
        data === "adm:lec" || data === "adm:summary" || data === "adm:questions" ||
        data === "adm:asg" || data === "adm:exam" || data === "adm:results" ||
        data.startsWith("quiz:") || data.startsWith("asg:") ||
        data.startsWith("exam:") || data.startsWith("lec:subj:") ||
        data.startsWith("lec:aud:") || data.startsWith("ann:subj:") ||
        data.startsWith("q:kind:") || data.startsWith("draft:");
      if (publishingNavigation && callback.message.message_id) {
        const chatId = Number(callback.message.chat.id);
        const messageId = Number(callback.message.message_id);
        after(() => tgFetch("editMessageReplyMarkup", {chat_id: chatId, message_id: messageId})
          .then(() => undefined).catch(() => undefined));
      }
    }
    await recordBotActivity(update);
    after(()=>wakeSupportDelivery().catch(err=>console.error("support delivery retry:",err instanceof Error?err.message:"error")));
    return NextResponse.json({ok: true});
  } catch (err) {
    console.error("telegram webhook error", err instanceof Error ? err.message : err);
    if (replyChat) await sendMessage(replyChat, "تعذر إكمال الخطوة الآن. ارجع للمسودة أو حاول مجددًا.", {replyMarkup: {inline_keyboard: [[{text: "🏠 القائمة الرئيسية", callback_data: "nav:home"}]]}});
    return NextResponse.json({ok: true});
  }
}
