// Read-only section drilldowns for the Telegram bot owner.
// Student totals exclude the owner and Telegram accounts linked to active portal staff.
import {BOT_OWNER_ID} from "./flags.ts";
import {defaultQueryer, type Queryer} from "./db.ts";
import type {UserRow} from "./analytics.ts";

export const SECTION_KEYS = ["A", "B", "C", "F", "NA"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export type SectionStats = {
  total: number;
  subscribed: number;
  stopped: number;
  active7d: number;
  active30d: number;
  new7d: number;
};

// This predicate is used identically for counts and paginated user listings.
// "status=stopped" means notifications were stopped, not deletion of registration.
const ELIGIBLE = "s.role='student' AND s.chat_id <> $1 AND NOT EXISTS (" +
  "SELECT 1 FROM portal_telegram_links l JOIN portal_admins a ON a.id=l.admin_id " +
  "WHERE l.telegram_user_id=COALESCE(s.user_id,s.chat_id) " +
  "AND l.revoked_at IS NULL AND a.is_active=true AND a.status='active')";

function ownerId(): string {
  return /^[0-9]+$/.test(BOT_OWNER_ID) ? BOT_OWNER_ID : "0";
}
function emptyStats(): SectionStats {
  return {total: 0, subscribed: 0, stopped: 0, active7d: 0, active30d: 0, new7d: 0};
}
export function sectionLabel(section: SectionKey): string {
  return section === "NA" ? "بدون شعبة" : "شعبة " + section;
}

export async function getSectionStats(db: Queryer = defaultQueryer, now = new Date()): Promise<Record<SectionKey, SectionStats>> {
  const weekAgo = new Date(now.getTime() - 7 * 86400_000);
  const monthAgo = new Date(now.getTime() - 30 * 86400_000);
  const sql = [
    "SELECT s.section, COUNT(*)::int AS total,",
    "SUM(CASE WHEN s.status='active' THEN 1 ELSE 0 END)::int AS subscribed,",
    "SUM(CASE WHEN s.status='stopped' THEN 1 ELSE 0 END)::int AS stopped,",
    "SUM(CASE WHEN s.last_activity_at >= $2 THEN 1 ELSE 0 END)::int AS active7d,",
    "SUM(CASE WHEN s.last_activity_at >= $3 THEN 1 ELSE 0 END)::int AS active30d,",
    "SUM(CASE WHEN s.registered_at >= $2 THEN 1 ELSE 0 END)::int AS new7d",
    "FROM tg_subscribers s WHERE " + ELIGIBLE + " GROUP BY s.section",
  ].join(" ");
  const rows = await db.q<SectionStats & {section: string | null}>(sql, [ownerId(), weekAgo, monthAgo]);
  const result: Record<SectionKey, SectionStats> = {A: emptyStats(), B: emptyStats(), C: emptyStats(), F: emptyStats(), NA: emptyStats()};
  for (const row of rows) {
    const code = row.section || "NA";
    if (!SECTION_KEYS.includes(code as SectionKey)) continue;
    result[code as SectionKey] = {
      total: Number(row.total),
      subscribed: Number(row.subscribed),
      stopped: Number(row.stopped),
      active7d: Number(row.active7d),
      active30d: Number(row.active30d),
      new7d: Number(row.new7d),
    };
  }
  return result;
}

export async function listSectionStudents(
  section: SectionKey,
  requestedPage = 0,
  perPage = 8,
  db: Queryer = defaultQueryer,
): Promise<{rows: UserRow[]; total: number; page: number}> {
  if (!SECTION_KEYS.includes(section)) throw new Error("Invalid academic section");
  const page = Number.isSafeInteger(requestedPage) ? Math.min(9999, Math.max(0, requestedPage)) : 0;
  const pageSize = Number.isSafeInteger(perPage) ? Math.min(12, Math.max(1, perPage)) : 8;
  const isUnassigned = section === "NA";
  const predicate = ELIGIBLE + (isUnassigned ? " AND (s.section IS NULL OR s.section='')" : " AND s.section=$2");
  const args = isUnassigned ? [ownerId()] : [ownerId(), section];
  const count = await db.qOne<{total: number | string}>(
    "SELECT COUNT(*)::int AS total FROM tg_subscribers s WHERE " + predicate, args
  );
  const total = Number(count?.total || 0);
  const select = [
    "SELECT s.chat_id, s.reg_seq, s.first_name, s.last_name, s.username, s.role,",
    "s.section, s.status, s.registered_at, s.last_activity_at",
    "FROM tg_subscribers s WHERE " + predicate,
    "ORDER BY s.registered_at DESC, s.chat_id DESC",
    "LIMIT $" + (args.length + 1) + " OFFSET $" + (args.length + 2),
  ].join(" ");
  const rows = await db.q<UserRow>(select, [...args, pageSize, page * pageSize]);
  return {rows, total, page};
}

export async function getEffectiveRoleCounts(db: Queryer = defaultQueryer): Promise<Record<string, number>> {
  const sql = [
    "SELECT effective_role, COUNT(*)::int AS total FROM (",
    "SELECT CASE WHEN s.chat_id=$1 THEN 'owner'",
    "WHEN a.id IS NOT NULL THEN a.role ELSE s.role END AS effective_role",
    "FROM tg_subscribers s",
    "LEFT JOIN portal_telegram_links l ON l.telegram_user_id=COALESCE(s.user_id,s.chat_id) AND l.revoked_at IS NULL",
    "LEFT JOIN portal_admins a ON a.id=l.admin_id AND a.is_active=true AND a.status='active'",
    ") roles GROUP BY effective_role ORDER BY total DESC",
  ].join(" ");
  const rows = await db.q<{effective_role: string; total: string | number}>(sql, [ownerId()]);
  return Object.fromEntries(rows.map(r => [r.effective_role, Number(r.total)]));
}

export async function getEffectiveRole(telegramId: number, db: Queryer = defaultQueryer): Promise<string | null> {
  const row = await db.qOne<{role: string}>(
    "SELECT a.role FROM portal_telegram_links l " +
      "JOIN portal_admins a ON a.id=l.admin_id " +
      "WHERE l.telegram_user_id=$1 AND l.revoked_at IS NULL " +
      "AND a.is_active=true AND a.status='active' LIMIT 1",
    [telegramId]
  );
  return row?.role ?? null;
}
