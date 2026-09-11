-- Rollback for 0022_beta1a_clerk_identity_mapping.sql
-- One new table, fully independent -- drop and nothing else.

SET search_path TO data1_dev;

DROP TABLE IF EXISTS principal_external_identity;
