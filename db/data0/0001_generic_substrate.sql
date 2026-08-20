-- =====================================================================
-- DATA-0A — Generic substrate (asset-class-agnostic evidence layer)
-- =====================================================================
-- DESIGN-ONLY ARTIFACT. Not applied to any database. No credentials, no
-- provisioning, no ingestion exist yet — see docs/DATA-0-ARCHITECTURE.md
-- for the full contract this migration implements a first draft of.
--
-- Doctrine: "generic evidence, typed canonical entities." This substrate
-- never encodes comic-specific concepts. Comics are seed rows in
-- asset_class at the bottom of this file, not a shape baked into any
-- table here — a future book/card vertical adds rows, not migrations
-- that touch this file.
--
-- `claim` mirrors src/lib/identityReconciler.js's addEvidence/
-- reportConflict exactly: {facet, source, value, type} plus provenance.
-- Authority (NONE/CONTESTED/CORROBORATED) is NEVER stored as a column on
-- claim or anywhere in this substrate — it is always DERIVED, at read
-- time or materialization time, by the SAME reconciliation rules the
-- GrailKey runtime reconciler already implements (reconcileIssue/
-- reconcileVariant/reconcileYear/reconcileTitle, src/lib/
-- identityReconciler.js). See docs/DATA-0-ARCHITECTURE.md "table ->
-- runtime reconciler mapping" for the literal correspondence, and "THE
-- REBUILD RULE" for why this constraint is load-bearing, not stylistic.
-- =====================================================================

CREATE TABLE asset_class (
  id    SERIAL PRIMARY KEY,
  code  TEXT UNIQUE NOT NULL,        -- 'comic' (seed row, bottom of this file)
  name  TEXT NOT NULL
);

