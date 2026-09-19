-- =====================================================================
-- 0028 -- Inventory Authority V1 (canonical migration)
-- =====================================================================
-- GRAILKEY — INVENTORY AUTHORITY V1. Authoritative one-of-one
-- sale-availability state for a physical asset, deliberately SEPARATE
-- from marketplace listing state (outcome_event's LISTED/SOLD/DELISTED/
-- EXPIRED_UNSOLD/ACTIVE_AT_CUTOFF) and from physical-asset lifecycle
-- (gk_asset.status's active/archived/merged-into-other-asset). Neither
-- existing table provides this: outcome_event is per-LISTING history
-- (an asset can accumulate many listing episodes over time, each its
-- own LISTED/terminal pair, with no single queryable "is this asset
-- currently sellable" fact anywhere); gk_asset.status describes the
-- asset's own physical-object lifecycle, never sale authorization.
-- Checked directly before writing this file (no existing
-- current-state/lock table for this purpose exists in the live schema).
--
-- DOCTRINE (binding): listing state != physical inventory state.
-- Marketplace status is never GrailKey inventory authority. This
-- migration's tables record GrailKey's OWN authorization to sell, a
-- fact distinct from "does eBay currently show a listing."
--
-- STATE MODEL: UNMANAGED -> AVAILABLE -> RESERVED -> SOLD, with
-- RESERVED -> AVAILABLE for a legitimate pre-sale release/cancellation.
-- UNMANAGED is represented by the ABSENCE of an inventory_current_state
-- row -- never a literal enum value -- so a missing row can never be
-- silently misread as AVAILABLE by a query that forgets to check for
-- NULL. SOLD is terminal for V1: no CHECK constraint or application
-- code in this migration permits a transition out of SOLD.
--
-- TWO TABLES, SAME "history appends; current state derives" law every
-- other durable GrailKey table in this schema already follows
-- (ownership_event/current_owner, outcome_event/asset_outcome_current):
--   inventory_transition_event -- immutable, one row per real
--     transition, full provenance (reason, channel, external
--     reference, correlation id).
--   inventory_current_state -- a materialized "what is the state right
--     now" projection, ALWAYS written by the exact same transaction
--     that appends the transition_event it points at, NEVER an
--     independent write path. This is also the table atomic
--     reservation locks against (a targeted UPDATE ... WHERE state =
--     'AVAILABLE' is itself the concurrency primitive -- see
--     src/modules/inventory/repository.js's own header for the full
--     CAS discussion; no advisory lock or SELECT...FOR UPDATE is
--     needed because Postgres row-level MVCC already makes a
--     predicated UPDATE atomic).
--
-- REVERSIBILITY: two new, fully independent tables (no existing table
-- altered). Rollback (0028_..._rollback.sql) drops both and nothing
-- else.
-- =====================================================================

SET search_path TO data1_dev;

-- ---------------------------------------------------------------------
-- inventory_transition_event -- immutable. One row per real state
-- transition. Reason is a fixed, CHECK-constrained vocabulary --
-- widening it later (a new legitimate reason) is additive-safe, the
-- same discipline 0023's own header already established for CHECK
-- constraints in this schema.
-- ---------------------------------------------------------------------
CREATE TABLE inventory_transition_event (
  id                        UUID PRIMARY KEY,          -- uuidv7(), minted explicitly (ADR-ID-001)
  gk_asset_id               UUID NOT NULL REFERENCES gk_asset(id),
  prior_state               TEXT NOT NULL CHECK (prior_state IN ('UNMANAGED', 'AVAILABLE', 'RESERVED', 'SOLD')),
  next_state                TEXT NOT NULL CHECK (next_state IN ('UNMANAGED', 'AVAILABLE', 'RESERVED', 'SOLD')),
  reason                    TEXT NOT NULL CHECK (reason IN (
                               'operator-enrollment',        -- UNMANAGED -> AVAILABLE
                               'marketplace-reservation',     -- AVAILABLE -> RESERVED (manual/API-driven only in V1 — see header)
                               'operator-release',             -- RESERVED -> AVAILABLE, legitimate cancellation
                               'authoritative-sale'              -- (AVAILABLE|RESERVED) -> SOLD, from the Outcome Reconciler's own SOLD evidence rule
                             )),
  channel                   TEXT,               -- 'ebay' | NULL; nullable — enrollment/release carry no channel
  external_reference        TEXT,               -- external order/listing id where applicable; nullable
  correlation_id            UUID NOT NULL,
  occurred_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by_principal_id  UUID NOT NULL REFERENCES gk_principal(id),

  -- First-party idempotency (GK-163 class-wide law).
  idempotency_namespace     TEXT NOT NULL,      -- 'inventory-authority-transition'
  idempotency_key           TEXT NOT NULL
);
CREATE UNIQUE INDEX ON inventory_transition_event (idempotency_namespace, idempotency_key);
CREATE INDEX ON inventory_transition_event (gk_asset_id, occurred_at);

-- ---------------------------------------------------------------------
-- inventory_current_state -- materialized projection, rebuilt from
-- inventory_transition_event on every write, inside the SAME
-- transaction. gk_asset_id is the PRIMARY KEY -- exactly the
-- uniqueness a one-of-one asset's current state needs, and exactly
-- what a predicated UPDATE ... WHERE gk_asset_id = $1 AND state = $2
-- locks against for atomic reservation (Postgres serializes concurrent
-- UPDATEs to the same row; the SECOND writer's WHERE predicate is
-- re-evaluated against the row as the FIRST writer left it, so only one
-- concurrent AVAILABLE -> RESERVED attempt can ever succeed).
-- ---------------------------------------------------------------------
CREATE TABLE inventory_current_state (
  gk_asset_id                 UUID PRIMARY KEY REFERENCES gk_asset(id),
  state                       TEXT NOT NULL CHECK (state IN ('AVAILABLE', 'RESERVED', 'SOLD')),  -- UNMANAGED is row-absence, never stored literally
  reserved_by_channel         TEXT,               -- nullable; set only while state = 'RESERVED'
  reserved_external_reference TEXT,               -- nullable; the order/reservation identity holding a RESERVED state — needed to tell "same reservation replay" from "a different, competing reservation"
  as_of_transition_event_id   UUID NOT NULL REFERENCES inventory_transition_event(id),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Open items, named not solved here:
--   * No automatic eBay-driven AVAILABLE -> RESERVED transition exists
--     in V1 — reservation stays manual/API-driven (see this dispatch's
--     own eBay-reservation-pressure finding: no eBay order field
--     combination was found that safely and unambiguously distinguishes
--     "genuinely committed, reservation-worthy" from "PENDING/ambiguous
--     payment processing" without risking a false reservation). A
--     future dispatch may revisit this if eBay's API ever exposes a
--     cleaner signal.
--   * No multi-channel withdrawal action exists — a future invariant
--     (any channel's real reservation blocks competing sale execution
--     elsewhere; authoritative SOLD makes remaining projections
--     candidates for withdrawal) is named, not built, per this
--     dispatch's own explicit scope.
