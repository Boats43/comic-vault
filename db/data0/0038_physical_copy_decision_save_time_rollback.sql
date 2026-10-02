-- Rollback for 0038 (only valid while no SAVE-time SAME_COPY row exists; NOT NULL cannot be restored otherwise)
SET search_path TO data1_dev;
DROP INDEX IF EXISTS physical_copy_decision_event_item_idx;
ALTER TABLE physical_copy_decision_event DROP CONSTRAINT IF EXISTS physical_copy_decision_prediction_fk;
ALTER TABLE physical_copy_decision_event DROP CONSTRAINT IF EXISTS physical_copy_decision_result_chk;
ALTER TABLE physical_copy_decision_event DROP CONSTRAINT IF EXISTS physical_copy_decision_incoming_chk;
ALTER TABLE physical_copy_decision_event DROP CONSTRAINT IF EXISTS physical_copy_decision_surface_chk;
ALTER TABLE physical_copy_decision_event DROP COLUMN IF EXISTS incoming_retired;
ALTER TABLE physical_copy_decision_event DROP COLUMN IF EXISTS canonical_collection_item_id;
ALTER TABLE physical_copy_decision_event DROP COLUMN IF EXISTS related_prediction_event_id;
ALTER TABLE physical_copy_decision_event DROP COLUMN IF EXISTS surface;
ALTER TABLE physical_copy_decision_event ALTER COLUMN incoming_collection_item_id SET NOT NULL;
ALTER TABLE physical_copy_decision_event ALTER COLUMN resulting_gk_asset_id SET NOT NULL;
