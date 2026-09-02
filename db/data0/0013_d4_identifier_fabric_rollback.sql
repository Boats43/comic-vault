-- =====================================================================
-- 0013 ROLLBACK -- inverse of db/data0/0013_d4_identifier_fabric.sql
-- =====================================================================
-- NOT part of the numbered forward-migration sequence. Predetermined
-- rollback path for 0013, written and validated BEFORE 0013 is ever
-- applied to data1_dev (D4 Phase A, mirroring D3.2/D3.3's own discipline).
-- If rollback is ever warranted, THIS is the only path used -- no ad-hoc
-- corrective migration is ever written during an incident.
--
-- Drops exactly what 0013 adds, in FK-safe dependency order: the
-- evidence-link table first (composite-FK-references both assertion and
-- observation, including the same-asset integrity FKs added after the
-- S1/S2 adversarial proof), then the assertion table's own
-- triggers/function/table (self-referencing composite FK included --
-- DROP TABLE removes it along with everything else on the table, no
-- separate statement needed), then the raw-observation table's
-- triggers/function/table (references gk_asset), then the identifier
-- definition table itself. No existing table (gk_asset, gk_principal, or
-- any other) is touched -- 0013 never ALTERs an existing table, so this
-- rollback never does either.
-- =====================================================================

SET search_path TO data1_dev;

DROP TRIGGER IF EXISTS asset_identifier_assertion_evidence_no_update ON asset_identifier_assertion_evidence;
DROP TRIGGER IF EXISTS asset_identifier_assertion_evidence_no_delete ON asset_identifier_assertion_evidence;
DROP FUNCTION IF EXISTS asset_identifier_assertion_evidence_immutable();
DROP TABLE IF EXISTS asset_identifier_assertion_evidence;

DROP TRIGGER IF EXISTS asset_identifier_assertion_no_update ON asset_identifier_assertion;
DROP TRIGGER IF EXISTS asset_identifier_assertion_no_delete ON asset_identifier_assertion;
DROP FUNCTION IF EXISTS asset_identifier_assertion_guard();
DROP TABLE IF EXISTS asset_identifier_assertion;

DROP TRIGGER IF EXISTS asset_raw_observation_no_update ON asset_raw_observation;
DROP TRIGGER IF EXISTS asset_raw_observation_no_delete ON asset_raw_observation;
DROP FUNCTION IF EXISTS asset_raw_observation_immutable();
DROP INDEX IF EXISTS asset_raw_observation_id_asset_unique;
DROP TABLE IF EXISTS asset_raw_observation;

DROP TRIGGER IF EXISTS asset_identifier_no_update ON asset_identifier;
DROP TRIGGER IF EXISTS asset_identifier_no_delete ON asset_identifier;
DROP FUNCTION IF EXISTS asset_identifier_immutable();
DROP INDEX IF EXISTS asset_identifier_unique;
DROP TABLE IF EXISTS asset_identifier;
