-- =====================================================================
-- 0009 -- DATA-1D T3: media.content_type (NEW column, additive)
-- =====================================================================
-- A real gap found while building the authenticated media-serving
-- endpoint (T3): the media table has never stored a content type
-- anywhere -- driver-localfs.js's own head() has always returned
-- contentType:null (confirmed, src/modules/media/driver-localfs.js).
-- DATA-1C never needed it (nothing served bytes over HTTP); T3's
-- api/asset-media.js genuinely does, to set a correct Content-Type
-- header for a browser to render the image. Additive column on an
-- existing table, applied via a NEW migration file -- 0004's own table
-- definition is not edited.
-- =====================================================================

SET search_path TO data1_dev;

ALTER TABLE media ADD COLUMN IF NOT EXISTS content_type TEXT;

-- Nullable, deliberately: the 7 pre-DATA-1C media rows (object_uri IS
-- NULL, metadata-only proof rows) and the substitute-bytes rows from
-- DATA-1C's own M4 proof never had a real content type recorded either
-- -- backfilling a guessed value for historical rows would be a real,
-- disclosed fabrication this project's own discipline forbids. New rows
-- from this dispatch forward populate it for real (attachMedia's own
-- `contentType` parameter, already required on every call, simply
-- reaches one column further now).
