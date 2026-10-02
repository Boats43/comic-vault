-- Rollback for 0035_learning_spine.sql (drops the two event tables and the snapshot column).
SET search_path TO data1_dev;
ALTER TABLE decision_event DROP CONSTRAINT IF EXISTS decision_event_authority_snapshot_object;
ALTER TABLE decision_event DROP COLUMN IF EXISTS authority_snapshot;
DROP TABLE IF EXISTS operator_correction_event;
DROP FUNCTION IF EXISTS operator_correction_event_guard();
DROP TABLE IF EXISTS model_prediction_event;
DROP FUNCTION IF EXISTS learning_ledger_immutable();
