-- Rollback for 0028_inventory_authority.sql
-- Drops exactly the two tables that migration added, in dependency order.
-- No other table or column is touched.

SET search_path TO data1_dev;

DROP TABLE IF EXISTS inventory_current_state;
DROP TABLE IF EXISTS inventory_transition_event;
