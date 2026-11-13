import {defaultQueryer, type Queryer} from "./db.ts";
import {dbConfigured} from "./flags.ts";
import {contentFromSeed, type ContentType} from "./content.ts";
import {validSection, lecturesForSection, announcementsForSection, sectionedForSection, scheduleForSection, type Section} from "./public-filters.ts";

export type PublicType = ContentType | "all" | "questions";
export const PUBLIC_TYPES: PublicType[] = ["all", "subjects", "lectures", "announcements", "exams", "assignments", "schedule", "telegram", "questions"];

export type PublicContent = {
  subjects: Record<string, unknown>[];
  lectures: Record<string, unknown>[];
  summaries: Record<string, unknown>[];
  announcements: Record<string, unknown>[];
  exams: Record<string, unknown>[];
  assignments: Record<string, unknown>[];
  schedule: Record<string, unknown>[];
  telegram: Record<string, unknown>[];
  questions: Record<string, unknown>[];
};

const SELECTS: Record<Exclude<PublicType, "all">, string> = {
  subjects: "SELECT id,name,english_name,teacher,description,color FROM portal_subjects ORDER BY name",
  lectures: `SELECT id,subject_id,number,title,description,file_url,file_name,material_kind,sections,status,archived_at,updated_at FROM portal_lectures WHERE status=$1 AND archived_at IS NULL ORDER BY subject_id,number`,
  // Resolve the owner's *public* display name without exposing the admin login email.
  // Older Telegram announcements may have an email stored in `author`, and some
  // legacy rows have no created_by. Match either linked owner id or owner email.
  // The database author field and other publishers' names are not overwritten.
  announcements: `SELECT a.id,a.title,a.body,a.scope,a.section,a.subject_id,
    CASE WHEN creator.role='super_admin' OR owner_email.id IS NOT NULL
      THEN 'Aws Faris' ELSE a.author END AS author,
    a.priority,a.published_at,a.pinned,a.archived_at
    FROM portal_announcements a
    LEFT JOIN portal_admins creator ON creator.id=a.created_by
    LEFT JOIN portal_admins owner_email ON owner_email.email=a.author AND owner_email.role='super_admin'
    WHERE a.archived_at IS NULL AND (a.scope='general' OR a.section='all' OR a.section=$1)
    ORDER BY a.pinned DESC, a.published_at DESC`,
  exams: `SELECT id,subject_id,title,type,date,start_time,room,sections,topics,notes,status FROM portal_exams WHERE archived_at IS NULL AND sections @> $1::jsonb ORDER BY date`,
  assignments: `SELECT id,subject_id,title,instructions,assigned_at,due_at,sections,submission,status,attachment_url FROM portal_assignments WHERE archived_at IS NULL AND sections @> $1::jsonb ORDER BY due_at`,
  schedule: `SELECT id,section,day,start,"end",subject_id,teacher,room,kind,status,note,periods FROM portal_schedule WHERE section=$1 ORDER BY day,start`,
  telegram: "SELECT kind,key,url FROM portal_telegram ORDER BY kind,key",
  questions: `SELECT id,subject_id,exam_kind,title,academic_year,file_url,file_name,sections,created_at
    FROM portal_past_questions WHERE archived_at IS NULL AND sections @> $1::jsonb ORDER BY created_at DESC LIMIT 300`,
};

// Read-only public content. When DATABASE_URL is configured this reads ONLY
// approved published rows from PostgreSQL (drafts and admin data never queried);
// otherwise it falls back to the static seed with the same filters applied.
// Fetch independent public collections concurrently, not in eight sequential
// serverless database requests. Never replace authoritative content with seed.
export async function getPublicContent(type: PublicType, section: Section, db: Queryer = defaultQueryer): Promise<{fromDatabase: boolean; content: Partial<PublicContent>}> {
  const sec = validSection(section);
  const want = (type === "all" ? Object.keys(SELECTS) : [type]) as Exclude<PublicType, "all">[];
  if (!dbConfigured()) {
    const content: Partial<PublicContent> = {};
    for (const t of want) {
      if (t === "questions") { content.questions = []; continue; }
      const rows = contentFromSeed(t);
      if (t === "lectures") content.lectures = lecturesForSection(rows, sec);
      else if (t === "announcements") content.announcements = announcementsForSection(rows, sec);
      else if (t === "exams" || t === "assignments") content[t] = sectionedForSection(rows, sec);
      else if (t === "schedule") content.schedule = scheduleForSection(rows, sec);
      else content[t] = rows;
    }
    return {fromDatabase: false, content};
  }
  const entries = await Promise.all(want.map(async t => {
    const sql = SELECTS[t];
    if (t === "subjects" || t === "telegram") return [t, await db.q<Record<string, unknown>>(sql)] as const;
    if (t === "lectures") return [t, lecturesForSection(await db.q<Record<string, unknown>>(sql, ["published"]), sec)] as const;
    if (t === "announcements") return [t, await db.q<Record<string, unknown>>(sql, [sec])] as const;
    if (t === "exams" || t === "assignments" || t === "questions") {
      try { return [t, await db.q<Record<string, unknown>>(sql, [JSON.stringify([sec])])] as const; }
      catch (error) {
        if (t === "questions" && ((error as {code?: string}).code === "42P01" ||
          /relation ["']?portal_past_questions["']? does not exist/i.test(String(error)))) {
          return [t, [] as Record<string, unknown>[]] as const;
        }
        throw error;
      }
    }
    return [t, await db.q<Record<string, unknown>>(sql, [sec])] as const;
  }));
  const content: Partial<PublicContent> = {};
  for (const [t, rows] of entries) {
    if (t === "lectures") {
      content.lectures = rows.filter(row => row.material_kind !== "summary");
      content.summaries = rows.filter(row => row.material_kind === "summary");
    } else if (t === "subjects") content.subjects = rows;
    else if (t === "telegram") content.telegram = rows;
    else if (t === "announcements") content.announcements = rows;
    else if (t === "exams") content.exams = rows;
    else if (t === "assignments") content.assignments = rows;
    else if (t === "questions") content.questions = rows;
    else content.schedule = rows;
  }
  return {fromDatabase: true, content};
}
