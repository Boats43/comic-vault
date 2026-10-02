-- Rollback for 0034_economic_ledger_immutability.sql
SET search_path TO data1_dev;

DROP TRIGGER IF EXISTS valuation_event_no_update ON valuation_event;
DROP TRIGGER IF EXISTS valuation_event_no_delete ON valuation_event;
DROP TRIGGER IF EXISTS valuation_event_no_truncate ON valuation_event;
DROP TRIGGER IF EXISTS decision_event_no_update ON decision_event;
DROP TRIGGER IF EXISTS decision_event_no_delete ON decision_event;
DROP TRIGGER IF EXISTS decision_event_no_truncate ON decision_event;
DROP FUNCTION IF EXISTS economic_ledger_immutable();
