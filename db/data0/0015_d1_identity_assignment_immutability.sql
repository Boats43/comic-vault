-- =====================================================================
-- 0015 -- D1: asset_identity_assignment immutability repair (PROPOSED,
-- NOT APPLIED to data1_dev)
-- =====================================================================
-- STATUS: proposed by this dispatch, NOT yet run against any database.
-- Per the standing "never modify historical migrations" rule, this is a
-- NEW additive file -- 0001 through 0014 are untouched.
--
-- SPLIT FROM D5B (A1 ruling, GK-188 live-apply gate dispatch,
-- 2026-09-03): this repair was originally proposed as Part 1 of a single
-- combined "0015_d5b_valuation_question_applicability.sql" file. On
-- review, the two changes -- (a) a durable-identity structural repair to
-- an EXISTING live table, and (b) two wholly NEW tables (0016) -- were
-- found to have independent rollback lifecycles: rolling back a future
-- D5B schema defect must never silently remove this D1 protection, and
-- repairing/adjusting this D1 protection must never require touching
-- D5B's own schema. A1 ruled SPLIT (the dispatch's own preferred
-- outcome) rather than accepting the coupling with an explicit-
-- consequence carve-out -- no real migration-infrastructure constraint
-- argued against splitting (this repo's migrations are already
-- independent numbered files; nothing about the numbering scheme
-- requires combining unrelated changes into one file). Full A1
-- reasoning, and the A1-R1/R2/R3 scratch rehearsal proof (each domain's
-- own forward/rollback rehearsed independently, plus the cross-domain
-- isolation proof), are in docs/D5B-LIVE-APPLY-REPORT.md.
--
-- D1 (0015 design pass) required a typed identity anchor such that a
-- ValuationQuestion (0016) asked at T1 (identity X) can never
-- retroactively acquire a T2 correction (identity Y).
-- asset_identity_assignment (db/data0/0004_data1_foundation.sql, live in
-- data1_dev) already has the right SHAPE for this -- an append-only row
-- per identity assignment, with `superseded_by` the sole documented
-- lifecycle mutation -- but that contract was, before this migration,
-- enforced by application convention ONLY. No DB trigger protected it,
-- unlike D4's sibling table asset_identifier_assertion (0013), which has
-- always had one.
--
-- GK188-0 (this pass) traced the real closure mechanism directly rather
-- than assuming it: src/modules/assets/service.js's correctIdentity
-- (:272-320) calls repo.insertIdentityAssignment
-- (src/modules/assets/repository.js:155-169), which (1) INSERTs a new
-- row, then (2) UPDATEs the PRIOR live row -- `UPDATE
-- asset_identity_assignment SET superseded_by = $1 WHERE asset_id = $2
-- AND id != $1 AND superseded_by IS NULL` -- setting ONLY
-- superseded_by, nothing else. This DOES mutate the prior durable row
-- (GK188-0B's condition), which is exactly why the trigger below is
-- COLUMN-SCOPED (only superseded_by may transition NULL -> value) and
-- NOT a blanket "BEFORE UPDATE OR DELETE -> RAISE EXCEPTION" -- the
-- trigger design already matched GK188-0B's expected model before
-- GK188-0 was run as an explicit check; this pass confirmed that
-- match against the real repository code rather than assuming it.
--
-- Freezing a ValuationQuestion to a specific assignment row's id (0016)
-- is only a real guarantee if that row's substantive fields genuinely
-- cannot change after insert -- this migration closes that gap now,
-- rather than shipping 0016's own anchor on top of an unenforced
-- assumption.
--
-- Compatibility with the ONE live write pattern (repository.js:155-169,
-- 171-177): the existing UPDATE statement sets ONLY superseded_by --
-- every other column is left untouched by that statement, so the
-- trigger's IS DISTINCT checks below all evaluate false (no real
-- change) for that exact call shape. Verified by STATIC reading of
-- repository.js in this pass, AND by a real scratch-schema
-- reproduction of that exact UPDATE statement (docs/
-- D5B-LIVE-APPLY-REPORT.md) -- NOT verified against the live data1_dev
-- rows themselves, since this file is not applied there this pass; see
-- that report's GK-188 section for the real read-only census this
-- migration's live-apply authorization is actually gated on.
--
-- A2 (this pass) -- the cycle-guard read below (`SELECT superseded_by
-- ... FOR UPDATE`) IS secondary lock geometry, not a bare reject-all
-- trigger -- concurrency analysis was required and performed (docs/
-- D5B-LIVE-APPLY-REPORT.md, A2 section), not assumed safe merely
-- because D4's asset_identifier_assertion_guard() uses the identical
-- pattern on a different table.
--
-- REVERSIBILITY -- this migration is additive to an EXISTING table with
-- EXISTING rows: the ALTER TABLE / CREATE TRIGGER statements below add
-- structure without rewriting or reading any existing row's content
-- (PostgreSQL does not rewrite table rows to add a trigger or a UNIQUE
-- constraint over already-indexed-shape columns). The rollback,
-- db/data0/0015_d1_identity_assignment_immutability_rollback.sql,
-- removes exactly the constraint and trigger/function added here, and
-- nothing else -- asset_identity_assignment's own rows are never
-- touched by either direction. This migration is NOT safely rollback-
-- able once 0016 has been applied on top of it (0016's composite FK
-- structurally depends on the UNIQUE constraint added here) -- Postgres
-- itself enforces this (a real dependency error, not a silent
-- corruption) -- 0016 must be rolled back first. This is a disclosed,
-- ordered dependency, not undisclosed coupling: rolling back 0016 alone
-- never touches this file's objects (proven, A1-R3); the reverse
-- requires the natural order.
-- =====================================================================

