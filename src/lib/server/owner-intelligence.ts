// Privacy-aware, owner-only analytics. No message bodies, searches, phone numbers,
// GPS coordinates, device information, profile photos or raw callback data are stored.
import {defaultQueryer, type Queryer} from "./db.ts";
import {BOT_OWNER_ID} from "./flags.ts";

export const FEATURE_LABELS: Record<string, string> = {
  start: "بدء استخدام البوت",
  home: "القائمة الرئيسية",
  announcements: "التبليغات",
  lectures: "المحاضرات والملازم",
  schedule: "الجدول الدراسي",
  exams: "الامتحانات",
  assignments: "الواجبات",
  subjects: "المواد",
  settings: "إعدادات الإشعارات",
  section: "اختيار أو تغيير الشعبة",
  help: "المساعدة",
  other: "تنقل آخر",
};
export type ActivityFeature = keyof typeof FEATURE_LABELS;
export type ClassifiedActivity = {feature: ActivityFeature; action: string; subjectId?: string};
type TelegramActor = {
  id?: number; username?: string; first_name?: string; last_name?: string; language_code?: string;
};
export type BotUpdate = {
  update_id?: number;
  message?: {chat?: {id?: number; type?: string}; text?: string; from?: TelegramActor};
  callback_query?: {
    data?: string; from?: TelegramActor;
    message?: {chat?: {id?: number; type?: string}};
  };
};

export function classifyBotActivity(update: BotUpdate): ClassifiedActivity | null {
  if (update.message?.chat?.type === "private") {
    const command = (update.message.text || "").trim().split(/\s+/)[0].split("@")[0].toLowerCase();
    const commands: Record<string, ClassifiedActivity> = {
      "/start": {feature: "start", action: "start"},
      "/menu": {feature: "home", action: "menu"},
      "/section": {feature: "section", action: "open_section_picker"},
      "/settings": {feature: "settings", action: "open_preferences"},
      "/status": {feature: "settings", action: "subscription_status"},
      "/stop": {feature: "settings", action: "stop_notifications"},
      "/help": {feature: "help", action: "help"},
    };
    return commands[command] || null; // free-text queries and documents are never recorded
  }

  const cb = update.callback_query;
  if (cb?.message?.chat?.type !== "private" || !cb.data) return null;
  const data = cb.data;
  if (data.startsWith("own:") || data.startsWith("adm:") ||
      data.startsWith("draft:") || data.startsWith("pub:") || data.startsWith("flow:"))
    return null;
  if (/^sec:(A|B|C|F)$/.test(data)) return {feature: "section", action: "select_section"};
  if (/^pref:(lectures|exams|announcements|schedule|assignments)$/.test(data))
    return {feature: "settings", action: "change_preference"};
  if (data === "nav:home" || data === "stu:home")
    return {feature: "home", action: "open_home"};
  if (data === "stu:ann" || data.startsWith("stu:ann:"))
    return {feature: "announcements", action: "open_announcements"};
  if (data === "stu:lec") return {feature: "lectures", action: "open_subject_list"};
  if (data.startsWith("stu:lec:")) {
    const id = data.slice(8);
    if (/^[a-zA-Z0-9_-]{1,60}$/.test(id))
      return {feature: "lectures", action: "select_subject", subjectId: id};
    return {feature: "lectures", action: "browse_lectures"};
  }
  if (data === "stu:sched" || data.startsWith("stu:sched:"))
    return {feature: "schedule", action: "open_schedule"};
  if (data === "stu:exams" || data.startsWith("stu:exams:"))
    return {feature: "exams", action: "open_exams_assignments"};
  if (data === "stu:prefs" || data.startsWith("stu:prefs:"))
    return {feature: "settings", action: "open_preferences"};
  if (data === "stu:help") return {feature: "help", action: "help"};
  if (data.startsWith("stu:")) return {feature: "other", action: "student_navigation"};
  return null; // don't record content of unknown or administrative callbacks
}

