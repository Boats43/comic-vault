-- =====================================================================
-- 0034 -- GK-276: valuation_event / decision_event are append-only (DB-enforced)
-- =====================================================================
-- Until now these two tables were append-only by CONVENTION only: no
-- application path updates or deletes them (verified by repo-wide
-- inventory, GK-276), but nothing stopped one. Economic history must not
-- be rewritable: corrections happen by appending new rows. Same blanket
-- pattern as the D5 ledgers (0014-0017): BEFORE UPDATE/DELETE/TRUNCATE
-- raises. There is NO bypass flag, no admin escape hatch, no session
-- setting that relaxes it. INSERT is unaffected; idempotent replay works
-- through the idempotency ledger, never through mutation.
--
-- HARD ORDERING DEPENDENCY: 0033's provenance BACKFILL is itself an UPDATE
-- on valuation_event. This migration must therefore be applied ONLY after
-- 0033 has been applied AND its backfill verified in the target
-- environment. The guard below refuses to install if the provenance
-- column is missing or any row is still unclassified.
-- =====================================================================

SET search_path TO data1_dev;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'valuation_event' AND column_name = 'provenance'
  ) THEN
    RAISE EXCEPTION '0034 refused: valuation_event.provenance does not exist -- apply and verify 0033 (incl. backfill) first';
  END IF;
  IF EXISTS (SELECT 1 FROM valuation_event WHERE provenance IS NULL) THEN
    RAISE EXCEPTION '0034 refused: valuation_event has unclassified (NULL provenance) rows -- the backfill is incomplete';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION economic_ledger_immutable() RETURNS TRIGGER AS $$
BEGIN
  IF TG_LEVEL = 'ROW' THEN
    RAISE EXCEPTION '% is append-only -- % rejected (id=%); correct by appending a new row', TG_TABLE_NAME, TG_OP, OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RAISE EXCEPTION '% is append-only -- % rejected; correct by appending a new row', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER valuation_event_no_update BEFORE UPDATE ON valuation_event FOR EACH ROW EXECUTE FUNCTION economic_ledger_immutable();
CREATE TRIGGER valuation_event_no_delete BEFORE DELETE ON valuation_event FOR EACH ROW EXECUTE FUNCTION economic_ledger_immutable();
CREATE TRIGGER valuation_event_no_truncate BEFORE TRUNCATE ON valuation_event FOR EACH STATEMENT EXECUTE FUNCTION economic_ledger_immutable();

CREATE TRIGGER decision_event_no_update BEFORE UPDATE ON decision_event FOR EACH ROW EXECUTE FUNCTION economic_ledger_immutable();
CREATE TRIGGER decision_event_no_delete BEFORE DELETE ON decision_event FOR EACH ROW EXECUTE FUNCTION economic_ledger_immutable();
CREATE TRIGGER decision_event_no_truncate BEFORE TRUNCATE ON decision_event FOR EACH STATEMENT EXECUTE FUNCTION economic_ledger_immutable();
