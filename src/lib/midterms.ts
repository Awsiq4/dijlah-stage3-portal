import {baghdadToday} from "./assignment-date.ts";
import type {Exam, Section} from "./types";

export const MIDTERM_SCHEDULE_ID = "midterm-2026-2027-semester-1";
export const MIDTERM_TITLE = "جدول امتحانات المد – الفصل الأول";
export const MIDTERM_ACADEMIC_YEAR = "السنة الدراسية ٢٠٢٦–٢٠٢٧";
export const MIDTERM_PATH = "/exams?tab=midterms";

const baghdad = "Asia/Baghdad";
const examDay = new Intl.DateTimeFormat("ar-IQ", {timeZone: baghdad, weekday: "long"});
const examDate = new Intl.DateTimeFormat("ar-IQ", {timeZone: baghdad, day: "numeric", month: "long"});
const examTime = new Intl.DateTimeFormat("ar-IQ", {
  timeZone: baghdad, hour: "numeric", minute: "2-digit", hour12: true, dayPeriod: "long",
});

export function isFirstSemesterMidterm(exam: Exam): boolean {
  return exam.type === "Midterm" && exam.scheduleId === MIDTERM_SCHEDULE_ID;
}

export function getFirstSemesterMidterms(exams: readonly Exam[], section: Section): Exam[] {
  return exams.filter(exam => isFirstSemesterMidterm(exam) && exam.sections.includes(section))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}

export function getClosestMidterm(schedule: readonly Exam[], today = baghdadToday()): Exam | undefined {
  return schedule.find(exam => exam.date >= today && exam.status !== "cancelled");
}

export function formatMidtermDate(date: string): string {
  const localNoon = new Date(`${date}T12:00:00+03:00`);
  return `${examDay.format(localNoon)} ${examDate.format(localNoon)}`;
}

export function formatMidtermTime(time: string): string {
  return time ? examTime.format(new Date(`2026-01-01T${time}:00+03:00`)) : "غير محدد";
}

export function midtermSubjectLabel(exam: Exam, subjectName?: string): string {
  if (exam.subjectId === "numerical-analysis" && subjectName === "التحليلات الهندسية والعددية") {
    return "التحليلات العددية";
  }
  return subjectName || exam.title || "مادة غير محددة";
}
