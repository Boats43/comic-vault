-- =====================================================================
-- 0025 -- Outcome #1 CLOSER: durable realized-economics components.
-- =====================================================================
-- OBJECTIVE: CLOSED-LOOP ECONOMIC OUTCOMES 0 -> 1. This migration adds
-- the piece outcome_event (0023) deliberately did NOT try to be: a
-- durable record of the individual economic facts (gross/fees/shipping/
-- refund/credit) that together compose a realized sale's net proceeds,
-- arriving incrementally and from two possible regimes (real eBay
-- Finances API data, or operator-entered manual facts) -- NEVER
-- collapsed into a single mutable "net" field.
--
-- WHY A SEPARATE TABLE, NOT MORE outcome_event COLUMNS: outcome_event
-- (0023) already has gross_amount/fees_amount/shipping_amount/
-- net_amount columns from 0006's original draft, but those model "one
-- snapshot, known at write time." Real economics do not arrive that
-- way -- gross proceeds are known the moment eBay confirms a sale
-- (immediate), fees/shipping are typically known only later via the
-- Finances API (days after), and a refund/credit can arrive weeks
-- after that. A single outcome_event row cannot honestly represent
-- "this fact arrived on this date, from this source" for each
-- component independently without being mutated -- which this
-- schema's whole append-only law forbids. A dedicated, append-only
-- component ledger, one row per fact, solves this without ever
-- rewriting a prior row.
--
-- OUTCOME_EVENT.NET_AMOUNT REMAINS UNUSED BY THIS DESIGN (disclosed,
-- not a defect): realized net is always DERIVED by summing this
-- table's rows for a given outcome_event_id at read time
-- (SUM(gross) - SUM(fees) - SUM(shipping) - SUM(refund) + SUM(credit)),
-- never stored as a second, potentially-stale copy of the same fact.
--
-- SOURCE DISCIPLINE (this dispatch's own explicit instruction —
-- "do not permit manual entry to masquerade as API-sourced evidence"):
-- every row is tagged source IN ('api-sourced','operator-entered').
-- Nothing here ever infers or upgrades one into the other.
--
-- ORDER LINKAGE (this dispatch's "eBay ItemID -> completed-checkout
-- order -> orderId" instruction): external_order_id lives on this
-- table, not on outcome_event, for the same incremental-arrival reason
-- -- Fulfillment API order confirmation can arrive on its own component
-- row (component_type='order_reference', amount NULL) independently of
-- when gross/fees/etc. are known, without ever needing to revise the
-- original SOLD outcome_event row.
--
-- GENERALITY (this dispatch's own note): channel/component semantics
-- are not eBay-specific -- the same table can later record economics
-- for a legitimate external/private sale (a different outcome_event's
-- channel), without a new table, though building that broader product
-- is explicitly out of scope for this pass.
--
-- REVERSIBILITY: one new, fully independent table (no existing table
-- altered). Rollback (0025_..._rollback.sql) drops it and nothing else.
-- =====================================================================

SET search_path TO data1_dev;

CREATE TABLE outcome_economics_component (
  id                       UUID PRIMARY KEY,
  outcome_event_id         UUID NOT NULL REFERENCES outcome_event(id),
  component_type           TEXT NOT NULL CHECK (component_type IN (
                              'gross', 'fees', 'shipping', 'refund', 'credit', 'order_reference'
                            )),
  -- NULL only for component_type='order_reference' (a pure linkage fact,
  -- no dollar amount of its own) -- enforced below, not merely by convention.
  amount                   NUMERIC(12,2),
  currency                 TEXT NOT NULL DEFAULT 'USD',
  source                   TEXT NOT NULL CHECK (source IN ('api-sourced', 'operator-entered')),
  -- api-sourced: the real Finances/Fulfillment transaction or order id
  -- this component came from. operator-entered: free-text evidence
  -- reference (e.g. "eBay sale email 2026-10-14", a screenshot filename,
  -- a shipping receipt number) -- never treated as authoritative provenance.
  source_reference         TEXT,
  -- The real eBay order id, when known -- populated on the
  -- component_type='order_reference' row primarily, but also settable
  -- on any component row that independently confirms it (e.g. a
  -- Finances transaction row that itself names the order id).
  external_order_id        TEXT,
  recorded_by_principal_id UUID NOT NULL REFERENCES gk_principal(id),
  -- occurred_at: when the economic event REALLY happened (e.g. the
  -- Finances transaction's own posted date, or the date an operator
  -- says a refund was issued) -- never assumed equal to recorded_at.
  occurred_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id           UUID NOT NULL,
  -- Optional operator note/evidence pointer -- never a substitute for
  -- source_reference's own provenance discipline.
  evidence_note            TEXT,

  CONSTRAINT outcome_economics_component_amount_required_unless_order_ref
    CHECK (component_type = 'order_reference' OR amount IS NOT NULL)
);

CREATE INDEX ON outcome_economics_component (outcome_event_id, occurred_at);
CREATE INDEX ON outcome_economics_component (external_order_id) WHERE external_order_id IS NOT NULL;
