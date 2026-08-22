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
-- Ruling 3 (ADR-ID-001) + amendment A3: mint_event. The mint idempotency
-- mechanism reuses external_map's OWN existing UNIQUE (source,
-- external_id) index (0001_generic_substrate.sql:159) as the real
-- duplication constraint, per A3's own instruction ("active external_map
-- participates as a duplication constraint") — a candidate's known
-- external references (gcd_id, metron_id, ...) are checked against
-- external_map FIRST; if ANY already resolves to a catalog_entity, that
-- IS the entity (record outcome='resolved-existing', add any missing
-- external_map rows for the candidate's OTHER references — this is how
-- N->M resolution accumulates evidence across separate mint attempts
-- without ever minting a duplicate). Only when NONE resolve does a new
-- entity mint.
-- ---------------------------------------------------------------------
CREATE TABLE mint_event (
  id                     UUID PRIMARY KEY,           -- its own UUIDv7, generated the same way as any entity id
  occurred_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  contract_version       TEXT NOT NULL,               -- e.g. 'grailkey-0e-full-v1' (ADR-ID-001's CONTRACT_VERSION concept, formalized)
  candidate_snapshot     JSONB NOT NULL,               -- the claim data considered (e.g. the GCD row + Metron row, matching the DATA-0E-PILOT's own provenance.agreeingClaims shape)
  mint_idempotency_key   TEXT NOT NULL,               -- derived from the SORTED set of (source, external_id) pairs in the candidate — order-independent, satisfies A4
  derivation_key         TEXT,                        -- the canonical normalized name used for candidate matching (ADR-ID-001 Ruling 2) — recorded for audit, never the identity itself
  outcome                TEXT NOT NULL CHECK (outcome IN ('minted-new', 'resolved-existing', 'queued-review', 'residual-no-mint')),
  entity_id              UUID REFERENCES catalog_entity(id), -- NULL for queued-review/residual-no-mint outcomes
  review_convention_class TEXT                        -- populated only when outcome='queued-review' (e.g. 'gcd-legacy-parenthetical-numbering', matching DATA-0D/0E-PILOT's own 3 classes)
);
CREATE INDEX ON mint_event (mint_idempotency_key);
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

-- ---------------------------------------------------------------------
-- ADR-ASSET-001 + ADR-EVIDENCE-001: physical asset identity + the
-- append-only assignment history that lets gkAssetId survive identity
-- correction (Ruling 19). Included here since it shares this migration's
-- UUID-identity foundation, even though its own ADRs are separate.
-- ---------------------------------------------------------------------
CREATE TABLE gk_asset (
  gk_asset_id       UUID PRIMARY KEY REFERENCES catalog_entity(id), -- minted at capture (ADR-ASSET-001 Ruling 10), asset_class_id on catalog_entity distinguishes it from a catalog entity
  captured_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  capture_source    TEXT NOT NULL                     -- 'watch-mode' | 'manual-entry' | 'bulk-import' | ...
);

CREATE TABLE asset_identity_assignment (
  id                UUID PRIMARY KEY,
  gk_asset_id       UUID NOT NULL REFERENCES gk_asset(gk_asset_id),
  gk_issue_id       UUID REFERENCES comic_issue(gk_issue_id), -- NULL = unresolved (a valid, storable state per ADR-ASSET-001 Invariant 4)
  assigned_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  reconciliation_version TEXT NOT NULL,                -- ADR-ID-001 Ruling 2's "reconciliation version" concept
  authority         TEXT NOT NULL CHECK (authority IN ('NONE', 'CONTESTED', 'CORROBORATED')),
  superseded_by     UUID REFERENCES asset_identity_assignment(id) -- append-only: a correction adds a NEW row and points the OLD row here, never edits the old row in place
);
CREATE INDEX ON asset_identity_assignment (gk_asset_id, assigned_at);
