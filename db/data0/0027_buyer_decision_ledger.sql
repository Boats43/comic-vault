-- =====================================================================
-- 0027 -- Buyer Decision Ledger (DESIGN DRAFT, NOT APPLIED)
-- =====================================================================
-- GRAILKEY — BUYER DECISION DURABILITY + AUTOMATIC OUTCOME INGESTION,
-- item 2. DESIGN-ONLY ARTIFACT: not applied to data1_dev or any database
-- as part of this dispatch. No application-layer writer exists yet
-- (App.jsx's BidCalculator still writes only to localStorage,
-- SESSIONS_KEY='cv_buyer_sessions' — see this dispatch's own storage
-- trace, docs/TICKET-REGISTRY.md). This file names the smallest addition
-- that would make Buyer Mode decisions durable and cross-device, and
-- explains why none of the four existing asset-scoped event tables can
-- be reused as-is.
--
-- WHY NO EXISTING TABLE FITS (checked against the real, live schema, not
-- assumed): acquisition_event, valuation_event, decision_event (0004) and
-- outcome_event (0023) are ALL declared `asset_id UUID NOT NULL
-- REFERENCES gk_asset(id)` / `gk_asset_id UUID NOT NULL REFERENCES
-- gk_asset(id)`. Every one of them requires a real, already-minted
-- physical asset to attach to. Buyer Mode decisions are evaluations of
-- something the operator does NOT yet own -- by definition, no gk_asset
-- exists at the moment "BUY" or "PASS" is logged. domain_event (0004)
-- has no such FK and is schema-permissive, but it is documented and used
-- throughout this schema as a derivative ENVELOPE that mirrors other
-- primary event tables' writes (Ruling 21's "envelope linkage") -- it is
-- not itself a primary store for a new record class. Treating it as one
-- here would be exactly the kind of silent doctrine stretch this
-- project's standing rules warn against. This is therefore a genuine,
-- disclosed schema gap, not a wiring gap.
--
-- APPEND-ONLY LAW (binding, same as every other table in this
-- directory): "history appends; current state derives" (0006's own
-- binding law, restated here because it directly shapes this design). A
-- recommendation and a later-recorded actual purchase price are TWO
-- separate facts that arrive at different times -- they are therefore
-- TWO separate immutable rows in TWO tables, never one row that gets a
-- column filled in later. This mirrors ownership_event/current_owner and
-- deliberately does NOT mirror this dispatch's own browser-local
-- shortcut (src/App.jsx's recordActualPurchasePrice(), which does merge
-- a field onto an existing localStorage session entry) -- that shortcut
-- is acceptable for ephemeral, single-device, non-durable browser
-- storage; it is NOT the correct pattern for a durable kernel table, and
-- this design does not carry it over.
--
-- SCOPE: schema only. No writer, no API endpoint, no App.jsx wiring to
-- this table exists in this dispatch. Bringing Buyer Mode's real
-- localStorage sessions durable (cross-device, queryable, feeding future
-- economic learning) is a separate, later, explicitly-gated pass -- named
-- here, not built here, matching the same discipline GK-203 itself used
-- when it deferred Finances-API fee ingestion out of its own scope.
-- =====================================================================

SET search_path TO data1_dev;

