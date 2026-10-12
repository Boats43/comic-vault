-- =====================================================================
-- 0040 -- GK-284: durable OPERATOR_MANUAL authority + marketplace attempt ledger
-- =====================================================================
-- WHY A NEW OBJECT (Dispatch B1 determination): the facts the first operator-approved marketplace listing
-- must preserve CANNOT live in the existing tables.
--   * decision_event.authority_snapshot (0035, das-v1) is DECISION-TIME authority; immutable (0034); NULL on
--     every pre-GK-278 row; the human has not acted yet when it is written.
--   * operator_action_event (0021) records which action and the approved price; it has no place for the
--     acknowledgment, authority type, evidence shown, or what happened at the marketplace.
--   * outcome_event (0023) is an outcome ledger; a refused / failed / ambiguous submission is not an outcome.
-- This table is the EXECUTION-time authority. It references (never alters) those three tables.
--
-- IMMUTABLE VALUE SNAPSHOT (B1-FINAL A1): the AUTHORIZED row carries the COMPLETE approved values itself --
-- exact price in integer cents + currency, asset, operator principal, the engine recommendation at approval,
-- evidence classification + verified sold count, the governing-grade reference (or an explicit uncertainty),
-- the Q41 acknowledgment and warnings, the approval timestamp, the attempt id and the provider correlation ids.
-- Foreign keys remain for navigation and integrity, but NOTHING needs to be joined to reconstruct or verify
-- what was approved: operator_action_event / outcome_event are NOT append-only at the database level (no
-- application path updates or deletes them -- inventoried 2026-10-12 -- but test cleanups do), so this
-- append-only snapshot is the tamper-evident record, and verifyAuthoritySnapshot() detects any divergence.
--
-- One row per attempt PHASE (rows share attempt_id):
--   AUTHORIZED          human approval, recorded BEFORE any marketplace call
--   SUBMITTED           immediately before the provider write
--   LISTED_CONFIRMED    provider returned a listing id
--   FAILED_DEFINITIVE   provider definitively refused (nothing created)
--   AMBIGUOUS           outcome unknown; carries review_due_at (bounded review, owner = principal_id)
--   OPERATOR_RECONCILED an explicit, append-only operator reconciliation (may repeat; the latest governs):
--                       verdict LISTING_FOUND | NOT_FOUND | UNRESOLVED, with observations, evidence reference and
--                       whether a NEW publish is authorized. UNRESOLVED (or an unconvincing NOT_FOUND) is a
--                       CLOSED-BUT-BLOCKED disposition: the attempt is owned and closed, the block is preserved.
--
-- Chain integrity is declarative (composite self-FK). Phase order and policy are enforced by the service in one
-- transaction under a per-asset advisory lock. No function reads any table (no search_path hazard, GK-194).
-- REVERSIBILITY: one new table; rollback drops it. Depends on 0021 and 0034 (economic_ledger_immutable()).
-- =====================================================================

