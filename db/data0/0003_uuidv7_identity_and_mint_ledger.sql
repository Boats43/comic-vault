-- =====================================================================
-- 0003 — UUIDv7 identity revision + mint ledger (DESIGN DRAFT)
-- =====================================================================
-- DESIGN-ONLY ARTIFACT. Not applied to any database. Additive to
-- 0001_generic_substrate.sql / 0002_comic_projection.sql — NEITHER file
-- is edited by this migration, per Summit Phase 1 amendment A5 ("never
-- modify historical migrations"). This file supersedes those files'
-- BIGINT/BIGSERIAL id-column choice, ratified by docs/adr/ADR-ID-001-
-- permanent-identity.md.
--
-- SCOPE, corrected in review (Summit Phase 1, correction pass, C1):
-- catalog permanent identity ONLY — catalog UUID revision, mint ledger/
-- basis, canonical projection UUID FKs, N->M resolution. gk_asset and
-- asset_identity_assignment (ADR-ASSET-001 / ADR-EVIDENCE-001) do NOT
-- belong in this file — their architecture is ratified in those two
-- ADRs, but their DDL belongs to the separately-reviewed DATA-1
-- Foundation dispatch, not this catalog-identity migration. A prior
-- draft of this file included them; removed here, not forgotten —
-- caught in review before any row existed.
--
-- Migration-discovery findings this draft is built against (amendment
-- A5, inspected before drafting, not after):
--   - No migration tooling exists in this repo (no Prisma/Knex/Alembic/
--     runner script) — db/data0/*.sql numbered files ARE the entire
--     migration mechanism, applied by hand.
--   - The real, already-provisioned Neon Postgres instance
--     (GRAILKEY_CATALOG_DATABASE_URL, project polished-frog-12911134,
--     PostgreSQL 18.6, confirmed via a direct read-only SELECT version()
--     during this same dispatch) has ZERO tables in its public schema —
--     0001/0002 have never been applied anywhere, live or otherwise.
--   - Because the real target is empty, this draft is written as a
--     clean redefinition (safe, no data to lose) — but the comments
--     below also state the GENERAL non-empty-environment cutover
--     pattern, since "no BIGINT->UUID fantasy casts" (amendment A5) is a
--     standing rule this project must honor even when today's specific
--     target happens not to need it.
--
-- GENERAL CUTOVER PATTERN (documented, not exercised — table is empty):
-- a real BIGINT->UUID migration on a NON-EMPTY table must never do
-- `ALTER COLUMN id TYPE uuid USING id::uuid` (a bigint has no meaningful
-- mapping to a UUID's own bit structure — this would either error or
-- produce garbage). The safe pattern: (1) add a new UUID column
-- alongside the old BIGINT one, nullable; (2) backfill it via the REAL
-- minting mechanism (this file's own mint_event flow), never a formula;
-- (3) add the new column to all referencing tables, backfilled the same
-- way; (4) swap foreign keys to point at the new column; (5) only then
-- drop the old BIGINT column and its own now-orphaned sequence. Every
-- step is reversible up until step 5. Not needed here because the real
-- target has 0 rows — recorded so a future non-empty cutover doesn't
-- reinvent this under time pressure.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Ruling 5 (ADR-ID-001): catalog_entity revision. id BIGSERIAL -> UUID,
-- no DEFAULT (ADR-ID-001: generation is never a passive column default;
-- the mint script supplies the value explicitly, post idempotency check).
-- ---------------------------------------------------------------------
ALTER TABLE catalog_entity ALTER COLUMN id DROP DEFAULT;
ALTER TABLE catalog_entity ALTER COLUMN id TYPE UUID USING NULL; -- safe: table is empty, verified live
-- (On a non-empty target, this line is exactly the "fantasy cast" A5
-- forbids — see the general cutover pattern above instead.)

-- comic_publisher / comic_series / comic_issue (0002_comic_projection.sql)
-- inherit the same id-type change, since their PKs reference
-- catalog_entity(id) directly.
ALTER TABLE comic_publisher ALTER COLUMN gk_publisher_id TYPE UUID USING NULL;
ALTER TABLE comic_series ALTER COLUMN gk_series_id TYPE UUID USING NULL;
ALTER TABLE comic_series ALTER COLUMN gk_publisher_id TYPE UUID USING NULL;
ALTER TABLE comic_issue ALTER COLUMN gk_issue_id TYPE UUID USING NULL;
ALTER TABLE comic_issue ALTER COLUMN gk_series_id TYPE UUID USING NULL;
ALTER TABLE comic_printing ALTER COLUMN gk_printing_id TYPE UUID USING NULL;
ALTER TABLE comic_printing ALTER COLUMN gk_issue_id TYPE UUID USING NULL;
ALTER TABLE comic_variant ALTER COLUMN gk_variant_id TYPE UUID USING NULL;
ALTER TABLE comic_variant ALTER COLUMN gk_printing_id TYPE UUID USING NULL;
ALTER TABLE comic_issue_creator ALTER COLUMN gk_issue_id TYPE UUID USING NULL;
ALTER TABLE comic_variant_creator ALTER COLUMN gk_variant_id TYPE UUID USING NULL;

-- claim/external_map (0001_generic_substrate.sql) reference
-- catalog_entity(id) too — same type change.
ALTER TABLE claim ALTER COLUMN catalog_entity_id TYPE UUID USING NULL;
ALTER TABLE external_map ALTER COLUMN catalog_entity_id TYPE UUID USING NULL;

-- ---------------------------------------------------------------------
-- Ruling 3 (ADR-ID-001) + amendment A3, REDESIGNED in review (C2), then
-- CORRECTED A SECOND TIME in the Phase-1 final micro-correction (C2-v2).
--
-- REJECTED, round 1 (found in review, before any row existed): the
-- original draft of this file used external_map's own
-- UNIQUE (source, external_id) index as the mint-idempotency primitive.
-- That is wrong at the architecture level, not just as an implementation
-- detail: it would place an EXTERNAL PROVIDER'S identity underneath
-- GrailKey's own first-party permanent identity — the exact dependency
-- this entire architecture exists to remove. It breaks for every case
-- that isn't "an entity with exactly one clean external mapping": an
-- entity synthesized from multiple agreeing claims with no single
-- external ID to key on, a manual entity with no external provider at
-- all, a future vertical with no GCD-analog whatsoever, or a
-- corrected/re-pointed provider mapping (which would silently look like
-- a brand-new, unrelated mint attempt under the old design, since the
-- OLD external_id row would no longer be the one the new claim carries).
-- Caught at zero cost; would have been a migration crisis after real
-- rows existed.
--
-- REJECTED, round 2 (C2-v2, found in the SAME review pass as round 1's
-- fix, before this design was ever committed to `main`): the first
-- correction made entity_mint_basis first-party, but its uniqueness
-- tuple was UNIQUE (namespace, key, version) — including a version
-- component. That is also wrong, for a related but distinct reason: it
-- means a policy/schema update to how a basis key is COMPUTED OR
-- INTERPRETED (e.g. promoting one of the 35 REVIEW-tier convention
-- classes to AUTO-MINT) would silently mint a SECOND, DIFFERENT entity
-- for what is still the same real-world basis — an "entity ID ≠ basis
-- version" violation in the opposite direction from round 1's mistake:
-- round 1 let an external provider's key stand in for GrailKey's own
-- identity; round 2 let GrailKey's own INTERPRETATION metadata leak into
-- what should be a pure identity key.
--
-- CORRECTED (current design): entity_mint_basis's PERMANENT uniqueness
-- invariant is UNIQUE (basis_namespace, basis_key) ONLY. Nothing else —
-- not a schema version, not a policy version, not a reconciliation-rule
-- version — ever participates in this constraint. This is the ONLY
-- thing "have I already minted for this" is ever checked against —
-- never external_map directly, and never widened to include a version
-- axis. External identifiers (GCD id, Metron id, ...) may still
-- participate as CONTENT of a basis key's VALUE for the specific use
-- cases that have them (0E-FULL's own GCD-issue-id case is exactly this
-- — see comment below), but the table/constraint enforcing uniqueness is
-- always this one, first-party, table, on this one two-column tuple —
-- never external_map's own index, never a three-column tuple. An entity
-- with zero external references (a manual entry, a synthesized-consensus
-- entity, a future non-GCD-analog vertical) mints under its own
-- namespace with a basis key built entirely from first-party content —
-- permanent mint semantics never REQUIRE an external ID to exist.
--
-- BINDING INVARIANT (stated here per C2-v2's own requirement, and
-- restated in ADR-ID-001 Ruling 2 — the two statements must never
-- drift apart):
--
--     entity ID  ≠  mint basis  ≠  basis/rule version  ≠  reconciliation version
--
-- Four distinct concepts, four distinct fields, never conflated and
-- never collapsed into one column or one constraint:
--   - entity ID       — catalog_entity.id (UUID). Permanent, external-
--                        facing, never recomputed.
--   - mint basis       — (basis_namespace, basis_key). The permanent,
--                        provider-independent uniqueness tuple. Claimed
--                        once, immutable thereafter (see the basis-key
--                        stability clause below).
--   - basis/rule version — basis_schema_version + mint_policy_version
--                        (below). Provenance/interpretation METADATA
--                        recorded alongside a basis row. Free to change
--                        across mint events; NEVER triggers a new basis
--                        row for the same (namespace, key), and NEVER
--                        participates in the uniqueness check.
--   - reconciliation version — a separate axis entirely (ADR-ID-001
--                        Ruling 2's own "Reconciliation version" row):
--                        the version of the identity-RECONCILIATION
--                        RULES (identityReconciler.js's own logic) that
--                        produced a given CLAIM's resolution. Governs
--                        claim interpretation upstream of minting, not
--                        basis uniqueness — a different concern from
--                        basis/rule version, which governs how the basis
--                        KEY ITSELF was computed/interpreted at mint
--                        time.
--
-- BASIS-KEY STABILITY CLAUSE (binding, C2-v2): basis_key must identify a
-- durable mint basis or invocation, and may NEVER be recomputed from
-- ordinary mutable canonical attributes — title, year, publisher
-- spelling, condition, grade, value, or reconciliation output. Those can
-- all legitimately change without the underlying real-world entity
-- changing; a basis key built from them would silently re-derive to a
-- DIFFERENT string on a routine correction and orphan the original
-- mint. For DATA-0E-FULL, namespace='comic:gcd-issue', key='<GCD issue
-- ID>' is one legitimate source-backed basis type — GCD's own issue ID
-- is durable, first-party-to-GCD, and never recomputed from a comic's
-- mutable descriptive attributes. This does NOT make the external ID
-- GrailKey's own entity ID — it is merely the CONTENT of one basis
-- key's VALUE, under a GrailKey-owned mechanism. Future mint paths
-- requiring NO external provider at all are equally valid basis types,
-- e.g. namespace='operator:manual-canonical-mint' (key = an
-- operator-issued stable token) or namespace='claim-cluster:<strategy>'
-- (key = a stable synthesized-consensus identifier for a strategy-named
-- clustering of agreeing claims with no single external anchor). The
-- mint-basis mechanism is GrailKey-owned; GCD is merely one basis type
-- among possibly many, never a dependency of the mechanism itself.
--
-- BASIS SUPERSESSION / ALIAS MECHANISM (C2-v2): if a future schema
-- change genuinely alters what a given (namespace, key) tuple MEANS —
-- not just how it's interpreted, but which real-world thing it
-- identifies — that is never handled by widening the uniqueness tuple
-- (round 2's mistake) and never by mutating the existing basis row's own
-- namespace/key in place (would violate basis-key stability). Instead,
-- basis_supersession (below) records an explicit edge from the
-- superseded basis row to a superseding basis row; any future basis
-- lookup for the same (namespace, key) resolves through this table to
-- whichever basis row is currently authoritative, walking at most one
-- hop per superseded row (a chain, not a DAG — see the UNIQUE index on
-- superseded_basis_id below) until it reaches a basis row with no
-- outgoing supersession edge. The ORIGINAL basis row and its mint_event
-- history are never deleted or edited — this is the same append-only,
-- resolve-through-a-record discipline Rulings 6-8 already require at the
-- ENTITY level, applied here at the BASIS level, which is a genuinely
-- different granularity (a basis can be superseded without its entity
-- ever merging/splitting, and vice versa).
--
-- TRANSACTIONAL / RACE CONTRACT (stated explicitly, per C2's own
-- requirement — this is a DDL file, so this is the invariant the schema
-- is designed to support; the actual transaction-wrapping is application
-- code in the eventual mint script, not expressible in DDL alone):
--   1. BEGIN.
--   2. INSERT INTO entity_mint_basis (basis_namespace, basis_key, ...)
--      VALUES (...) — if this violates the UNIQUE (basis_namespace,
--      basis_key) constraint (another transaction already claimed this
--      exact basis, concurrently or in the past), catch the conflict,
--      SELECT the existing basis row's entity_id, record a mint_event
--      with outcome='resolved-existing' pointing at it, COMMIT. No new
--      catalog_entity is ever created in this branch — regardless of
--      whether this attempt's basis_schema_version/mint_policy_version
--      differ from the existing row's (they never do — version is
--      metadata, not a re-mint trigger).
--   3. If the INSERT in step 2 succeeded (this transaction won the
--      race), THEN — in the SAME transaction — INSERT the new
--      catalog_entity row and its typed comic_publisher/comic_series/
--      comic_issue row(s), record a mint_event with
--      outcome='minted-new', COMMIT.
--   4. If step 3's entity/typed-row creation fails for any reason after
--      step 2's basis INSERT succeeded, the WHOLE transaction rolls
--      back — the basis claim is undone along with it, so no basis row
--      is ever left pointing at an entity that failed to be created,
--      and no catalog_entity is ever left unclaimed by a basis row.
-- Net effect: the same mint basis, whether attempted concurrently or
-- repeated later, or under a newer basis_schema_version/mint_policy_
-- version, always resolves to exactly ONE entity, and no orphan
-- catalog_entity or entity_mint_basis row can ever exist in a
-- successfully-committed state.
-- ---------------------------------------------------------------------
CREATE TABLE entity_mint_basis (
  id                    UUID PRIMARY KEY,
  entity_id             UUID NOT NULL REFERENCES catalog_entity(id),
  -- Namespace examples: 'comic:gcd-issue' (0E-FULL's own use case — key
  -- = the GCD issue ID, see comment below), 'operator:manual-canonical-
  -- mint' (key = an operator-issued stable token, no external provider
  -- involved), 'claim-cluster:<strategy>' (key = a stable synthesized-
  -- consensus identifier, strategy-named, for claims with no single
  -- external anchor), future non-comic-vertical namespaces with no GCD
  -- analog at all.
  basis_namespace       TEXT NOT NULL,
  -- The normalized, first-party-computed key within that namespace. For
  -- 'comic:gcd-issue', this is the GCD issue ID itself — a durable,
  -- GCD-first-party identifier, never recomputed from this comic's own
  -- mutable descriptive attributes (basis-key stability clause above).
  -- A manual-entry or claim-cluster basis key contains no external id at
  -- all and is equally valid. External identifiers participate as VALUE
  -- content for the basis types that have them — the constraint
  -- mechanism itself never lives on external_map.
  basis_key             TEXT NOT NULL,
  -- --- Everything below this line is PROVENANCE/INTERPRETATION
  -- METADATA. Neither column participates in entity_mint_basis_unique.
  -- Both are free to change on a later re-read of the SAME basis row
  -- (an UPDATE to these two columns only, never to basis_namespace/
  -- basis_key) without that ever constituting a new mint. ---
  -- The schema/format version basis_key's own encoding followed when
  -- this row was written (e.g. did the GCD-issue-id key format include
  -- a checksum suffix at the time). Audit/debugging only.
  basis_schema_version  TEXT NOT NULL,
  -- The AUTO-MINT/REVIEW/RESIDUAL tier policy version in effect at mint
  -- time (e.g. which DATA-0D/0E-PILOT convention-class ruleset decided
  -- this candidate was eligible). Audit/debugging only — a later policy
  -- version reviewing the SAME (namespace, key) never re-mints; it may
  -- only update this metadata column and/or record a new mint_event with
  -- outcome='resolved-existing'.
  mint_policy_version   TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX entity_mint_basis_unique ON entity_mint_basis (basis_namespace, basis_key);
CREATE INDEX ON entity_mint_basis (entity_id);

-- Basis supersession/alias mechanism — see the comment block above.
-- Records that `superseded_basis_id` is no longer the authoritative
-- basis row for whatever it identifies; lookups resolve forward to
-- `superseding_basis_id`. The UNIQUE index on superseded_basis_id keeps
-- resolution a simple chain (each basis row supersedes at most once) —
-- a basis row that has never been superseded simply has no matching row
-- here, and IS the authoritative end of its own chain.
CREATE TABLE basis_supersession (
  id                    UUID PRIMARY KEY,
  superseded_basis_id   UUID NOT NULL REFERENCES entity_mint_basis(id),
  superseding_basis_id  UUID NOT NULL REFERENCES entity_mint_basis(id),
  occurred_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason                TEXT NOT NULL,
  CHECK (superseded_basis_id <> superseding_basis_id)
);
CREATE UNIQUE INDEX basis_supersession_superseded_unique ON basis_supersession (superseded_basis_id);
CREATE INDEX ON basis_supersession (superseding_basis_id);

-- DURABILITY CONTRACT (proof-table row 5, ADR-ID-001): mint_event and
-- entity_mint_basis are the permanent record of every mint decision ever
-- made. If this ledger is ever lost (storage failure, accidental drop,
-- ...), recovery is EXCLUSIVELY via backup/restore of these tables —
-- never by re-running the mint script against the candidate population
-- again. Re-running against a lost ledger would re-derive basis rows via
-- fresh UNIQUE-constraint checks with no prior rows to conflict against,
-- silently minting a SECOND, DIFFERENT set of entity IDs for the same
-- real-world candidates — the exact non-reproducibility this whole
-- design exists to prevent. This is an operational discipline this DDL
-- cannot itself enforce (no schema constraint can require "restore,
-- don't reprocess") — recorded here, and in ADR-ID-001's own invariants,
-- as the binding operational rule.
CREATE TABLE mint_event (
  id                     UUID PRIMARY KEY,           -- its own UUIDv7, generated the same way as any entity id
  occurred_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  contract_version       TEXT NOT NULL,               -- e.g. 'grailkey-0e-full-v1' (ADR-ID-001's CONTRACT_VERSION concept, formalized)
  candidate_snapshot     JSONB NOT NULL,               -- the claim data considered (e.g. the GCD row + Metron row, matching the DATA-0E-PILOT's own provenance.agreeingClaims shape)
  mint_basis_id          UUID REFERENCES entity_mint_basis(id), -- the first-party basis row this attempt matched or created (C2's own mechanism, NOT a raw external-id-derived key) — NULL only for queued-review/residual-no-mint outcomes where no basis was ever claimed
  derivation_key         TEXT,                        -- the canonical normalized name used for candidate matching (ADR-ID-001 Ruling 2) — recorded for audit, distinct from basis_key, never the identity itself
  outcome                TEXT NOT NULL CHECK (outcome IN ('minted-new', 'resolved-existing', 'queued-review', 'residual-no-mint')),
  entity_id              UUID REFERENCES catalog_entity(id), -- NULL for queued-review/residual-no-mint outcomes
  review_convention_class TEXT                        -- populated only when outcome='queued-review' (e.g. 'gcd-legacy-parenthetical-numbering', matching DATA-0D/0E-PILOT's own 3 classes)
);
CREATE INDEX ON mint_event (mint_basis_id);
CREATE INDEX ON mint_event (entity_id);
CREATE INDEX ON mint_event (outcome);

-- ---------------------------------------------------------------------
-- Ruling 4 (ADR-ID-001) + amendment A4: entity_resolution_event, N->M
-- safe via member rows rather than a fixed old-id/new-id column pair.
-- A merge of 3 entities into 1 is 3 'source' rows + 1 'target' row under
-- one resolution_event_id; a split of 1 into 2 is 1 'source' row + 2
-- 'target' rows. No redesign needed for either shape, or for a genuine
-- N->M case (e.g. 2 source entities resolving into 2 different target
-- entities via a re-derivation that reshuffles which claims belong
-- where) — the member-row shape handles all three uniformly.
-- ---------------------------------------------------------------------
CREATE TABLE entity_resolution_event (
  id                UUID PRIMARY KEY,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolution_type   TEXT NOT NULL CHECK (resolution_type IN ('merge', 'split', 'supersession')),
  reason            TEXT NOT NULL,                    -- human-readable: why this resolution happened
  contract_version  TEXT NOT NULL
);

CREATE TABLE entity_resolution_member (
  resolution_event_id  UUID NOT NULL REFERENCES entity_resolution_event(id),
  entity_id            UUID NOT NULL REFERENCES catalog_entity(id),
  role                 TEXT NOT NULL CHECK (role IN ('source', 'target')), -- source = retiring/absorbed, target = surviving/new
  PRIMARY KEY (resolution_event_id, entity_id, role)
);
CREATE INDEX ON entity_resolution_member (entity_id);

-- gk_asset / asset_identity_assignment intentionally NOT included —
-- see the SCOPE note at the top of this file (C1). Their DDL belongs to
-- the DATA-1 Foundation dispatch, reviewed separately.
