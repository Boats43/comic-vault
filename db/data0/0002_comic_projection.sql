-- =====================================================================
-- DATA-0A — Typed comic projection (first vertical's operational catalog)
-- =====================================================================
-- DESIGN-ONLY ARTIFACT. Not applied to any database. Requires
-- 0001_generic_substrate.sql. See docs/DATA-0-ARCHITECTURE.md for the
-- full contract.
--
-- THE REBUILD RULE: every row in every comic_* table below must be
-- derivable from `claim` + the SAME reconciliation rules
-- src/lib/identityReconciler.js already implements, and NOTHING ELSE.
-- Dropping and rebuilding all comic_* tables from the evidence layer is
-- a supported, scripted operation from day one, not an aspiration. If a
-- typed row can exist that the evidence layer cannot reproduce, this
-- projection has become a second, competing truth system — the exact
-- disease this architecture exists to prevent. This project's own
-- history is the reason this rule is written down instead of assumed:
-- Q54, Q84, AK, and AQ (docs/PATTERN-LIBRARY.md) are all instances of a
-- SEPARATE authority system silently overriding the reconciler's own
-- correct answer. A typed projection with an independent write path is
-- that exact bug class, one layer down, at the schema level.
--
-- Stable IDs (gkPublisherId etc.) are catalog_entity.id under the hood,
-- surfaced here as typed foreign keys for fast, ergonomic application
-- queries — never a second identity space. A gkIssueId IS a
-- catalog_entity.id (where asset_class = 'comic') that happens to also
-- have a row in comic_issue.
-- =====================================================================

CREATE TABLE comic_publisher (
  gk_publisher_id  BIGINT PRIMARY KEY REFERENCES catalog_entity(id),
  name             TEXT NOT NULL,             -- resolved 'publisher' facet value
  normalized_name  TEXT NOT NULL              -- comparable key (normalizePublisher-style, api/mega-keys.js precedent)
);
CREATE INDEX ON comic_publisher (normalized_name);

CREATE TABLE comic_series (
  gk_series_id     BIGINT PRIMARY KEY REFERENCES catalog_entity(id),
  gk_publisher_id  BIGINT REFERENCES comic_publisher(gk_publisher_id),
  title            TEXT NOT NULL,             -- resolved 'title' facet value
  start_year       INT,
  end_year         INT,
  title_authority  TEXT NOT NULL CHECK (title_authority IN ('NONE','CONTESTED','CORROBORATED')),
  last_materialized_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON comic_series (gk_publisher_id);
CREATE INDEX ON comic_series (title);

CREATE TABLE comic_issue (
  gk_issue_id      BIGINT PRIMARY KEY REFERENCES catalog_entity(id),
  gk_series_id     BIGINT NOT NULL REFERENCES comic_series(gk_series_id),
  issue_number     TEXT NOT NULL,             -- resolved 'issue' facet value (text: "1", "1A", "1000000")
  cover_year       INT,                       -- resolved 'year' facet value
  -- *_authority columns are a CACHE of a value the reconciliation rules
  -- would recompute identically from `claim` — refreshed by the same
  -- rebuild job that populates the rest of this row. Never hand-edited,
  -- never an independent judgment call. This is the ONLY place in the
  -- typed projection authority is stored, and it is exactly what THE
  -- REBUILD RULE (above) requires be reproducible, not authoritative.
  issue_authority  TEXT NOT NULL CHECK (issue_authority IN ('NONE','CONTESTED','CORROBORATED')),
  year_authority   TEXT NOT NULL CHECK (year_authority IN ('NONE','CONTESTED','CORROBORATED')),
  last_materialized_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON comic_issue (gk_series_id);
CREATE UNIQUE INDEX ON comic_issue (gk_series_id, issue_number);

CREATE TABLE comic_printing (
  gk_printing_id   BIGINT PRIMARY KEY REFERENCES catalog_entity(id),
  gk_issue_id      BIGINT NOT NULL REFERENCES comic_issue(gk_issue_id),
  printing_label   TEXT NOT NULL              -- '1st print' | '2nd print' | 'facsimile' | ...
);
CREATE INDEX ON comic_printing (gk_issue_id);

CREATE TABLE comic_variant (
  gk_variant_id     BIGINT PRIMARY KEY REFERENCES catalog_entity(id),
  gk_printing_id    BIGINT NOT NULL REFERENCES comic_printing(gk_printing_id),
  variant_label     TEXT NOT NULL,            -- resolved 'variant' facet value
  variant_authority TEXT NOT NULL CHECK (variant_authority IN ('NONE','CONTESTED','CORROBORATED')),
  last_materialized_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON comic_variant (gk_printing_id);

-- A creator is a distinct kind of REFERENCED entity, not itself a
-- collectible — deliberately its own sequence, not FK'd to
-- catalog_entity/asset_class. (Open question: should a creator someday
-- be modeled as its own asset_class instead of a parallel table? Logged
-- in the design doc's Risks section, not decided here.)
CREATE TABLE comic_creator (
  gk_creator_id    BIGSERIAL PRIMARY KEY,
  canonical_name   TEXT NOT NULL,             -- premiumCreators.js's own `canonical` field, migration target
  normalized_name  TEXT NOT NULL
);
CREATE INDEX ON comic_creator (normalized_name);

CREATE TABLE comic_issue_creator (
  gk_issue_id      BIGINT NOT NULL REFERENCES comic_issue(gk_issue_id),
  gk_creator_id    BIGINT NOT NULL REFERENCES comic_creator(gk_creator_id),
  role             TEXT NOT NULL DEFAULT '',  -- 'writer' | 'artist' | 'cover' | '' (premiumCreators.js's own role field)
  PRIMARY KEY (gk_issue_id, gk_creator_id, role)
);

CREATE TABLE comic_variant_creator (
  gk_variant_id    BIGINT NOT NULL REFERENCES comic_variant(gk_variant_id),
  gk_creator_id    BIGINT NOT NULL REFERENCES comic_creator(gk_creator_id),
  role             TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (gk_variant_id, gk_creator_id, role)
);
