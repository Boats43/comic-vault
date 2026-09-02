-- =====================================================================
-- 0013 -- D4 Phase A: Identifier Fabric (PROPOSED, NOT APPLIED to data1_dev)
-- =====================================================================
-- STATUS: proposed by this dispatch (D4 Phase A), NOT yet run against any
-- database. Per the standing "never modify historical migrations" rule,
-- this is a NEW additive file -- 0001 through 0012 are untouched. Applying
-- this migration to live data1_dev requires explicit authorization (D4
-- Phase B, not this pass) -- see docs/DATABASE-MIGRATION-STATUS.md for the
-- real, isolated-scratch-schema proof that stands in for a live data1_dev
-- round-trip until that authorization is granted.
--
-- RATIFICATION: docs/adr/ADR-IDENTIFIER-001-identifier-fabric.md, Rulings
-- 1-20 (Foundation Law 4, Compatibility Matrix question 3/8). This file
-- implements the ratified MINIMUM slice only (Ruling 7): four tables,
-- physical-asset side only. It deliberately does NOT activate
-- catalog_entity, external_map, the DATA-0 catalog substrate, marketplace
-- identity, or definition-level UNKNOWN->known issuer reconciliation
-- (Ruling 13, explicitly deferred) -- none of those are prerequisites for
-- this slice, and none is a side effect of applying it.
--
-- NAMING REFINEMENT FROM THE RATIFYING ADR: the ADR's own illustrative
-- sketches used `evidence_source`/`asserting_principal_id`. Inspecting
-- the live schema before drafting this file (per Ruling 7's own
-- instruction to check repo convention before DDL) found the established,
-- universal names across every existing evidence/event table
-- (ownership_event, custody_event, media, acquisition_event,
-- condition_observation, valuation_event, comp_snapshot) are `source` and
-- `recorded_by_principal_id` -- used here instead, for consistency. No
-- ratified semantic changed by this rename; the ADR's `issuing_authority`/
-- `resolution_authority` naming ruling (Ruling 8) is preserved exactly,
-- unchanged -- it is the one place a bare `authority` column is
-- deliberately NOT used, per that ruling.
--
-- CONTRACT (ADR-IDENTIFIER-001):
--   asset_identifier                    -- "this scheme+issuer+value is a
--                                           real-world identifier" (Ruling
--                                           4 concept 1, Ruling 12).
--   asset_raw_observation                -- "this raw value was observed
--                                           on this asset" (Ruling 15).
--                                           No identifier_id column exists
--                                           on this table AT ALL -- a
--                                           malformed/unresolved
--                                           observation is fully legal
--                                           here, permanently, without
--                                           ever manufacturing a canonical
--                                           asset_identifier row.
--   asset_identifier_assertion           -- "this canonical identifier is
--                                           asserted of this asset"
--                                           (Ruling 4 concept 2, Ruling
--                                           15). identifier_id is NOT
--                                           NULL, DB-enforced.
--   asset_identifier_assertion_evidence  -- typed many-to-many provenance
--                                           link (Ruling 16) -- required
--                                           because CORROBORATED already
--                                           means "multiple independent
--                                           sources agreed" throughout
--                                           this codebase (identityReconciler.js),
--                                           and a single nullable FK
--                                           cannot name more than one
--                                           supporting observation.
--
-- CORROBORATED CARDINALITY -- binding Phase A ruling, stated explicitly:
-- this migration does NOT enforce `resolution_authority='CORROBORATED' =>
-- evidence_link_count>=2` or any equivalent cross-row cardinality check.
-- The database can count evidence rows; it cannot determine whether they
-- are INDEPENDENT (two reads of the same label by the same scanner are
-- two durable rows and zero independent corroboration). Independence is a
-- reconciliation/service-layer judgment, never inferred from row count at
-- the schema layer. A CORROBORATED assertion with 0, 1, or 2+ evidence
-- links is all structurally legal here, deliberately -- no deferred
-- constraint trigger simulates semantic independence.
--
-- SUPERSESSION GRAPH -- controlled lifecycle mutability, not absolute
-- append-only (Ruling 17). Evidence fields immutable after insert; DELETE
-- always rejected; `superseded_by` is the sole permitted mutation, NULL ->
-- an existing, currently-live (superseded_by IS NULL) target. The target
-- check acquires a real row lock (SELECT ... FOR UPDATE) inside the
-- trigger, held through transaction completion -- proven concurrency-safe
-- against real two-connection races (Ruling 19), not a plain unlocked
-- read. Convergence is legal and intentional: multiple superseded
-- assertions may point at the same live target (in-degree unbounded,
-- out-degree <=1) -- the graph is a forest of in-trees rooted at live
-- assertions, never described as a "chain."
--
-- No mint-basis dependency, ever: this fabric does not touch, extend, or
-- read entity_mint_basis or basis_supersession (Ruling 1). No external
-- identifier of any kind participates in mint-basis construction, and
-- nothing here changes that.
--
-- SAME-ASSET INTEGRITY -- added after an adversarial pre-modification
-- attack against this file's original committed bytes (SHA-256
-- e522de5097fec2e72bea5d45dd96586b42068ab8bf6e5664ca3dd7160a5b5e4d)
-- proved, empirically, that BOTH an evidence link across two different
-- physical assets AND a supersession edge across two different physical
-- assets succeeded -- a real same-asset provenance hole, not merely a
-- hypothetical one. Fixed declaratively, not with a new trigger: both
-- asset_identifier_assertion and asset_raw_observation carry a
-- UNIQUE(id, asset_id) so a composite FK can pin a referencing row's
-- asset_id to match. asset_identifier_assertion.superseded_by is now a
-- composite FK (superseded_by, asset_id) -> (id, asset_id) on itself --
-- a correcting assertion must belong to the same asset, but may
-- legitimately assert a DIFFERENT identifier_id (the ruled invariant is
-- same physical asset, never same external identifier).
-- asset_identifier_assertion_evidence gained an asset_id column with two
-- composite FKs, one to each side, transitively forcing
-- assertion.asset_id = observation.asset_id for every link. None of this
-- adds a new trigger or changes the existing supersession trigger's own
-- locking behavior -- the same FOR UPDATE lock geometry proven under
-- real concurrency is unchanged; Postgres's own FK-existence checking
-- (a FOR KEY SHARE lock on the referenced row) is the only additional
-- locking surface, and was re-verified under real two-connection
-- concurrency after this change, not assumed safe.
--
-- No chronology CHECK -- occurred_at/recorded_at remain independent
-- exactly as D3.2 established (0011); occurred_at is nullable, no
-- default, never inferred from recorded_at, and occurred_at > recorded_at
-- is legal.
--
-- REVERSIBILITY -- none of these four tables exist yet; every statement
-- below is fully reversible (DROP TRIGGER / DROP FUNCTION / DROP TABLE
-- undoes it completely). No existing table is altered by this migration
-- at all -- gk_asset and gk_principal are referenced, never modified. The
-- rollback, db/data0/0013_d4_identifier_fabric_rollback.sql, removes
-- exactly what this file adds, in FK-safe dependency order, and nothing
-- else.
-- =====================================================================