-- ---------------------------------------------------------------------
-- buyer_decision_event -- one immutable row per BUY/PASS evaluation.
-- Pre-asset by definition: gk_asset_id is nullable and NOT required --
-- most rows will never acquire one. IF the evaluated item is later
-- actually captured as a real physical asset, a future (not this
-- dispatch's) process may populate gk_asset_id on a NEW row's own write
-- path is not applicable here since this row is immutable once written;
-- linking a buyer decision to a later-minted asset, if ever needed, is a
-- named open item, not solved by mutating this row.
-- ---------------------------------------------------------------------
CREATE TABLE buyer_decision_event (
  id                             UUID PRIMARY KEY,          -- uuidv7(), minted explicitly (ADR-ID-001)
  principal_id                   UUID NOT NULL REFERENCES gk_principal(id),  -- who evaluated
  gk_asset_id                    UUID REFERENCES gk_asset(id),  -- nullable: pre-asset by definition, see header

  observed_title                 TEXT,           -- nullable: identification may be partial/unresolved at buy time
  observed_grade                 TEXT,

  market_value_amount            NUMERIC(12,2) NOT NULL,
  market_value_currency          TEXT NOT NULL DEFAULT 'USD',

  -- Economics inputs, snapshotted at decision time (mirrors
  -- src/lib/maxBuyCalculator.js's own inputs exactly -- this table is a
  -- durable projection of that same, already-shipped math, never a
  -- second/parallel model).
  fee_pct                        NUMERIC(7,3) NOT NULL,
  supplies_amount                NUMERIC(12,2) NOT NULL,
  labor_amount                   NUMERIC(12,2) NOT NULL,
  target_profit_amount           NUMERIC(12,2) NOT NULL,

  -- max_buy_amount is nullable: computeMaxBuy() can be valid but
  -- unachievable (negative) -- the true, possibly-negative value is
  -- preserved here exactly as the calculator computed it, never clamped.
  max_buy_amount                 NUMERIC(12,2),

  contemplated_price_amount      NUMERIC(12,2) NOT NULL,  -- the bid/ask evaluated against
  net_profit_amount              NUMERIC(12,2),           -- computeNetProfit() at decision time

  decision                       TEXT NOT NULL CHECK (decision IN ('BUY', 'PASS')),

  occurred_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by_principal_id       UUID NOT NULL REFERENCES gk_principal(id),

  -- First-party idempotency (same class-wide law as every Asset Service
  -- writer, GK-163) -- a future writer would need this to make a
  -- repeated client-side sync safe; named here rather than added later,
  -- since the whole point of this table is durability, and durability
  -- without idempotency reintroduces exactly the duplicate-write risk
  -- this project has repeatedly had to close elsewhere.
  idempotency_namespace          TEXT NOT NULL,      -- e.g. 'buyer-mode-sync'
  idempotency_key                TEXT NOT NULL
);
CREATE UNIQUE INDEX ON buyer_decision_event (idempotency_namespace, idempotency_key);
CREATE INDEX ON buyer_decision_event (principal_id, occurred_at);
CREATE INDEX ON buyer_decision_event (gk_asset_id) WHERE gk_asset_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- buyer_acquisition_event -- one immutable row per actual-purchase-price
-- fact, recorded independently and possibly much later than the
-- decision it corresponds to. NEVER a column added to
-- buyer_decision_event -- see the append-only law in this file's header.
-- A buyer_decision_event may have zero, one acquisition row (the normal
-- case: BUY, then the operator later records what they actually paid)
-- -- more than one would represent a correction, itself just another
-- appended row, never an edit of a prior one.
-- ---------------------------------------------------------------------
CREATE TABLE buyer_acquisition_event (
  id                             UUID PRIMARY KEY,
  buyer_decision_event_id        UUID NOT NULL REFERENCES buyer_decision_event(id),
  actual_purchase_price_amount   NUMERIC(12,2) NOT NULL,
  actual_purchase_currency       TEXT NOT NULL DEFAULT 'USD',
  occurred_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),  -- when the purchase itself happened, if known; defaults to recording time otherwise
  recorded_by_principal_id       UUID NOT NULL REFERENCES gk_principal(id),

  idempotency_namespace          TEXT NOT NULL,
  idempotency_key                TEXT NOT NULL
);
CREATE UNIQUE INDEX ON buyer_acquisition_event (idempotency_namespace, idempotency_key);
CREATE INDEX ON buyer_acquisition_event (buyer_decision_event_id, occurred_at);

-- Open items, named not solved here:
--   * No FK/mechanism links a buyer_decision_event to the gk_asset later
--     minted from it, beyond the nullable gk_asset_id column above,
--     which nothing populates automatically -- a future capture-time
--     lookup (e.g. by observed_title + occurred_at proximity) is a named
--     idea, not a design.
--   * No server API endpoint, no client sync/writer, no App.jsx wiring.
--     Buyer Mode's real decisions remain localStorage-only until a later,
--     explicitly-gated pass builds and authorizes that sync.
