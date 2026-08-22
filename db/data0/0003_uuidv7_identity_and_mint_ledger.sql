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
-- Ruling 3 (ADR-ID-001) + amendment A3, REDESIGNED in review (C2).
--
-- REJECTED (found in review, before any row existed): the original draft
-- of this file used external_map's own UNIQUE (source, external_id)
-- index as the mint-idempotency primitive. That is wrong at the
-- architecture level, not just as an implementation detail: it would
-- place an EXTERNAL PROVIDER'S identity underneath GrailKey's own
-- first-party permanent identity — the exact dependency this entire
-- architecture exists to remove. It breaks for every case that isn't
-- "an entity with exactly one clean external mapping": an entity
-- synthesized from multiple agreeing claims with no single external ID
-- to key on, a manual entity with no external provider at all, a future
-- vertical with no GCD-analog whatsoever, or a corrected/re-pointed
-- provider mapping (which would silently look like a brand-new,
-- unrelated mint attempt under the old design, since the OLD external_id
-- row would no longer be the one the new claim carries). Caught at zero
-- cost tonight; would have been a migration crisis after real rows
-- existed.
--
-- CORRECTED: entity_mint_basis is a first-party, provider-independent
-- uniqueness primitive. Its UNIQUE (namespace, key, version) constraint
-- is the ONLY thing "have I already minted for this" is ever checked
-- against — never external_map directly. External identifiers (GCD id,
-- Metron id, ...) may still participate as CONTENT of a basis key's
-- VALUE for the specific use cases that have them (0E-FULL's own
-- GCD+Metron-agreement case is exactly this — see comment below), but
-- the table/constraint enforcing uniqueness is always this one,
-- first-party, table — never external_map's own index. An entity with
-- zero external references (a manual entry, a synthesized-consensus
-- entity, a future non-GCD-analog vertical) mints under its own
-- namespace with a basis key built entirely from first-party content —
-- permanent mint semantics never REQUIRE an external ID to exist.
--
-- mint_basis_version ties to a reconciliation/contract version
-- (ADR-ID-001 Ruling 2) — a basis key computed under a different
-- version is a DIFFERENT basis row on purpose, so a future normalizer
-- change (e.g. promoting one of the 35 REVIEW-tier convention classes)
-- never silently collides with or reuses a basis claimed under the old
-- rules.
--
-- TRANSACTIONAL / RACE CONTRACT (stated explicitly, per C2's own
-- requirement — this is a DDL file, so this is the invariant the schema
-- is designed to support; the actual transaction-wrapping is application
-- code in the eventual mint script, not expressible in DDL alone):
--   1. BEGIN.
--   2. INSERT INTO entity_mint_basis (namespace, key, version, ...)
--      VALUES (...) — if this violates the UNIQUE constraint (another
--      transaction already claimed this exact basis, concurrently or in
--      the past), catch the conflict, SELECT the existing basis row's
--      entity_id, record a mint_event with outcome='resolved-existing'
--      pointing at it, COMMIT. No new catalog_entity is ever created in
--      this branch.
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
-- repeated later, always resolves to exactly ONE entity, and no orphan
-- catalog_entity or entity_mint_basis row can ever exist in a
-- successfully-committed state.
-- ---------------------------------------------------------------------
CREATE TABLE entity_mint_basis (
  id                    UUID PRIMARY KEY,
  entity_id             UUID NOT NULL REFERENCES catalog_entity(id),
  -- Namespace examples: 'comic-gcd-metron-agreement' (0E-FULL's own use
  -- case — see below), 'manual-entry', 'derived-consensus' (synthesized
  -- from multiple agreeing claims with no single external anchor),
  -- future non-comic-vertical namespaces with no GCD analog at all.
  mint_basis_namespace  TEXT NOT NULL,
  -- The normalized, first-party-computed key within that namespace. For
  -- 0E-FULL specifically, this MAY be built from external ids as VALUE
  -- content (e.g. 'gcd:1914289|metron:1191', sorted/normalized for
  -- order-independence, matching ADR-ID-001 Ruling 2's derivation-key
  -- discipline) — external identifiers participate as supporting
  -- uniqueness evidence for the use case that has them, per the review's
  -- own instruction, WITHOUT the constraint mechanism itself living on
  -- external_map. A manual-entry or derived-consensus basis key contains
  -- no external id at all and is equally valid.
  mint_basis_key        TEXT NOT NULL,
  mint_basis_version    TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX entity_mint_basis_unique ON entity_mint_basis (mint_basis_namespace, mint_basis_key, mint_basis_version);
CREATE INDEX ON entity_mint_basis (entity_id);

CREATE TABLE mint_event (
  id                     UUID PRIMARY KEY,           -- its own UUIDv7, generated the same way as any entity id
  occurred_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  contract_version       TEXT NOT NULL,               -- e.g. 'grailkey-0e-full-v1' (ADR-ID-001's CONTRACT_VERSION concept, formalized)
  candidate_snapshot     JSONB NOT NULL,               -- the claim data considered (e.g. the GCD row + Metron row, matching the DATA-0E-PILOT's own provenance.agreeingClaims shape)
  mint_basis_id          UUID REFERENCES entity_mint_basis(id), -- the first-party basis row this attempt matched or created (C2's own mechanism, NOT a raw external-id-derived key) — NULL only for queued-review/residual-no-mint outcomes where no basis was ever claimed
  derivation_key         TEXT,                        -- the canonical normalized name used for candidate matching (ADR-ID-001 Ruling 2) — recorded for audit, distinct from mint_basis_key, never the identity itself
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
