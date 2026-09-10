-- Rollback for 0020_outcome1_valuation_event_population_link.sql
-- Drops exactly what that migration added, in FK-safe order, nothing else.

SET search_path TO data1_dev;

DROP INDEX IF EXISTS valuation_event_market_population_idx;
ALTER TABLE valuation_event DROP COLUMN IF EXISTS market_population_id;
