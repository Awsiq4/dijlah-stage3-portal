// One definition of valid exam scheduling data for web and Telegram publishers.
// All date/time inputs are interpreted as local Asia/Baghdad (+03:00) time.
const ALL_SECTIONS = ["A","B","C","F"];

export function validExamDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year,month,day] = value.split("-").map(Number);
  const d = new Date(Date.UTC(year,month-1,day));
  return d.getUTCFullYear()===year && d.getUTCMonth()===month-1 && d.getUTCDate()===day;
}

export function validExamTime(value: string): boolean {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return false;
  return true;
}

export function validExamSchedule(input: Record<string,unknown>, requireFuture = true): string | null {
  const subject = String(input.subject_id || input.subjectId || "");
  const title = String(input.title || "").trim();
  const type = String(input.type || "").trim();
  const date = String(input.date || "");
  const start = String(input.start_time || "");
  const sections = input.sections;
  const status = String(input.status || "provisional");
  if (!subject || subject.length > 120 || !title || title.length > 180 ||
      !type || type.length > 80) return "المادة أو عنوان الامتحان أو نوعه غير صالح";
  const isQuiz = type === "كوز يومي";
  if (!validExamDay(date) || (!isQuiz && !validExamTime(start)) ||
      (isQuiz && start !== "" && !validExamTime(start))) return "تاريخ الامتحان أو وقته غير صالح";
  const at = Date.parse(date+(isQuiz ? "T23:59:59+03:00" : "T"+start+":00+03:00"));
  if (!Number.isFinite(at) || (requireFuture && at < Date.now()-60_000))
    return "موعد الامتحان مضى أو غير صالح";
  if (!Array.isArray(sections) || !sections.length ||
      new Set(sections).size !== sections.length || !sections.every(s => ALL_SECTIONS.includes(String(s))))
    return "الشعب المحددة للامتحان غير صالحة";
  if (!["confirmed","provisional","cancelled"].includes(status)) return "حالة الامتحان غير صالحة";
  if (String(input.room || "").length > 120 || String(input.topics || "").length > 3000 ||
      String(input.notes || "").length > 3000) return "تفاصيل الامتحان أطول من المسموح";
  return null;
}

export function readableExamKind(type: string): string { return type; }
