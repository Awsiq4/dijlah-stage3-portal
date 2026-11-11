import {q, qOne, defaultQueryer, type Queryer} from "./db.ts";
import {selectRecipients, eventKey, type TgEvent, type TgSubscriber} from "./targeting.ts";
import {renderMessage} from "./templates.ts";
import {sendMessage} from "./telegram.ts";
import {nextDelayMs, shouldRetry, isBlockedError} from "./backoff.ts";
import {PORTAL_BASE_URL, QSTASH_TOKEN, QSTASH_URL, telegramServiceEnabled} from "./flags.ts";

export type CreateEventInput = TgEvent & {
  refId: string;
  version: number | string;
  title: string;
  body?: string;
  url?: string;
};

export async function createEvent(input: CreateEventInput, db: Queryer = defaultQueryer): Promise<{created: boolean; eventId?: number; recipients: number}> {
  const key = eventKey(input.type, input.refId, input.version);
  const row = await db.qOne<{id: number}>(
    `INSERT INTO tg_events (event_key, type, title, body, url, scope, section, subject_id, priority)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (event_key) DO NOTHING RETURNING id`,
    [key, input.type, input.title, input.body || null, input.url || null, input.scope, input.section ?? null, input.subject_id ?? null, input.priority || "normal"]
  );
  if (!row) return {created: false, recipients: 0};
  const subs = await db.q<TgSubscriber>(`SELECT id, chat_id, section, status, prefs FROM tg_subscribers WHERE status='active'`);
  const recipients = selectRecipients(input, subs);
  for (const s of recipients) {
    await db.q(
      `INSERT INTO tg_deliveries (event_id, subscriber_id) VALUES ($1,$2) ON CONFLICT (event_id, subscriber_id) DO NOTHING`,
      [row.id, s.id]
    );
  }
  await db.q(`INSERT INTO tg_audit (action, detail) VALUES ($1,$2)`, ["event.created", {event_key: key, recipients: recipients.length}]);
  return {created: true, eventId: row.id, recipients: recipients.length};
}

export async function drainQueue(limit = 100): Promise<{sent: number; failed: number; retried: number; skipped: number}> {
  if (!telegramServiceEnabled()) return {sent: 0, failed: 0, retried: 0, skipped: 0};
  const due = await q<{
    id: number; event_id: number; subscriber_id: number; attempts: number;
    type: string; title: string; body: string | null; url: string | null; scope: string; section: string | null; priority: string;
    chat_id: number;
  }>(
    `SELECT d.id, d.event_id, d.subscriber_id, d.attempts, e.type, e.title, e.body, e.url, e.scope, e.section, e.priority, s.chat_id
     FROM tg_deliveries d
     JOIN tg_events e ON e.id = d.event_id
     JOIN tg_subscribers s ON s.id = d.subscriber_id
     WHERE d.status = 'pending' AND d.next_attempt_at <= now()
     ORDER BY d.id LIMIT $1`,
    [limit]
  );
  let sent = 0, failed = 0, retried = 0, skipped = 0;
  for (const d of due) {
    const event: TgEvent & {title: string; body: string | null; url: string | null} = {type: d.type as TgEvent["type"], scope: d.scope as TgEvent["scope"], section: d.section, priority: d.priority, title: d.title, body: d.body, url: d.url};
    const msg = renderMessage(event, PORTAL_BASE_URL);
    const res = await sendMessage(d.chat_id, msg.text, {parseMode: msg.parseMode});
    if (res.ok) {
      await q(`UPDATE tg_deliveries SET status='sent', sent_at=now(), last_error=NULL WHERE id=$1`, [d.id]);
      sent++;
    } else if (isBlockedError(res.error)) {
      await q(`UPDATE tg_deliveries SET status='failed', last_error=$2 WHERE id=$1`, [d.id, res.error?.description || "blocked"]);
      await q(`UPDATE tg_subscribers SET status='stopped', updated_at=now() WHERE id=$1`, [d.subscriber_id]);
      await q(`INSERT INTO tg_audit (action, detail) VALUES ($1,$2)`, ["subscriber.stopped", {subscriber_id: d.subscriber_id, reason: res.error?.description}]);
      failed++;
    } else if (shouldRetry(d.attempts + 1, res.error)) {
      const delay = nextDelayMs(d.attempts + 1, res.retryAfter);
      await q(`UPDATE tg_deliveries SET attempts=attempts+1, next_attempt_at=now() + ($2 || ' milliseconds')::interval, last_error=$3 WHERE id=$1`, [d.id, String(delay), res.error?.description || "error"]);
      retried++;
    } else {
      await q(`UPDATE tg_deliveries SET status='failed', last_error=$2 WHERE id=$1`, [d.id, res.error?.description || "max attempts"]);
      failed++;
    }
  }
  return {sent, failed, retried, skipped};
}

export async function scheduleViaQStash(): Promise<void> {
  if (!QSTASH_TOKEN || !QSTASH_URL) return;
  try {
    await fetch(`${QSTASH_URL}/publish`, {
      method: "POST",
      headers: {"content-type": "application/json", authorization: `Bearer ${QSTASH_TOKEN}`},
      body: JSON.stringify({url: `${PORTAL_BASE_URL}/api/telegram/worker`, headers: {"x-worker-secret": process.env.WORKER_SECRET || ""}}),
    });
  } catch { /* fall back to in-process drain */ }
}

export async function publishAndDeliver(input: CreateEventInput): Promise<{created: boolean; recipients: number; delivery?: {sent: number; failed: number; retried: number; skipped: number}}> {
  const ev = await createEvent(input);
  if (!ev.created || !telegramServiceEnabled()) return {created: ev.created, recipients: ev.recipients};
  await scheduleViaQStash();
  const delivery = await drainQueue(200);
  return {created: ev.created, recipients: ev.recipients, delivery};
}
