-- =====================================================================
-- 0038 -- GK-279 correction: server-adjudicated physical-copy decision at SAVE time
-- =====================================================================
-- Additive delta on 0037 (0037 itself is unchanged). The decision may now be made BEFORE any
-- duplicate collection_item becomes durable (surface='SAVE'): a SAME_COPY there has NO incoming
-- collection row at all, so incoming_collection_item_id becomes nullable. The model inference the
-- operator just made is linked to the existing asset's decision (related_prediction_event_id, from
-- the SERVER-claimed grade receipt, never client-supplied) -- model_prediction_event itself stays
-- immutable and untouched. incoming_retired records a capture-time SAME_COPY that retired a
-- transient unlinked duplicate row (only when every retirement condition held).
-- Constraint-existence guards are scoped to THIS table (conrelid): pg_constraint names are not
-- unique database-wide, and an unscoped guard would silently skip a constraint whenever another
-- schema (e.g. a scratch proof) already holds one of the same name.
-- Append-only triggers are row-level; this DDL touches no existing row (constant defaults are
-- metadata-only). Rerunnable.
-- =====================================================================

SET search_path TO data1_dev;

ALTER TABLE physical_copy_decision_event ALTER COLUMN incoming_collection_item_id DROP NOT NULL;
-- A SAVE-time ANOTHER_COPY precedes any mint: no resulting asset exists yet (the explicit capture
-- later writes its own CAPTURE-surface row naming the minted asset).
ALTER TABLE physical_copy_decision_event ALTER COLUMN resulting_gk_asset_id DROP NOT NULL;
ALTER TABLE physical_copy_decision_event ADD COLUMN IF NOT EXISTS surface TEXT NOT NULL DEFAULT 'CAPTURE';
ALTER TABLE physical_copy_decision_event ADD COLUMN IF NOT EXISTS related_prediction_event_id UUID;
ALTER TABLE physical_copy_decision_event ADD COLUMN IF NOT EXISTS canonical_collection_item_id TEXT;
ALTER TABLE physical_copy_decision_event ADD COLUMN IF NOT EXISTS incoming_retired BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'physical_copy_decision_surface_chk' AND conrelid = 'physical_copy_decision_event'::regclass) THEN
    ALTER TABLE physical_copy_decision_event ADD CONSTRAINT physical_copy_decision_surface_chk
      CHECK (surface IN ('SAVE','CAPTURE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'physical_copy_decision_incoming_chk' AND conrelid = 'physical_copy_decision_event'::regclass) THEN
    -- A missing incoming row is only valid for a SAVE-time SAME_COPY (nothing durable was created).
    ALTER TABLE physical_copy_decision_event ADD CONSTRAINT physical_copy_decision_incoming_chk
      CHECK (incoming_collection_item_id IS NOT NULL OR (surface = 'SAVE' AND choice = 'SAME_COPY'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'physical_copy_decision_result_chk' AND conrelid = 'physical_copy_decision_event'::regclass) THEN
    ALTER TABLE physical_copy_decision_event ADD CONSTRAINT physical_copy_decision_result_chk
      CHECK (resulting_gk_asset_id IS NOT NULL OR (surface = 'SAVE' AND choice = 'ANOTHER_COPY'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'physical_copy_decision_prediction_fk' AND conrelid = 'physical_copy_decision_event'::regclass) THEN
    ALTER TABLE physical_copy_decision_event ADD CONSTRAINT physical_copy_decision_prediction_fk
      FOREIGN KEY (principal_id, related_prediction_event_id) REFERENCES model_prediction_event (principal_id, id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS physical_copy_decision_event_item_idx
  ON physical_copy_decision_event (principal_id, incoming_collection_item_id) WHERE incoming_collection_item_id IS NOT NULL;
