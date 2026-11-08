// Owner analytics — all numbers computed from actual DB records.
// Date boundaries use Asia/Baghdad (portal timezone), never the server's local time.
import {defaultQueryer, type Queryer} from "./db.ts";

export const TZ = "Asia/Baghdad";

// start-of-day (UTC instant) for a given Baghdad calendar date
export function baghdadDayStartUTC(y: number, m: number, d: number): Date {
  // Baghdad is UTC+3 year-round (no DST since 2008-ish; Iraq abolished DST)
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 3 * 3600 * 1000);
}

export function baghdadToday(): {y: number; m: number; d: number} {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"});
  const [y, m, d] = fmt.format(now).split("-").map(Number);
  return {y, m, d};
}

function dayOffsetUTC(base: {y: number; m: number; d: number}, days: number): Date {
  return new Date(baghdadDayStartUTC(base.y, base.m, base.d).getTime() + days * 86400_000);
}

export interface Analytics {
  total: number;
  newToday: number;
  newYesterday: number;
  new7d: number;
  new30d: number;
  active24h: number;
  active7d: number;
  active30d: number;
  byRole: Record<string, number>;
  bySection: Record<string, number>;
  unassignedSection: number;
  growth: {
    today: number; thisWeek: number; thisMonth: number;
    last7d: number; prev7d: number; pct: number | null; peakDay: string | null; peakCount: number;
  };
}

