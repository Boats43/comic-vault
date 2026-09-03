-- =====================================================================
-- 0015 ROLLBACK -- D1: asset_identity_assignment immutability repair
-- =====================================================================
-- Removes exactly what 0015_d1_identity_assignment_immutability.sql
-- adds, and nothing else. asset_identity_assignment's own pre-existing
-- rows and every other column/constraint on it are left completely
-- untouched.
--
-- ORDERING WARNING (A1, disclosed): if 0016 (ValuationQuestion +
-- Applicability) has already been applied on top of this migration,
-- this rollback WILL FAIL -- 0016's valuation_question table carries a
-- composite FOREIGN KEY against the UNIQUE(id, asset_id) constraint
-- this file drops, and PostgreSQL refuses to drop a constraint a live
-- FK still depends on (a real, loud dependency error, never a silent
-- corruption). Roll back 0016 first. This is the correct, expected
-- direction for the dependency to run -- 0016 depends on 0015, not the
-- reverse -- and is proven directly (not merely asserted) in the A1-R3
-- section of docs/D5B-LIVE-APPLY-REPORT.md.
-- =====================================================================

SET search_path TO data1_dev;

DROP TRIGGER IF EXISTS asset_identity_assignment_no_delete ON asset_identity_assignment;
DROP TRIGGER IF EXISTS asset_identity_assignment_no_update ON asset_identity_assignment;
DROP FUNCTION IF EXISTS asset_identity_assignment_guard();
ALTER TABLE asset_identity_assignment DROP CONSTRAINT IF EXISTS asset_identity_assignment_id_asset_uk;
