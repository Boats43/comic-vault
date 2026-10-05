-- =====================================================================
-- 0039 -- UNIVERSAL U1: remove the silent 'comic' category defaults
-- =====================================================================
-- PERMANENT LAW: UNKNOWN OR MISSING CATEGORY MUST NEVER BECOME COMIC BY
-- DEFAULT.
--
-- Before this migration, both category columns silently became 'comic'
-- when a writer omitted them:
--   gk_asset.asset_class           TEXT NOT NULL DEFAULT 'comic'   (0004:64)
--   collection_item.asset_category TEXT NOT NULL DEFAULT 'comic'   (0026:48)
--
-- ORDER (mandatory, enforced by the U1 commit sequence): every live writer
-- was converted to supply an explicit supported category FIRST (U1 commit
-- C: createPhysicalAsset/mintAsset, captureFromScan, createCollectionItem,
-- the client push, the operator panel, assetRecoveryHandler). Only then does
-- this migration drop the defaults, so a writer that still omitted the
-- column now fails LOUDLY with a NOT NULL violation instead of silently
-- becoming a comic.
--
-- Supported U1 physical classes: comic | book | generic. One vocabulary for
-- both columns, so the kernel class and the catalogue category can never
-- drift apart by definition.
--
-- NOT VALID, deliberately: the CHECKs are enforced for every NEW insert and
-- every UPDATE, but are NOT validated against existing rows. HISTORICAL
-- ROWS ARE NEVER REWRITTEN (Development holds 105 legacy 'd4-proof' test
-- rows in gk_asset that this migration must not touch or reclassify).
--
-- VALIDATE CONSTRAINT POLICY (ruled 2026-10-05): `VALIDATE CONSTRAINT` on
-- these two CHECKs is NOT PLANNED, and NO ONE SHOULD RUN IT CASUALLY. NOT VALID
-- skips validation of historical rows only at creation; every later INSERT and
-- every UPDATE of ANY column is still checked against the CHECK, so a row
-- holding an unsupported value is trapped against updates until reconciled.
-- Legacy unsupported values may intentionally remain (Development holds 111
-- 'd4-proof' gk_asset rows; Production held none at the 2026-10-05 census),
-- and VALIDATE would fail wherever one exists until those rows are
-- deliberately reconciled. Reconcile first (an explicit, separately authorized
-- decision), then and only then consider validating.
--
-- Rollback: db/data0/0039_u1_remove_silent_comic_defaults_rollback.sql.
-- Re-runnable.
-- =====================================================================

SET search_path TO data1_dev;

ALTER TABLE gk_asset ALTER COLUMN asset_class DROP DEFAULT;
ALTER TABLE collection_item ALTER COLUMN asset_category DROP DEFAULT;

-- Postgres has no `ADD CONSTRAINT IF NOT EXISTS` -- DO block is the
-- standard idiom for a safely re-runnable constraint add.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'gk_asset_asset_class_supported_check' AND conrelid = 'gk_asset'::regclass
  ) THEN
    ALTER TABLE gk_asset ADD CONSTRAINT gk_asset_asset_class_supported_check
      CHECK (asset_class = ANY (ARRAY['comic', 'book', 'generic'])) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'collection_item_asset_category_supported_check' AND conrelid = 'collection_item'::regclass
  ) THEN
    ALTER TABLE collection_item ADD CONSTRAINT collection_item_asset_category_supported_check
      CHECK (asset_category = ANY (ARRAY['comic', 'book', 'generic'])) NOT VALID;
  END IF;
END $$;
