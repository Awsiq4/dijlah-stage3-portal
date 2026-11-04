-- Telegram notification service schema (PostgreSQL, e.g. Neon on Vercel)
-- Apply with: psql "$DATABASE_URL" -f database/telegram-notifications.sql

CREATE TABLE IF NOT EXISTS tg_subscribers (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL UNIQUE,
  user_id BIGINT,
  username TEXT,
  section TEXT NOT NULL CHECK (section IN ('A','B','C','F')),
  prefs JSONB NOT NULL DEFAULT '{"lectures":true,"exams":true,"announcements":true,"schedule":true,"assignments":true}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','stopped')),
  consent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tg_events (
  id BIGSERIAL PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('lecture','exam','announcement','schedule','assignment','test')),
  title TEXT NOT NULL,
  body TEXT,
  url TEXT,
  scope TEXT NOT NULL CHECK (scope IN ('general','section','teacher')),
  section TEXT,
  subject_id TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tg_deliveries (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES tg_events(id) ON DELETE CASCADE,
  subscriber_id BIGINT NOT NULL REFERENCES tg_subscribers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, subscriber_id)
);

CREATE TABLE IF NOT EXISTS tg_audit (
  id BIGSERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tg_deliveries_due ON tg_deliveries (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_tg_events_created ON tg_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tg_subscribers_section ON tg_subscribers (section, status);