export async function recordBotActivity(update: BotUpdate, db: Queryer = defaultQueryer): Promise<void> {
  const classified = classifyBotActivity(update);
  const id = update.update_id;
  if (!classified || typeof id !== "number" || !Number.isSafeInteger(id) || id < 0) return;
  const cb = update.callback_query;
  const message = update.message;
  const chatId = message?.chat?.id ?? cb?.message?.chat?.id;
  const from = message?.from ?? cb?.from;
  if (!chatId || chatId !== from?.id || String(chatId) === BOT_OWNER_ID) return;
  const language = typeof from.language_code === "string" && /^[a-zA-Z0-9-]{2,16}$/.test(from.language_code)
    ? from.language_code : null;
  try {
    // Only interactions from already-registered, opted-in users.
    await db.q(
      "INSERT INTO tg_student_activity (update_id, chat_id, feature, action, subject_id, language_code, section_at_event) " +
      "SELECT $1, s.chat_id, $2, $3, $4, $5, s.section FROM tg_subscribers s " +
      "WHERE s.chat_id=$6 AND s.analytics_opt_out=false ON CONFLICT (update_id) DO NOTHING",
      [id, classified.feature, classified.action, classified.subjectId || null, language, chatId]
    );
    // Opportunistic 90-day retention purge, without a recurring paid worker.
    if (id % 250 === 0) {
      await db.q("DELETE FROM tg_student_activity WHERE occurred_at < now() - interval '90 days'");
      await db.q("DELETE FROM tg_student_section_changes WHERE changed_at < now() - interval '90 days'");
    }
  } catch {
    // Failure to record a usage metric must never prevent student access.
  }
}

const FROM_EVENTS = [
  "FROM tg_student_activity e",
  "JOIN tg_subscribers s ON s.chat_id=e.chat_id",
  "LEFT JOIN portal_telegram_links l ON l.telegram_user_id=s.chat_id AND l.revoked_at IS NULL",
  "LEFT JOIN portal_admins a ON a.id=l.admin_id AND a.is_active=true AND a.status='active'",
].join(" ");
const STUDENTS_ONLY = "s.role='student' AND s.chat_id<>$1 AND a.id IS NULL";
const ownerId = () => /^[0-9]+$/.test(BOT_OWNER_ID) ? BOT_OWNER_ID : "0";

export interface FeatureCount {feature: string; interactions: number; students: number}
export interface SubjectCount {subject: string; selections: number; students: number}
export interface EngagementOverview {
  interactions7d: number; interactions30d: number;
  engaged7d: number; engaged30d: number;
  firstRecordedAt: string | null;
  byFeature: FeatureCount[];
  bySubject: SubjectCount[];
  daily: {day: string; interactions: number; users: number}[];
}
export interface DeliveryOverview {total: number; sent: number; failed: number; pending: number}
export interface ProfileQuality {
  studentTotal: number; noUsername: number; missingFirstName: number;
  missingSection: number; optedOut: number;
}

