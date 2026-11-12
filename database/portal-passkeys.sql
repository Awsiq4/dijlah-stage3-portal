CREATE TABLE IF NOT EXISTS portal_passkeys (
  id TEXT PRIMARY KEY,
  admin_id BIGINT NOT NULL REFERENCES portal_admins(id) ON DELETE CASCADE,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL CHECK (counter >= 0),
  transports TEXT[] NOT NULL DEFAULT '{}',
  label TEXT NOT NULL,
  enrolled_as_owner BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_portal_passkeys_admin ON portal_passkeys(admin_id);
CREATE TABLE IF NOT EXISTS portal_passkey_challenges (
  token_hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'authenticate')),
  challenge TEXT NOT NULL,
  session_hash TEXT,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_portal_passkey_challenges_expiry ON portal_passkey_challenges(expires_at);
ALTER TABLE portal_sessions ADD COLUMN IF NOT EXISTS passkey_id TEXT;
CREATE INDEX IF NOT EXISTS idx_portal_sessions_passkey ON portal_sessions(passkey_id) WHERE passkey_id IS NOT NULL;
