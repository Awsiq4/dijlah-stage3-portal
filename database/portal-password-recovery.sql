-- One-time email verified password recovery tokens.
-- Secret tokens are never stored: only SHA-256 digests.
CREATE TABLE IF NOT EXISTS portal_password_resets (
  token_hash TEXT PRIMARY KEY,
  admin_id BIGINT NOT NULL REFERENCES portal_admins(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_portal_password_resets_admin ON portal_password_resets(admin_id);
CREATE INDEX IF NOT EXISTS idx_portal_password_resets_expires ON portal_password_resets(expires_at);