SET search_path TO data1_dev;

-- ---------------------------------------------------------------------
-- asset_identifier -- canonical identifier definition (Ruling 12/13/14).
-- Vertical-neutral: no UPC/ISBN/cert-number/manufacturer/comic/
-- marketplace-specific column anywhere in this table. scheme-specific
-- normalization (GTIN<->GTIN-14, ISBN-10<->ISBN-13) is APPLICATION code
-- (a normalizer registry keyed by scheme), never SQL -- normalized_value
-- is supplied by the caller, already normalized, at insert time.
-- ---------------------------------------------------------------------
CREATE TABLE asset_identifier (
  id                 UUID PRIMARY KEY,
  scheme             TEXT NOT NULL,
  -- The external scheme governor/issuer (e.g. 'GS1', 'CGC', 'PSA', a
  -- specific manufacturer name). NEVER NULL -- reserved sentinel
  -- 'UNKNOWN' for genuinely unresolved issuer state (Ruling 13). Plain
  -- UNIQUE with a nullable column would silently admit duplicate
  -- "unknown-issuer" canonical rows for the same real identifier (NULL
  -- is never equal to NULL under standard uniqueness) -- verified live
  -- against this project's own PostgreSQL 18.6 instance before ruling
  -- this column NOT NULL instead of relying on NULLS NOT DISTINCT.
  issuing_authority  TEXT NOT NULL,
  -- The scheme-canonical form of the value (e.g. GTIN-14-width,
  -- ISBN-13). Computed by application-side normalizer code, never by
  -- this table. Raw, as-observed strings live on asset_raw_observation,
  -- never here (Ruling 15) -- this column is never the sole record of
  -- what was actually read off the physical object.
  normalized_value   TEXT NOT NULL,
  -- Intrinsic to the identifier's own definition, never to an assertion
  -- of it (Ruling 5) -- a GTIN remains PRODUCT_CLASS-scoped whether
  -- attached correctly, attached incorrectly, or attached to nothing.
  -- Deliberately excluded from the uniqueness key below: scheme alone
  -- determines an identifier's semantic scope, so scope cannot
  -- independently disambiguate two otherwise-identical
  -- (scheme, issuing_authority, normalized_value) tuples.
  scope              TEXT NOT NULL CHECK (scope IN
                        ('PRODUCT_CLASS', 'MODEL', 'VARIANT', 'BATCH', 'LOT',
                         'SERIALIZED_INSTANCE', 'CERTIFIED_INSTANCE')),
  recorded_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Ruling 12: manufacturer-serial "12345" issued by two different
-- manufacturers must NOT collapse -- issuing_authority is load-bearing
-- in this key, proven directly against exactly this failure case.
CREATE UNIQUE INDEX asset_identifier_unique ON asset_identifier (scheme, issuing_authority, normalized_value);

-- Full DB-enforced immutability (matches comp_snapshot's own precedent,
-- not asset_identity_assignment's convention-only gap). No supersession
-- lifecycle exists for this table in Phase A -- Ruling 13 requires
-- UNKNOWN -> known issuer resolution to NEVER mutate this row's key in
-- place; this trigger makes that a hard database guarantee rather than
-- an unenforced convention. Definition-level reconciliation, if ever
-- built, mints a NEW row and records a supersession edge in a separate,
-- independent mechanism (Ruling 13) -- it never edits this one.
CREATE OR REPLACE FUNCTION asset_identifier_immutable() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'asset_identifier rows are immutable once written -- % on id=% is not permitted (a resolved/corrected identifier is a new row plus a separate reconciliation record, never an edit)', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER asset_identifier_no_update BEFORE UPDATE ON asset_identifier FOR EACH ROW EXECUTE FUNCTION asset_identifier_immutable();
CREATE TRIGGER asset_identifier_no_delete BEFORE DELETE ON asset_identifier FOR EACH ROW EXECUTE FUNCTION asset_identifier_immutable();

-- ---------------------------------------------------------------------
-- asset_raw_observation -- durable raw evidence (Ruling 15). No
-- identifier_id column exists on this table at all -- resolution
-- success/failure is not a distinction this table needs to make. Fully
-- immutable: no supersession lifecycle, no correction-in-place. A
-- corrected reading is always a NEW row, never an edit of this one.
-- ---------------------------------------------------------------------
CREATE TABLE asset_raw_observation (
  id                        UUID PRIMARY KEY,
  asset_id                  UUID NOT NULL REFERENCES gk_asset(id),
  observed_raw_value        TEXT NOT NULL,
  -- Matches comp_snapshot's own convention: generic string, not an enum
  -- -- new sources never require a schema change here. Examples:
  -- 'barcode-scan', 'vision-ocr', 'operator-entry'.
  source                    TEXT NOT NULL,
  recorded_by_principal_id  UUID NOT NULL REFERENCES gk_principal(id),
  recorded_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  occurred_at               TIMESTAMPTZ
);
CREATE INDEX ON asset_raw_observation (asset_id);
-- Same-asset integrity target (S1, adversarial proof): lets the evidence
-- table's composite FK below force observation.asset_id to match without
-- a trigger. id is already globally unique (PRIMARY KEY); this adds no
-- new uniqueness semantics of its own, only a (id, asset_id) pair a
-- composite FK can reference.
CREATE UNIQUE INDEX asset_raw_observation_id_asset_unique ON asset_raw_observation (id, asset_id);

CREATE OR REPLACE FUNCTION asset_raw_observation_immutable() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'asset_raw_observation rows are immutable once written -- % on id=% is not permitted (a corrected reading is a new row, never an edit)', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER asset_raw_observation_no_update BEFORE UPDATE ON asset_raw_observation FOR EACH ROW EXECUTE FUNCTION asset_raw_observation_immutable();
CREATE TRIGGER asset_raw_observation_no_delete BEFORE DELETE ON asset_raw_observation FOR EACH ROW EXECUTE FUNCTION asset_raw_observation_immutable();

-- ---------------------------------------------------------------------
-- asset_identifier_assertion -- "this canonical identifier is asserted
-- of this physical asset" (Ruling 4 concept 2, Ruling 15).
-- identifier_id NOT NULL by definition -- an unresolved observation
-- belongs in asset_raw_observation, never here.
--
-- No identifier_id/asset_id uniqueness of any kind: a PRODUCT_CLASS
-- identifier (GTIN) may legitimately be asserted on many different
-- physical assets, and one physical asset may legitimately carry many
-- identifiers at different scopes simultaneously (P-A2). Neither
-- direction is constrained by this table.
-- ---------------------------------------------------------------------
CREATE TABLE asset_identifier_assertion (
  id                        UUID PRIMARY KEY,
  identifier_id             UUID NOT NULL REFERENCES asset_identifier(id),
  asset_id                  UUID NOT NULL REFERENCES gk_asset(id),
  source                    TEXT NOT NULL,
  recorded_by_principal_id  UUID NOT NULL REFERENCES gk_principal(id),
  recorded_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  occurred_at               TIMESTAMPTZ,
  -- GrailKey's own resolution-confidence state -- reuses the existing
  -- vocabulary already live at asset_identity_assignment.authority.
  -- Named resolution_authority, never bare `authority` (Ruling 8) --
  -- distinct from issuing_authority above, which is the EXTERNAL
  -- scheme governor, a different concept entirely.
  --
  -- CORROBORATED cardinality is intentionally NOT enforced here (see
  -- this file's own header) -- 0, 1, or 2+ evidence links are all
  -- structurally legal under any resolution_authority value.
  resolution_authority      TEXT NOT NULL CHECK (resolution_authority IN ('NONE', 'CONTESTED', 'CORROBORATED')),
  -- Sole permitted lifecycle mutation, once: NULL -> an existing,
  -- currently-live correcting/replacing assertion (Ruling 9/17). Every
  -- other column above is immutable after insert -- enforced by the
  -- trigger below, not by convention.
  superseded_by             UUID,
  CHECK (superseded_by IS NULL OR superseded_by <> id),
  -- Same-asset FK target for the self-reference below, and for the
  -- evidence table's own composite FKs further down. id alone is
  -- already the PRIMARY KEY, but Postgres requires the exact referenced
  -- column SET to carry its own unique constraint for a composite FK to
  -- target it -- declared here, inline, so it exists before the
  -- self-referencing FK immediately below needs it (a separate
  -- CREATE UNIQUE INDEX statement placed after this CREATE TABLE closes
  -- would be too late for that self-reference).
  UNIQUE (id, asset_id),
  -- Same-asset integrity for supersession (S2, adversarial proof) --
  -- DECLARATIVE, not trigger-based. superseded_by alone (a plain FK to
  -- id) cannot express "and the same asset_id" -- a composite FK against
  -- this table's own (id, asset_id) does, using columns that already
  -- exist on this row: no new column needed. This forces the correcting
  -- target to belong to the SAME physical asset as the row being
  -- superseded -- it says nothing about identifier_id, so a wrong
  -- identifier may still be legitimately corrected by asserting a
  -- DIFFERENT identifier_id on the same asset (per ruling: the invariant
  -- is same physical asset, never same external identifier). NULL
  -- superseded_by trivially satisfies this FK (standard MATCH SIMPLE
  -- NULL handling) -- a live row is unaffected.
  FOREIGN KEY (superseded_by, asset_id) REFERENCES asset_identifier_assertion (id, asset_id)
);
CREATE INDEX ON asset_identifier_assertion (asset_id);
CREATE INDEX ON asset_identifier_assertion (identifier_id);
CREATE INDEX asset_identifier_assertion_live_idx ON asset_identifier_assertion (asset_id) WHERE superseded_by IS NULL;

-- Ruling 19: concurrency-safe target-live enforcement. The target read
-- below is a locking read (FOR UPDATE), held through transaction
-- completion -- proven, under real two-connection concurrency, to
-- prevent the exact A<->B cycle a plain unlocked read allows (including
-- a case where PostgreSQL's own deadlock detector aborts one competing
-- transaction rather than let both commit). Every assertion can acquire
-- at most one outgoing supersession edge, ever; an edge may only target
-- an assertion whose own outgoing edge is still absent. Closing a cycle
-- would require the final edge to target a node that already acquired
-- an outgoing edge earlier in that same cycle -- this check, under this
-- lock, prevents that edge from ever committing. No UUID ordering, no
-- timestamp comparison, no read-time cycle walk.
CREATE OR REPLACE FUNCTION asset_identifier_assertion_guard() RETURNS TRIGGER AS $$
DECLARE target_superseded_by UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'asset_identifier_assertion rows are never deleted -- id=% (correct via a new superseding assertion instead)', OLD.id;
  END IF;
  IF OLD.superseded_by IS NOT NULL THEN
    RAISE EXCEPTION 'asset_identifier_assertion id=% is already superseded -- no further mutation permitted', OLD.id;
  END IF;
  IF NEW.superseded_by IS NULL THEN
    RAISE EXCEPTION 'asset_identifier_assertion id=% -- UPDATE must set superseded_by (no other mutation permitted)', OLD.id;
  END IF;
  IF NEW.identifier_id IS DISTINCT FROM OLD.identifier_id
     OR NEW.asset_id IS DISTINCT FROM OLD.asset_id
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.recorded_by_principal_id IS DISTINCT FROM OLD.recorded_by_principal_id
     OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
     OR NEW.resolution_authority IS DISTINCT FROM OLD.resolution_authority
  THEN
    RAISE EXCEPTION 'asset_identifier_assertion id=% -- only superseded_by may be set; all other fields are immutable after insert', OLD.id;
  END IF;
  SELECT superseded_by INTO target_superseded_by FROM asset_identifier_assertion WHERE id = NEW.superseded_by FOR UPDATE;
  IF target_superseded_by IS NOT NULL THEN
    RAISE EXCEPTION 'asset_identifier_assertion id=% -- superseded_by target % is itself already superseded; cannot supersede into a non-live row (cycle guard)', OLD.id, NEW.superseded_by;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER asset_identifier_assertion_no_update BEFORE UPDATE ON asset_identifier_assertion FOR EACH ROW EXECUTE FUNCTION asset_identifier_assertion_guard();
CREATE TRIGGER asset_identifier_assertion_no_delete BEFORE DELETE ON asset_identifier_assertion FOR EACH ROW EXECUTE FUNCTION asset_identifier_assertion_guard();

-- ---------------------------------------------------------------------
-- asset_identifier_assertion_evidence -- typed, permanent, many-to-many
-- provenance link (Ruling 16). Required because CORROBORATED already
-- means "multiple independent sources agreed" throughout this codebase
-- (src/lib/identityReconciler.js) -- a single nullable FK cannot name
-- more than one supporting observation. Structurally permits (does not
-- require, and no repo evidence claims reachable today) one observation
-- supporting multiple assertions -- the same relation costs nothing
-- extra to allow both directions.
--
-- Same-asset integrity (S1, adversarial proof) -- DECLARATIVE, not
-- trigger-based. Plain single-column FKs to assertion(id) and
-- observation(id) only check existence, not that the two rows belong to
-- the SAME physical asset -- proven exploitable against the original
-- shape of this table (cross-asset evidence link succeeded, no
-- constraint stopped it). Fixed by carrying asset_id on this table and
-- pointing BOTH composite FKs at it: (assertion_id, asset_id) must
-- resolve on asset_identifier_assertion, AND (observation_id, asset_id)
-- must resolve on asset_raw_observation -- since both FKs constrain the
-- SAME asset_id column value on this row, they transitively force
-- assertion.asset_id = evidence.asset_id = observation.asset_id. Holds
-- for every assertion row regardless of lifecycle state (live,
-- superseded, an intermediate chain position, or the target of multiple
-- incoming supersession edges) -- the FK doesn't know or care about
-- superseded_by, it only ever checks (id, asset_id).
-- ---------------------------------------------------------------------
CREATE TABLE asset_identifier_assertion_evidence (
  assertion_id    UUID NOT NULL,
  observation_id  UUID NOT NULL,
  asset_id        UUID NOT NULL REFERENCES gk_asset(id),
  linked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (assertion_id, observation_id),
  FOREIGN KEY (assertion_id, asset_id) REFERENCES asset_identifier_assertion (id, asset_id),
  FOREIGN KEY (observation_id, asset_id) REFERENCES asset_raw_observation (id, asset_id)
);
CREATE INDEX ON asset_identifier_assertion_evidence (observation_id);
CREATE INDEX ON asset_identifier_assertion_evidence (asset_id);

CREATE OR REPLACE FUNCTION asset_identifier_assertion_evidence_immutable() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'asset_identifier_assertion_evidence rows are permanent -- % on (assertion_id=%, observation_id=%) is not permitted', TG_OP, OLD.assertion_id, OLD.observation_id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER asset_identifier_assertion_evidence_no_update BEFORE UPDATE ON asset_identifier_assertion_evidence FOR EACH ROW EXECUTE FUNCTION asset_identifier_assertion_evidence_immutable();
CREATE TRIGGER asset_identifier_assertion_evidence_no_delete BEFORE DELETE ON asset_identifier_assertion_evidence FOR EACH ROW EXECUTE FUNCTION asset_identifier_assertion_evidence_immutable();
