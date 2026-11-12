import {assignmentDisplayDay, baghdadToday} from "./assignment-date.ts";
import type {PortalData, Section} from "./types.ts";

type WeekItem = {
  id: string;
  kind: "assignment" | "quiz" | "schedule";
  title: string;
  subjectId: string;
  date: string;
  time?: string;
  status: string;
  href: string;
};

const DAY_MS = 86_400_000;
const isoDay = (value: number) => new Date(value).toISOString().slice(0, 10);

export function studentWeek(data: Pick<PortalData, "assignments" | "exams" | "schedule">, section: Section, now: Date) {
  const today = baghdadToday(now);
  const localDay = Date.parse(today + "T00:00:00Z");
  const weekday = new Date(localDay).getUTCDay();
  // Match the teaching timetable, whose first column is Saturday.
  const start = localDay - ((weekday + 1) % 7) * DAY_MS;
  const dates = Array.from({length: 7}, (_, index) => isoDay(start + index * DAY_MS));
  const inWeek = (day: string) => day >= dates[0] && day <= dates[6];
  const items: WeekItem[] = [];

  for (const assignment of data.assignments) {
    const date = assignmentDisplayDay(assignment.dueAt);
    if (!assignment.sections.includes(section) || !inWeek(date)) continue;
    items.push({id: assignment.id, kind: "assignment", title: assignment.title, subjectId: assignment.subjectId,
      date, status: assignment.status, href: "/assignments#assignment-" + encodeURIComponent(assignment.id)});
  }

  for (const quiz of data.exams) {
    if (quiz.type !== "كوز يومي" || !quiz.sections.includes(section) || !inWeek(quiz.date) || quiz.date < today) continue;
    const begins = quiz.startTime ? Date.parse(quiz.date + "T" + quiz.startTime + ":00+03:00") : Number.NaN;
    if (Number.isFinite(begins) && begins < now.getTime()) continue;
    items.push({id: quiz.id, kind: "quiz", title: quiz.title, subjectId: quiz.subjectId,
      date: quiz.date, time: quiz.startTime || undefined, status: quiz.status,
      href: "/exams#exam-" + encodeURIComponent(quiz.id)});
  }

  for (const slot of data.schedule) {
    if (slot.section !== section || slot.status === "normal" || !Number.isInteger(slot.day) || slot.day < 0 || slot.day > 6) continue;
    items.push({id: slot.id, kind: "schedule", title: "تغيير في الجدول", subjectId: slot.subjectId,
      date: dates[(slot.day + 1) % 7], time: slot.start || undefined, status: slot.status,
      href: "/schedule?day=" + slot.day + "#slot-" + encodeURIComponent(slot.id)});
  }

  items.sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || "") || a.title.localeCompare(b.title, "ar"));
  return {today, dates, items};
}
