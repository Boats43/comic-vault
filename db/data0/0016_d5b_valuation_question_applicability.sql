-- =====================================================================
-- 0016 -- D5B: ValuationQuestion + Applicability (PROPOSED, NOT APPLIED
-- to data1_dev)
-- =====================================================================
-- STATUS: proposed by this dispatch, NOT yet run against any database.
-- Per the standing "never modify historical migrations" rule, this is a
-- NEW additive file -- 0001 through 0015 are untouched. Requires 0015
-- (asset_identity_assignment immutability repair) already applied --
-- this file's composite FK on valuation_question depends on the
-- UNIQUE(id, asset_id) constraint 0015 adds. Design authority:
-- docs/adr/ADR-VALUATION-001-question-applicability.md (banked 5d667fc,
-- V1-V4 addendum 30d001d). This file implements ONLY ValuationQuestion +
-- Applicability -- no MarketPopulation, no comp_snapshot/valuation_event
-- wiring, no writer. Those are D5C/D5D, deliberately not built here.
--
-- SPLIT FROM 0015 (A1 ruling, GK-188 live-apply gate dispatch,
-- 2026-09-03): originally proposed as Part 2/3 of a single combined
-- "0015_d5b_valuation_question_applicability.sql" file, alongside the
-- asset_identity_assignment repair. Split so that rolling back a D5B
-- schema defect (this file) can never silently remove 0015's D1
-- protection, and so 0015's own rollback lifecycle is never entangled
-- with this file's. Full A1 reasoning and the independent scratch
-- rehearsal proof for each file: docs/D5B-LIVE-APPLY-REPORT.md.
--
-- =====================================================================
-- PART 1 -- valuation_question
-- =====================================================================
-- D2 field admission (ADR-VALUATION-001 R2, mechanically applied to
-- fetchComps()'s live 22-parameter surface, api/comps.js:998-1029):
-- exactly 4 semantic assumption fields survive ("does changing it
-- change what a correct answer would be") -- target_grade, disposition,
-- variant_scope, target_year. D2 re-audit (this dispatch): does the
-- identity anchor (0015) already establish variant/year, making a
-- duplicate column here redundant? NO -- asset_identity_assignment
-- carries only asset_id/catalog_entity_id/authority/source, no variant
-- or year field at all, so both remain genuinely distinct valuation
-- assumptions, not copies of identity. The other 18 fetchComps() inputs
-- (title, issue, author, publisher, assetType, imageSearchTitle,
-- labelType, categoryId, appId, certId, creator, cvVolumeStartYear,
-- artistOverride, signedConsensus, issueAuthorityPresent,
-- issueAuthorityStatus, yearIsContested, plus COMP_FILTER_VERSION/
-- modelVersion per R3) do NOT participate -- query/credential/
-- reconciliation/filter-implementation state, never persisted here. See
-- ADR-VALUATION-001's field classification table for the per-field
-- reasoning.
--
-- D3/V4 -- target_grade is NUMERIC(12,6), the exact same generic bound
-- and canonicalization discipline (canonicalMinimalDecimal, "9.4" and
-- "9.40" hash identically) as market_observation.grade_numeric -- no
-- new decimal convention invented. grade_basis is a nullable,
-- source-asserted qualifier, same normalizeText discipline as
-- market_observation.grade_basis (F2/F2a) -- "target 9.4 CGC" and
-- "target 9.4 raw-estimate" are different questions even though the
-- numeric target is identical; confirmed NOT already covered by
-- disposition alone (the live pricing math's own CGC_MULTIPLIERS/
-- RAW_MULTIPLIERS split, CLAUDE.md "Grade multipliers (era-aware)", is
-- the same coarse raw-vs-graded boolean, no finer grading-authority
-- distinction exists today).
--
-- disposition is nullable, not NOT NULL -- api/comps.js's own isGraded
-- parameter is genuinely tri-state today (true/false/undefined all
-- reachable, api/comps.js:1051-1052: `rawOnly = isGraded === false;
-- gradedOnly = isGraded === true;` -- neither true when isGraded is
-- undefined, meaning "no preference," a real existing state). Forcing
-- NOT NULL here would demand a decision the current pipeline does not
-- require.
--
-- V3 -- content_hash follows vq-hash-v1 (src/lib/valuationQuestionHash
-- .js), which imports its byte-framing primitive (encodeField) directly
-- from src/lib/canonicalHashFraming.js -- the SAME module mo-hash-v1
-- now uses (marketObservationHash.js was refactored to the identical
-- shared primitive in the same pass this file was originally proposed
-- in, zero behavior change, proven by tests/d5a-market-observation-
-- hash-serializer.test.js rerun unchanged). Tuple: version tag,
-- asset_id, identity_assignment_id, target_grade, grade_basis,
-- disposition, variant_scope, target_year. COMP_FILTER_VERSION/
-- modelVersion/every other transient fetchComps() input NEVER
-- participates (R3/GK-185).
--
-- R1 -- asset_id NOT NULL FK -> gk_asset(id), no exception carved out
-- for a hypothetical future assetless acquisition workflow (ADR-
-- VALUATION-001 R1's own reasoning: relaxing NOT NULL later is
-- additive; tightening it later is not).
--
-- No valuation RESULT column (D10's own instruction, restated here for
-- this table too) -- a ValuationQuestion is what is being asked, never
-- an answer.

SET search_path TO data1_dev;

CREATE TABLE valuation_question (
  id                        UUID PRIMARY KEY,

  -- R1 -- WHICH physical instance.
  asset_id                  UUID NOT NULL REFERENCES gk_asset(id),

  -- D1 (0015) -- WHAT GrailKey believed that instance was, frozen to
  -- one immutable asset_identity_assignment row (never "current
  -- identity" -- a live JOIN to the un-superseded row would let a later
  -- correction retroactively change what an existing question means;
  -- referencing the specific row's id, DB-guaranteed immutable by
  -- 0015's trigger, prevents that structurally).
  identity_assignment_id    UUID NOT NULL,

  -- D2/D3/V4 -- see header.
  target_grade              NUMERIC(12, 6),
  grade_basis                TEXT,
  disposition                TEXT CHECK (disposition IS NULL OR disposition IN ('raw', 'graded')),
  variant_scope               TEXT,
  -- Plain INTEGER -- a year is definitionally integral in every
  -- vertical this kernel might ever serve (comics, coins, stamps,
  -- cards); no NUMERIC(x,y) scale ambiguity to resolve, unlike grade.
  -- Canonicalized via the same canonicalMinimalDecimal function grade
  -- uses (a bare integer is a zero-fractional-digit case of the exact
  -- same base-10 rule -- no separate year-canonicalization function
  -- was written; see src/lib/canonicalHashFraming.js's own doc comment).
  target_year                 INTEGER,

  recorded_by_principal_id    UUID NOT NULL REFERENCES gk_principal(id),
  recorded_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  content_hash                 TEXT NOT NULL,
  hash_contract_version          TEXT NOT NULL DEFAULT 'vq-hash-v1',

  -- D1 -- cross-asset identity anchoring impossible at DB level. A
  -- plain FK on identity_assignment_id alone cannot express "and the
  -- same asset_id" -- this composite FK, against the UNIQUE(id,
  -- asset_id) added by 0015, forces the referenced identity-assignment
  -- row to belong to the SAME asset_id this question itself asserts.
  -- Exact same technique D4 Ruling 21 used for asset_identifier_
  -- assertion's own same-asset integrity fix (db/data0/0013:283,
  -- FOREIGN KEY (superseded_by, asset_id) REFERENCES asset_identifier_
  -- assertion (id, asset_id)). REQUIRES 0015 already applied.
  FOREIGN KEY (identity_assignment_id, asset_id) REFERENCES asset_identity_assignment (id, asset_id)
);

-- R4/R5 -- content-hash-only dedup, no raw-column prefix needed (unlike
-- market_observation's provider/provider_item_id prefix, which exists
-- specifically for that table's NULL-provider_item_id multiplicity
-- case -- asset_id and identity_assignment_id here are both NOT NULL
-- and already participate in the hash tuple itself, so hash-alone
-- already scopes correctly). Asking the identical semantic question
-- again does not mint a second row (R4, no ValuationAttempt table);
-- app-layer resolve-or-create is the contract over a collision, exactly
-- market_observation's own documented contract.
CREATE UNIQUE INDEX valuation_question_dedup_key ON valuation_question (content_hash);
CREATE INDEX ON valuation_question (asset_id);
CREATE INDEX ON valuation_question (identity_assignment_id);

-- R1 -- immutable. A ValuationQuestion's assumptions never change in
-- place; a different assumption is a different (or re-derived-identical,
-- via the dedup index above) question.
CREATE OR REPLACE FUNCTION valuation_question_immutable() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'valuation_question rows are immutable once written -- % on valuation_question.id=% is not permitted (a different assumption is a different question, or the identical one via the dedup index)', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER valuation_question_no_update BEFORE UPDATE ON valuation_question FOR EACH ROW EXECUTE FUNCTION valuation_question_immutable();
CREATE TRIGGER valuation_question_no_delete BEFORE DELETE ON valuation_question FOR EACH ROW EXECUTE FUNCTION valuation_question_immutable();

-- =====================================================================
-- PART 2 -- applicability
-- =====================================================================
-- D6/V1 -- verdict and confidence are two independent columns, never
-- collapsed into one enum (precedent: ADR-IDENTIFIER-001 Ruling 8's
-- issuing_authority/resolution_authority split -- "rejected with high
-- confidence" and "applicable but contested" must both be
-- representable). Named `confidence_tier`, deliberately NOT `authority`
-- -- reusing that word risked silently reaching for D4's resolution_
-- authority VOCABULARY (NONE/CONTESTED/CORROBORATED), which describes
-- how many independent sources corroborate an IDENTITY claim, a
-- different concept from how much weight a SINGLE rule-based judgment's
-- own verdict deserves. confidence_tier uses its own generic, disjoint
-- vocabulary (LOW/MEDIUM/HIGH) so a reader can never assume shared
-- semantics with D4's column by name OR by value set.
--
-- "Machine rule vs operator override" (also flagged in review) is a
-- real, separate axis too -- but it is WHO/WHAT produced the judgment
-- (provenance, D10), not HOW CONFIDENT that judgment is (confidence_
-- tier) -- modeled here as source_type, alongside rule_id/rule_version/
-- model_version, not folded into confidence_tier. An automated rule and
-- an operator override can each independently be LOW, MEDIUM, or HIGH
-- confidence; the two axes are orthogonal by construction (2 x 3 = 6
-- representable combinations, none forced). GK-189 (permanent note,
-- banked at live-apply time): source_type is PROVENANCE, not
-- PRECEDENCE -- it does not establish that an operator-override
-- judgment defeats or outranks an automated one; that behavior, if ever
-- needed, requires an explicit modeled rule, never an inference from
-- this column's value.
--
-- D7 -- verdict's CHECK constraint below allows ONLY APPLICABLE and
-- NOT_APPLICABLE -- CONTESTED is never a persisted verdict value.
-- "Contested" is a READ-TIME derived concept over the primitive rows
-- (see applicability_contested_pairs below) -- preferred over storing a
-- third verdict state or a derived aggregate row, per this dispatch's
-- own instruction to prefer preservation of primitive claims.
--
-- D8/V2 -- NO supersession. Ruled out entirely, not deferred: an
-- Applicability judgment is not a standing claim that must be
-- correctable in place (unlike a D4 identifier assertion) -- a new
-- judgment under a new rule/model version is naturally a NEW row over
-- the same (observation_id, question_id) pair (D9), and "current" is a
-- query ordered by rule_version/model_version/recorded_at, never a
-- mutation. This is the SAME philosophy market_observation already
-- uses for a "provider correction" (D5A's own precedent: a corrected
-- occurred_on is a new immutable row, the original untouched -- never
-- superseded_by). No concrete scenario surfaced in this pass requiring
-- same-rule-version in-place correction; if one does later, that is a
-- deliberate, separately-scoped addition, never a default import of
-- D4's trigger/FOR UPDATE-lock/40P01-retry surface. Consequence: this
-- table's immutability trigger (below) rejects ALL UPDATE/DELETE
-- unconditionally -- there is no "only superseded_by may change"
-- carve-out, because there is no mutable field at all. (Contrast
-- directly with 0015's asset_identity_assignment_guard, which DOES have
-- exactly one such carve-out -- this table intentionally has none.)
--
-- D9 -- explicitly NO UNIQUE(observation_id, question_id) -- multiple
-- judgments per pair are legal and expected (a rule-version bump, a
-- model-version bump, or a genuinely independent second opinion each
-- produce additional, legitimately distinct rows). "Same judgment
-- replay" (a retry after a network blip, or an identical re-run
-- reaching an identical conclusion) is instead prevented by a per-row
-- content hash (applicability-hash-v1, src/lib/applicabilityHash.js),
-- UNIQUE-indexed alone -- the exact market_observation dedup mechanism,
-- reused rather than reinvented, applied to a tuple that already
-- includes observation_id/question_id/verdict/confidence_tier/rule_id/
-- rule_version/model_version/source_type/reason. WHO recorded an
-- otherwise-identical judgment (recorded_by_principal_id) is EXCLUDED
-- from the hash, same treatment mo-hash-v1 already gives its own
-- recorded_by_principal_id -- provenance/attribution, not judgment
-- content.
--
-- D10 -- provenance columns below are the minimum needed to make a
-- judgment intelligible later: which observation, which question,
-- verdict, confidence_tier, rule_id/rule_version/model_version,
-- source_type, principal, reason, recorded_at. No comic-specific
-- field. No provider query parameter. No value/result column.
--
-- D11/GK-186 -- this schema places NO cap on row count per batch or per
-- (observation, question) pair -- soldVerification.js's own
-- rejectedSamples<3 transient debug cap (GK-186) must never become a
-- durable persistence limit; nothing here enforces or implies one. A
-- future D5D writer evaluating 83 observations against one question is
-- structurally free to persist up to 83 judgment rows (one per
-- observation, more if multiple rule/model passes run) -- this
-- migration places no obstacle to full accounting, though it does not
-- itself write anything (no writer built here).
CREATE TABLE applicability (
  id                        UUID PRIMARY KEY,

  observation_id             UUID NOT NULL REFERENCES market_observation(id),
  question_id                 UUID NOT NULL REFERENCES valuation_question(id),

  -- D7 -- exactly two primitive verdict states.
  verdict                      TEXT NOT NULL CHECK (verdict IN ('APPLICABLE', 'NOT_APPLICABLE')),

  -- V1 -- independent confidence axis, deliberately not named/valued
  -- like D4's resolution_authority (see header).
  confidence_tier               TEXT NOT NULL CHECK (confidence_tier IN ('LOW', 'MEDIUM', 'HIGH')),

  -- D10 -- generic rule/filter identifier, e.g. 'comp-filter' -- never
  -- comic-specific. rule_version/model_version independently nullable
  -- -- not every judgment mechanism is versioned the same way (a
  -- pure-rule judgment may have no model_version; a model-only
  -- judgment may have no rule_version).
  rule_id                       TEXT NOT NULL,
  rule_version                   TEXT,
  model_version                   TEXT,

  -- Separate from confidence_tier -- WHO/WHAT produced the judgment
  -- (the "machine rule vs operator override" axis raised in review),
  -- not how confident it is. GK-189: provenance, never precedence.
  source_type                     TEXT NOT NULL CHECK (source_type IN ('automated', 'operator-override')),

  reason                            TEXT,

  recorded_by_principal_id           UUID NOT NULL REFERENCES gk_principal(id),
  -- D12 -- one evaluation batch's judgments share one correlation_id,
  -- same A4a batched write-ceremony ruling market_observation already
  -- uses -- individual judgment provenance stays recoverable via a
  -- plain SELECT WHERE correlation_id = X, even though the future
  -- writer's event/idempotency ceremony is batched, not per-row (no
  -- writer built here -- this column exists so that future ceremony has
  -- somewhere to attach).
  correlation_id                      UUID NOT NULL,
  recorded_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),

  content_hash                         TEXT NOT NULL,
  hash_contract_version                  TEXT NOT NULL DEFAULT 'applicability-hash-v1'
);

