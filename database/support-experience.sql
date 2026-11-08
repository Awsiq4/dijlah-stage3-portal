-- Additive support UX migration: seen/unread indicators and optional website-only recovery.
CREATE TABLE IF NOT EXISTS support_read_states (
  ticket_id BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  reader_key TEXT NOT NULL,
  last_read_id BIGINT NOT NULL DEFAULT 0,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, reader_key)
);
CREATE INDEX IF NOT EXISTS support_read_states_reader_idx
  ON support_read_states (reader_key, read_at DESC);

-- A recovery code is independent of Telegram and only its SHA-256 digest is stored.
CREATE TABLE IF NOT EXISTS support_recovery_codes (
  identity_id TEXT PRIMARY KEY REFERENCES support_identities(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