SET search_path TO data1_dev;

-- id alone is already the PRIMARY KEY; Postgres requires the exact
-- referenced column SET to carry its own unique constraint for a
-- composite FK to target it -- identical technique already proven at
-- db/data0/0013_d4_identifier_fabric.sql:270 for asset_identifier_
-- assertion's own self-reference, reused here verbatim (not
-- reinvented) for a different table.
ALTER TABLE asset_identity_assignment ADD CONSTRAINT asset_identity_assignment_id_asset_uk UNIQUE (id, asset_id);

-- Mirrors asset_identifier_assertion_guard() (0013) exactly, adapted to
-- this table's own column set (authority/source/catalog_entity_id in
-- place of identifier_id/resolution_authority) -- same cycle-guard
-- technique (FOR UPDATE lock on the target's own superseded_by before
-- allowing an edge into it), same "only superseded_by may be set" rule,
-- same "never deleted" rule.
CREATE OR REPLACE FUNCTION asset_identity_assignment_guard() RETURNS TRIGGER AS $$
DECLARE target_superseded_by UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'asset_identity_assignment rows are never deleted -- id=% (correct via a new superseding assignment instead)', OLD.id;
  END IF;
  IF OLD.superseded_by IS NOT NULL THEN
    RAISE EXCEPTION 'asset_identity_assignment id=% is already superseded -- no further mutation permitted', OLD.id;
  END IF;
  IF NEW.superseded_by IS NULL THEN
    RAISE EXCEPTION 'asset_identity_assignment id=% -- UPDATE must set superseded_by (no other mutation permitted)', OLD.id;
  END IF;
  IF NEW.asset_id IS DISTINCT FROM OLD.asset_id
     OR NEW.catalog_entity_id IS DISTINCT FROM OLD.catalog_entity_id
     OR NEW.authority IS DISTINCT FROM OLD.authority
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
     OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
  THEN
    RAISE EXCEPTION 'asset_identity_assignment id=% -- only superseded_by may be set; all other fields are immutable after insert', OLD.id;
  END IF;
  SELECT superseded_by INTO target_superseded_by FROM asset_identity_assignment WHERE id = NEW.superseded_by FOR UPDATE;
  IF target_superseded_by IS NOT NULL THEN
    RAISE EXCEPTION 'asset_identity_assignment id=% -- superseded_by target % is itself already superseded; cannot supersede into a non-live row (cycle guard)', OLD.id, NEW.superseded_by;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER asset_identity_assignment_no_update BEFORE UPDATE ON asset_identity_assignment FOR EACH ROW EXECUTE FUNCTION asset_identity_assignment_guard();
CREATE TRIGGER asset_identity_assignment_no_delete BEFORE DELETE ON asset_identity_assignment FOR EACH ROW EXECUTE FUNCTION asset_identity_assignment_guard();
