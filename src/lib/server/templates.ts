import type {TgEvent} from "./targeting";

export type RenderedMessage = {text: string; parseMode: "HTML"};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderMessage(event: TgEvent & {title: string; body?: string | null; url?: string | null}, baseUrl: string): RenderedMessage {
  const link = event.url ? `${baseUrl}${event.url}` : baseUrl;
  const section = event.section && event.section !== "all" ? `\nالشعبة: <b>${esc(event.section)}</b>` : "";
  const btn = `<a href="${esc(link)}">فتح في البوابة</a>`;
  let text = "";
  switch (event.type) {
    case "lecture":
      text = `📚 <b>محاضرة جديدة</b>\nالمادة: ${esc(event.title)}${section}\n\n${esc(event.body || "تمت إضافة/تحديث محاضرة جديدة.")}\n\n📎 ${btn}`;
      break;
    case "exam":
      text = `📢 <b>تحديث امتحان/كويز</b>\nالمادة: ${esc(event.title)}${section}\n\n${esc(event.body || "تم تعديل تفاصيل الامتحان.")}\n\n${btn}`;
      break;
    case "assignment":
      text = `📝 <b>واجب جديد</b>\n${esc(event.title)}${section}\n\n${esc(event.body || "")}\n\n${btn}`;
      break;
    case "schedule":
      text = `🗓️ <b>تغيير في الجدول</b>${section}\n\n${esc(event.body || "")}\n\n${btn}`;
      break;
    case "announcement":
      text = `${event.priority === "urgent" ? "🔴" : event.priority === "important" ? "🟠" : "📣"} <b>${esc(event.title)}</b>\n\n${esc(event.body || "")}\n\n${btn}`;
      break;
    case "test":
      text = `🧪 <b>رسالة اختبار</b>\n\n${esc(event.body || "هذه رسالة اختبار من مركز إشعارات تليجرام.")}\n\n${btn}`;
      break;
    default:
      text = `🔔 <b>${esc(event.title)}</b>\n\n${esc(event.body || "")}\n\n${btn}`;
  }
  return {text, parseMode: "HTML"};
}
