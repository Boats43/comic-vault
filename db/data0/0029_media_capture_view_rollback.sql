-- Rollback for 0029_media_capture_view.sql

SET search_path TO data1_dev;

ALTER TABLE media DROP CONSTRAINT IF EXISTS media_capture_view_check;
ALTER TABLE media DROP COLUMN IF EXISTS capture_view;
