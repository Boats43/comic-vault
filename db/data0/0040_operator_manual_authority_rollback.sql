-- Rollback for 0040. Drops only the table this migration created (its triggers go with it).
-- economic_ledger_immutable() belongs to 0034 and is NOT dropped here.
SET search_path TO data1_dev;
DROP TABLE IF EXISTS operator_authority_event;
