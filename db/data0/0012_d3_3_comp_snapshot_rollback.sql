-- =====================================================================
-- 0012 ROLLBACK -- inverse of db/data0/0012_d3_3_comp_snapshot.sql
-- =====================================================================
-- NOT part of the numbered forward-migration sequence. Predetermined
-- rollback path for 0012, written and validated BEFORE 0012 is ever
-- applied to data1_dev (D3.3 Phase A, mirroring D3.2's own B1
-- discipline). If rollback is ever warranted, THIS is the only path
-- used -- no ad-hoc corrective migration is ever written during an
-- incident.
--
-- Drops exactly what 0012 adds, in dependency order (triggers before
-- their function, function before the table they reference, table
-- last). Nothing else in data1_dev is touched.
-- =====================================================================

SET search_path TO data1_dev;

DROP TRIGGER IF EXISTS comp_snapshot_no_update ON comp_snapshot;
DROP TRIGGER IF EXISTS comp_snapshot_no_delete ON comp_snapshot;
DROP FUNCTION IF EXISTS comp_snapshot_immutable();
DROP TABLE IF EXISTS comp_snapshot;
