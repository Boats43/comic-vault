-- =====================================================================
-- 0017 ROLLBACK -- D5C: MarketPopulation
-- =====================================================================
-- Removes exactly what 0017_d5c_market_population.sql adds, in FK-safe
-- reverse-dependency order, and nothing else. comp_snapshot,
-- valuation_event, and every 0001-0016 object are completely untouched
-- (this migration's ALTER TABLE applicability ADD CONSTRAINT is the
-- ONLY change to a pre-existing table -- reversed here as well, leaving
-- applicability exactly as 0016 left it).
-- =====================================================================

SET search_path TO data1_dev;

DROP TRIGGER IF EXISTS market_population_member_no_delete ON market_population_member;
DROP TRIGGER IF EXISTS market_population_member_no_update ON market_population_member;
DROP FUNCTION IF EXISTS market_population_member_immutable();
DROP TABLE IF EXISTS market_population_member;

ALTER TABLE applicability DROP CONSTRAINT IF EXISTS applicability_id_observation_uk;

DROP TRIGGER IF EXISTS market_population_no_delete ON market_population;
DROP TRIGGER IF EXISTS market_population_no_update ON market_population;
DROP FUNCTION IF EXISTS market_population_immutable();
DROP TABLE IF EXISTS market_population;
