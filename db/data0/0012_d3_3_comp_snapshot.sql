-- =====================================================================
-- 0012 -- D3.3: durable comp snapshots (PROPOSED, NOT APPLIED to data1_dev)
-- =====================================================================
-- STATUS: proposed by this dispatch (D3.3 Phase A), NOT yet run against
-- any database. Per the standing "never modify historical migrations"
-- rule, this is a NEW additive file -- 0001 through 0011 are untouched.
-- Applying this migration to live data1_dev requires explicit
-- authorization (D3.3 Phase B, not this pass) -- see the D3.3 Standing
-- Report for the real, isolated-scratch-schema proof that stands in for
-- a live data1_dev round-trip until that authorization is granted.
--
-- CONTRACT (GrailKey Physical Asset Protocol v1, Foundation Law 5 --
-- "Market = observations -> valuation"): a comp snapshot is the durable,
-- immutable evidence set a valuation was actually computed from.
-- valuation_event.comp_snapshot_ref (0004, nullable TEXT, currently
-- unpopulated by anything -- confirmed, D1 audit) can now point at a
-- real comp_snapshot.id -- stored as TEXT (comp_snapshot_ref's own
-- column type is NOT altered here; comp_snapshot.id::text is what a
-- future writer would store there). This is a SOFT reference by design,
-- not a hard FK -- 0004 is not touched, per the standing migration
-- discipline (never edit historical migration files).
--
-- SCOPE, deliberately bounded (this is NOT D5 MarketObservation): one
-- generic table only. No MarketObservation -> applicability ->
-- MarketPopulation -> ValuationEvent -> EconomicProjection architecture
-- is built here. `payload` is a single opaque JSONB blob -- the minimum
-- generic structure needed to preserve an evidence set faithfully,
-- deliberately NOT decomposed into comic-specific columns (no `issue`,
-- `grade`, `publisher`, etc. anywhere in this file). D5 can later
-- formalize MarketObservation/MarketPopulation on top of this without
-- losing any historical information already captured here.
--
-- IMMUTABILITY -- stronger than this schema's existing convention-only
-- pattern (the rest of db/data0/'s append-only tables rely on "no
-- repository.js function ever issues UPDATE," spot-checked, not DB-
-- enforced -- see the Protocol doc's own "Append-only" invariant). This
-- table adds REAL, DB-enforced immutability via trigger: once a row
-- exists, UPDATE and DELETE both raise a real exception. Repricing
-- creates a NEW comp_snapshot row (new evidence) referenced by a NEW
-- valuation_event row -- it never mutates the old one. The old snapshot
-- remains readable, permanently, once written.
--
-- REVERSIBILITY -- every statement below is reversible without any risk
-- to existing data: this table does not exist yet, so DROP TRIGGER /
-- DROP FUNCTION / DROP TABLE (the rollback, db/data0/
-- 0012_d3_3_comp_snapshot_rollback.sql) removes exactly what this file
-- adds and nothing else. No other table's DDL, data, or constraints are
-- touched by this migration.
-- =====================================================================

SET search_path TO data1_dev;

CREATE TABLE comp_snapshot (
  id                        UUID PRIMARY KEY,
  asset_id                  UUID NOT NULL REFERENCES gk_asset(id),
  -- Provenance: where this evidence set came from. Generic string, not
  -- an enum -- new sources (future verticals, future providers) never
  -- require a schema change here. Examples today: 'pricecharting-scrape',
  -- 'ebay-browse-api', 'manual'.
  source                    TEXT NOT NULL,
  -- The evidence set itself. Deliberately a single opaque JSONB blob --
  -- the minimum generic structure. Comic-specific shape (issue/grade/
  -- variant-aware comp fields) lives entirely INSIDE this JSON value,
  -- supplied by the caller -- never as a column on this table.
  payload                   JSONB NOT NULL,
  -- SHA-256 of the canonical JSON of `payload`, for integrity/dedup
  -- detection -- mirrors src/modules/media/'s own content-addressing
  -- discipline (contentAddress.js), applied here to evidence instead of
  -- bytes.
  content_hash              TEXT NOT NULL,
  recorded_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by_principal_id  UUID NOT NULL REFERENCES gk_principal(id)
);
CREATE INDEX ON comp_snapshot (asset_id);
CREATE INDEX ON comp_snapshot (content_hash);

CREATE OR REPLACE FUNCTION comp_snapshot_immutable() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'comp_snapshot rows are immutable once written -- % on comp_snapshot.id=% is not permitted (repricing creates a NEW snapshot row; it never mutates an existing one)', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER comp_snapshot_no_update BEFORE UPDATE ON comp_snapshot FOR EACH ROW EXECUTE FUNCTION comp_snapshot_immutable();
CREATE TRIGGER comp_snapshot_no_delete BEFORE DELETE ON comp_snapshot FOR EACH ROW EXECUTE FUNCTION comp_snapshot_immutable();
