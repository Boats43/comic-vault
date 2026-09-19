-- =====================================================================
-- 0029 -- GK-227: media.capture_view (NEW column, additive)
-- =====================================================================
-- GRAILKEY — POST-CAPTURE PHYSICAL MEDIA APPEND V1.
--
-- media.media_type (0004, CHECK 'capture-photo'/'grading-photo'/
-- 'document') already exists and is a WHY-axis classification (why this
-- media exists) — it is NOT a view-angle. There is currently no column
-- recording WHICH SIDE of the physical object a given media row shows
-- (front cover vs. back cover vs. spine vs. interior pages vs. a close-up
-- detail), which is exactly what a certification-readiness check needs
-- ("do we have durable evidence of the back cover") and exactly what
-- media_type cannot answer on its own (every real row today is
-- media_type='capture-photo' regardless of which side it depicts).
--
-- Additive column on an existing table (0004's own definition, and 0009's
-- content_type addition, are both left unedited). Nullable, deliberately:
-- every existing media row (including the original capture-time photo on
-- every already-minted asset, e.g. Old Man Logan #25's own single row)
-- predates this concept and never recorded a view angle — backfilling a
-- guessed value for a historical row would be fabrication this project's
-- own discipline forbids (GK-227's own dispatch: "No rewriting history").
-- NULL on an old row means exactly what it says: "no view angle was
-- recorded for this piece of evidence," never silently coerced to FRONT
-- or any other value.
-- =====================================================================

SET search_path TO data1_dev;

ALTER TABLE media ADD COLUMN IF NOT EXISTS capture_view TEXT;

-- Postgres has no `ADD CONSTRAINT IF NOT EXISTS` -- DO block is the
-- standard idiom for a safely re-runnable constraint add.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'media_capture_view_check' AND conrelid = 'media'::regclass
  ) THEN
    ALTER TABLE media ADD CONSTRAINT media_capture_view_check
      CHECK (capture_view IS NULL OR capture_view = ANY (ARRAY['FRONT', 'BACK', 'SPINE', 'PAGES', 'DETAIL']));
  END IF;
END $$;
