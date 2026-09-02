-- =====================================================================
-- 0014 ROLLBACK -- D5A: MarketObservation substrate
-- =====================================================================
-- Removes exactly what 0014_d5a_market_observation.sql adds, in
-- FK-safe dependency order, and nothing else. market_observation has no
-- inbound dependents (this migration touches no other table -- D9, the
-- ratified D3.3 UNDER relationship, means comp_snapshot/valuation_event
-- are never referenced by or referencing this table in Phase A), so
-- this rollback cannot damage any D1-D4 or D3.3 structure or history.
-- Safe to run at any time before this table has real dependents from a
-- future D5B/D5C phase (neither exists yet).
-- =====================================================================

SET search_path TO data1_dev;

DROP TRIGGER IF EXISTS market_observation_no_delete ON market_observation;
DROP TRIGGER IF EXISTS market_observation_no_update ON market_observation;
DROP FUNCTION IF EXISTS market_observation_immutable();
DROP TABLE IF EXISTS market_observation;
