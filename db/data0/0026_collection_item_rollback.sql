-- Rollback for 0026_collection_item.sql
-- Drops exactly the one new, independent table this migration added.

SET search_path TO data1_dev;

DROP TABLE IF EXISTS collection_item;
