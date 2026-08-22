-- =====================================================================
-- 0004 -- DATA-1 Foundation: the durable physical asset (DESIGN DRAFT)
-- =====================================================================
-- DESIGN-ONLY ARTIFACT. Not applied to any database as-is. Additive to
-- 0001_generic_substrate.sql / 0002_comic_projection.sql /
-- 0003_uuidv7_identity_and_mint_ledger.sql -- none of those files are
-- edited by this migration, per the standing "never modify historical
-- migrations" rule (Summit Phase 1 amendment A5).
--
-- Full writeup, ADR citations, and the record-class/naming-law
-- restatements: docs/adr/DATA-1-FOUNDATION-DESIGN.md (GrailKey Dispatch
-- 2026-08-22, DATA-1 Foundation, Task 1). This file covers the WHOLE
-- physical-asset graph as one coherent unit; Task 2's actual executed
-- implementation runs only a BOUNDED SLICE of these tables (see that
-- design doc's own scope statement) against a real Postgres schema
-- (`data1_dev`, chosen per Task 2a's home ruling -- a separate schema
-- within the already-verified Neon instance, not a true Neon branch,
-- because no Neon management API/CLI credential is available to mint a
-- real branch from this session).
--
-- delegation_event, the outbox dispatcher's own queue/worker tables, and
-- any object-storage-vendor-specific columns are deliberately NOT
-- drafted here -- named as open items in the design doc, not guessed at.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Section 2 (design doc): Principal / Organization -- ADR-AUTH-001,
-- Rulings 12-13, 36. GK-151 stays OPEN/HARD-GATE -- these tables exist
-- so other tables have something real to reference; they are not an
-- auth implementation.
-- ---------------------------------------------------------------------
CREATE TABLE gk_principal (
  id            UUID PRIMARY KEY,          -- uuidv7(), minted explicitly at seed/creation time, never a column default (ADR-ID-001)
  display_name  TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('operator', 'user')),  -- 'operator' = the current single-operator era; 'user' = a future real account
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE gk_organization (
  id            UUID PRIMARY KEY,
  display_name  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE gk_membership (
  id                UUID PRIMARY KEY,
  organization_id   UUID NOT NULL REFERENCES gk_organization(id),
  principal_id      UUID NOT NULL REFERENCES gk_principal(id),
  role              TEXT NOT NULL,
  joined_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON gk_membership (organization_id);
CREATE INDEX ON gk_membership (principal_id);

-- ---------------------------------------------------------------------
-- Section 4 (design doc): The Asset -- ADR-ASSET-001, Rulings 9-11.
-- gkAssetId represents one physical object, full stop. Minted at
-- capture. Identity-independent. No uniqueness tied to catalog identity
-- (duplicate-copy law) -- the only uniqueness is inherited from the
-- mint-basis mechanism below.
-- ---------------------------------------------------------------------
CREATE TABLE gk_asset (
  id              UUID PRIMARY KEY,        -- uuidv7(), minted via the SAME entity_mint_basis/mint_event machinery as 0003 -- reused, not reinvented
  asset_class     TEXT NOT NULL DEFAULT 'comic',  -- future: 'book' | 'card', per the AssetCore/BookAdapter/CardAdapter roadmap
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'merged-into-other-asset')),
  mint_basis_id   UUID NOT NULL REFERENCES entity_mint_basis(id),  -- namespace='asset:capture-event' -- see 0003's own entity_mint_basis table; this file does not redefine that table
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON gk_asset (mint_basis_id);
CREATE INDEX ON gk_asset (status);

-- ---------------------------------------------------------------------
-- Section 3 (design doc): Ownership + Custody -- ADR-AUTH-001,
-- Rulings 14-15. Append-only history + a materialized current-owner
-- view rebuilt FROM that history (THE REBUILD RULE, applied one layer
-- up from the catalog projection).
-- ---------------------------------------------------------------------
CREATE TABLE ownership_event (
  id                        UUID PRIMARY KEY,
  asset_id                  UUID NOT NULL REFERENCES gk_asset(id),
  owner_principal_id        UUID NOT NULL REFERENCES gk_principal(id),
  reason                    TEXT NOT NULL CHECK (reason IN ('initial-mint', 'transfer', 'correction')),
  occurred_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by_principal_id  UUID NOT NULL REFERENCES gk_principal(id)
);
CREATE INDEX ON ownership_event (asset_id, occurred_at);

-- Materialized "who owns this right now" -- a cache of ownership_event's
-- own append-only history, never an independent write path (rebuild
-- logic: current_owner for an asset = the owner_principal_id of that
-- asset's ownership_event row with the latest occurred_at). Task 2's
-- implementation recomputes this on every ownership_event insert inside
-- the SAME transaction -- never a separately-triggered async job for
-- this dispatch's bounded slice.
CREATE TABLE current_owner (
  asset_id                  UUID PRIMARY KEY REFERENCES gk_asset(id),
  owner_principal_id        UUID NOT NULL REFERENCES gk_principal(id),
  as_of_ownership_event_id  UUID NOT NULL REFERENCES ownership_event(id),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE custody_event (
  id                        UUID PRIMARY KEY,
  asset_id                  UUID NOT NULL REFERENCES gk_asset(id),
  custodian_principal_id    UUID NOT NULL REFERENCES gk_principal(id),
  reason                    TEXT NOT NULL,
  occurred_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by_principal_id  UUID NOT NULL REFERENCES gk_principal(id)
);
CREATE INDEX ON custody_event (asset_id, occurred_at);

-- ---------------------------------------------------------------------
-- Section 5 (design doc): Media -- ADR-MEDIA-001, Ruling 16. NEVER a
-- blob/bytea column. object_uri nullable this dispatch -- vendor
-- selection is a named open item, not decided here.
-- ---------------------------------------------------------------------
CREATE TABLE media (
  id                         UUID PRIMARY KEY,
  asset_id                   UUID NOT NULL REFERENCES gk_asset(id),
  media_type                 TEXT NOT NULL CHECK (media_type IN ('capture-photo', 'grading-photo', 'document')),
  content_hash                TEXT NOT NULL,  -- SHA-256 of the actual bytes
  object_uri                  TEXT,            -- nullable: real object-storage vendor not chosen this dispatch
  local_path_placeholder      TEXT,            -- TEST-HARNESS ONLY (Task 3) -- never a real storage mechanism, never read outside this dispatch's own proof scripts
  captured_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by_principal_id    UUID NOT NULL REFERENCES gk_principal(id)
);
CREATE INDEX ON media (asset_id);
CREATE INDEX ON media (content_hash);

-- ---------------------------------------------------------------------
-- Section 6 (design doc): Identity Assignment -- ADR-EVIDENCE-001,
-- Rulings 18-19. Append-only. catalog_entity_id nullable (identity=
-- UNKNOWN is valid, per ADR-ASSET-001 Invariant 4; also nullable because
-- DATA-0E-FULL has not yet populated real catalog_entity rows to
-- reference). authority reuses the SAME NONE/CONTESTED/CORROBORATED
-- vocabulary the catalog-layer reconcilers already use -- never a
-- reinvented scale.
-- ---------------------------------------------------------------------
CREATE TABLE asset_identity_assignment (
  id                  UUID PRIMARY KEY,
  asset_id            UUID NOT NULL REFERENCES gk_asset(id),
  catalog_entity_id   UUID REFERENCES catalog_entity(id),  -- nullable, see above
  authority            TEXT NOT NULL CHECK (authority IN ('NONE', 'CONTESTED', 'CORROBORATED')),
  source                TEXT NOT NULL CHECK (source IN ('vision', 'operator-correction', 'unresolved')),
  assigned_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_by          UUID REFERENCES asset_identity_assignment(id)  -- nullable self-reference to the LATER row that replaced this one; this row itself is never edited or deleted
);
CREATE INDEX ON asset_identity_assignment (asset_id, assigned_at);

-- ---------------------------------------------------------------------
-- Section 7 (design doc): Economics + History -- ADR-EVENT-001,
-- Rulings 20-22.
-- ---------------------------------------------------------------------
CREATE TABLE acquisition_event (
  id                         UUID PRIMARY KEY,
  asset_id                   UUID NOT NULL REFERENCES gk_asset(id),
  cost_amount                NUMERIC(12,2) NOT NULL,
  cost_currency               TEXT NOT NULL DEFAULT 'USD',
  source                      TEXT NOT NULL CHECK (source IN ('purchase', 'gift', 'inherited', 'other')),
  lot_reference                TEXT,           -- nullable free text this dispatch; a future lot table FK is a named open item
  occurred_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by_principal_id     UUID NOT NULL REFERENCES gk_principal(id)
);
CREATE INDEX ON acquisition_event (asset_id, occurred_at);

CREATE TABLE condition_observation (
  id                         UUID PRIMARY KEY,
  asset_id                   UUID NOT NULL REFERENCES gk_asset(id),
  grade_scale                 TEXT NOT NULL CHECK (grade_scale IN ('CGC', 'raw-estimate')),
  grade_value                  NUMERIC(3,1) NOT NULL,
  defect_flags                  JSONB,          -- matches the existing cgcPenaltyFlags shape
  observed_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  media_id                       UUID REFERENCES media(id),  -- nullable
  recorded_by_principal_id       UUID NOT NULL REFERENCES gk_principal(id)
);
CREATE INDEX ON condition_observation (asset_id, observed_at);

CREATE TABLE valuation_event (
  id                          UUID PRIMARY KEY,
  asset_id                    UUID NOT NULL REFERENCES gk_asset(id),
  value_amount                 NUMERIC(12,2) NOT NULL,
  value_currency                 TEXT NOT NULL DEFAULT 'USD',
  method                          TEXT NOT NULL CHECK (method IN ('engine-computed', 'operator-override', 'gocollect', 'other')),
  comp_snapshot_ref                TEXT,          -- nullable pointer to a comp-pool snapshot (future priceDerivationTrace durability work, not built here)
  grade_assumption                  NUMERIC(3,1),
  build_sha                          TEXT NOT NULL,  -- which deployed commit produced this number
  occurred_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by_principal_id           UUID NOT NULL REFERENCES gk_principal(id)
);
CREATE INDEX ON valuation_event (asset_id, occurred_at);

CREATE TABLE decision_event (
  id                          UUID PRIMARY KEY,
  asset_id                    UUID NOT NULL REFERENCES gk_asset(id),
  recommendation                TEXT NOT NULL,  -- 'LIST_NOW' | 'RESEARCH' | 'GRADE_CANDIDATE' | ... (decisionEngine.js's own vocabulary)
  reason_codes                    JSONB NOT NULL DEFAULT '[]',
  valuation_event_id                UUID REFERENCES valuation_event(id),
  occurred_at                        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON decision_event (asset_id, occurred_at);

-- ---------------------------------------------------------------------
-- Section 8 (design doc): Event Envelope + Outbox -- ADR-EVENT-001
-- Ruling 21 / ADR-ASYNC-001 Ruling 23. Table DDL only -- no dispatcher,
-- no worker. Rows accumulate status='pending' by design this dispatch.
-- ---------------------------------------------------------------------
CREATE TABLE domain_event (
  event_id         UUID PRIMARY KEY,
  event_type       TEXT NOT NULL,     -- 'asset.minted' | 'identity.assigned' | 'ownership.transferred' | 'valuation.computed' | 'decision.computed' | ...
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor            JSONB NOT NULL,     -- { principal_id, kind: 'user'|'system'|'ai-model' }
  subject          JSONB NOT NULL,     -- { entity_type, entity_id }
  payload          JSONB NOT NULL,
  correlation_id   UUID NOT NULL,
  schema_version   INT NOT NULL DEFAULT 1
);
CREATE INDEX ON domain_event (correlation_id);
CREATE INDEX ON domain_event (event_type, occurred_at);
CREATE INDEX ON domain_event ((subject->>'entity_id'));

CREATE TABLE outbox (
  id                UUID PRIMARY KEY,
  domain_event_id   UUID NOT NULL REFERENCES domain_event(event_id),
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'dead-letter')),
  attempts          INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ
);
CREATE INDEX ON outbox (status);
