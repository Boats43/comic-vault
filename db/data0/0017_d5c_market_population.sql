-- =====================================================================
-- 0017 -- D5C: MarketPopulation (PROPOSED, NOT APPLIED to data1_dev)
-- =====================================================================
-- STATUS: proposed by this dispatch, NOT yet run against any database.
-- Per the standing "never modify historical migrations" rule, this is a
-- NEW additive file -- 0001 through 0016 are untouched. Applying this
-- migration to live data1_dev requires explicit authorization (a future
-- D5C live-apply dispatch, not this pass). Design authority:
-- docs/D5C-MARKET-POPULATION-DESIGN-REPORT.md. No writer, no D5D bridge,
-- no comp_snapshot schema change, no production capture built here.
--
-- CONTRACT: given one immutable ValuationQuestion, which immutable
-- MarketObservation rows constitute the evaluated market population for
-- that question, under which population-construction rule version --
-- and, per Section 10/M2, WHICH APPLICABLE OBSERVATIONS WERE EXCLUDED
-- and why. Applicability (0016) already answers "does this observation
-- apply to this question" -- MarketPopulation answers the DIFFERENT
-- question "among applicable observations, which were SELECTED into
-- this specific evaluation, and which were excluded despite being
-- applicable" (dedup collapse, sample-size cap, thin-pool isolation,
-- etc. -- real, current api/comps.js behavior, classified in the design
-- report's Deliverable A). A membership row recording only "this
-- observation was applicable" would be redundant re-encoding of
-- Applicability and was rejected by M2's information-novelty test --
-- every membership row below carries member_status/exclusion_reason,
-- durable information Applicability alone cannot express.
--
-- ARCHITECTURE (Section 2): Candidate C -- header + membership rows.
-- A pure digest-only "event" row (Candidate A) would fail M3's
-- zero-code historical reproducibility test (a hash proves integrity,
-- never enumerates membership without re-deriving it). A bare
-- membership relation with no header (Candidate B) would have no single
-- place to hold population-level identity (rule version, dedup key) or
-- provenance (principal, correlation_id, recorded_at) without
-- duplicating it onto every member row. Header + typed member rows
-- satisfies M3 directly: every member is a real, individually
-- queryable, permanently joinable row -- no code re-execution is ever
-- required to answer "which MarketObservation rows were in this
-- population."
--
-- M4 -- market_population carries NO asset_id. The canonical path is
-- market_population -> valuation_question -> gk_asset; asset_id already
-- lives NOT NULL on valuation_question (R1, 0016). Duplicating it here
-- would create a divergence risk with no proven benefit -- not solved
-- with a second FK, a trigger, or application convention: simply
-- omitted.
--
-- Q9/Section 9 -- member ORDER is NOT semantically meaningful in this
-- pass: current pipeline behavior (blendedAvg/median-based aggregate
-- statistics, CLAUDE.md "Search query construction"/"Sold comps"
-- sections) consumes the selected set, never a positional rank. No
-- `rank`/`position` column exists on market_population_member. If a
-- future population-construction rule needs true ranking, that is a
-- deliberate, separately-scoped addition -- not assumed here.
-- market_population_hash.js's own memberSetDigest is therefore built
-- ORDER-INSENSITIVE (sorted before hashing, proven by MP-NP11).
--
-- Section 7/V2 precedent -- NO supersession, ruled the same way D5B's
-- Applicability was ruled (D8): a changed population (new rule version,
-- new Applicability judgments, newly arrived MarketObservations) is
-- simply a NEW market_population header row (and its own new member
-- rows) referencing the SAME valuation_question -- never an in-place
-- correction of a historical population. No concrete scenario surfaced
-- requiring one; the burden the dispatch itself set for YES was not
-- met. Both tables below are therefore fully immutable, no carve-out.
--
-- Section 8 -- dedupe via content_hash alone (market-population-hash-v1,
-- src/lib/marketPopulationHash.js), reusing the exact market_
-- observation/valuation_question/applicability precedent: a genuine
-- duplicate execution (identical question, identical rule version,
-- identical resulting member set) collides on content_hash and is
-- rejected (app-layer resolve-or-create); a legitimate reevaluation
-- (anything differs -- rule version, applicability, arrived
-- observations) produces a different memberSetDigest and therefore a
-- new row.
--
-- M1 -- comp_snapshot relationship: M1-A, comp_snapshot as a FUTURE
-- materialized projection of a MarketPopulation. comp_snapshot (0012,
-- LIVE in data1_dev since D3.3 Phase B, 2026-09-02) stores a single
-- OPAQUE JSONB payload -- architecturally incapable of serving as a
-- typed membership relation, and its own header text already states
-- "D5 can later formalize MarketObservation/MarketPopulation on top of
-- this without losing any historical information already captured
-- here." This migration does NOT alter comp_snapshot's schema at all --
-- zero ALTER TABLE against it, zero rewritten historical row, zero new
-- required column. A future comp_snapshot.market_population_id FK
-- (nullable, optional) is explicitly a LATER migration's decision (D5D
-- writer-layer), not built or implied here. All 4 existing comp_
-- snapshot rows and all 78 existing valuation_event rows remain
-- completely untouched by this migration.
--
-- N1 (live-migration gate dispatch, GK-192 declarative closure) --
-- GK-192, as originally banked, disclosed that the 2-way composite FK
-- below (applicability_id, observation_id) proves observation-level
-- consistency but NOT that the cited judgment belongs to the SAME
-- valuation_question this population answers (a Q1-population citing a
-- Q2-judgment was DB-representable). Tested directly, following D4's
-- own discriminator-carrying pattern (a child relation carries the
-- parent discriminator explicitly, constrained equal to BOTH
-- independently-referenced parents via composite FKs, no trigger, no
-- procedural reconciliation): market_population_member now carries its
-- own valuation_question_id column, NOT independently writable in
-- practice -- once market_population_id and applicability_id are set,
-- this column is fully determined by BOTH composite FKs below
-- simultaneously (a pure integrity discriminator, never a second source
-- of truth, per N1-C's own test). GK-192 is CLOSED at the schema level
-- by this redesign -- proven live (tests/d5c-market-population-
-- migration-contract.test.js, MP-NP3b): a population belonging to Q1
-- citing a judgment that actually belongs to Q2 is REJECTED by a real
-- foreign key violation, not delegated to a future writer's own
-- discipline.
-- =====================================================================

SET search_path TO data1_dev;

CREATE TABLE market_population (
  id                          UUID PRIMARY KEY,

  -- R1-style anchor: WHICH durable question this population answers.
  -- No asset_id here (M4) -- reachable via
  -- valuation_question.asset_id.
  valuation_question_id        UUID NOT NULL REFERENCES valuation_question(id),

  -- Generic population-construction-rule identifier/version, e.g.
  -- 'comp-population-v1' -- never comic-specific, mirrors rule_id/
  -- rule_version's own generic-string convention on applicability.
  population_rule_version       TEXT NOT NULL,

  recorded_by_principal_id       UUID NOT NULL REFERENCES gk_principal(id),
  -- One evaluation's header + all its member rows share one
  -- correlation_id -- same A4a batched write-ceremony precedent as
  -- market_observation/applicability.
  correlation_id                  UUID NOT NULL,
  recorded_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),

  content_hash                     TEXT NOT NULL,
  hash_contract_version              TEXT NOT NULL DEFAULT 'market-population-hash-v1'
);

