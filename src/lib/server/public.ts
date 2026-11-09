import {defaultQueryer, type Queryer} from "./db.ts";
import {dbConfigured} from "./flags.ts";
import {contentFromSeed, type ContentType} from "./content.ts";
import {validSection, lecturesForSection, announcementsForSection, sectionedForSection, scheduleForSection, type Section} from "./public-filters.ts";

export type PublicType = ContentType | "all";
export const PUBLIC_TYPES: PublicType[] = ["all", "subjects", "lectures", "announcements", "exams", "assignments", "schedule", "telegram"];

export type PublicContent = {
  subjects: Record<string, unknown>[];
  lectures: Record<string, unknown>[];
  summaries: Record<string, unknown>[];
  announcements: Record<string, unknown>[];
  exams: Record<string, unknown>[];
  assignments: Record<string, unknown>[];
  schedule: Record<string, unknown>[];
  telegram: Record<string, unknown>[];
};

const SELECTS: Record<Exclude<PublicType, "all">, string> = {
  subjects: "SELECT id,name,english_name,teacher,description,color FROM portal_subjects ORDER BY name",
  lectures: `SELECT id,subject_id,number,title,description,file_url,file_name,material_kind,sections,status,archived_at,updated_at FROM portal_lectures WHERE status=$1 AND archived_at IS NULL ORDER BY subject_id,number`,
  announcements: `SELECT id,title,body,scope,section,subject_id,author,priority,published_at,pinned,archived_at FROM portal_announcements WHERE archived_at IS NULL AND (scope='general' OR section='all' OR section=$1) ORDER BY pinned DESC, published_at DESC`,
  exams: `SELECT id,subject_id,title,type,date,start_time,room,sections,topics,notes,status FROM portal_exams WHERE archived_at IS NULL AND sections @> $1::jsonb ORDER BY date`,
  assignments: `SELECT id,subject_id,title,instructions,assigned_at,due_at,sections,submission,status,attachment_url FROM portal_assignments WHERE archived_at IS NULL AND sections @> $1::jsonb ORDER BY due_at`,
  schedule: `SELECT id,section,day,start,"end",subject_id,teacher,room,kind,status,note,periods FROM portal_schedule WHERE section=$1 ORDER BY day,start`,
  telegram: "SELECT kind,key,url FROM portal_telegram ORDER BY kind,key",
};

// Read-only public content. When DATABASE_URL is configured this reads ONLY
// approved published rows from PostgreSQL (drafts and admin data never queried);
// otherwise it falls back to the static seed with the same filters applied.
export async function getPublicContent(type: PublicType, section: Section, db: Queryer = defaultQueryer): Promise<{fromDatabase: boolean; content: Partial<PublicContent>}> {
  const sec = validSection(section);
  if (!dbConfigured()) {
    const seed = (t: Exclude<PublicType, "all">) => contentFromSeed(t);
    const content: Partial<PublicContent> = {};
    const want = type === "all" ? Object.keys(SELECTS) as Exclude<PublicType, "all">[] : [type];
    for (const t of want) {
      const rows = seed(t);
      if (t === "lectures") content.lectures = lecturesForSection(rows, sec);
      else if (t === "announcements") content.announcements = announcementsForSection(rows, sec);
      else if (t === "exams" || t === "assignments") content[t] = sectionedForSection(rows, sec);
      else if (t === "schedule") content.schedule = scheduleForSection(rows, sec);
      else content[t] = rows;
    }
    return {fromDatabase: false, content};
  }
  const content: Partial<PublicContent> = {};
  const want = type === "all" ? Object.keys(SELECTS) as Exclude<PublicType, "all">[] : [type];
  for (const t of want) {
    const sql = SELECTS[t];
    if (t === "subjects" || t === "telegram") content[t] = await db.q(sql);
    else if (t === "lectures") {
      const materials = lecturesForSection(await db.q<Record<string, unknown>>(sql, ["published"]), sec);
      content.lectures = materials.filter(row => row.material_kind !== "summary");
      if (type === "all") content.summaries = materials.filter(row => row.material_kind === "summary");
    }
    else if (t === "announcements") content.announcements = await db.q(sql, [sec]);
    else if (t === "exams" || t === "assignments") content[t] = await db.q(sql, [JSON.stringify([sec])]);
    else content.schedule = await db.q(sql, [sec]);
  }
  return {fromDatabase: true, content};
}