CREATE UNIQUE INDEX applicability_dedup_key ON applicability (content_hash);
CREATE INDEX ON applicability (observation_id);
CREATE INDEX ON applicability (question_id);
CREATE INDEX ON applicability (correlation_id);

-- D8/V2 -- full immutability, no carve-out (see header -- no field on
-- this table is ever mutable, unlike asset_identity_assignment's
-- superseded_by-only exception, added by 0015).
CREATE OR REPLACE FUNCTION applicability_immutable() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'applicability rows are immutable once written -- % on applicability.id=% is not permitted (a new judgment under changed rule/model logic is a NEW row -- D8 rules out supersession entirely)', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER applicability_no_update BEFORE UPDATE ON applicability FOR EACH ROW EXECUTE FUNCTION applicability_immutable();
CREATE TRIGGER applicability_no_delete BEFORE DELETE ON applicability FOR EACH ROW EXECUTE FUNCTION applicability_immutable();

-- D7 -- declarative proof that "contested" is expressible purely as a
-- read over the primitive judgment rows: a (observation_id,
-- question_id) pair appears here exactly when it carries at least one
-- APPLICABLE row and at least one NOT_APPLICABLE row. Not wired into
-- any consumer in this pass (no runtime wiring) -- exists so D7's
-- ruling is proven structurally representable, not merely claimed.
CREATE VIEW applicability_contested_pairs AS
SELECT observation_id, question_id
FROM applicability
GROUP BY observation_id, question_id
HAVING COUNT(DISTINCT verdict) > 1;

