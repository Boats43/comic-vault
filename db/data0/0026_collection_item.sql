-- =====================================================================
-- 0026 -- Account/Collection Readiness: server-backed collection_item
-- =====================================================================
-- Zero lines touched in 0001-0025 -- per the standing "never modify
-- historical migrations" rule. One new, independent, additive table.
--
-- GrailKey Clean Account/Collection Cutover (2026-09-17). Operator
-- decision: legacy browser-local IndexedDB collections are NOT migrated
-- (no import, no gkAssetId minted from legacy data). This table starts
-- empty and is populated only by genuinely new server-authenticated
-- writes going forward.
--
-- Category-agnostic: `asset_category` + a flexible `attributes` JSONB
-- bag carry the record's actual content (title/issue/publisher/grade/
-- price/... for comics today; a future book/card adapter reuses this
-- same table, never a category-specific column set). Deliberately does
-- NOT carry `images` -- large base64 photo blobs have no content-
-- addressing or dedup benefit sitting in a JSONB column, and photo
-- storage for a GENUINE physical asset is already the Media module's
-- job (attachMedia, content-addressed, real Blob storage). This table
-- is the "what does this account say it owns" record, not evidence
-- storage.
--
-- `id` is CALLER-SUPPLIED (matches the app's existing client-generated
-- `cv_<timestamp>_<random>` id shape, same discipline
-- collection_item_link.collection_item_id already uses for its own
-- TEXT id) -- not a uuidv7 mint. This keeps a 1:1 identity between the
-- item as the client already knows it and the server row, with zero
-- translation layer. PRIMARY KEY (principal_id, id): ownership is
-- always resolved through the verified principalId, never through id
-- alone -- two different principals coining the same id string (an
-- astronomically unlikely client-side collision) are still two
-- structurally distinct rows, not a conflict.
--
-- Physical-asset doctrine, unchanged (restated here, not modified):
-- collection_item != gkAssetId. This table carries NO gk_asset_id
-- column of its own -- linking a collection item to a real physical
-- asset later is already collection_item_link's job (0007), keyed by
-- the same id string this table uses. Adding a second linkage column
-- here would duplicate that existing mechanism, not extend it.
-- =====================================================================

SET search_path TO data1_dev;

CREATE TABLE IF NOT EXISTS collection_item (
  id              TEXT NOT NULL,
  principal_id    UUID NOT NULL REFERENCES gk_principal(id),
  asset_category  TEXT NOT NULL DEFAULT 'comic',
  attributes      JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (principal_id, id)
);

-- List-my-collection is the hot path (every login hydration) -- newest
-- first, scoped to principal.
CREATE INDEX IF NOT EXISTS collection_item_principal_updated_idx
  ON collection_item (principal_id, updated_at DESC);
