-- First-semester stage-three midterms. Apply after portal subjects are provisioned.
-- Re-running preserves later edits to any exam already imported under its stable ID.
BEGIN;

ALTER TABLE portal_exams ADD COLUMN IF NOT EXISTS schedule_id TEXT;
ALTER TABLE portal_exams ADD COLUMN IF NOT EXISTS schedule_updated_at TIMESTAMPTZ;

INSERT INTO portal_exams
  (id, subject_id, title, type, date, start_time, room, sections, status, schedule_id)
SELECT
  'midterm-2026-2027-semester-1-' || schedule.subject_id,
  subject.id,
  schedule.title,
  'Midterm',
  schedule.exam_date,
  '12:30',
  '',
  '["A","B","C","F"]'::jsonb,
  'confirmed',
  'midterm-2026-2027-semester-1'
FROM (VALUES
  ('numerical-analysis', 'التحليلات العددية', '2026-11-28'),
  ('laser-safety', 'الوقاية من الليزر', '2026-11-29'),
  ('quantum-mechanics', 'ميكانيك الكم', '2026-12-01'),
  ('nonlinear-optics', 'بصريات لاخطية', '2026-12-02'),
  ('digital-systems', 'الأنظمة التسلسلية الرقمية', '2026-12-05'),
  ('industrial-lasers', 'تطبيقات الليزر الصناعية', '2026-12-06'),
  ('optoelectronics', 'الإلكترونيات البصرية', '2026-12-08')
) AS schedule(subject_id, title, exam_date)
-- A missing subject fails the insert through the NOT NULL constraint.
LEFT JOIN portal_subjects AS subject ON subject.id = schedule.subject_id
ON CONFLICT (id) DO NOTHING;

COMMIT;