-- =====================================================================
-- D13 -- D5C compatibility (not built here): MarketPopulation is
-- constructible from explicit immutable Applicability judgments alone
-- -- SELECT observation_id FROM applicability WHERE question_id = ? AND
-- verdict = 'APPLICABLE' (optionally filtered to the latest rule_
-- version per D9's "current is a query" model) is a complete, correct
-- population query against this schema as written. No
-- MarketObservation -> ValuationEvent shortcut exists or is implied.
--
-- D14 -- D5D contract only (not built here): a future writer can
-- eventually (a) carry a real gkAssetId (R1's asset_id), (b) establish
-- the exact identity anchor (D1's identity_assignment_id, 0015), (c)
-- resolve-or-create the semantic ValuationQuestion via content_hash
-- (R4/R5), (d) preserve every eligible MarketObservation (0014, already
-- live), (e) persist every applicability outcome, not a sampled subset
-- (D11/GK-186 -- nothing in this schema obstructs full accounting), (f)
-- retain true provider retrieval time (market_observation.observed_at,
-- 0014 -- GK-184 remains the hard gate on threading it through the
-- cache layer correctly), (g) avoid any rejectedSamples-style
-- truncation (D11). GK-182 and GK-184 remain hard D5D gates, unaffected
-- by this migration.
-- =====================================================================

-- =====================================================================
-- REVERSIBILITY -- every statement above is reversible without risk to
-- existing data: neither valuation_question nor applicability existed
-- before this file, so DROP undoes them completely. This migration
-- touches ZERO rows/columns of any pre-existing table (0001-0015) --
-- confirmed: this file contains no ALTER TABLE statement at all,
-- unlike 0015, which this file depends on but does not modify further.
-- The rollback, db/data0/0016_d5b_valuation_question_applicability_
-- rollback.sql, removes exactly what this file adds, in FK-safe
-- dependency order, and nothing else -- safe to run at any time without
-- affecting 0015's own objects (proven, A1-R3).
-- =====================================================================