export async function getEngagementOverview(db: Queryer = defaultQueryer): Promise<EngagementOverview> {
  const overview = await db.qOne<{
    interactions7d: number | string; interactions30d: number | string;
    engaged7d: number | string; engaged30d: number | string;
    first_recorded_at: string | null;
  }>(
    "SELECT COUNT(*) FILTER (WHERE e.occurred_at>=now()-interval '7 days')::int AS \"interactions7d\", " +
    "COUNT(*) FILTER (WHERE e.occurred_at>=now()-interval '30 days')::int AS \"interactions30d\", " +
    "COUNT(DISTINCT CASE WHEN e.occurred_at>=now()-interval '7 days' THEN e.chat_id END)::int AS \"engaged7d\", " +
    "COUNT(DISTINCT CASE WHEN e.occurred_at>=now()-interval '30 days' THEN e.chat_id END)::int AS \"engaged30d\", " +
    "MIN(e.occurred_at)::text AS first_recorded_at " + FROM_EVENTS + " WHERE " + STUDENTS_ONLY,
    [ownerId()]
  );
  const features = await db.q<{feature: string; interactions: string | number; students: string | number}>(
    "SELECT e.feature, COUNT(*)::int AS interactions, COUNT(DISTINCT e.chat_id)::int AS students " +
    FROM_EVENTS + " WHERE " + STUDENTS_ONLY +
    " AND e.occurred_at>=now()-interval '30 days' " +
    "GROUP BY e.feature ORDER BY interactions DESC, e.feature LIMIT 12",
    [ownerId()]
  );
  const subjects = await db.q<{subject: string; selections: string | number; students: string | number}>(
    "SELECT COALESCE(p.name, e.subject_id) AS subject, COUNT(*)::int AS selections, " +
    "COUNT(DISTINCT e.chat_id)::int AS students " +
    FROM_EVENTS + " LEFT JOIN portal_subjects p ON p.id=e.subject_id " +
    "WHERE " + STUDENTS_ONLY + " AND e.subject_id IS NOT NULL " +
    "AND e.occurred_at>=now()-interval '30 days' " +
    "GROUP BY p.name, e.subject_id ORDER BY selections DESC LIMIT 7",
    [ownerId()]
  );
  const daily = await db.q<{day: string; interactions: string | number; users: string | number}>(
    "SELECT to_char(e.occurred_at AT TIME ZONE 'Asia/Baghdad','YYYY-MM-DD') AS \"day\", " +
    "COUNT(*)::int AS interactions, COUNT(DISTINCT e.chat_id)::int AS users " +
    FROM_EVENTS + " WHERE " + STUDENTS_ONLY +
    " AND e.occurred_at>=now()-interval '7 days' " +
    "GROUP BY \"day\" ORDER BY \"day\" DESC",
    [ownerId()]
  );
  return {
    interactions7d: Number(overview?.interactions7d || 0),
    interactions30d: Number(overview?.interactions30d || 0),
    engaged7d: Number(overview?.engaged7d || 0),
    engaged30d: Number(overview?.engaged30d || 0),
    firstRecordedAt: overview?.first_recorded_at || null,
    byFeature: features.map(x => ({feature: x.feature, interactions: Number(x.interactions), students: Number(x.students)})),
    bySubject: subjects.map(x => ({subject: x.subject, selections: Number(x.selections), students: Number(x.students)})),
    daily: daily.map(x => ({day: x.day, interactions: Number(x.interactions), users: Number(x.users)})),
  };
}

export async function getSectionEngagement(section: string, db: Queryer = defaultQueryer) {
  if (!["A", "B", "C", "F", "NA"].includes(section))
    return {interactions7d: 0, interactions30d: 0, topFeatures: [] as FeatureCount[], topSubjects: [] as SubjectCount[]};
  const extra = section === "NA"
    ? " AND (s.section IS NULL OR s.section='')"
    : " AND s.section=$2";
  const params = section === "NA" ? [ownerId()] : [ownerId(), section];
  const totals = await db.qOne<{d7: number | string; d30: number | string}>(
    "SELECT COUNT(*) FILTER (WHERE e.occurred_at>=now()-interval '7 days')::int AS d7, " +
    "COUNT(*) FILTER (WHERE e.occurred_at>=now()-interval '30 days')::int AS d30 " +
    FROM_EVENTS + " WHERE " + STUDENTS_ONLY + extra, params
  );
  const top = await db.q<{feature: string; interactions: number | string; students: number | string}>(
    "SELECT e.feature, COUNT(*)::int AS interactions, COUNT(DISTINCT e.chat_id)::int AS students " +
    FROM_EVENTS + " WHERE " + STUDENTS_ONLY + extra +
    " AND e.occurred_at>=now()-interval '30 days' GROUP BY e.feature ORDER BY interactions DESC LIMIT 5",
    params
  );
  const subjects = await db.q<{subject: string; selections: number | string; students: number | string}>(
    "SELECT COALESCE(p.name, e.subject_id) AS subject, COUNT(*)::int AS selections, " +
    "COUNT(DISTINCT e.chat_id)::int AS students " +
    FROM_EVENTS + " LEFT JOIN portal_subjects p ON p.id=e.subject_id " +
    "WHERE " + STUDENTS_ONLY + extra +
    " AND e.subject_id IS NOT NULL AND e.occurred_at>=now()-interval '30 days' " +
    "GROUP BY p.name, e.subject_id ORDER BY selections DESC LIMIT 5",
    params
  );
  return {
    interactions7d: Number(totals?.d7 || 0), interactions30d: Number(totals?.d30 || 0),
    topFeatures: top.map(x => ({feature: x.feature, interactions: Number(x.interactions), students: Number(x.students)})),
    topSubjects: subjects.map(x => ({subject: x.subject, selections: Number(x.selections), students: Number(x.students)})),
  };
}

