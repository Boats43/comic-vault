-- Rollback for 0037_physical_copy_decision.sql
SET search_path TO data1_dev;
DROP TABLE IF EXISTS physical_copy_decision_event;
