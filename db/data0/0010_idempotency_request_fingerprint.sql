-- =====================================================================
-- 0010 -- GK-163: class-wide idempotency request fingerprint (NEW,
-- additive)
-- =====================================================================
-- Zero lines touched in 0001-0009 -- per the standing "never modify
-- historical migrations" rule (Summit Phase 1 amendment A5). This file
-- adds exactly one new nullable column and nothing else.
--
-- GK-163 (docs/TICKET-REGISTRY.md): `idempotency_key` (0005) proved
-- "same key wins regardless of whether the new call's content agrees
-- with the old one" for every operation except attachMedia (DATA-1C,
-- which carried its own request fingerprint inside result_snapshot
-- JSONB rather than a column, precisely because no shared column
-- existed yet). This migration adds that column so the check becomes
-- ONE shared law in src/modules/assets/idempotency.js, not nine
-- per-operation copies of attachMedia's own bespoke pattern.
--
-- Nullable, not backfilled: every row written before this migration
-- (including attachMedia's own pre-migration rows, which already carry
-- an equivalent value inside result_snapshot instead) has no
-- request_fingerprint here. checkIdempotencyReplay treats a NULL
-- stored fingerprint as "nothing to compare against" (permits the
-- replay) rather than fabricating a retroactive value for history it
-- cannot know — same "never guess a historical value" discipline this
-- project applies to content_type (0009) and every other additive
-- nullable column.
-- =====================================================================

SET search_path TO data1_dev;

ALTER TABLE idempotency_key ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;