SET search_path TO data1_dev;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = current_schema() AND p.proname = 'economic_ledger_immutable') THEN
    RAISE EXCEPTION '0040 refused: economic_ledger_immutable() does not exist in %, apply 0034 first', current_schema();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS operator_authority_event (
  id                        UUID PRIMARY KEY,
  authorized_event_id       UUID NOT NULL,
  attempt_id                UUID NOT NULL,
  phase                     TEXT NOT NULL CHECK (phase IN ('AUTHORIZED','SUBMITTED','LISTED_CONFIRMED','FAILED_DEFINITIVE','AMBIGUOUS','OPERATOR_RECONCILED')),
  gk_asset_id               UUID NOT NULL REFERENCES gk_asset(id),
  principal_id              UUID NOT NULL REFERENCES gk_principal(id),
  operator_action_event_id  UUID NOT NULL REFERENCES operator_action_event(id),
  decision_event_id         UUID NOT NULL REFERENCES decision_event(id),
  channel                   TEXT NOT NULL CHECK (channel = 'ebay'),
  authority_type            TEXT NOT NULL CHECK (authority_type = 'OPERATOR_MANUAL'),
  -- ---- the immutable approved-value snapshot (AUTHORIZED rows) ----
  approved_amount           NUMERIC(12,2),
  approved_amount_cents     BIGINT,
  approved_currency         TEXT,
  approved_at               TIMESTAMPTZ,
  engine_recommendation     TEXT,
  governing_grade           JSONB,
  evidence_class            TEXT,
  verified_sold_count       INTEGER,
  ack_payload               JSONB,
  ack_warnings              JSONB,
  evidence                  JSONB,
  provider_correlation      JSONB,
  -- ---- later phases ----
  external_listing_id       TEXT,
  detail                    JSONB,
  review_due_at             TIMESTAMPTZ,
  recon_verdict             TEXT CHECK (recon_verdict IS NULL OR recon_verdict IN ('LISTING_FOUND','NOT_FOUND','UNRESOLVED')),
  new_publish_authorized    BOOLEAN,
  reconciliation            JSONB,
  correlation_id            UUID NOT NULL,
  recorded_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT operator_authority_event_chain_uniq UNIQUE (id, gk_asset_id, principal_id, operator_action_event_id, attempt_id),
  CONSTRAINT operator_authority_event_chain_fk FOREIGN KEY (authorized_event_id, gk_asset_id, principal_id, operator_action_event_id, attempt_id)
    REFERENCES operator_authority_event (id, gk_asset_id, principal_id, operator_action_event_id, attempt_id),
  CONSTRAINT operator_authority_event_self_ref CHECK ((phase = 'AUTHORIZED') = (authorized_event_id = id)),
  CONSTRAINT operator_authority_event_authorized_complete CHECK (
    phase <> 'AUTHORIZED' OR (
      approved_amount IS NOT NULL AND approved_amount > 0 AND approved_amount_cents IS NOT NULL
      AND approved_amount_cents = round(approved_amount * 100)::bigint
      AND approved_currency IS NOT NULL AND approved_at IS NOT NULL AND engine_recommendation IS NOT NULL
      AND governing_grade IS NOT NULL AND evidence_class IS NOT NULL
      AND ack_payload IS NOT NULL AND ack_warnings IS NOT NULL AND evidence IS NOT NULL AND provider_correlation IS NOT NULL
    )),
  CONSTRAINT operator_authority_event_json_objects CHECK (
    (ack_payload IS NULL OR jsonb_typeof(ack_payload) = 'object') AND (ack_warnings IS NULL OR jsonb_typeof(ack_warnings) = 'object')
    AND (evidence IS NULL OR jsonb_typeof(evidence) = 'object') AND (detail IS NULL OR jsonb_typeof(detail) = 'object')
    AND (governing_grade IS NULL OR jsonb_typeof(governing_grade) = 'object') AND (provider_correlation IS NULL OR jsonb_typeof(provider_correlation) = 'object')
    AND (reconciliation IS NULL OR jsonb_typeof(reconciliation) = 'object')),
  CONSTRAINT operator_authority_event_listing_id CHECK (
    phase <> 'LISTED_CONFIRMED' OR (external_listing_id IS NOT NULL AND external_listing_id <> '')),
  CONSTRAINT operator_authority_event_ambiguous_review CHECK (phase <> 'AMBIGUOUS' OR review_due_at IS NOT NULL),
  CONSTRAINT operator_authority_event_reconciled_complete CHECK (
    phase <> 'OPERATOR_RECONCILED' OR (
      recon_verdict IS NOT NULL AND new_publish_authorized IS NOT NULL AND reconciliation IS NOT NULL
      AND (recon_verdict <> 'LISTING_FOUND' OR (external_listing_id IS NOT NULL AND external_listing_id <> ''))
      AND (new_publish_authorized = false OR recon_verdict = 'NOT_FOUND')
    )),
  CONSTRAINT operator_authority_event_recon_only_on_reconciled CHECK (
    phase = 'OPERATOR_RECONCILED' OR (recon_verdict IS NULL AND new_publish_authorized IS NULL AND reconciliation IS NULL))
);

-- Every phase appears at most once per attempt EXCEPT operator reconciliations, which may be appended repeatedly
-- (new evidence reopens a closed-but-blocked attempt; the latest event governs).
CREATE UNIQUE INDEX IF NOT EXISTS operator_authority_event_attempt_phase_uniq ON operator_authority_event (attempt_id, phase) WHERE phase <> 'OPERATOR_RECONCILED';
CREATE INDEX IF NOT EXISTS operator_authority_event_asset_idx ON operator_authority_event (gk_asset_id, channel, recorded_at);
CREATE INDEX IF NOT EXISTS operator_authority_event_action_idx ON operator_authority_event (operator_action_event_id);
CREATE INDEX IF NOT EXISTS operator_authority_event_review_idx ON operator_authority_event (review_due_at) WHERE phase = 'AMBIGUOUS';

CREATE OR REPLACE TRIGGER operator_authority_event_no_update BEFORE UPDATE ON operator_authority_event FOR EACH ROW EXECUTE FUNCTION economic_ledger_immutable();
CREATE OR REPLACE TRIGGER operator_authority_event_no_delete BEFORE DELETE ON operator_authority_event FOR EACH ROW EXECUTE FUNCTION economic_ledger_immutable();
CREATE OR REPLACE TRIGGER operator_authority_event_no_truncate BEFORE TRUNCATE ON operator_authority_event FOR EACH STATEMENT EXECUTE FUNCTION economic_ledger_immutable();
