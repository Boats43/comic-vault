-- =====================================================================
-- 0018 ROLLBACK -- GK-179: database-resident environment identity
-- =====================================================================
-- Removes exactly what 0018_gk179_environment_identity.sql adds, and
-- nothing else. No other 0001-0017 object is touched.
-- =====================================================================

SET search_path TO data1_dev;

DROP TABLE IF EXISTS environment_marker;
