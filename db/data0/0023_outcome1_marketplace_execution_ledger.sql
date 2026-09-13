-- =====================================================================
-- 0023 -- Outcome #1: the marketplace-execution ledger (LISTED/SOLD/
-- EXPIRED_UNSOLD/DELISTED/ACTIVE_AT_CUTOFF), promoting 0006's own
-- design-draft rather than inventing a competing table.
-- =====================================================================
-- OUTCOME #1 — IMPLEMENTATION PASS (2026-09-12). Per the audit that
-- preceded this migration: 0006_outcome_ledger.sql (design draft, never
-- applied) already named the right shape -- an append-only outcome_event
-- ledger, typed economic columns, "history appends, current state
-- derives." This migration takes 0006's outcome_event table live, with
-- two deliberate, disclosed departures from that draft:
--
-- (1) SCOPE: outcome_type is scoped to exactly the five values this
--     dispatch's own instruction named as required now -- LISTED, SOLD,
--     EXPIRED_UNSOLD, DELISTED, ACTIVE_AT_CUTOFF. 0006's own
--     FEES_FINALIZED/FULFILLMENT_FINALIZED/REALIZED_OUTCOME values are
--     deferred (they need real Finances-API fee data, explicitly out of
--     this pass's scope -- "Do not build Finances yet"), as are
--     PRICE_CHANGED/OFFER_ACCEPTED/RETURNED/REFUNDED (deferred per this
--     dispatch's own explicit instruction: doing so does not destroy
--     observable history -- widening this CHECK constraint later is
--     additive and append-only-compatible, the same append-only law
--     0021 already established for action_code).
--
-- (2) IDEMPOTENCY MECHANISM: 0006 designed its OWN inline
--     idempotency_namespace/idempotency_key columns + unique index,
--     reasoned for a hypothetical future webhook-redelivery source. This
--     table instead reuses the SAME class-wide idempotency_key table +
--     requestFingerprint law every other Asset Service writer already
--     uses (recordValuation/recordDecision/recordOperatorAction, GK-163)
--     -- one idempotency law across the whole module, not two competing
--     ones. If a real webhook-redelivery source is ever added later,
--     0006's own inline-column design remains available as a documented
--     alternative; this migration does not foreclose it.
--
-- LINKAGE (this dispatch's own "REQUIRED LINKAGE" instruction):
-- gk_asset_id -> decision_event_id (nullable: an outcome can be recorded
-- without a known recommendation, e.g. a backfilled historical sale) ->
-- operator_action_event_id (nullable for the same reason, but ALWAYS
-- populated by this dispatch's own real write path) -> channel +
-- external_listing_id (the eBay ItemID, a plain text column -- NOT a
-- marketplace-account FK; that full four-step authorization chain is
-- GK-151's own hard gate, steps 3-4, explicitly NOT built here and NOT
-- required for a single-operator prototype, GK-151's own text) ->
-- outcome_type (the listing's disposition).
--
-- OUTCOME ATTACHMENT RULE (this dispatch, mirrored in
-- src/lib/operatorActionAlignment.js's own header and enforced in code
-- by src/modules/assets/service.js's recordOutcomeEvent): a LISTED
-- outcome_event MUST attach to the specific LIST operator_action_event
-- it executes -- never to a HOLD/PASS row, and never floating unattached
-- to any operator action at all when one is supplied. HOLD rows are
-- preserved, untouched, as historical truth; this migration adds no
-- trigger or constraint that could ever mutate operator_action_event --
-- the attachment rule is enforced at the service layer (read-only check
-- against operator_action_event.action_code), not by a DB-level CHECK,
-- because a CHECK cannot reach across tables without a trigger, and this
-- dispatch's own append-only discipline prefers application-layer
-- enforcement over a novel trigger for a single-row-shape rule.
--
-- ACTIVE_AT_CUTOFF / right-censoring: no new column is needed to
-- represent "this listing was still active as of some observation time"
-- -- occurred_at on an ACTIVE_AT_CUTOFF row IS that observation/cutoff
-- timestamp (the instant a GetItem-style check last confirmed the
-- listing was still live). A non-sale is a real, first-class outcome
-- row here, not an absence of one.
--
-- asset_outcome_current (0006's own materialized "current state"
-- projection): DEFERRED, disclosed, not silently dropped. It is a pure
-- read-side projection, rebuildable from outcome_event at any time with
-- zero data loss risk -- this pass ships the append-only source of
-- truth first per "smallest next implementation"; the projection is
-- additive follow-on work once real query patterns against this table
-- are known.
--
-- REVERSIBILITY: one new, fully independent table (no existing table
-- altered). Rollback (0023_..._rollback.sql) drops it and nothing else.
-- =====================================================================

SET search_path TO data1_dev;

CREATE TABLE outcome_event (
  id                       UUID PRIMARY KEY,
  gk_asset_id              UUID NOT NULL REFERENCES gk_asset(id),
  decision_event_id        UUID REFERENCES decision_event(id),
  operator_action_event_id UUID REFERENCES operator_action_event(id),
  outcome_type             TEXT NOT NULL CHECK (outcome_type IN (
                              'LISTED', 'SOLD', 'EXPIRED_UNSOLD',
                              'DELISTED', 'ACTIVE_AT_CUTOFF'
                            )),
  channel                  TEXT NOT NULL,       -- 'ebay' today; free-text, not CHECK-restricted, so a future channel needs no migration
  external_listing_id      TEXT,                -- the marketplace's own listing id (eBay ItemID) -- plain text, NOT a marketplace-account FK (GK-151 steps 3-4, out of scope)
  ask_amount               NUMERIC(12,2),
  ask_currency             TEXT NOT NULL DEFAULT 'USD',
  gross_amount             NUMERIC(12,2),
  fees_amount              NUMERIC(12,2),
  shipping_amount          NUMERIC(12,2),
  net_amount               NUMERIC(12,2),
  days_to_sale             INT,
  recorded_by_principal_id UUID NOT NULL REFERENCES gk_principal(id),
  occurred_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id           UUID NOT NULL
);

CREATE INDEX ON outcome_event (gk_asset_id, occurred_at);
CREATE INDEX ON outcome_event (decision_event_id);
CREATE INDEX ON outcome_event (operator_action_event_id);
CREATE INDEX ON outcome_event (outcome_type, occurred_at);

-- Defense in depth alongside the shared idempotency_key table: two
-- DIFFERENT idempotency keys must never be able to produce two LISTED
-- (or two SOLD) rows for the same real external listing.
CREATE UNIQUE INDEX outcome_event_listing_type_uidx
  ON outcome_event (external_listing_id, outcome_type)
  WHERE external_listing_id IS NOT NULL;
