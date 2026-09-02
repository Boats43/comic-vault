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
-- immutable evidence set a valuation was actually computed from. Once a
-- valuation references a snapshot, that snapshot must remain durably
-- resolvable for it -- immutability of the snapshot alone is
-- insufficient if the reference itself can dangle.
--
-- REVISED (D3.3 Phase A review, R1) -- valuation_event.comp_snapshot_ref
-- (0004, nullable TEXT) is explicitly NOT reused for this. Audited
-- directly against live data1_dev before drafting this revision: of 78
-- valuation_event rows, 10 already carry a non-null comp_snapshot_ref,
-- in two shapes, neither a comp_snapshot row: 8 rows are the literal
-- string "snap-ref-1" (a pre-existing fixture placeholder, resolves to
-- nothing), 2 rows are "scanlog:<correlationId>" (a real pointer into
-- the Upstash Redis KV scanLog cache -- a different persistence layer
-- entirely, not Postgres, not necessarily still live, no durability
-- guarantee). Reusing this same free-text, already-ambiguous column for
-- a NEW durable reference type would make it three-ways ambiguous with
-- no way for a reader to tell which shape a given value is. Instead,
-- this migration adds a NEW, dedicated column --
-- valuation_event.comp_snapshot_id, a REAL foreign key to
-- comp_snapshot(id) -- additive only, comp_snapshot_ref is completely
-- untouched (its existing scanlog/fixture usage, whatever its own
-- merits, is out of this migration's scope to fix). The FK constraint
-- itself is what enforces "S1 remains durably resolvable for V1": a
-- referenced comp_snapshot row can never be deleted (FK) and can never
-- be mutated (the immutability trigger below) -- the two mechanisms
-- together give a genuinely non-dangling guarantee, not merely a
-- documented convention. Deliberately the smallest generic enforcement
-- compatible with a future D5 formalization -- a bare nullable FK
-- column, not D5's own MarketObservation/MarketPopulation architecture.
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
-- to existing data: comp_snapshot does not exist yet (DROP TRIGGER /
-- DROP FUNCTION / DROP TABLE undoes it completely), and the one existing
-- table this migration touches -- valuation_event -- only gains a new,
-- nullable column with no default (DROP COLUMN undoes it, and nothing
-- populates it until paired application code, deferred to Phase B,
-- ships). The rollback, db/data0/0012_d3_3_comp_snapshot_rollback.sql,
-- removes exactly what this file adds, in FK-safe dependency order, and
-- nothing else. No existing valuation_event row, column, or data is
-- altered by adding a new nullable column.
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

-- R1 -- the durable, FK-enforced reference. Additive column on the
-- existing valuation_event table (0004 is not edited, per the standing
-- discipline); nullable (a valuation with no comp evidence -- e.g.
-- operator-override -- legitimately has none); NOT comp_snapshot_ref
-- (see the header comment above for why that column is left alone).
-- Combined with comp_snapshot's own immutability trigger, this FK makes
-- "once V1 references S1, S1 remains durably resolvable for V1" a real,
-- enforced database guarantee, not a documented intention.
ALTER TABLE valuation_event ADD COLUMN comp_snapshot_id UUID REFERENCES comp_snapshot(id);
CREATE INDEX ON valuation_event (comp_snapshot_id);
