-- Rollback for 0027_buyer_decision_ledger.sql
-- Drops exactly the two tables that migration added, in dependency order.
-- No other table or column is touched.

SET search_path TO data1_dev;

DROP TABLE IF EXISTS buyer_acquisition_event;
DROP TABLE IF EXISTS buyer_decision_event;