-- One row per canonical collectible identity. Deliberately empty of
-- domain fields — title/issue/publisher/etc. live in `claim`, never here.
--
-- gkAssetId (physical-asset identity — a specific owned/graded copy) is
-- explicitly NOT this table and does not exist yet. Boundary, stated
-- once here and in the design doc: canonical collectible identity !=
-- physical asset identity. `catalog_entity` is the CANONICAL side only;
-- a future asset-management layer's gkAssetId REFERENCES a
-- catalog_entity row, never the reverse, and never merges into it.
CREATE TABLE catalog_entity (
  id             BIGSERIAL PRIMARY KEY,
  asset_class_id INT NOT NULL REFERENCES asset_class(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON catalog_entity (asset_class_id);

-- The KIND of attribute a catalog_entity can carry. Seed rows (bottom of
-- this file) match the reconciler facets already shipped in production
-- (title/issue/variant/year — AS/AM/AU/AT/AW) plus two the runtime
-- pipeline resolves without a dedicated reconciler yet (publisher,
-- creator) — added here so the schema doesn't have to wait for those to
-- get their own reconcileX function before the DB can represent them as
-- evidence. Extensible per asset_class later without a migration (a
-- future book vertical's 'isbn'/'author' facets are new rows, not new
-- columns or tables).
CREATE TABLE facet (
  id    SERIAL PRIMARY KEY,
  code  TEXT UNIQUE NOT NULL,   -- 'title' | 'issue' | 'variant' | 'year' | 'publisher' | 'creator' | ...
  name  TEXT NOT NULL
);

-- A snapshot of one FETCH from one external source at one point in time
-- — the thing a claim is DERIVED FROM, never the claim itself. GCD and
-- Metron never write catalog_entity/claim directly; they produce
-- source_snapshot rows, and a separate transform step derives claims
-- from them. This is what makes "GCD and Metron never directly overwrite
-- canonical GrailKey truth" a structural guarantee enforced by the
-- schema, not a convention someone has to remember to follow.
CREATE TABLE source_snapshot (
  id                  BIGSERIAL PRIMARY KEY,
  source              TEXT NOT NULL,          -- 'gcd' | 'metron' | 'comicvine' | 'pricecharting' | ...
  source_record_id    TEXT NOT NULL,          -- the source's own primary key for this record
  source_version      TEXT,                   -- e.g. GCD dump date, Metron's own modified_gt timestamp
  retrieved_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_modified_at  TIMESTAMPTZ,            -- the source's own claimed last-modified time, when exposed
  payload             JSONB NOT NULL,         -- the raw fetched record, verbatim
  payload_hash        TEXT NOT NULL,          -- checksum of `payload`, for cheap change detection
  license             TEXT NOT NULL,          -- e.g. 'cc-by-sa-4.0-metadata-only' | 'metron-bootstrap-pending-terms'
  rights_classification TEXT NOT NULL DEFAULT 'metadata-only'
                          CHECK (rights_classification IN ('metadata-only','image-excluded','unresolved')),
  superseded_by       BIGINT REFERENCES source_snapshot(id),  -- points to the newer snapshot once one exists
  deleted_at          TIMESTAMPTZ             -- source-side deletion/retraction; never a hard DELETE here
);
CREATE UNIQUE INDEX ON source_snapshot (source, source_record_id, source_version);
CREATE INDEX ON source_snapshot (source, retrieved_at);
CREATE INDEX ON source_snapshot (source, source_record_id) WHERE deleted_at IS NULL;

-- Persisted evidence entry. One row per (source, facet, value)
-- observation for one catalog_entity — the DB shape of
-- addEvidence(evidenceSet, facet, source, value, opts). `type` mirrors
-- the reconciler's own vocabulary exactly ('corroboration' | 'conflict'
-- | 'refinement' — src/lib/identityReconciler.js). No 'authority' column
-- exists on this table, deliberately — see the file header.
CREATE TABLE claim (
  id                 BIGSERIAL PRIMARY KEY,
  catalog_entity_id  BIGINT NOT NULL REFERENCES catalog_entity(id),
  facet_id           INT NOT NULL REFERENCES facet(id),
  source             TEXT NOT NULL,           -- 'gcd' | 'metron' | 'comicvine' | 'user' | 'first-eligible-visual' | ...
  value              TEXT NOT NULL,
  type               TEXT NOT NULL DEFAULT 'corroboration'
                       CHECK (type IN ('corroboration','conflict','refinement')),
  source_snapshot_id BIGINT REFERENCES source_snapshot(id),  -- provenance: which fetch produced this claim
  metadata           JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON claim (catalog_entity_id, facet_id);
CREATE INDEX ON claim (source_snapshot_id);

-- Crosswalk to external identifiers. `verification_state` distinguishes
-- an automated match (e.g. Metron's own gcd_id field, per GK-141's own
-- open crosswalk-yield question) from one this project has independently
-- confirmed — required precision once real Metron/GCD data lands and the
-- crosswalk yield actually gets measured.
CREATE TABLE external_map (
  id                 BIGSERIAL PRIMARY KEY,
  catalog_entity_id  BIGINT NOT NULL REFERENCES catalog_entity(id),
  source             TEXT NOT NULL,           -- 'gcd' | 'metron' | 'comicvine' | 'upc' | 'isbn' | 'sku' | 'pricecharting' | ...
  external_id        TEXT NOT NULL,
  match_method       TEXT NOT NULL,           -- 'source-native-crosswalk' | 'automated-fuzzy' | 'manual-verified'
  verification_state TEXT NOT NULL DEFAULT 'unverified'
                       CHECK (verification_state IN ('unverified','automated','manual-verified','rejected')),
  provenance         JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON external_map (source, external_id);
CREATE INDEX ON external_map (catalog_entity_id);

-- Alternate spellings/names. Facet-scoped when the alias is about ONE
-- value ("Amazing Spider-Man" vs "The Amazing Spider-Man" as a title
-- alias, or a creator-name alias migrated from premiumCreators.js's own
-- alias arrays in a later dispatch); entity-scoped (facet_id NULL) when
-- it's a whole-entity alternate identity.
CREATE TABLE alias (
  id                 BIGSERIAL PRIMARY KEY,
  catalog_entity_id  BIGINT REFERENCES catalog_entity(id),
  facet_id           INT REFERENCES facet(id),
  value              TEXT NOT NULL,
  kind               TEXT,                    -- 'title-variant' | 'creator-alias' | 'market-name' | ...
  CHECK (catalog_entity_id IS NOT NULL OR facet_id IS NOT NULL)
);
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX ON alias USING gin (value gin_trgm_ops);

-- Seed data — comics as data, never as table shape (the whole point).
INSERT INTO asset_class (code, name) VALUES ('comic', 'Comic Book');
INSERT INTO facet (code, name) VALUES
  ('title', 'Series Title'),
  ('issue', 'Issue Number'),
  ('variant', 'Variant / Edition'),
  ('year', 'Publication Year'),
  ('publisher', 'Publisher'),
  ('creator', 'Creator Credit');