export interface StudentUsage {
  events7d: number; events30d: number; activeDays30d: number;
  firstRecorded: string | null; lastRecorded: string | null;
  languageCode: string | null; optedOut: boolean;
  topFeatures: {feature: string; interactions: number}[];
  topSubjects: {subject: string; selections: number}[];
  recent: {feature: string; occurred_at: string}[];
  sectionHistory: {old_section: string | null; new_section: string | null; changed_at: string}[];
  deliveries: DeliveryOverview;
  preferences: Record<string, boolean>;
}
export async function getStudentUsage(chatId: number, db: Queryer = defaultQueryer): Promise<StudentUsage> {
  const [row, counts, features, subjects, recents, language, changes, notifications] = await Promise.all([
    db.qOne<{prefs: Record<string, boolean> | string; analytics_opt_out: boolean}>(
      "SELECT prefs, analytics_opt_out FROM tg_subscribers WHERE chat_id=$1", [chatId]),
    db.qOne<{events7d: number | string; events30d: number | string; days: number | string;
      first: string | null; last: string | null}>(
      "SELECT COUNT(*) FILTER (WHERE occurred_at>=now()-interval '7 days')::int AS \"events7d\", " +
      "COUNT(*) FILTER (WHERE occurred_at>=now()-interval '30 days')::int AS \"events30d\", " +
      "COUNT(DISTINCT (occurred_at AT TIME ZONE 'Asia/Baghdad')::date) FILTER " +
      "(WHERE occurred_at>=now()-interval '30 days')::int AS days, " +
      "MIN(occurred_at)::text AS first, MAX(occurred_at)::text AS last " +
      "FROM tg_student_activity WHERE chat_id=$1", [chatId]),
    db.q<{feature: string; interactions: string | number}>(
      "SELECT feature, COUNT(*)::int AS interactions FROM tg_student_activity " +
      "WHERE chat_id=$1 AND occurred_at>=now()-interval '30 days' " +
      "GROUP BY feature ORDER BY interactions DESC LIMIT 8", [chatId]),
    db.q<{subject: string; selections: number | string}>(
      "SELECT COALESCE(p.name, e.subject_id) AS subject, COUNT(*)::int AS selections " +
      "FROM tg_student_activity e LEFT JOIN portal_subjects p ON p.id=e.subject_id " +
      "WHERE e.chat_id=$1 AND e.subject_id IS NOT NULL " +
      "AND e.occurred_at>=now()-interval '30 days' " +
      "GROUP BY p.name, e.subject_id ORDER BY selections DESC LIMIT 7", [chatId]),
    db.q<{feature: string; occurred_at: string}>(
      "SELECT feature, occurred_at FROM tg_student_activity WHERE chat_id=$1 " +
      "ORDER BY occurred_at DESC LIMIT 5", [chatId]),
    db.qOne<{language_code: string | null}>(
      "SELECT language_code FROM tg_student_activity " +
      "WHERE chat_id=$1 AND language_code IS NOT NULL ORDER BY occurred_at DESC LIMIT 1", [chatId]),
    db.q<{old_section: string | null; new_section: string | null; changed_at: string}>(
      "SELECT old_section, new_section, changed_at FROM tg_student_section_changes " +
      "WHERE chat_id=$1 ORDER BY changed_at DESC LIMIT 5", [chatId]),
    db.qOne<{total: number | string; sent: number | string; failed: number | string; pending: number | string}>(
      "SELECT COUNT(*)::int AS total, " +
      "COUNT(*) FILTER (WHERE d.status='sent')::int AS sent, " +
      "COUNT(*) FILTER (WHERE d.status='failed')::int AS failed, " +
      "COUNT(*) FILTER (WHERE d.status='pending')::int AS pending " +
      "FROM tg_deliveries d JOIN tg_subscribers s ON s.id=d.subscriber_id WHERE s.chat_id=$1",
      [chatId]
    ),
  ]);
  const prefs = typeof row?.prefs === "string" ? JSON.parse(row.prefs) : (row?.prefs || {});
  return {
    events7d: Number(counts?.events7d || 0), events30d: Number(counts?.events30d || 0),
    activeDays30d: Number(counts?.days || 0), firstRecorded: counts?.first || null,
    lastRecorded: counts?.last || null, languageCode: language?.language_code || null,
    optedOut: row?.analytics_opt_out === true,
    topFeatures: features.map(x => ({feature: x.feature, interactions: Number(x.interactions)})),
    topSubjects: subjects.map(x => ({subject: x.subject, selections: Number(x.selections)})),
    recent: recents,
    sectionHistory: changes,
    deliveries: {
      total: Number(notifications?.total || 0), sent: Number(notifications?.sent || 0),
      failed: Number(notifications?.failed || 0), pending: Number(notifications?.pending || 0),
    },
    preferences: prefs,
  };
}

