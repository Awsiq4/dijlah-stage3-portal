import {q, qOne, defaultQueryer, type Queryer} from "./db.ts";
import {selectRecipients, eventKey, type TgEvent, type TgSubscriber} from "./targeting.ts";
import {renderMessage} from "./templates.ts";
import {sendMessage} from "./telegram.ts";
import {nextDelayMs, shouldRetry, isBlockedError} from "./backoff.ts";
import {PORTAL_BASE_URL, QSTASH_TOKEN, QSTASH_URL, WORKER_SECRET, telegramServiceEnabled} from "./flags.ts";

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

export async function drainQueue(limit = 100, eventIds?: readonly number[]): Promise<{sent: number; failed: number; retried: number; skipped: number}> {
  if (!telegramServiceEnabled() || eventIds?.length === 0) return {sent: 0, failed: 0, retried: 0, skipped: 0};
  const due = await q<{
    id: number; event_id: number; subscriber_id: number; attempts: number;
    type: TgEvent["type"]; title: string; body: string | null; url: string | null;
    scope: TgEvent["scope"]; section: string | null; priority: string; subject_name: string | null;
  }>(
    `SELECT d.id, d.event_id, d.subscriber_id, d.attempts, e.type, e.title, e.body, e.url, e.scope, e.section, e.priority,
            p.name AS subject_name
     FROM tg_deliveries d
     JOIN tg_events e ON e.id = d.event_id
     LEFT JOIN portal_subjects p ON p.id = e.subject_id
     WHERE d.status = 'pending' AND d.next_attempt_at <= now()
       ${eventIds ? "AND d.event_id = ANY($2::bigint[])" : ""}
     ORDER BY d.id LIMIT $1`,
    eventIds ? [limit, eventIds] : [limit]
  );
  let sent = 0, failed = 0, retried = 0, skipped = 0;
  let earliestRetry = Infinity;
  for (const d of due) {
    const claim = await qOne(`UPDATE tg_deliveries SET next_attempt_at=now() + interval '2 minutes'
      WHERE id=$1 AND status='pending' AND next_attempt_at<=now() RETURNING id`, [d.id]);
    if (!claim) { skipped++; continue; }
    const event = {type: d.type, scope: d.scope, section: d.section, priority: d.priority, title: d.title, body: d.body, url: d.url, subjectName: d.subject_name};
    const subscriber = await qOne<TgSubscriber>(`SELECT id,chat_id,section,status,prefs FROM tg_subscribers WHERE id=$1`, [d.subscriber_id]);
    if (!subscriber || !selectRecipients(event, [subscriber]).length) {
      await q(`UPDATE tg_deliveries SET status='failed', last_error='subscriber no longer eligible' WHERE id=$1`, [d.id]);
      skipped++;
      continue;
    }
    const msg = renderMessage(event, PORTAL_BASE_URL);
    const res = await sendMessage(Number(subscriber.chat_id), msg.text, {parseMode: msg.parseMode});
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
      earliestRetry = Math.min(earliestRetry, Date.now() + delay);
      retried++;
    } else {
      await q(`UPDATE tg_deliveries SET status='failed', last_error=$2 WHERE id=$1`, [d.id, res.error?.description || "max attempts"]);
      failed++;
    }
  }
  if (retried) await scheduleViaQStash(Math.max(0, (earliestRetry - Date.now()) / 1000) + 1);
  return {sent, failed, retried, skipped};
}

export async function scheduleViaQStash(delaySeconds = 0): Promise<void> {
  if (!QSTASH_TOKEN || !WORKER_SECRET || process.env.VERCEL_ENV === "preview") return;
  const base = (QSTASH_URL || "https://qstash.upstash.io").replace(/\/(?:v2\/?)?$/, "");
  try {
    const response = await fetch(`${base}/v2/publish/${PORTAL_BASE_URL}/api/telegram/worker`, {
      method: "POST",
      headers: {"content-type": "application/json", authorization: `Bearer ${QSTASH_TOKEN}`,
        "Upstash-Forward-X-Worker-Secret": WORKER_SECRET,
        ...(delaySeconds ? {"Upstash-Delay": `${Math.ceil(delaySeconds)}s`} : {})},
      body: "{}",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) console.warn("notification worker scheduling rejected", response.status);
  } catch { console.warn("notification worker scheduling unavailable"); }
}

export async function publishAndDeliver(input: CreateEventInput): Promise<{created: boolean; recipients: number; delivery?: {sent: number; failed: number; retried: number; skipped: number}}> {
  const ev = await createEvent(input);
  if (!ev.created || !telegramServiceEnabled()) return {created: ev.created, recipients: ev.recipients};
  await scheduleViaQStash();
  const delivery = await drainQueue(200);
  return {created: ev.created, recipients: ev.recipients, delivery};
}
