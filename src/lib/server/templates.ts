import type {TgEvent} from "./targeting";

export type RenderedMessage = {text: string; parseMode: "HTML"};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderMessage(event: TgEvent & {title: string; body?: string | null; url?: string | null; subjectName?: string | null}, baseUrl: string): RenderedMessage {
  const link = event.url ? `${baseUrl}${event.url}` : baseUrl;
  const section = event.section && event.section !== "all" ? `\nالشعبة: <b>${esc(event.section)}</b>` : "";
  const btn = `<a href="${esc(link)}">فتح في البوابة</a>`;
  let text = "";
  switch (event.type) {
    case "lecture": {
      // Keep the subject and lecture title separate: event.title is the lecture,
      // while subjectName is the real academic subject resolved from the database.
      const subject = event.subjectName?.trim();
      const audience = event.scope === "general"
        ? "\n🎯 الجمهور: جميع الشعب (A, B, C, F)"
        : event.section && event.section !== "all" ? `\n🎯 الجمهور: شعبة ${esc(event.section)}` : "";
      const description = event.body?.trim() ? `\n\n${esc(event.body.trim())}` : "";
      text = `📚 <b>محاضرة جديدة</b>${subject ? `\n📘 المادة: <b>${esc(subject)}</b>` : ""}\n📄 المحاضرة: <b>${esc(event.title)}</b>${audience}${description}\n\n📎 <a href="${esc(link)}">فتح المحاضرة</a>`;
      break;
    }
    case "exam": {
      const subject = event.subjectName?.trim();
      const quiz = (event.body || "").includes("النوع: كوز يومي");
      const audience = section ? "\n🎯 "+section.trim() : "\n🎯 الشعب: جميع الشعب";
      text = `${quiz ? "📝 <b>كوز جديد</b>" : "📢 <b>موعد امتحان</b>"}${subject ? "\n📘 المادة: <b>"+esc(subject)+"</b>" : ""}${audience}\n📌 العنوان: <b>${esc(event.title)}</b>\n\n${esc(event.body || "تفاصيل الامتحان في البوابة.")}\n\n${btn}`;
      break;
    }
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
