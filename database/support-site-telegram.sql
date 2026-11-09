-- Website-gated Telegram support, reusing all pre-existing support tickets/messages/jobs.
-- Additive migration only: no modification or deletion of existing records.
CREATE TABLE IF NOT EXISTS support_site_entries (
  token_hash TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('support','idea','problem')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  used_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_site_entries_expiry
  ON support_site_entries (expires_at);

ALTER TABLE support_jobs ADD COLUMN IF NOT EXISTS reply_markup JSONB;
ALTER TABLE support_jobs ADD COLUMN IF NOT EXISTS media_file_id TEXT;
ALTER TABLE support_attachments ADD COLUMN IF NOT EXISTS telegram_file_id TEXT;
CREATE INDEX IF NOT EXISTS support_jobs_claimable
  ON support_jobs (next_at, id)
  WHERE sent_at IS NULL AND failed = false;
