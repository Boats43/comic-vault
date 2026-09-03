-- =====================================================================
-- 0015 ROLLBACK -- D5B: ValuationQuestion + Applicability
-- =====================================================================
-- Removes exactly what 0015_d5b_valuation_question_applicability.sql
-- adds, in FK-safe reverse-dependency order, and nothing else. Restores
-- asset_identity_assignment to its exact pre-0015 shape (Part 1's
-- additions removed last, since valuation_question's composite FK
-- depends on the UNIQUE constraint added there). Every pre-existing
-- table (0001-0014) is left otherwise completely untouched -- this
-- rollback never drops or alters market_observation, gk_asset,
-- gk_principal, or any row within asset_identity_assignment itself
-- (only the trigger/constraint added by 0015's Part 1 are removed; the
-- table's 80 pre-existing live rows, in a real data1_dev application of
-- this migration, would be entirely unaffected by this rollback).
-- =====================================================================

SET search_path TO data1_dev;

-- Part 3 reversal (applicability) -- view depends on the table, drop
-- first.
DROP VIEW IF EXISTS applicability_contested_pairs;
DROP TRIGGER IF EXISTS applicability_no_delete ON applicability;
DROP TRIGGER IF EXISTS applicability_no_update ON applicability;
DROP FUNCTION IF EXISTS applicability_immutable();
DROP TABLE IF EXISTS applicability;

-- Part 2 reversal (valuation_question) -- applicability referenced this
-- table's id via FK, already dropped above.
DROP TRIGGER IF EXISTS valuation_question_no_delete ON valuation_question;
DROP TRIGGER IF EXISTS valuation_question_no_update ON valuation_question;
DROP FUNCTION IF EXISTS valuation_question_immutable();
DROP TABLE IF EXISTS valuation_question;

-- Part 1 reversal (asset_identity_assignment) -- valuation_question's
-- composite FK against the UNIQUE constraint below is already gone
-- (the whole table was just dropped), so this constraint/trigger can
-- now be removed safely.
DROP TRIGGER IF EXISTS asset_identity_assignment_no_delete ON asset_identity_assignment;
DROP TRIGGER IF EXISTS asset_identity_assignment_no_update ON asset_identity_assignment;
DROP FUNCTION IF EXISTS asset_identity_assignment_guard();
ALTER TABLE asset_identity_assignment DROP CONSTRAINT IF EXISTS asset_identity_assignment_id_asset_uk;
