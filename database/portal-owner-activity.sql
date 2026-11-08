-- Owner analytics v2. Additive migration. No student records are deleted or reset.
-- Only high-level Telegram bot interactions are retained, never message bodies.
ALTER TABLE tg_subscribers ADD COLUMN IF NOT EXISTS analytics_opt_out BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS tg_student_activity (
  update_id BIGINT PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  feature TEXT NOT NULL CHECK (feature IN (
    'start','home','announcements','lectures','schedule','exams',
    'assignments','subjects','settings','section','help','other'
  )),
  action TEXT NOT NULL,
  subject_id TEXT,
  language_code TEXT,
  section_at_event TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE tg_student_activity ADD COLUMN IF NOT EXISTS subject_id TEXT;
CREATE INDEX IF NOT EXISTS idx_tg_student_activity_subject_time
  ON tg_student_activity (subject_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_tg_student_activity_user_time
  ON tg_student_activity (chat_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_tg_student_activity_feature_time
  ON tg_student_activity (feature, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_tg_student_activity_day
  ON tg_student_activity (occurred_at DESC);

-- Database trigger keeps change history accurate regardless of whether the
-- section was changed via /start payload, callback, or another supported path.
CREATE TABLE IF NOT EXISTS tg_student_section_changes (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  old_section TEXT,
  new_section TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tg_student_section_changes_user
  ON tg_student_section_changes (chat_id, changed_at DESC);

CREATE OR REPLACE FUNCTION record_tg_student_section_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.analytics_opt_out THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.section IS NOT NULL THEN
      INSERT INTO tg_student_section_changes(chat_id, old_section, new_section)
      VALUES (NEW.chat_id, NULL, NEW.section);
    END IF;
  ELSIF NEW.section IS DISTINCT FROM OLD.section THEN
    INSERT INTO tg_student_section_changes(chat_id, old_section, new_section)
    VALUES (NEW.chat_id, OLD.section, NEW.section);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname='trg_tg_student_section_change'
  ) THEN
    CREATE TRIGGER trg_tg_student_section_change
    AFTER INSERT OR UPDATE OF section ON tg_subscribers
    FOR EACH ROW EXECUTE FUNCTION record_tg_student_section_change();
  END IF;
END;
$;

-- Retention for activity and section-history data is 90 days after capture.
-- Purge is triggered periodically by the webhook, and a manual purge is safe.
