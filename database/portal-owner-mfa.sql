CREATE TABLE IF NOT EXISTS portal_owner_mfa (
  admin_id BIGINT PRIMARY KEY REFERENCES portal_admins(id) ON DELETE CASCADE,
  encrypted_seed TEXT,
  last_step BIGINT NOT NULL DEFAULT -1,
  recovery_hashes TEXT[] NOT NULL DEFAULT '{}',
  enrollment_hash TEXT,
  enrollment_expires_at TIMESTAMPTZ
);
