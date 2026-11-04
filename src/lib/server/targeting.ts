export type TgEvent = {
  type: "lecture" | "exam" | "announcement" | "schedule" | "assignment" | "test";
  scope: "general" | "section" | "teacher";
  section?: string | null;
  subject_id?: string | null;
  priority?: string;
};

export type TgSubscriber = {
  id: number;
  chat_id: number;
  section: string;
  status: string;
  prefs: Record<string, boolean>;
};

const PREF_KEY: Record<TgEvent["type"], string> = {
  lecture: "lectures",
  exam: "exams",
  announcement: "announcements",
  schedule: "schedule",
  assignment: "assignments",
  test: "test",
};

export function selectRecipients(event: TgEvent, subscribers: TgSubscriber[]): TgSubscriber[] {
  const prefKey = PREF_KEY[event.type] || "announcements";
  const seen = new Set<number>();
  const out: TgSubscriber[] = [];
  for (const s of subscribers) {
    if (s.status !== "active") continue;
    if (seen.has(s.id)) continue;
    if (s.prefs && s.prefs[prefKey] === false) continue;
    if (event.scope === "section" || event.scope === "teacher") {
      if (event.section && event.section !== "all" && s.section !== event.section) continue;
    }
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

export function eventKey(type: string, refId: string, version: number | string): string {
  return `${type}:${refId}:v${version}`;
}
