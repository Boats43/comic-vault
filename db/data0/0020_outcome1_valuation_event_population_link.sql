-- =====================================================================
-- 0020 -- Outcome #1: link valuation_event to its D5 evidence basis
-- =====================================================================
-- valuation_event (0004, LIVE) already carries comp_snapshot_id (D3.3's
-- generic opaque-JSONB evidence pointer, 0012) but has no way to
-- reference D5's own structured evidence chain (market_population ->
-- valuation_question -> market_observation/applicability, 0014/0016/
-- 0017, all LIVE). Outcome #1 (GrailKey, 2026-09-09) requires a
-- prediction's durable evidence basis to be SQL-reconstructable back
-- to the exact MarketPopulation it was computed from -- comp_snapshot_id
-- cannot express that (it points at a single opaque blob, not D5's own
-- typed membership rows).
--
-- Additive, nullable, reversible. Every one of the 78 existing
-- valuation_event rows (live-queried, all fixture/test data -- GK-180)
-- already carries comp_snapshot_id IS NULL; this column starts the
-- same way for all of them. A caller with no D5 population (an
-- operator-override valuation, or a future comp_snapshot-only source)
-- legitimately leaves this NULL -- not an error, a truthful state.
-- comp_snapshot_id/comp_snapshot_ref are completely untouched -- both
-- linkage mechanisms coexist, per 0012's own header note ("D5 can
-- later formalize MarketObservation/MarketPopulation on top of this
-- without losing any historical information already captured here").
--
-- REVERSIBILITY: adds one nullable FK column + one index to an
-- existing table. No existing row, column, or constraint is altered.
-- Rollback (0020_..._rollback.sql) drops exactly what this file adds,
-- in FK-safe order, and nothing else.
-- =====================================================================

SET search_path TO data1_dev;

ALTER TABLE valuation_event
  ADD COLUMN IF NOT EXISTS market_population_id UUID REFERENCES market_population(id);

CREATE INDEX IF NOT EXISTS valuation_event_market_population_idx
  ON valuation_event (market_population_id);
