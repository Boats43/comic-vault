-- =====================================================================
-- 0011 ROLLBACK — inverse of db/data0/0011_d3_2_event_time.sql
-- =====================================================================
-- NOT part of the numbered forward-migration sequence. Exists solely as
-- the predetermined rollback path for 0011, written and validated BEFORE
-- 0011 is applied to data1_dev (D3.2 Phase B, B1). If rollback is ever
-- warranted, THIS is the only path used — no ad-hoc corrective migration
-- is ever written during an incident.
--
-- Exact inverse, per table: DROP the new nullable occurred_at column
-- (safe — by construction nothing has written to it until the paired
-- application code, deferred separately, ships), then RENAME recorded_at
-- back to its original historical column name. Reversible without data
-- loss in either direction: the RENAME is pure metadata (no row value
-- changes), and DROP COLUMN only removes a column no writer this pass
-- has populated.
-- =====================================================================

SET search_path TO data1_dev;

ALTER TABLE ownership_event DROP COLUMN occurred_at;
ALTER TABLE ownership_event RENAME COLUMN recorded_at TO occurred_at;

ALTER TABLE acquisition_event DROP COLUMN occurred_at;
ALTER TABLE acquisition_event RENAME COLUMN recorded_at TO occurred_at;

ALTER TABLE valuation_event DROP COLUMN occurred_at;
ALTER TABLE valuation_event RENAME COLUMN recorded_at TO occurred_at;

ALTER TABLE decision_event DROP COLUMN occurred_at;
ALTER TABLE decision_event RENAME COLUMN recorded_at TO occurred_at;

ALTER TABLE domain_event DROP COLUMN occurred_at;
ALTER TABLE domain_event RENAME COLUMN recorded_at TO occurred_at;

ALTER TABLE media DROP COLUMN occurred_at;
ALTER TABLE media RENAME COLUMN recorded_at TO captured_at;

ALTER TABLE asset_identity_assignment DROP COLUMN occurred_at;
ALTER TABLE asset_identity_assignment RENAME COLUMN recorded_at TO assigned_at;
