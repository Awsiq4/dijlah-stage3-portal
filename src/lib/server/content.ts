import {q, qOne} from "./db";
import {dbConfigured} from "./flags";
import {SEED} from "@/lib/seed";

export type ContentType = "subjects" | "lectures" | "announcements" | "exams" | "assignments" | "schedule" | "telegram";

const TABLES: Record<Exclude<ContentType, "telegram">, string> = {
  subjects: "portal_subjects",
  lectures: "portal_lectures",
  announcements: "portal_announcements",
  exams: "portal_exams",
  assignments: "portal_assignments",
  schedule: "portal_schedule",
};

export function contentFromSeed(type: ContentType) {
  if (type === "telegram") {
    return [
      {kind: "general", key: "general", url: SEED.telegram.general},
      ...Object.entries(SEED.telegram.sections).map(([k, url]) => ({kind: "section", key: k, url})),
      ...Object.entries(SEED.telegram.subjects).map(([k, url]) => ({kind: "subject", key: k, url})),
    ];
  }
  return [...(SEED[type] as unknown as Record<string, unknown>[])];
}

export async function listContent(type: ContentType): Promise<Record<string, unknown>[]> {
  if (type === "telegram") {
    if (!dbConfigured()) return contentFromSeed("telegram");
    return q(`SELECT kind, key, url FROM portal_telegram ORDER BY kind, key`);
  }
  if (!dbConfigured()) return contentFromSeed(type);
  return q(`SELECT * FROM ${TABLES[type]} ORDER BY 1`);
}

export async function createContent(type: Exclude<ContentType, "telegram">, row: Record<string, unknown>): Promise<void> {
  const table = TABLES[type];
  const cols = Object.keys(row);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
  await q(
    `INSERT INTO ${table} (${cols.join(",")}) VALUES (${placeholders})
     ON CONFLICT (id) DO UPDATE SET ${cols.filter(c => c !== "id").map(c => `${c}=EXCLUDED.${c}`).join(",")}`,
    cols.map(c => (row[c] !== undefined && typeof row[c] === "object" ? JSON.stringify(row[c]) : row[c]))
  );
}

export async function deleteContent(type: Exclude<ContentType, "telegram">, id: string): Promise<void> {
  await q(`DELETE FROM ${TABLES[type]} WHERE id=$1`, [id]);
}

export async function upsertTelegram(kind: "general" | "section" | "subject", key: string, url: string): Promise<void> {
  await q(
    `INSERT INTO portal_telegram (kind, key, url) VALUES ($1,$2,$3) ON CONFLICT (kind,key) DO UPDATE SET url=EXCLUDED.url`,
    [kind, key, url]
  );
}

export async function audit(actor: string, action: string, detail: unknown): Promise<void> {
  try {
    await q(`INSERT INTO portal_audit (actor, action, detail) VALUES ($1,$2,$3)`, [actor, action, JSON.stringify(detail ?? null)]);
  } catch { /* audit must never break the operation */ }
}
