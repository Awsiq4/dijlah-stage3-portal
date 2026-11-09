ALTER TABLE portal_lectures ADD COLUMN IF NOT EXISTS material_kind TEXT NOT NULL DEFAULT 'lecture' CHECK (material_kind IN ('lecture','summary'));