export async function getDeliveryOverview(db: Queryer = defaultQueryer): Promise<DeliveryOverview> {
  const row = await db.qOne<{total: number | string; sent: number | string;
    failed: number | string; pending: number | string}>(
    "SELECT COUNT(*)::int AS total, " +
    "COUNT(*) FILTER (WHERE status='sent')::int AS sent, " +
    "COUNT(*) FILTER (WHERE status='failed')::int AS failed, " +
    "COUNT(*) FILTER (WHERE status='pending')::int AS pending FROM tg_deliveries"
  );
  return {
    total: Number(row?.total || 0), sent: Number(row?.sent || 0),
    failed: Number(row?.failed || 0), pending: Number(row?.pending || 0),
  };
}

export async function getProfileQuality(db: Queryer = defaultQueryer): Promise<ProfileQuality> {
  const row = await db.qOne<{
    student_total: number | string; no_username: number | string;
    missing_first: number | string; no_section: number | string; opted_out: number | string;
  }>(
    "SELECT COUNT(*)::int AS student_total, " +
    "COUNT(*) FILTER (WHERE s.username IS NULL OR s.username='')::int AS no_username, " +
    "COUNT(*) FILTER (WHERE s.first_name IS NULL OR s.first_name='')::int AS missing_first, " +
    "COUNT(*) FILTER (WHERE s.section IS NULL OR s.section='')::int AS no_section, " +
    "COUNT(*) FILTER (WHERE s.analytics_opt_out=true)::int AS opted_out " +
    "FROM tg_subscribers s LEFT JOIN portal_telegram_links l " +
    "ON l.telegram_user_id=s.chat_id AND l.revoked_at IS NULL " +
    "LEFT JOIN portal_admins a ON a.id=l.admin_id AND a.is_active=true AND a.status='active' " +
    "WHERE s.role='student' AND s.chat_id<>$1 AND a.id IS NULL",
    [ownerId()]
  );
  return {
    studentTotal: Number(row?.student_total || 0),
    noUsername: Number(row?.no_username || 0),
    missingFirstName: Number(row?.missing_first || 0),
    missingSection: Number(row?.no_section || 0),
    optedOut: Number(row?.opted_out || 0),
  };
}
