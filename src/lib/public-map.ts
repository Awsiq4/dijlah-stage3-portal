import {safeFileUrl} from "./safe-url.ts";
// Pure mappers: DB rows (snake_case) -> client PortalData types (camelCase).
// Type-only import is erased at runtime, so this file is unit-testable under node.
import type {Announcement, Assignment, Exam, Lecture, PortalData, ScheduleSlot, Section, Subject} from "./types";

const s = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const asArray = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.trim()) { try { const p = JSON.parse(v); return Array.isArray(p) ? p.map(String) : []; } catch { return []; } }
  return [];
};
const asBool = (v: unknown): boolean => v === true || v === "true" || v === 1;

export const mapSubject = (r: Record<string, unknown>): Subject => ({
  id: s(r.id), name: s(r.name), englishName: s(r.english_name), teacher: s(r.teacher), description: s(r.description), color: s(r.color) || "#3586d9",
});
export const mapLecture = (r: Record<string, unknown>): Lecture => ({
  id: s(r.id), subjectId: s(r.subject_id), number: Number(r.number) || 1, title: s(r.title), description: s(r.description),
  fileUrl: safeFileUrl(s(r.file_url)), fileName: s(r.file_name), status: (s(r.status) === "published" ? "published" : "draft") as Lecture["status"], updatedAt: s(r.updated_at),
});
export const mapAnnouncement = (r: Record<string, unknown>): Announcement => ({
  id: s(r.id), title: s(r.title), body: s(r.body), scope: (s(r.scope) || "general") as Announcement["scope"],
  section: (s(r.section) || "all") as Announcement["section"], subjectId: s(r.subject_id), author: s(r.author),
  priority: (s(r.priority) || "normal") as Announcement["priority"], publishedAt: s(r.published_at), pinned: asBool(r.pinned),
});
export const mapExam = (r: Record<string, unknown>): Exam => ({
  id: s(r.id), subjectId: s(r.subject_id), title: s(r.title), type: s(r.type), date: s(r.date), startTime: s(r.start_time),
  room: s(r.room), sections: asArray(r.sections) as Section[], topics: s(r.topics), notes: s(r.notes),
  status: (s(r.status) || "provisional") as Exam["status"],
});
export const mapAssignment = (r: Record<string, unknown>): Assignment => ({
  id: s(r.id), subjectId: s(r.subject_id), title: s(r.title), instructions: s(r.instructions), assignedAt: s(r.assigned_at),
  dueAt: s(r.due_at), sections: asArray(r.sections) as Section[], submission: s(r.submission),
  status: (s(r.status) || "active") as Assignment["status"], attachmentUrl: safeFileUrl(s(r.attachment_url)),
});
export const mapScheduleSlot = (r: Record<string, unknown>): ScheduleSlot => ({
  id: s(r.id), section: s(r.section) as Section, day: Number(r.day) || 0, start: s(r.start), end: s(r.end),
  subjectId: s(r.subject_id), teacher: s(r.teacher), room: s(r.room),
  kind: (s(r.kind) === "practical" ? "practical" : "theory") as ScheduleSlot["kind"],
  status: (s(r.status) || "normal") as ScheduleSlot["status"], note: s(r.note),
  periods: asArray(r.periods),
});
export function mapTelegram(rows: Record<string, unknown>[]): PortalData["telegram"] {
  const out: PortalData["telegram"] = {general: "", sections: {A: "", B: "", C: "", F: ""}, subjects: {}};
  for (const r of rows) {
    const kind = s(r.kind), key = s(r.key), url = s(r.url);
    if (!url) continue;
    if (kind === "general") out.general = url;
    else if (kind === "section" && ["A", "B", "C", "F"].includes(key)) out.sections[key as Section] = url;
    else if (kind === "subject") out.subjects[key] = url;
  }
  return out;
}

export type PublicContentPayload = {
  subjects?: Record<string, unknown>[];
  lectures?: Record<string, unknown>[];
  summaries?: Record<string, unknown>[];
  announcements?: Record<string, unknown>[];
  exams?: Record<string, unknown>[];
  assignments?: Record<string, unknown>[];
  schedule?: Record<string, unknown>[];
  telegram?: Record<string, unknown>[];
};

// Maps a /api/public/content response into PortalData-shaped arrays.
// Only applied by the client when the server reports fromDatabase: true.
export function mapPublicContent(c: PublicContentPayload): Partial<PortalData> {
  const out: Partial<PortalData> = {};
  if (c.subjects) out.subjects = c.subjects.map(mapSubject);
  if (c.lectures) out.lectures = c.lectures.map(mapLecture);
  if (c.summaries) out.summaries = c.summaries.map(mapLecture);
  if (c.announcements) out.announcements = c.announcements.map(mapAnnouncement);
  if (c.exams) out.exams = c.exams.map(mapExam);
  if (c.assignments) out.assignments = c.assignments.map(mapAssignment);
  if (c.schedule) out.schedule = c.schedule.map(mapScheduleSlot);
  if (c.telegram) out.telegram = mapTelegram(c.telegram);
  return out;
}
