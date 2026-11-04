# Telegram Notification Bot — Setup Guide

The portal ships with a complete, secure, server-side Telegram notification service.
It is **disabled by default** (`TELEGRAM_BOT_ENABLED=false`) and only activates when all
required secrets + database are configured in Vercel Environment Variables.

## 1. Create the bot (BotFather)
1. Open Telegram → @BotFather → `/newbot` → choose name + username (ends with `bot`).
2. Copy the **HTTP API token** (secret — never commit it).
3. Note the username (e.g. `dijlah_stage3_bot`).

## 2. Database (PostgreSQL on Vercel)
1. Create a Postgres database (e.g. Neon) and copy `DATABASE_URL`.
2. Run the migration: `psql "$DATABASE_URL" -f database/telegram-notifications.sql`
   (creates `tg_subscribers`, `tg_events`, `tg_deliveries`, `tg_audit` with uniqueness constraints
   that prevent duplicate subscriptions and duplicate deliveries).

## 3. Vercel Environment Variables (Project → Settings → Environment Variables)
| Variable | Value |
|---|---|
| `TELEGRAM_BOT_ENABLED` | `true` (only after everything else is set) |
| `TELEGRAM_BOT_TOKEN` | token from BotFather |
| `TELEGRAM_BOT_USERNAME` | bot username without `@` |
| `TELEGRAM_WEBHOOK_SECRET` | random 32+ chars (e.g. `openssl rand -hex 32`) |
| `SUBSCRIPTION_SECRET` | random 32+ chars |
| `ADMIN_API_SECRET` | random 32+ chars |
| `WORKER_SECRET` | random 32+ chars |
| `DATABASE_URL` | Postgres connection string (with `?sslmode=require` if needed) |
| `PORTAL_BASE_URL` | `https://dijlah-stage3-portal.vercel.app` |
| `QSTASH_TOKEN` / `QSTASH_URL` | optional, for event-driven delivery via Upstash QStash |

Never put these in GitHub or chat. `.env.example` documents them without values.

## 4. Register the webhook
After the first deploy with env vars set:
```
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d url="https://dijlah-stage3-portal.vercel.app/api/telegram/webhook" \
  -d secret_token="<TELEGRAM_WEBHOOK_SECRET>"
```
Verify: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"`

## 5. How it works
- Subscribe: homepage/notifications card → `POST /api/telegram/subscribe` → short-lived HMAC token (15 min) → deep link `t.me/<bot>?start=<token>` → bot `/start` verifies token, upserts subscriber (chat_id unique), confirms section.
- Bot commands: `/start /section /settings /status /stop /help` (inline keyboards for section & prefs).
- Events: server-side `publishAndDeliver()` inserts `tg_events` (unique `event_key` = type:ref:version → no duplicates), computes recipients via targeting rules (general / section / teacher + prefs), inserts `tg_deliveries` (unique event+subscriber → idempotent), then delivers via QStash if configured, else drains the queue in-process; `/api/telegram/worker` (x-worker-secret) drains with exponential backoff + Telegram `retry_after` handling; 403/blocked → subscriber marked `stopped` gracefully.
- Admin: `/admin` → «مركز إشعارات التليجرام» (x-admin-secret) → stats, by-section counts, delivery states, recent events, bot status, test notification.
- Health (public, no secrets): `GET /api/telegram/health` → `{enabled, botConfigured, databaseConfigured, flag}`.

## 6. Security measures
- Webhook protected by Telegram secret-token header (timing-safe compare).
- Deep-link subscription tokens: HMAC-SHA256 signed, 15-min expiry, section-bound.
- Admin/worker endpoints require secret headers (timing-safe), 403 without configured secret.
- Bot token only server-side (never in client JS, never committed).
- No subscriber lists or personal data in public APIs; health endpoint exposes no secrets.
- Opt-in only; `/stop` unsubscribes; blocked bots handled gracefully.
- Delivery failures never roll back academic content; full audit log table.

## 7. Testing checklist (do after setup)
- [ ] `/api/telegram/health` shows enabled:true
- [ ] Subscribe from the site card; bot confirms section
- [ ] Repeat subscribe (idempotent), `/section` change, `/settings` toggle, `/status`, `/stop`, `/start` again
- [ ] Admin test notification delivers to all active subscribers once
- [ ] Section targeting: section A subscriber does not get section B event
- [ ] Simulate Telegram 429/500 → retries with backoff; 403 → subscriber stopped
- [ ] Feature flag off → card shows disabled, endpoints 503
- [ ] Existing site pages unchanged

## 8. Automatic publication triggers (future)
Today academic content is prototype-local (localStorage), so automatic triggers are intentionally
**not** wired to it. When real server-side persistence (D1/Postgres-backed CMS) exists, call
`publishAndDeliver()` from the authenticated admin/content API after a successful commit of a
lecture/exam/announcement/assignment/schedule change — never from client-side storage events.
