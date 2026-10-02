-- =====================================================================
-- 0037 -- GK-279: capture-time PHYSICAL COPY DISAMBIGUATION record
-- =====================================================================
-- PHYSICAL IDENTITY != CATALOGUE SIMILARITY. When a capture resembles an already-owned
-- physical asset, the OPERATOR decides SAME_COPY or ANOTHER_COPY. That decision is durable
-- (this table), server-validated, and idempotent per capture action. It is an operator
-- physical-identity decision -- not model truth, and it asserts nothing about grade/value.
--
-- Append-only (history appends; current state derives). Additive, rerunnable. No existing
-- row is touched. Reuses learning_ledger_immutable() (0035) for the immutability triggers.
-- =====================================================================

SET search_path TO data1_dev;

CREATE TABLE IF NOT EXISTS physical_copy_decision_event (
  id                          UUID PRIMARY KEY DEFAULT uuidv7(),
  principal_id                UUID NOT NULL REFERENCES gk_principal(id),
  choice                      TEXT NOT NULL CHECK (choice IN ('SAME_COPY','ANOTHER_COPY')),
  incoming_collection_item_id TEXT NOT NULL,
  candidate_gk_asset_ids      UUID[] NOT NULL CHECK (cardinality(candidate_gk_asset_ids) >= 1),
  selected_gk_asset_id        UUID REFERENCES gk_asset(id),
  resulting_gk_asset_id       UUID NOT NULL REFERENCES gk_asset(id),
  capture_idempotency_key     TEXT NOT NULL,
  rule_version                TEXT NOT NULL,
  decided_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (principal_id, capture_idempotency_key),
  CHECK ((choice = 'SAME_COPY') = (selected_gk_asset_id IS NOT NULL)),
  CHECK (choice <> 'SAME_COPY' OR (resulting_gk_asset_id = selected_gk_asset_id AND selected_gk_asset_id = ANY (candidate_gk_asset_ids))),
  CHECK (choice <> 'ANOTHER_COPY' OR NOT (resulting_gk_asset_id = ANY (candidate_gk_asset_ids)))
);

CREATE INDEX IF NOT EXISTS physical_copy_decision_event_principal_idx ON physical_copy_decision_event (principal_id, decided_at DESC);

CREATE OR REPLACE TRIGGER physical_copy_decision_event_no_update BEFORE UPDATE ON physical_copy_decision_event FOR EACH ROW EXECUTE FUNCTION learning_ledger_immutable();
CREATE OR REPLACE TRIGGER physical_copy_decision_event_no_delete BEFORE DELETE ON physical_copy_decision_event FOR EACH ROW EXECUTE FUNCTION learning_ledger_immutable();
CREATE OR REPLACE TRIGGER physical_copy_decision_event_no_truncate BEFORE TRUNCATE ON physical_copy_decision_event FOR EACH STATEMENT EXECUTE FUNCTION learning_ledger_immutable();