CREATE UNIQUE INDEX market_population_dedup_key ON market_population (content_hash);
CREATE INDEX ON market_population (valuation_question_id);
CREATE INDEX ON market_population (correlation_id);

-- N1 -- id alone is already the PRIMARY KEY; this composite UNIQUE lets
-- market_population_member's own composite FK (below) prove that a
-- member row's stated valuation_question_id matches the SPECIFIC
-- population it belongs to -- half of the two-sided discriminator that
-- closes GK-192.
ALTER TABLE market_population ADD CONSTRAINT market_population_id_question_uk UNIQUE (id, valuation_question_id);

CREATE OR REPLACE FUNCTION market_population_immutable() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'market_population rows are immutable once written -- % on market_population.id=% is not permitted (a changed population is a NEW header row -- no supersession, see the header)', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER market_population_no_update BEFORE UPDATE ON market_population FOR EACH ROW EXECUTE FUNCTION market_population_immutable();
CREATE TRIGGER market_population_no_delete BEFORE DELETE ON market_population FOR EACH ROW EXECUTE FUNCTION market_population_immutable();

-- id alone is already applicability's PRIMARY KEY; this composite
-- UNIQUE is required for market_population_member's own composite FKs
-- (below) to target it -- must exist BEFORE that table is created
-- (same ordering lesson already learned in 0015/0016: Postgres requires
-- the exact referenced column SET to carry its own unique constraint
-- before a composite FK can be declared against it). A single 3-column
-- key (id, observation_id, question_id) closes BOTH the observation-
-- level (MP-NP3) and question-level (N1/GK-192) consistency
-- requirements with one constraint and one FK, rather than two
-- separate 2-column ones.
ALTER TABLE applicability ADD CONSTRAINT applicability_id_observation_question_uk UNIQUE (id, observation_id, question_id);

