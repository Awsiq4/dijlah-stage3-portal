// Pure, unit-testable filters for the PUBLIC read-only data layer.
// Rules mirror exactly what the student-facing pages already do client-side,
// so server-pre-filtered data stays consistent with client-side filtering.
// No imports — safe under node --experimental-strip-types.

export type Section = "A" | "B" | "C" | "F";
export const PUBLIC_SECTIONS: readonly Section[] = ["A", "B", "C", "F"];

export function validSection(s: unknown): Section {
  return (PUBLIC_SECTIONS as readonly string[]).includes(String(s)) ? (s as Section) : "A";
}

// lectures: only published, never drafts
export function publishedLectures<T extends {status?: unknown}>(rows: T[]): T[] {
  return rows.filter(r => r.status === "published");
}

// announcements: general for everyone; section/teacher only for matching (or "all") section
export function announcementsForSection<T extends {scope?: unknown; section?: unknown}>(rows: T[], section: Section): T[] {
  return rows.filter(a => a.scope === "general" || a.section === "all" || a.section === section);
}

// exams/assignments: visible only when the sections array includes the section (client rule: e.sections.includes(section))
export function sectionedForSection<T extends {sections?: unknown}>(rows: T[], section: Section): T[] {
  return rows.filter(r => Array.isArray(r.sections) && r.sections.includes(section));
}

// schedule: only the selected section's slots
export function scheduleForSection<T extends {section?: unknown}>(rows: T[], section: Section): T[] {
  return rows.filter(s => s.section === section);
}
