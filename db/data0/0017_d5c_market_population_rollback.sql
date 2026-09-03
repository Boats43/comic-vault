-- =====================================================================
-- 0017 ROLLBACK -- D5C: MarketPopulation
-- =====================================================================
-- Removes exactly what 0017_d5c_market_population.sql adds, in FK-safe
-- reverse-dependency order, and nothing else. comp_snapshot,
-- valuation_event, and every 0001-0016 object are completely untouched
-- (this migration's two ALTER TABLE statements -- applicability's
-- composite UNIQUE and market_population's own composite UNIQUE -- are
-- the ONLY changes to pre-existing tables -- both reversed here,
-- leaving applicability and market_population exactly as this
-- migration's own forward text first created/left them).
-- =====================================================================

SET search_path TO data1_dev;

DROP TRIGGER IF EXISTS market_population_member_no_delete ON market_population_member;
DROP TRIGGER IF EXISTS market_population_member_no_update ON market_population_member;
DROP FUNCTION IF EXISTS market_population_member_immutable();
DROP TABLE IF EXISTS market_population_member;

ALTER TABLE applicability DROP CONSTRAINT IF EXISTS applicability_id_observation_question_uk;

DROP TRIGGER IF EXISTS market_population_no_delete ON market_population;
DROP TRIGGER IF EXISTS market_population_no_update ON market_population;
DROP FUNCTION IF EXISTS market_population_immutable();
-- market_population_id_question_uk is dropped implicitly with the
-- table itself (no separate ALTER needed -- market_population is not
-- shared with any pre-existing table, unlike applicability above).
DROP TABLE IF EXISTS market_population;
