-- =====================================================================
-- 0036 -- GK-278B: explicit learning-corpus EXCLUSION registry + organic projections
-- =====================================================================
-- Certification/test activity creates real, valid, immutable learning events that are NOT
-- organic user data. The events themselves are never modified or deleted. Instead, an
-- explicit, append-only registry (learning_corpus_exclusion) names each such event, and the
-- ORGANIC projection views exclude exactly the registered rows.
--
--   raw immutable history  : model_prediction_event / operator_correction_event  (everything)
--   organic corpus         : organic_model_prediction_event / organic_operator_correction_event
--
-- LAW: any provider bake-off, calibration set, PredictionError evaluation, or aggregate
-- statistic meant to represent organic activity MUST read the organic_* views, never the raw
-- tables. Exclusion is by registered event id only -- never inferred from dates, titles,
-- principals, or behavior.
-- Additive, rerunnable. No existing row is touched.
-- =====================================================================

SET search_path TO data1_dev;

CREATE TABLE IF NOT EXISTS learning_corpus_exclusion (
  id                      UUID PRIMARY KEY DEFAULT uuidv7(),
  event_table             TEXT NOT NULL CHECK (event_table IN ('model_prediction_event','operator_correction_event')),
  event_id                UUID NOT NULL,
  reason_code             TEXT NOT NULL CHECK (reason_code IN ('CERTIFICATION_ARTIFACT','TEST_ARTIFACT')),
  reason                  TEXT NOT NULL,
  ticket                  TEXT NOT NULL,
  certification_date      DATE,
  source_collection_item_id TEXT,
  registered_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_table, event_id)
);

-- The registry is itself append-only: an exclusion can be superseded only by a future,
-- explicitly designed mechanism, never silently rewritten or removed.
CREATE OR REPLACE TRIGGER learning_corpus_exclusion_no_update BEFORE UPDATE ON learning_corpus_exclusion FOR EACH ROW EXECUTE FUNCTION learning_ledger_immutable();
CREATE OR REPLACE TRIGGER learning_corpus_exclusion_no_delete BEFORE DELETE ON learning_corpus_exclusion FOR EACH ROW EXECUTE FUNCTION learning_ledger_immutable();
CREATE OR REPLACE TRIGGER learning_corpus_exclusion_no_truncate BEFORE TRUNCATE ON learning_corpus_exclusion FOR EACH STATEMENT EXECUTE FUNCTION learning_ledger_immutable();

CREATE OR REPLACE VIEW organic_model_prediction_event AS
  SELECT e.* FROM data1_dev.model_prediction_event e
   WHERE NOT EXISTS (SELECT 1 FROM data1_dev.learning_corpus_exclusion x
                      WHERE x.event_table = 'model_prediction_event' AND x.event_id = e.id);

CREATE OR REPLACE VIEW organic_operator_correction_event AS
  SELECT e.* FROM data1_dev.operator_correction_event e
   WHERE NOT EXISTS (SELECT 1 FROM data1_dev.learning_corpus_exclusion x
                      WHERE x.event_table = 'operator_correction_event' AND x.event_id = e.id);
