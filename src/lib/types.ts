export type Section = "A" | "B" | "C" | "F";
export type Priority = "normal" | "important" | "urgent";
export type AnnouncementScope = "general" | "section" | "teacher";
export type ExamStatus = "confirmed" | "provisional" | "cancelled";
export type AssignmentStatus = "active" | "closed" | "cancelled";
export type LectureStatus = "published" | "draft";

export interface Subject {
  id: string;
  name: string;
  englishName: string;
  teacher: string;
  description: string;
  color: string;
}
export interface Lecture {
  id: string;
  subjectId: string;
  number: number;
  title: string;
  description: string;
  fileUrl: string;
  fileName: string;
  status: LectureStatus;
  updatedAt: string;
}
export interface ScheduleSlot {
  id: string;
  section: Section;
  day: number; // 0 Sunday through 6 Saturday
  start: string; // HH:mm
  end: string;
  subjectId: string;
  teacher: string;
  room: string;
  kind: "theory" | "practical";
  status: "normal" | "moved" | "cancelled" | "extra";
  note: string;
  periods?: string[]; // الفترات الدراسية الأصلية (45 دقيقة) من المصدر الرقمي
}
export interface Exam {
  id: string;
  subjectId: string;
  title: string;
  type: string;
  date: string; // YYYY-MM-DD
  startTime: string;
  room: string;
  sections: Section[];
  topics: string;
  notes: string;
  status: ExamStatus;
}
export interface PastQuestion {
  id: string;
  subjectId: string;
  examKind: "quiz" | "midterm" | "final";
  title: string;
  academicYear: string;
  fileUrl: string;
  fileName: string;
  sections: Section[];
  createdAt: string;
}
export interface Announcement {
  id: string;
  title: string;
  body: string;
  scope: AnnouncementScope;
  section: Section | "all";
  subjectId: string;
  author: string;
  priority: Priority;
  publishedAt: string;
  pinned: boolean;
}
export interface Assignment {
  id: string;
  subjectId: string;
  title: string;
  instructions: string;
  assignedAt: string;
  dueAt: string;
  sections: Section[];
  submission: string;
  status: AssignmentStatus;
  attachmentUrl: string;
}
export interface PortalData {
  subjects: Subject[];
  lectures: Lecture[];
  summaries?: Lecture[];
  schedule: ScheduleSlot[];
  exams: Exam[];
  questions: PastQuestion[];
  announcements: Announcement[];
  assignments: Assignment[];
  telegram: { general: string; sections: Record<Section, string>; subjects: Record<string, string> };
}
