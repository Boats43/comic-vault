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

-- GrailKey Directive 0A-r2 — one run of one ingestion process (a GCD bulk
-- load, a Metron modified_gt poll). Batch-level lineage, distinct from
-- source_snapshot's own per-record lineage: "which run produced this
-- fetch" is a different question from "when was this specific record
-- fetched," and the former is needed to answer "did run N ever complete"
-- or "re-run everything ingested by run N" without scanning every
-- source_snapshot row for a timestamp range.
CREATE TABLE ingestion_run (
  id            BIGSERIAL PRIMARY KEY,
  source        TEXT NOT NULL,             -- 'gcd' | 'metron' | ...
  run_kind      TEXT NOT NULL CHECK (run_kind IN ('bulk-load','incremental-sync')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,               -- NULL while running or if it never finished
  status        TEXT NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running','completed','failed','partial')),
  notes         TEXT
);
CREATE INDEX ON ingestion_run (source, started_at);

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
  source_uri          TEXT,                   -- 0A-r2: the literal URL/file path this record was fetched
                                               -- from (the GCD dump's own path/URL, or the exact Metron
                                               -- API endpoint+query string called) — "where did this come
                                               -- from, precisely" as a re-fetchable fact, not a memory.
  ingestion_run_id    BIGINT REFERENCES ingestion_run(id),  -- 0A-r2: which run produced this fetch
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
CREATE INDEX ON source_snapshot (ingestion_run_id);
-- 0A-r2 note: license/rights_classification/superseded_by/deleted_at
-- (above) were already present in the r1 draft this amends — verified,
-- not re-added. This table is the ONLY place `payload` (the full raw
-- record) is stored; see docs/DATA-0-ARCHITECTURE.md's new "Deployment
-- topology" section for why that fact drives where this table actually
-- gets deployed (local staging, not Neon, on current sizing).

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
--
-- GrailKey Directive 0A-r2 — `kind` becomes an explicit, closed taxonomy
-- instead of a freeform example list. THE DEL O'TT LESSON, AS DATA
-- (GK-136, docs/PATTERN-LIBRARY.md "GrailKey Directive AU"): the real
-- production defect this taxonomy exists to prevent from recurring at
-- the schema level was a creator name observed in FIVE different raw
-- spellings across a pool ("DEL O'TT" space-separated, "DEL OTT"
-- collapsed, etc.) — the fix was a bounded fuzzy-match FALLBACK
-- (matchCreatorCanonicals, premiumCreators.js) that needed those raw,
-- mangled spellings to exist as real input, not a canonicalization step
-- that silently corrected or discarded them before the matcher ever saw
-- them. This table's whole reason for existing is to make that the
-- default: a raw spelling variant is ALWAYS recorded verbatim as evidence
-- — never destructively normalized away at ingestion time — regardless
-- of which tier of trust it carries.
--   canonical_alias        this project's own accepted alternate name for
--                          the SAME entity (e.g. a title-change/rename
--                          this project has decided are the same series).
--   catalog_alias          an alternate name a REFERENCE CATALOG source
--                          itself records (GCD/Metron/ComicVine's own
--                          alternate indexing/reprint title) — catalog-
--                          authored, not observed in the wild.
--   source_alias           a raw spelling variant observed VERBATIM in
--                          any source's own text, exactly as encountered
--                          — the DEL O'TT-class row. Never corrected.
--   market_observed_alias  a spelling/naming variant observed specifically
--                          in MARKETPLACE listing text (eBay comps, etc.)
--                          — kept distinct from source_alias because
--                          marketplace text is noisier/less authoritative
--                          than a reference catalog, and this is exactly
--                          the population the fuzzy-match/variant-taxonomy
--                          machinery (compHygiene.js/imageSearchIdentity.js)
--                          already draws its own real-world spelling
--                          variance from.
--   operator_alias         a human-entered/manually-confirmed alias —
--                          highest trust tier, mirrors this project's own
--                          'user' sole-authority precedence already
--                          established in the runtime reconciler (GK-85
--                          OPERATOR_CONFIRMED, GK-127's 'user' issue-facet
--                          precedence).
CREATE TABLE alias (
  id                 BIGSERIAL PRIMARY KEY,
  catalog_entity_id  BIGINT REFERENCES catalog_entity(id),
  facet_id           INT REFERENCES facet(id),
  value              TEXT NOT NULL,           -- verbatim — never destructively normalized (see header)
  kind               TEXT NOT NULL
                       CHECK (kind IN ('canonical_alias','catalog_alias','source_alias',
                                        'market_observed_alias','operator_alias')),
  source             TEXT,                    -- which literal source/observation this came from, when
                                               -- kind is source_alias/market_observed_alias — required
                                               -- for those two kinds to actually be traceable back to
                                               -- the row that produced them; NULL for canonical_alias/
                                               -- operator_alias, which don't originate from a source.
  CHECK (catalog_entity_id IS NOT NULL OR facet_id IS NOT NULL)
);
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX ON alias USING gin (value gin_trgm_ops);
CREATE INDEX ON alias (kind);

-- Seed data — comics as data, never as table shape (the whole point).
INSERT INTO asset_class (code, name) VALUES ('comic', 'Comic Book');
INSERT INTO facet (code, name) VALUES
  ('title', 'Series Title'),
  ('issue', 'Issue Number'),
  ('variant', 'Variant / Edition'),
  ('year', 'Publication Year'),
  ('publisher', 'Publisher'),
  ('creator', 'Creator Credit');
