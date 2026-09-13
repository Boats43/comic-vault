-- Rollback for 0025_outcome1_economics_components.sql
-- Drops exactly the one table that migration added. No other table or
-- column is touched.

SET search_path TO data1_dev;

DROP TABLE IF EXISTS outcome_economics_component;
