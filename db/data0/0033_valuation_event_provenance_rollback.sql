-- Rollback for 0033_valuation_event_provenance.sql
-- (Must be applied only after 0034's triggers are rolled back; the column
-- drop is a DDL change, not a row UPDATE, but keep the order.)

SET search_path TO data1_dev;

ALTER TABLE valuation_event DROP CONSTRAINT IF EXISTS valuation_event_provenance_check;
ALTER TABLE valuation_event DROP COLUMN IF EXISTS provenance;
