// User registry: atomic first-time registration with DB-backed sequential numbers,
// activity tracking, and idempotent owner notifications. Reuses tg_subscribers.
import {withTx, qOne, defaultQueryer} from "./db.ts";
import {sendMessage} from "./telegram.ts";
import {BOT_OWNER_ID} from "./flags.ts";
import {ownerNotificationsEnabled} from "./analytics.ts";

export function isBotOwner(telegramUserId: number | string): boolean {
  return Boolean(BOT_OWNER_ID) && String(telegramUserId) === String(BOT_OWNER_ID);
}

export interface RegisteredUser {
  chat_id: number;
  reg_seq: number | null;
  isNew: boolean;
}

// Atomic, race-safe registration. Returns isNew=false for repeated /start.
export async function registerUser(
  chatId: number,
  userId: number | undefined,
  username: string | undefined,
  firstName: string | undefined,
  lastName: string | undefined,
  section: string
): Promise<RegisteredUser> {
  return withTx(async tx => {
    const existing = await tx.qOne<{chat_id: number; reg_seq: number | null; username: string | null}>(`SELECT chat_id, reg_seq, username FROM tg_subscribers WHERE chat_id=$1`, [chatId]);
    if (existing) {
      // update changeable profile fields + activity; reg_seq never changes once assigned
      const seq = existing.reg_seq ?? Number((await tx.qOne<{v: string | number}>(`SELECT nextval('tg_reg_seq') AS v`))?.v || 0);
      await tx.q(
        `UPDATE tg_subscribers SET user_id=$2, username=$3, first_name=$4, last_name=$5, section=$6, status='active', reg_seq=$7, last_activity_at=now(), updated_at=now() WHERE chat_id=$1`,
        [chatId, userId ?? null, username ?? null, (firstName || "").slice(0, 120), (lastName || "").slice(0, 120), section, seq]
      );
      return {chat_id: chatId, reg_seq: seq, isNew: false};
    }
    const row = await tx.qOne<{chat_id: number; reg_seq: number} & {c: string | number}>(
      `INSERT INTO tg_subscribers (chat_id, user_id, username, first_name, last_name, section, role, status, reg_seq, registered_at, last_activity_at, consent_at)
       VALUES ($1,$2,$3,$4,$5,$6,'student','active', nextval('tg_reg_seq'), now(), now(), now())
       ON CONFLICT (chat_id) DO NOTHING RETURNING chat_id, reg_seq`,
      [chatId, userId ?? null, username ?? null, (firstName || "").slice(0, 120), (lastName || "").slice(0, 120), section]
    );
    if (!row) {
      // lost the race — another request inserted concurrently; treat as existing
      const cur = await tx.qOne<{chat_id: number; reg_seq: number | null}>(`SELECT chat_id, reg_seq FROM tg_subscribers WHERE chat_id=$1`, [chatId]);
      return {chat_id: chatId, reg_seq: cur?.reg_seq ?? null, isNew: false};
    }
    return {chat_id: row.chat_id, reg_seq: Number(row.reg_seq), isNew: true};
  });
}

export async function touchActivity(chatId: number): Promise<void> {
  try { await defaultQueryer.q(`UPDATE tg_subscribers SET last_activity_at=now() WHERE chat_id=$1`, [chatId]); } catch { /* activity tracking must never break the bot */ }
}

// HTML-escape user-supplied text before embedding in Telegram HTML messages
export function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function baghdadStamp(d: Date): string {
  return new Intl.DateTimeFormat("ar-IQ", {timeZone: "Asia/Baghdad", dateStyle: "medium", timeStyle: "short"}).format(d);
}

// Notify the owner about a genuinely new user. Idempotent via tg_owner_notifs.event_key;
// delivery failure never throws (registration is already committed).
export async function notifyOwnerNewUser(u: RegisteredUser & {username?: string | null; first_name?: string; last_name?: string; section?: string}): Promise<void> {
  if (!BOT_OWNER_ID) return;
  if (!u.isNew || !u.reg_seq) return;
  const key = `reg:${u.chat_id}`;
  try {
    const inserted = await defaultQueryer.qOne<{event_key: string}>(
      `INSERT INTO tg_owner_notifs (event_key, chat_id, payload) VALUES ($1,$2,$3) ON CONFLICT (event_key) DO NOTHING RETURNING event_key`,
      [key, u.chat_id, JSON.stringify({})]
    );
    if (!inserted) return; // already notified — dedupe
    if (!(await ownerNotificationsEnabled())) { await defaultQueryer.q(`UPDATE tg_owner_notifs SET sent_at=now() WHERE event_key=$1`, [key]); return; }
    const total = await defaultQueryer.qOne<{c: string | number}>(`SELECT count(*)::int AS c FROM tg_subscribers`);
    const name = `${u.first_name || ""} ${u.last_name || ""}`.trim() || "—";
    const text = `🔔 <b>مستخدم جديد</b>\n\n👤 الاسم: ${esc(name)}\n🔗 المعرف: ${u.username ? "@" + esc(u.username) : "لا يوجد username"}\n🆔 TG ID: <code>${u.chat_id}</code>\n🔢 رقم التسجيل: #${String(u.reg_seq).padStart(6, "0")}\n🎓 الدور: طالب\n🏫 الشعبة: ${esc(u.section || "A")}\n📅 التسجيل: ${baghdadStamp(new Date())}\n👥 إجمالي المسجلين: ${Number(total?.c || 0)}`;
    await sendMessage(Number(BOT_OWNER_ID), text, {parseMode: "HTML"});
    await defaultQueryer.q(`UPDATE tg_owner_notifs SET sent_at=now(), attempts=attempts+1 WHERE event_key=$1`, [key]);
  } catch (err) {
    // bounded retry marker; never throw into the webhook
    try { await defaultQueryer.q(`UPDATE tg_owner_notifs SET attempts=attempts+1 WHERE event_key=$1`, [key]); } catch { /* ignore */ }
    console.error("owner notification failed (will not block registration):", err instanceof Error ? err.message : err);
  }
}
