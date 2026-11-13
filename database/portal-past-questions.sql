-- Published past exam questions: Telegram uploads and student subject-tab reads.
-- Additive migration; all existing data and notification preferences are retained.
CREATE TABLE IF NOT EXISTS portal_past_questions (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES portal_subjects(id) ON DELETE CASCADE,
  exam_kind TEXT NOT NULL CHECK (exam_kind IN ('quiz','midterm','final')),
  title TEXT NOT NULL,
  academic_year TEXT NOT NULL DEFAULT '',
  sections JSONB NOT NULL DEFAULT '["A","B","C","F"]'::jsonb
    CHECK (sections <@ '["A","B","C","F"]'::jsonb),
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL DEFAULT '',
  file_sha256 TEXT NOT NULL,
  created_by BIGINT NOT NULL REFERENCES portal_admins(id),
  source TEXT NOT NULL DEFAULT 'telegram',
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS portal_past_questions_file_unique
  ON portal_past_questions(subject_id,exam_kind,file_sha256)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS portal_past_questions_subject_kind
  ON portal_past_questions(subject_id,exam_kind,created_at DESC);