-- market_population_member -- one row per (population, observation)
-- pair actually evaluated for membership. Records member_status
-- (SELECTED/EXCLUDED) and, for excluded rows, exclusion_reason -- the
-- population-level selection decision Applicability alone cannot
-- express (M2).
--
-- N1/GK-192 (closed) -- valuation_question_id is carried on this row
-- as a pure integrity DISCRIMINATOR, never an independent source of
-- truth: once market_population_id and applicability_id are set, this
-- column's legal value is fully determined by BOTH composite FKs below
-- simultaneously (population's own question via FK1, the cited
-- judgment's own question via FK2) -- the same column cannot
-- simultaneously satisfy "= population's question" and "= judgment's
-- question" unless those two are already equal, so a cross-question
-- construction is structurally unrepresentable, not merely discouraged.
CREATE TABLE market_population_member (
  id                          UUID PRIMARY KEY,

  market_population_id         UUID NOT NULL REFERENCES market_population(id),
  observation_id                 UUID NOT NULL REFERENCES market_observation(id),
  applicability_id                UUID NOT NULL REFERENCES applicability(id),

  -- N1/GK-192 discriminator -- see header. Not independently
  -- meaningful; fully constrained by the two composite FKs below.
  valuation_question_id             UUID NOT NULL,

  member_status                     TEXT NOT NULL CHECK (member_status IN ('SELECTED', 'EXCLUDED')),
  -- Nullable -- only populated for EXCLUDED rows (a SELECTED row has no
  -- exclusion to explain). CHECK enforces the pairing so a SELECTED row
  -- can never silently carry a stale/contradictory reason.
  exclusion_reason                   TEXT,
  CHECK ((member_status = 'SELECTED' AND exclusion_reason IS NULL) OR (member_status = 'EXCLUDED')),

  recorded_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- FK1 (N1/GK-192, population side) -- forces valuation_question_id to
  -- match the SAME question the cited population itself answers.
  FOREIGN KEY (market_population_id, valuation_question_id) REFERENCES market_population (id, valuation_question_id),
  -- FK2 (MP-NP3 + N1/GK-192, judgment side) -- forces observation_id
  -- AND valuation_question_id to match the SAME observation and
  -- question the cited Applicability judgment actually judged, in one
  -- 3-column composite FK.
  FOREIGN KEY (applicability_id, observation_id, valuation_question_id) REFERENCES applicability (id, observation_id, question_id)
);

CREATE UNIQUE INDEX market_population_member_dedup_key ON market_population_member (market_population_id, observation_id);
CREATE INDEX ON market_population_member (market_population_id);
CREATE INDEX ON market_population_member (observation_id);
CREATE INDEX ON market_population_member (applicability_id);

CREATE OR REPLACE FUNCTION market_population_member_immutable() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'market_population_member rows are immutable once written -- % on market_population_member.id=% is not permitted', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER market_population_member_no_update BEFORE UPDATE ON market_population_member FOR EACH ROW EXECUTE FUNCTION market_population_member_immutable();
CREATE TRIGGER market_population_member_no_delete BEFORE DELETE ON market_population_member FOR EACH ROW EXECUTE FUNCTION market_population_member_immutable();

-- =====================================================================
-- D5D contract only (not built here): a future writer can construct one
-- market_population header + its member rows atomically (one
-- transaction, one correlation_id, same batched-ceremony precedent as
-- market_observation/applicability), after Applicability judgments
-- already exist for the candidate pool. No writer, no api/comps.js
-- wiring, no comp_snapshot linkage, exist as of this migration.
-- =====================================================================
