-- =====================================================================
-- 0016 ROLLBACK -- D5B: ValuationQuestion + Applicability
-- =====================================================================
-- Removes exactly what 0016_d5b_valuation_question_applicability.sql
-- adds, in FK-safe reverse-dependency order, and nothing else. Does NOT
-- touch 0015 (asset_identity_assignment's immutability trigger/
-- constraint) at all -- proven directly, not merely by omission (A1-R3,
-- docs/D5B-LIVE-APPLY-REPORT.md): rolling back this file alone leaves
-- 0015's protection live and byte-identical to its pre-rollback state.
-- =====================================================================

SET search_path TO data1_dev;

DROP VIEW IF EXISTS applicability_contested_pairs;
DROP TRIGGER IF EXISTS applicability_no_delete ON applicability;
DROP TRIGGER IF EXISTS applicability_no_update ON applicability;
DROP FUNCTION IF EXISTS applicability_immutable();
DROP TABLE IF EXISTS applicability;

DROP TRIGGER IF EXISTS valuation_question_no_delete ON valuation_question;
DROP TRIGGER IF EXISTS valuation_question_no_update ON valuation_question;
DROP FUNCTION IF EXISTS valuation_question_immutable();
DROP TABLE IF EXISTS valuation_question;
