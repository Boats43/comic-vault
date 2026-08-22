-- =====================================================================
-- 0006 -- The Outcome Ledger (DESIGN DRAFT, NOT APPLIED)
-- =====================================================================
-- DESIGN-ONLY ARTIFACT, same status as 0004_data1_foundation.sql. Not
-- applied to data1_dev or any database as part of this dispatch. Zero
-- lines touched in 0001-0005 -- per the standing "never modify
-- historical migrations" rule (Summit Phase 1 amendment A5), the same
-- discipline every prior file in this directory already restates.
--
-- Full rationale: docs/adr/DATA-1-OUTCOME-LEDGER-DESIGN.md (GrailKey
-- Dispatch 2026-08-23, DATA-1C ADDITION 1) and docs/adr/
-- ADR-EVENT-001-event-model.md, Ruling 22 ("the outcome ledger is
-- first-class, not instrumentation... the exact durability mechanism...
-- is DATA-1 implementation scope, not ratified there -- this ruling
-- states that it MUST become durable, not where"). This file is that
-- "where": Postgres, alongside every other durable DATA-1 record class,
-- for the same reasons 0004's tables live here rather than in the KV
-- cache (see docs/DATA-1-READINESS.md, section C1's "no — Upstash KV is
-- not a sane home for durable asset records" verdict, which applies with
-- identical force to realized-outcome economics).
--
-- BINDING LAW (Addition 1): history appends; current state derives.
-- outcome_event is append-only, exactly like ownership_event and
-- asset_identity_assignment in 0004 -- never one mutable row gradually
-- acquiring listed_at/sold_at/fees/net. asset_outcome_current is a
-- materialized projection, rebuilt FROM the ledger (THE REBUILD RULE,
-- same discipline current_owner already established one layer up), never
-- an independent write path.
--
-- SCHEMA CLOCK ONLY. This migration draft starts the schema clock, not
-- the data clock -- see docs/adr/DATA-1-OUTCOME-LEDGER-DESIGN.md's
-- explicit roadmap gate: minimal real OutcomeEvent capture ships after
-- DATA-1D (durable auth/cross-device) and before the Long Box pilot,
-- bootstrapped from the existing eBay/listing workflow. No capture wiring
-- exists yet; this file defines the table those writes will eventually
-- target.
-- =====================================================================

-- ---------------------------------------------------------------------
-- outcome_event -- immutable. One row per real-world economic fact about
-- an asset's path to (or through) a transaction. Multiple rows over an
-- asset's life, one per outcome_type as each becomes known -- never
-- edited once written.
-- ---------------------------------------------------------------------
CREATE TABLE outcome_event (
  event_id              UUID PRIMARY KEY,          -- uuidv7(), minted explicitly, never a column default (ADR-ID-001)
  gk_asset_id            UUID NOT NULL REFERENCES gk_asset(id),
  decision_event_id       UUID REFERENCES decision_event(id),  -- nullable: an outcome can occur without a prior recorded recommendation (e.g. a pre-DATA-1 sale, backfilled)
  outcome_type              TEXT NOT NULL CHECK (outcome_type IN (
                               'LISTED', 'SOLD', 'FEES_FINALIZED',
                               'FULFILLMENT_FINALIZED', 'REALIZED_OUTCOME'
                             )),
  occurred_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  channel                       TEXT,               -- 'ebay' | 'whatnot' | 'in-person' | ... ; nullable (some outcome_types, e.g. an early LISTED row, may not know the eventual channel's full detail yet)

  -- First-party idempotency (ADR-ID-001) -- the SAME shape as
  -- src/modules/assets/idempotency.js's idempotency_key table, applied
  -- inline here rather than through that module's generalized table:
  -- outcome events are expected to originate from webhook/callback
  -- sources (a marketplace's own "item sold" notification) that may
  -- redeliver, so the dedup key belongs on the row itself, not bolted on
  -- via a side table keyed by (operation, key) the way an interactive
  -- service call is.
  idempotency_namespace          TEXT NOT NULL,      -- e.g. 'ebay-webhook', 'operator-entry', 'listing-workflow-bootstrap'
  idempotency_key                  TEXT NOT NULL,

  -- Typed economic payload -- every column nullable; which ones are
  -- populated depends on outcome_type (a LISTED row has ask_amount and
  -- nothing else yet; a REALIZED_OUTCOME row has the full picture).
  -- Deliberately flat/typed columns, not one JSONB payload blob -- these
  -- are the numbers the 90-day board's metric hierarchy (expected-vs-
  -- realized error, realized profit/operator-hour) queries directly and
  -- repeatedly; JSONB would push that arithmetic into application code on
  -- every read instead of the database's own typed NUMERIC columns.
  ask_amount                         NUMERIC(12,2),
  ask_currency                         TEXT DEFAULT 'USD',
  gross_amount                          NUMERIC(12,2),
  fees_amount                            NUMERIC(12,2),
  shipping_amount                          NUMERIC(12,2),
  net_amount                                NUMERIC(12,2),
  days_to_sale                                INT,          -- computed/backfilled at REALIZED_OUTCOME write time from the asset's own LISTED row, not re-derived on every read

  -- Ruling 21's ratified envelope linkage -- this ledger's own rows are
  -- ADDITIONALLY summarized as domain_event rows (event_type
  -- 'outcome.recorded') per ADR-EVENT-001; domain_event_id is the pointer
  -- back, nullable because a backfilled/historical outcome_event (a sale
  -- that happened before this table existed) may never get a
  -- corresponding live domain_event.
  domain_event_id                              UUID REFERENCES domain_event(event_id),

  recorded_by_principal_id                       UUID NOT NULL REFERENCES gk_principal(id)
);
CREATE UNIQUE INDEX ON outcome_event (idempotency_namespace, idempotency_key);
CREATE INDEX ON outcome_event (gk_asset_id, occurred_at);
CREATE INDEX ON outcome_event (decision_event_id);
CREATE INDEX ON outcome_event (outcome_type, occurred_at);

-- ---------------------------------------------------------------------
-- asset_outcome_current -- a materialized "what's the realized picture
-- for this asset right now" projection. Rebuilt FROM outcome_event on
-- every insert (same convention current_owner already established for
-- ownership_event in 0004), never an independent write path. Nullable
-- columns throughout: an asset with only a LISTED row has a
-- last_listed_at and nothing else yet.
-- ---------------------------------------------------------------------
CREATE TABLE asset_outcome_current (
  gk_asset_id             UUID PRIMARY KEY REFERENCES gk_asset(id),
  last_listed_at           TIMESTAMPTZ,
  last_sold_at               TIMESTAMPTZ,
  last_channel                 TEXT,
  realized_gross_amount          NUMERIC(12,2),
  realized_net_amount              NUMERIC(12,2),
  realized_days_to_sale               INT,
  as_of_outcome_event_id                 UUID NOT NULL REFERENCES outcome_event(event_id),
  updated_at                               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Open items, named not solved here (per this file's own DESIGN DRAFT
-- status -- see the design doc for full discussion):
--   * REALIZED_OUTCOME's days_to_sale/net computation logic (does the
--     service layer compute it from the asset's own prior LISTED/SOLD
--     rows at write time, or is it always caller-supplied) is
--     unspecified -- a DATA-1D-or-later implementation decision, not a
--     schema question.
--   * No FK from outcome_event to a listing/marketplace-account table --
--     none exists yet (GK-151's hard gate territory); `channel` stays a
--     free-text column until that model exists.
