-- Rollback for 0039_u1_remove_silent_comic_defaults.sql
-- Restores the historical DEFAULT 'comic' on both columns and drops the
-- supported-category CHECKs. No row is touched in either direction.

SET search_path TO data1_dev;

ALTER TABLE gk_asset DROP CONSTRAINT IF EXISTS gk_asset_asset_class_supported_check;
ALTER TABLE collection_item DROP CONSTRAINT IF EXISTS collection_item_asset_category_supported_check;

ALTER TABLE gk_asset ALTER COLUMN asset_class SET DEFAULT 'comic';
ALTER TABLE collection_item ALTER COLUMN asset_category SET DEFAULT 'comic';
