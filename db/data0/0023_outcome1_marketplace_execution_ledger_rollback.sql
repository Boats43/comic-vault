-- Rollback for 0023_outcome1_marketplace_execution_ledger.sql
-- Drops exactly what that migration added: one table, its indexes.
-- No other table is touched.

SET search_path TO data1_dev;

DROP TABLE IF EXISTS outcome_event;
