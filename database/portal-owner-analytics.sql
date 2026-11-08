-- Phase 3 — Bot owner management & user analytics (idempotent, non-destructive).
-- Reuses tg_subscribers as the user registry; adds registration sequence + activity tracking.

-- sequential registration numbers: database-backed, race-safe (never COUNT(*))
CREATE SEQUENCE IF NOT EXISTS tg_reg_seq START WITH 1;

ALTER TABLE tg_subscribers ADD COLUMN IF NOT EXISTS reg_seq BIGINT UNIQUE;
ALTER TABLE tg_subscribers ADD COLUMN IF NOT EXISTS first_name TEXT NOT NULL DEFAULT '';
ALTER TABLE tg_subscribers ADD COLUMN IF NOT EXISTS last_name TEXT NOT NULL DEFAULT '';
ALTER TABLE tg_subscribers ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'student';
ALTER TABLE tg_subscribers ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE tg_subscribers ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- backfill stable sequence numbers for existing users (ordered by consent_at, id)
DO $$
DECLARE r RECORD; n BIGINT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tg_subscribers WHERE reg_seq IS NOT NULL) THEN
    n := 0;
    FOR r IN SELECT id FROM tg_subscribers WHERE reg_seq IS NULL ORDER BY consent_at, id LOOP
      n := n + 1;
      UPDATE tg_subscribers SET reg_seq = n WHERE id = r.id;
    END LOOP;
    PERFORM setval('tg_reg_seq', GREATEST(n, 1));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tg_subscribers_registered ON tg_subscribers (registered_at);
CREATE INDEX IF NOT EXISTS idx_tg_subscribers_activity ON tg_subscribers (last_activity_at);
CREATE INDEX IF NOT EXISTS idx_tg_subscribers_section_role ON tg_subscribers (section, role);

-- allow "no section yet" (nullable) for users who have not chosen a section
ALTER TABLE tg_subscribers ALTER COLUMN section DROP NOT NULL;
ALTER TABLE tg_subscribers DROP CONSTRAINT IF EXISTS tg_subscribers_section_check;
ALTER TABLE tg_subscribers ADD CONSTRAINT tg_subscribers_section_check CHECK (section IS NULL OR section IN ('A','B','C','F'));

-- persistent bot settings (owner notification preferences etc.)
CREATE TABLE IF NOT EXISTS bot_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- idempotent owner notifications (dedupe by event key)
CREATE TABLE IF NOT EXISTS tg_owner_notifs (
  event_key TEXT PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  payload JSONB NOT NULL,
  sent_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