export async function computeAnalytics(db: Queryer = defaultQueryer, now = new Date()): Promise<Analytics> {
  const t = baghdadTodayAt(now);
  const todayStart = baghdadDayStartUTC(t.y, t.m, t.d);
  const yesterdayStart = dayOffsetUTC(t, -1);
  const d7 = dayOffsetUTC(t, -6);
  const d30 = dayOffsetUTC(t, -29);
  const h24 = new Date(now.getTime() - 24 * 3600_000);
  const w7 = new Date(now.getTime() - 7 * 86400_000);
  const m30 = new Date(now.getTime() - 30 * 86400_000);
  const prev7Start = dayOffsetUTC(t, -13);
  const prev7End = d7;

  const one = async (sql: string, params: unknown[]) => Number((await db.qOne<{c: string | number}>(sql, params))?.c || 0);
  const total = await one(`SELECT count(*)::int AS c FROM tg_subscribers`, []);
  const newToday = await one(`SELECT count(*)::int AS c FROM tg_subscribers WHERE registered_at >= $1`, [todayStart]);
  const newYesterday = await one(`SELECT count(*)::int AS c FROM tg_subscribers WHERE registered_at >= $1 AND registered_at < $2`, [yesterdayStart, todayStart]);
  const new7d = await one(`SELECT count(*)::int AS c FROM tg_subscribers WHERE registered_at >= $1`, [d7]);
  const new30d = await one(`SELECT count(*)::int AS c FROM tg_subscribers WHERE registered_at >= $1`, [d30]);
  const active24h = await one(`SELECT count(DISTINCT chat_id)::int AS c FROM tg_subscribers WHERE last_activity_at >= $1`, [h24]);
  const active7d = await one(`SELECT count(DISTINCT chat_id)::int AS c FROM tg_subscribers WHERE last_activity_at >= $1`, [w7]);
  const active30d = await one(`SELECT count(DISTINCT chat_id)::int AS c FROM tg_subscribers WHERE last_activity_at >= $1`, [m30]);

  const roles = await db.q<{role: string; c: string | number}>(`SELECT role, count(*)::int AS c FROM tg_subscribers GROUP BY role ORDER BY c DESC`);
  const byRole: Record<string, number> = {};
  for (const r of roles) byRole[r.role] = Number(r.c);

  const secs = await db.q<{section: string; c: string | number}>(`SELECT section, count(*)::int AS c FROM tg_subscribers WHERE role='student' GROUP BY section ORDER BY section`);
  const bySection: Record<string, number> = {};
  for (const s of secs) bySection[s.section] = Number(s.c);
  const unassignedSection = await one(`SELECT count(*)::int AS c FROM tg_subscribers WHERE role='student' AND (section IS NULL OR section='')`, []);

  const last7d = await one(`SELECT count(*)::int AS c FROM tg_subscribers WHERE registered_at >= $1 AND registered_at < $2`, [d7, todayStart]);
  const prev7d = await one(`SELECT count(*)::int AS c FROM tg_subscribers WHERE registered_at >= $1 AND registered_at < $2`, [prev7Start, prev7End]);
  const pct = prev7d === 0 ? (last7d > 0 ? null : 0) : Math.round(((last7d - prev7d) / prev7d) * 100);
  // peak day computed in JS (portable across PG/pg-mem; Baghdad calendar day)
  const regRows = await db.q<{registered_at: string}>(`SELECT registered_at FROM tg_subscribers WHERE registered_at >= $1`, [d30]);
  const perDay = new Map<string, number>();
  const dayFmt = new Intl.DateTimeFormat("en-CA", {timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"});
  for (const r of regRows) {
    const d = dayFmt.format(new Date(r.registered_at));
    perDay.set(d, (perDay.get(d) || 0) + 1);
  }
  let peak: {d: string; c: number} | null = null;
  for (const [d, c] of perDay) if (!peak || c > peak.c || (c === peak.c && d > peak.d)) peak = {d, c};

  return {
    total, newToday, newYesterday, new7d, new30d, active24h, active7d, active30d,
    byRole, bySection, unassignedSection,
    growth: {
      today: newToday,
      thisWeek: await one(`SELECT count(*)::int AS c FROM tg_subscribers WHERE registered_at >= $1`, [dayOffsetUTC(t, -(isoWeekday(t) - 1))]),
      thisMonth: await one(`SELECT count(*)::int AS c FROM tg_subscribers WHERE registered_at >= $1`, [baghdadDayStartUTC(t.y, t.m, 1)]),
      last7d, prev7d, pct, peakDay: peak?.d ?? null, peakCount: peak ? peak.c : 0,
    },
  };
}

function baghdadTodayAt(now: Date) {
  const fmt = new Intl.DateTimeFormat("en-CA", {timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"});
  const [y, m, d] = fmt.format(now).split("-").map(Number);
  return {y, m, d};
}
function isoWeekday(t: {y: number; m: number; d: number}): number {
  const dow = new Date(Date.UTC(t.y, t.m - 1, t.d)).getUTCDay(); // 0=Sun
  return dow === 0 ? 7 : dow;
}

// ---------- user management ----------
export interface UserRow {
  chat_id: number; reg_seq: number | null; first_name: string; last_name: string;
  username: string | null; role: string; section: string | null; status: string;
  registered_at: string; last_activity_at: string;
}

export async function listUsers(db: Queryer, page: number, perPage = 8, filter?: {role?: string; section?: string; q?: string}): Promise<{rows: UserRow[]; total: number}> {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (filter?.role) { params.push(filter.role); conds.push(`role=$${params.length}`); }
  if (filter?.section) { params.push(filter.section); conds.push(`section=$${params.length}`); }
  if (filter?.q) {
    const like = `%${filter.q}%`;
    params.push(like);
    const idNum = Number(filter.q);
    conds.push(`(username ILIKE $${params.length} OR first_name ILIKE $${params.length} OR last_name ILIKE $${params.length} OR CAST(reg_seq AS TEXT) = $${params.length}${Number.isInteger(idNum) ? ` OR chat_id=$${params.length + 1}` : ""})`);
    if (Number.isInteger(idNum)) params.push(idNum);
  }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const total = Number((await db.qOne<{c: string | number}>(`SELECT count(*)::int AS c FROM tg_subscribers ${where}`, params))?.c || 0);
  const rows = await db.q<UserRow>(`SELECT chat_id, reg_seq, first_name, last_name, username, role, section, status, registered_at, last_activity_at FROM tg_subscribers ${where} ORDER BY registered_at DESC, chat_id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, perPage, page * perPage]);
  return {rows, total};
}

export async function getUser(db: Queryer, chatId: number): Promise<UserRow | null> {
  return db.qOne<UserRow>(`SELECT chat_id, reg_seq, first_name, last_name, username, role, section, status, registered_at, last_activity_at FROM tg_subscribers WHERE chat_id=$1`, [chatId]);
}

// ---------- settings ----------
export async function getSetting(db: Queryer, key: string, fallback: unknown): Promise<unknown> {
  const row = await db.qOne<{value: unknown}>(`SELECT value FROM bot_settings WHERE key=$1`, [key]);
  return row ? row.value : fallback;
}
export async function setSetting(db: Queryer, key: string, value: unknown): Promise<void> {
  await db.q(`INSERT INTO bot_settings (key, value, updated_at) VALUES ($1,$2,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [key, JSON.stringify(value)]);
}

export const OWNER_NOTIFY_KEY = "owner_new_user_notifications";
export async function ownerNotificationsEnabled(db: Queryer = defaultQueryer): Promise<boolean> {
  const v = await getSetting(db, OWNER_NOTIFY_KEY, true);
  return v !== false;
}
