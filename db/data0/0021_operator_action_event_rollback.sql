-- Rollback for 0021_operator_action_event.sql
-- Drops exactly the one new, independent table this migration added.

SET search_path TO data1_dev;

DROP TABLE IF EXISTS operator_action_event;
