-- =====================================================================
-- 0027 -- Buyer Decision Ledger (FINALIZED, real canonical migration)
-- =====================================================================
-- GRAILKEY — DURABLE BUYER DECISION LEDGER V1. Supersedes the prior
-- 0027 design-draft text (banked in git history at commit 0356ba3) with
-- the finalized schema this dispatch's own instruction requires. Applied
-- fresh to Development first (proof), then Production, per this
-- dispatch's own migration discipline -- see the apply scripts and
-- verification report cited in docs/TICKET-REGISTRY.md.
--
-- WHY NO EXISTING TABLE FITS (restated from the prior draft, still true):
-- acquisition_event, valuation_event, decision_event (0004) and
-- outcome_event (0023) are ALL `asset_id`/`gk_asset_id NOT NULL
-- REFERENCES gk_asset(id)`. Buyer Mode decisions are evaluations of
-- something the operator does NOT yet own -- no gk_asset exists at
-- BUY/PASS time. domain_event has no such FK but is a documented
-- derivative envelope over primary events, not a primary store for a new
-- record class. This is a genuine, disclosed schema gap.
--
-- BUY AND PASS ARE EQUALLY DURABLE (this dispatch's own explicit
-- instruction): decision has exactly two values, BUY and PASS, and
-- nothing in this schema treats one as more first-class than the other
-- -- both are ordinary rows in the same append-only table. A PASS is a
-- real economic observation (e.g. "MAX BUY $44, seller asked $60,
-- passed") and is preserved with the identical fidelity as a BUY,
-- including full valuation provenance.
--
-- APPEND-ONLY LAW (binding, same as every other table in this
-- directory): "history appends; current state derives" (0006's own
-- binding law). A recommendation (buyer_decision_event) and a
-- later-recorded actual acquisition (buyer_acquisition_event) are two
-- facts that arrive at different times -- they are therefore two
-- separate immutable rows in two tables, never one row mutated in place.
-- This deliberately does NOT mirror src/App.jsx's own browser-local
-- shortcut (recordActualPurchasePrice(), which merges a field onto an
-- existing localStorage entry) -- that shortcut remains acceptable for
-- ephemeral, single-device, non-durable browser storage; it is not
-- carried into this durable kernel table. No UPDATE statement against
-- either table is part of this design; no application code in this
-- dispatch issues one.
--
-- VALUATION PROVENANCE (this dispatch's own explicit instruction --
-- "do not store only the final number, persist enough evidence to later
-- judge the quality of the recommendation"). Every provenance column
-- below is sourced from a field the pricing system ALREADY exposes on
-- the scan result object (out.pricingSource, out.priceBands.source,
-- out.rawComps.count, out.soldComps.length, out.comps.count,
-- out.matchConfidence.tier/.score, and src/lib/actionAuthority.js's
-- deriveMarketStanding(out) -- EXACT_CURRENT / EXACT_STALE /
-- SIMILAR_ONLY, the exact axis GK-212's Hulk #273 finding showed can
-- diverge from a card's displayed comp count). verified_comp_count is
-- included in the schema because the instruction requires the *column*
-- to exist for future use, but the pricing system does not currently
-- compute or expose any such figure anywhere (confirmed by grep across
-- api/enrich.js, api/comps.js, responseContract.js -- no field named
-- anything resembling "verified comp count" exists) -- every writer in
-- this dispatch passes NULL for it, disclosed rather than invented. All
-- provenance columns are nullable for the same reason: a given scan may
-- not have reached pricing at all (e.g. ID_REQUIRED), and this table
-- must still accept the decision without fabricating evidence that was
-- never computed.
-- =====================================================================

SET search_path TO data1_dev;

-- ---------------------------------------------------------------------
-- buyer_decision_event -- one immutable row per committed BUY or PASS
-- evaluation. Pre-asset by definition: gk_asset_id is nullable and not
-- required -- most rows will never acquire one. session_id is a client-
-- minted correlation UUID grouping decisions made within one Buyer Mode
-- browsing session; it is NOT a foreign key to any session/auth table
-- (no such table exists), purely a grouping value.
-- ---------------------------------------------------------------------
CREATE TABLE buyer_decision_event (
  id                             UUID PRIMARY KEY,          -- uuidv7(), minted explicitly (ADR-ID-001)
  principal_id                   UUID NOT NULL REFERENCES gk_principal(id),  -- who evaluated
  session_id                     UUID NOT NULL,              -- client-minted correlation id, groups decisions in one Buyer Mode session
  gk_asset_id                    UUID REFERENCES gk_asset(id),  -- nullable: pre-asset by definition, see header

  -- Observed identity snapshot -- whatever the pipeline had resolved at
  -- decision time, all nullable (identity may be partial/unresolved).
  observed_title                 TEXT,
  observed_issue                 TEXT,
  observed_publisher             TEXT,
  observed_year                  TEXT,
  observed_variant                TEXT,
  observed_grade                  TEXT,

  market_value_amount             NUMERIC(12,2) NOT NULL,
  market_value_currency            TEXT NOT NULL DEFAULT 'USD',

  contemplated_price_amount        NUMERIC(12,2) NOT NULL,  -- seller ask / contemplated acquisition price at decision time

  -- Economics inputs, snapshotted at decision time -- mirrors
  -- src/lib/maxBuyCalculator.js's own inputs exactly, a durable
  -- projection of that already-shipped math, never a second model.
  fee_pct                          NUMERIC(7,3) NOT NULL,
  supplies_amount                  NUMERIC(12,2) NOT NULL,
  labor_amount                     NUMERIC(12,2) NOT NULL,
  target_profit_amount             NUMERIC(12,2) NOT NULL,

  -- max_buy_amount is nullable: computeMaxBuy() can be valid but
  -- unachievable (negative) -- the true, possibly-negative value is
  -- preserved exactly as computed, never clamped to zero here.
  max_buy_amount                   NUMERIC(12,2),
  net_profit_amount                 NUMERIC(12,2),           -- computeNetProfit() at decision time

  decision                          TEXT NOT NULL CHECK (decision IN ('BUY', 'PASS')),

  -- Valuation provenance -- see header. All nullable; UNKNOWN is stored
  -- as SQL NULL, never as a fabricated value.
  pricing_source                    TEXT,        -- out.pricingSource, raw token (src/lib/sourceLabels.js's own domain)
  price_bands_source                TEXT,        -- out.priceBands.source, raw token
  market_standing                   TEXT CHECK (market_standing IS NULL OR market_standing IN ('EXACT_CURRENT', 'EXACT_STALE', 'SIMILAR_ONLY')),
  sold_comp_count                   INT,         -- out.soldComps.length
  active_comp_count                 INT,         -- out.comps.count
  total_comp_count                  INT,         -- out.rawComps.count (the pool actually behind the price)
  verified_comp_count               INT,         -- NEVER populated in this dispatch -- no such figure exists yet, see header
  match_confidence_tier             TEXT,        -- out.matchConfidence.tier, raw value, no re-derivation
  match_confidence_score            NUMERIC(6,2),-- out.matchConfidence.score

  occurred_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by_principal_id          UUID NOT NULL REFERENCES gk_principal(id),

  -- First-party idempotency (class-wide law, GK-163) -- mobile/network
  -- retries of the same commit must never create a second row.
  idempotency_namespace             TEXT NOT NULL,      -- 'buyer-decision-sync'
  idempotency_key                   TEXT NOT NULL
);
CREATE UNIQUE INDEX ON buyer_decision_event (idempotency_namespace, idempotency_key);
CREATE INDEX ON buyer_decision_event (principal_id, occurred_at);
CREATE INDEX ON buyer_decision_event (session_id);
CREATE INDEX ON buyer_decision_event (gk_asset_id) WHERE gk_asset_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- buyer_acquisition_event -- one immutable row per actual-purchase-price
-- fact, recorded independently and possibly later than the decision it
-- corresponds to. NEVER a column update on buyer_decision_event -- see
-- the append-only law in this file's header. gk_asset_id here is the
-- OPTIONAL later link if/when the purchased item becomes a real durable
-- physical asset (capture is a separate, unrelated process -- this
-- column is populated only if a future, out-of-scope-for-this-dispatch
-- process chooses to set it; nothing in this dispatch writes it).
-- ---------------------------------------------------------------------
CREATE TABLE buyer_acquisition_event (
  id                             UUID PRIMARY KEY,
  buyer_decision_event_id        UUID NOT NULL REFERENCES buyer_decision_event(id),
  actual_purchase_price_amount   NUMERIC(12,2) NOT NULL,
  actual_purchase_currency       TEXT NOT NULL DEFAULT 'USD',
  gk_asset_id                    UUID REFERENCES gk_asset(id),  -- nullable, optional, see above
  occurred_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by_principal_id       UUID NOT NULL REFERENCES gk_principal(id),

  idempotency_namespace          TEXT NOT NULL,      -- 'buyer-acquisition-sync'
  idempotency_key                TEXT NOT NULL
);
CREATE UNIQUE INDEX ON buyer_acquisition_event (idempotency_namespace, idempotency_key);
CREATE INDEX ON buyer_acquisition_event (buyer_decision_event_id, occurred_at);

-- Open items, named not solved here:
--   * No mechanism auto-populates gk_asset_id on either table -- both
--     stay NULL unless/until a future process explicitly links them.
--   * verified_comp_count has no real writer anywhere -- named for
--     future use, always NULL today.
--   * No trigger enforces "at most one buyer_acquisition_event per
--     buyer_decision_event" -- more than one would represent an
--     operator correction and is legal (itself just another appended
--     row, never an edit of a prior one); the API layer's own
--     idempotency law prevents an accidental duplicate of the SAME
--     fact, not a legitimate second, different fact.
