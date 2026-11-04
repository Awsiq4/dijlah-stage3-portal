import type { ScheduleSlot } from "./types";

// جدول المحاضرات الأسبوعي — منقول ميكانيكيًا من مستند PDF «جدول المحاضرات الأسبوعي 17-10-2026»
// (references/schedule-2026-10-17-extracted.txt) بعد تحليل مواضع الأعمدة بالبايتات.
// كل محاضرة تمتد على فترتين (مادة + تدريسي/قاعة). النتيجة: 36 محاضرة = 9 لكل شعبة (A/B/C/F)،
// والتدريسيون مطابقون للمواد في seed.ts. يوم الاستراحة: الاثنين. لا خميس/جمعة.
// حالة المراجعة: بانتظار تأكيد المستخدم مقابل صورة الجدول الأصلية قبل الاعتماد النهائي.
// ملاحظات مفتوحة:
// - ورد بتصحيح لاحق أن يوم الأحد فيه ثلاث محاضرات؛ هذا المستند يُظهر محاضرتين لكل شعبة — لا يُخترع الثالثة.
// - الرمز (T) ورد في الجدول الأصلي بجانب «التحليلات الهندسية والعددية» — معناه غير موثق (الرجحان: Tutorial).
// - «[قاعة]» في الأصل = قاعة غير محددة.
// - أربع محاضرات عُلّمت للمراجعة (بدايتها استُنتجت من أنماط الاستخراج): انظر حقل note.
export const SCHEDULE_2026_10_17: ScheduleSlot[] = [
  // السبت
  { id: "sched-sat-F-0900", section: "F", day: 6, start: "09:00", end: "10:35", subjectId: "digital-systems", teacher: "أ.م.د. علي يوسف", room: "A508", kind: "theory", status: "normal", note: "" },
  { id: "sched-sat-C-0900", section: "C", day: 6, start: "09:00", end: "10:35", subjectId: "optoelectronics", teacher: "م.م. رامي سالار", room: "B514", kind: "theory", status: "normal", note: "" },
  { id: "sched-sat-B-0900", section: "B", day: 6, start: "09:00", end: "10:35", subjectId: "numerical-analysis", teacher: "م.م. أثير عدنان", room: "", kind: "theory", status: "normal", note: "وردت [قاعة] بالأصل — القاعة غير محددة" },
  { id: "sched-sat-A-0900", section: "A", day: 6, start: "09:00", end: "10:35", subjectId: "digital-systems", teacher: "أ.م.د. علي يوسف", room: "A508", kind: "theory", status: "normal", note: "" },
  { id: "sched-sat-F-1040", section: "F", day: 6, start: "10:40", end: "12:15", subjectId: "numerical-analysis", teacher: "م.م. أثير عدنان", room: "A508", kind: "theory", status: "normal", note: "" },
  { id: "sched-sat-B-1040", section: "B", day: 6, start: "10:40", end: "12:15", subjectId: "digital-systems", teacher: "م.م. حيدر سامي", room: "B412", kind: "practical", status: "normal", note: "" },
  { id: "sched-sat-A-1040", section: "A", day: 6, start: "10:40", end: "12:15", subjectId: "numerical-analysis", teacher: "م.م. أثير عدنان", room: "A508", kind: "theory", status: "normal", note: "" },
  { id: "sched-sat-C-1130", section: "C", day: 6, start: "11:30", end: "13:05", subjectId: "industrial-lasers", teacher: "م.م. أحمد حميد", room: "B514", kind: "theory", status: "normal", note: "" },
  { id: "sched-sat-F-1220", section: "F", day: 6, start: "12:20", end: "13:55", subjectId: "numerical-analysis", teacher: "م.م. أثير عدنان", room: "", kind: "theory", status: "normal", note: "(T) — القاعة غير محددة بالأصل" },
  { id: "sched-sat-A-1220", section: "A", day: 6, start: "12:20", end: "13:55", subjectId: "numerical-analysis", teacher: "م.م. أثير عدنان", room: "", kind: "theory", status: "normal", note: "(T) — القاعة غير محددة بالأصل" },
  { id: "sched-sat-C-1310", section: "C", day: 6, start: "13:10", end: "14:45", subjectId: "numerical-analysis", teacher: "م.م. أثير عدنان", room: "B514", kind: "theory", status: "normal", note: "(T)" },
  { id: "sched-sat-F-1450", section: "F", day: 6, start: "14:50", end: "16:25", subjectId: "nonlinear-optics", teacher: "م.م. سجود باسم", room: "A508", kind: "theory", status: "normal", note: "" },
  // الأحد
  { id: "sched-sun-C-0900", section: "C", day: 0, start: "09:00", end: "10:35", subjectId: "digital-systems", teacher: "م.م. حيدر سامي", room: "B412", kind: "practical", status: "normal", note: "" },
  { id: "sched-sun-B-0900", section: "B", day: 0, start: "09:00", end: "10:35", subjectId: "digital-systems", teacher: "أ.م.د. علي يوسف", room: "A508", kind: "theory", status: "normal", note: "" },
  { id: "sched-sun-C-1040", section: "C", day: 0, start: "10:40", end: "12:15", subjectId: "digital-systems", teacher: "أ.م.د. علي يوسف", room: "A508", kind: "theory", status: "normal", note: "" },
  { id: "sched-sun-B-1130", section: "B", day: 0, start: "11:30", end: "13:05", subjectId: "nonlinear-optics", teacher: "م.م. سجود باسم", room: "B514", kind: "theory", status: "normal", note: "" },
  { id: "sched-sun-A-1130", section: "A", day: 0, start: "11:30", end: "13:05", subjectId: "digital-systems", teacher: "م.م. حيدر سامي", room: "B412", kind: "practical", status: "normal", note: "" },
  { id: "sched-sun-A-1310", section: "A", day: 0, start: "13:10", end: "14:45", subjectId: "laser-safety", teacher: "م.م. دعاء محمود", room: "B514", kind: "theory", status: "normal", note: "" },
  { id: "sched-sun-F-1400", section: "F", day: 0, start: "14:00", end: "15:35", subjectId: "laser-safety", teacher: "م.م. دعاء محمود", room: "A508", kind: "theory", status: "normal", note: "" },
  { id: "sched-sun-F-1540", section: "F", day: 0, start: "15:40", end: "17:15", subjectId: "industrial-lasers", teacher: "م.م. أحمد حميد", room: "A508", kind: "theory", status: "normal", note: "" },
  // الثلاثاء
  { id: "sched-tue-B-0900", section: "B", day: 2, start: "09:00", end: "10:35", subjectId: "numerical-analysis", teacher: "م.م. أثير عدنان", room: "B514", kind: "theory", status: "normal", note: "(T)" },
  { id: "sched-tue-C-0900", section: "C", day: 2, start: "09:00", end: "10:35", subjectId: "nonlinear-optics", teacher: "م.م. سجود باسم", room: "B606", kind: "theory", status: "normal", note: "" },
  { id: "sched-tue-A-0900", section: "A", day: 2, start: "09:00", end: "10:35", subjectId: "optoelectronics", teacher: "م.م. رامي سالار", room: "B610", kind: "theory", status: "normal", note: "" },
  { id: "sched-tue-C-1130", section: "C", day: 2, start: "11:30", end: "13:05", subjectId: "numerical-analysis", teacher: "م.م. أثير عدنان", room: "", kind: "theory", status: "normal", note: "وردت [قاعة] بالأصل — القاعة غير محددة" },
  { id: "sched-tue-B-1220", section: "B", day: 2, start: "12:20", end: "13:55", subjectId: "quantum-mechanics", teacher: "د. زهراء عبد الأمير", room: "B514", kind: "theory", status: "normal", note: "للمراجعة: وقت البدء مستنتج من أنماط الاستخراج (احتمال بديل 11:30)" },
  { id: "sched-tue-A-1220", section: "A", day: 2, start: "12:20", end: "13:55", subjectId: "nonlinear-optics", teacher: "م.م. سجود باسم", room: "B606", kind: "theory", status: "normal", note: "للمراجعة: وقت البدء مستنتج من أنماط الاستخراج (احتمال بديل 11:30)" },
  { id: "sched-tue-F-1450", section: "F", day: 2, start: "14:50", end: "16:25", subjectId: "quantum-mechanics", teacher: "د. زهراء عبد الأمير", room: "A508", kind: "theory", status: "normal", note: "" },
  // الأربعاء
  { id: "sched-wed-B-0900", section: "B", day: 3, start: "09:00", end: "10:35", subjectId: "optoelectronics", teacher: "م.م. رامي سالار", room: "B514", kind: "theory", status: "normal", note: "" },
  { id: "sched-wed-C-0950", section: "C", day: 3, start: "09:50", end: "11:25", subjectId: "quantum-mechanics", teacher: "د. زهراء عبد الأمير", room: "A508", kind: "theory", status: "normal", note: "للمراجعة: وقت البدء مستنتج من أنماط الاستخراج (احتمال بديل 09:00)" },
  { id: "sched-wed-A-0950", section: "A", day: 3, start: "09:50", end: "11:25", subjectId: "industrial-lasers", teacher: "م.م. أحمد حميد", room: "B606", kind: "theory", status: "normal", note: "للمراجعة: وقت البدء مستنتج من أنماط الاستخراج (احتمال بديل 09:00)" },
  { id: "sched-wed-B-1040", section: "B", day: 3, start: "10:40", end: "12:15", subjectId: "laser-safety", teacher: "م.م. دعاء محمود", room: "B514", kind: "theory", status: "normal", note: "" },
  { id: "sched-wed-C-1130", section: "C", day: 3, start: "11:30", end: "13:05", subjectId: "laser-safety", teacher: "م.م. دعاء محمود", room: "A508", kind: "theory", status: "normal", note: "" },
  { id: "sched-wed-B-1220", section: "B", day: 3, start: "12:20", end: "13:55", subjectId: "industrial-lasers", teacher: "م.م. أحمد حميد", room: "B514", kind: "theory", status: "normal", note: "" },
  { id: "sched-wed-A-1220", section: "A", day: 3, start: "12:20", end: "13:55", subjectId: "quantum-mechanics", teacher: "د. زهراء عبد الأمير", room: "B606", kind: "theory", status: "normal", note: "" },
  { id: "sched-wed-F-1400", section: "F", day: 3, start: "14:00", end: "15:35", subjectId: "digital-systems", teacher: "م.م. حيدر سامي", room: "B412", kind: "practical", status: "normal", note: "" },
  { id: "sched-wed-F-1540", section: "F", day: 3, start: "15:40", end: "17:15", subjectId: "optoelectronics", teacher: "م.م. رامي سالار", room: "A508", kind: "theory", status: "normal", note: "" },
];
