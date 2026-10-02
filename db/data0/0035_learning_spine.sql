-- =====================================================================
-- 0035 -- GK-278: MINIMUM LEARNING SPINE (durable evidence preservation)
-- =====================================================================
-- GRAILKEY LEARNS FROM HISTORY WITHOUT REWRITING HISTORY.
--   MODEL PREDICTION != OPERATOR LABEL != ADJUDICATED AUTHORITY != REALIZED OUTCOME
-- Each is its own fact class. This migration adds:
--   1. model_prediction_event    -- what the SERVER's model actually returned (append-only)
--   2. operator_correction_event -- what the operator changed, with authority before/after
--                                   (append-only; written in the SAME transaction as the
--                                   state mutation it records)
--   3. decision_event.authority_snapshot -- nullable JSONB: the governed facts a decision
--                                   relied on (historical rows stay NULL, NO backfill)
-- Naming is deliberate: an operator correction is a LABEL, never "truth". There is no
-- ground_truth / verified column anywhere. No learning algorithm lives here.
-- Additive only; no existing row is touched. Rerunnable.
-- =====================================================================

SET search_path TO data1_dev;

CREATE OR REPLACE FUNCTION learning_ledger_immutable() RETURNS TRIGGER AS $$
BEGIN
  IF TG_LEVEL = 'ROW' THEN
    RAISE EXCEPTION '% is append-only -- % rejected (id=%); correct by appending a new event', TG_TABLE_NAME, TG_OP, OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RAISE EXCEPTION '% is append-only -- % rejected; correct by appending a new event', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 1. model_prediction_event -- SERVER-WRITTEN ONLY (no HTTP surface writes it).
-- No collection_item_id / gk_asset_id columns on purpose: a scan precedes any
-- catalogue item or physical asset, and an immutable row can never be filled in
-- later. The link is carried by the REFERENCING rows (the item's server-owned
-- modelPredictedProvenance.predictionEventId; operator_correction_event.
-- related_prediction_event_id). No raw image bytes: input_hash only.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS model_prediction_event (
  id               UUID PRIMARY KEY DEFAULT uuidv7(),
  principal_id     UUID NOT NULL REFERENCES gk_principal(id),
  surface          TEXT NOT NULL CHECK (surface IN ('IDENTITY','GRADE','CONDITION','RESEARCH')),
  result_id        UUID NOT NULL,
  provider         TEXT,
  model            TEXT,
  model_version    TEXT,
  prompt_version   TEXT,
  build_sha        TEXT,
  input_hash       TEXT,
  prediction       JSONB NOT NULL CHECK (jsonb_typeof(prediction) = 'object'),
  payload_hash     TEXT NOT NULL,
  usage            JSONB CHECK (usage IS NULL OR jsonb_typeof(usage) = 'object'),
  idempotency_key  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (principal_id, id),
  UNIQUE (principal_id, idempotency_key),
  UNIQUE (principal_id, surface, result_id)
);
CREATE INDEX IF NOT EXISTS model_prediction_event_principal_created_idx ON model_prediction_event (principal_id, created_at DESC);

CREATE OR REPLACE TRIGGER model_prediction_event_no_update BEFORE UPDATE ON model_prediction_event FOR EACH ROW EXECUTE FUNCTION learning_ledger_immutable();
CREATE OR REPLACE TRIGGER model_prediction_event_no_delete BEFORE DELETE ON model_prediction_event FOR EACH ROW EXECUTE FUNCTION learning_ledger_immutable();
CREATE OR REPLACE TRIGGER model_prediction_event_no_truncate BEFORE TRUNCATE ON model_prediction_event FOR EACH STATEMENT EXECUTE FUNCTION learning_ledger_immutable();

-- ---------------------------------------------------------------------
-- 2. operator_correction_event -- an operator LABEL/ACTION, not adjudicated truth.
-- Written in the same transaction as the collection_item authority mutation it
-- records (src/modules/collection). No FK to collection_item (history must outlive
-- an item delete); linkage is enforced at insert by the guard trigger below.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS operator_correction_event (
  id                          UUID PRIMARY KEY DEFAULT uuidv7(),
  principal_id                UUID NOT NULL REFERENCES gk_principal(id),
  collection_item_id          TEXT NOT NULL,
  gk_asset_id                 UUID REFERENCES gk_asset(id),
  surface                     TEXT NOT NULL CHECK (surface IN ('GRADE','GRADING_FORMAT','IDENTITY','CONDITION')),
  action                      TEXT NOT NULL CHECK (action IN ('SET','CLEAR','CORRECT')),
  before_value                JSONB NOT NULL,
  after_value                 JSONB NOT NULL,
  authority_before            JSONB NOT NULL,
  authority_after             JSONB NOT NULL,
  related_prediction_event_id UUID,
  source                      TEXT,
  reason                      TEXT,
  build_sha                   TEXT,
  idempotency_key             TEXT NOT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (principal_id, idempotency_key),
  -- cross-principal prediction linkage is structurally unrepresentable
  FOREIGN KEY (principal_id, related_prediction_event_id) REFERENCES model_prediction_event (principal_id, id)
);
CREATE INDEX IF NOT EXISTS operator_correction_event_item_idx ON operator_correction_event (principal_id, collection_item_id, created_at DESC);

CREATE OR REPLACE FUNCTION operator_correction_event_guard() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM data1_dev.collection_item ci WHERE ci.principal_id = NEW.principal_id AND ci.id = NEW.collection_item_id) THEN
    RAISE EXCEPTION 'operator_correction_event refused: collection_item % does not exist for this principal', NEW.collection_item_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.gk_asset_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM data1_dev.collection_item_link l WHERE l.collection_item_id = NEW.collection_item_id AND l.gk_asset_id = NEW.gk_asset_id) THEN
    RAISE EXCEPTION 'operator_correction_event refused: gk_asset % is not the canonical link of collection_item %', NEW.gk_asset_id, NEW.collection_item_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER operator_correction_event_guard_ins BEFORE INSERT ON operator_correction_event FOR EACH ROW EXECUTE FUNCTION operator_correction_event_guard();
CREATE OR REPLACE TRIGGER operator_correction_event_no_update BEFORE UPDATE ON operator_correction_event FOR EACH ROW EXECUTE FUNCTION learning_ledger_immutable();
CREATE OR REPLACE TRIGGER operator_correction_event_no_delete BEFORE DELETE ON operator_correction_event FOR EACH ROW EXECUTE FUNCTION learning_ledger_immutable();
CREATE OR REPLACE TRIGGER operator_correction_event_no_truncate BEFORE TRUNCATE ON operator_correction_event FOR EACH STATEMENT EXECUTE FUNCTION learning_ledger_immutable();

-- ---------------------------------------------------------------------
-- 3. decision_event.authority_snapshot -- nullable, server-constructed. decision_event
-- stays immutable (0034); adding a column fires no row trigger. Historical rows stay NULL.
-- ---------------------------------------------------------------------
ALTER TABLE decision_event ADD COLUMN IF NOT EXISTS authority_snapshot JSONB;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'decision_event_authority_snapshot_object' AND conrelid = 'data1_dev.decision_event'::regclass) THEN
    ALTER TABLE decision_event ADD CONSTRAINT decision_event_authority_snapshot_object
      CHECK (authority_snapshot IS NULL OR jsonb_typeof(authority_snapshot) = 'object');
  END IF;
END $$;
