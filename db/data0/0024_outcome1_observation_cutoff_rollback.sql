-- Rollback for 0024_outcome1_observation_cutoff.sql
-- Drops exactly the one column that migration added. No other table or
-- column is touched.

SET search_path TO data1_dev;

ALTER TABLE outcome_event
  DROP COLUMN IF EXISTS next_observation_due_at;
