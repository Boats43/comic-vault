-- =====================================================================
-- 0030 -- GK-241: widen buyer_decision_event.market_standing CHECK
-- =====================================================================
-- GK-241 (2026-09-21). buyer_decision_event.market_standing (0027)
-- carried a CHECK constraint listing only 3 of the real 6 values
-- deriveMarketStanding (src/lib/actionAuthority.js) can actually emit --
-- a second, independent, database-level copy of the exact same
-- duplicated-vocabulary drift that also existed in
-- src/modules/buyer/service.js's own hand-maintained JS whitelist
-- (fixed separately, same ticket, by importing the new
-- MARKET_STANDING_VALUES export instead of re-copying its values).
--
-- FALLBACK_ONLY and NONE were ALREADY excluded by this constraint since
-- 0027 first shipped (2026-09-20), before GK-238 existed. GK-238
-- (836f264, 2026-09-21) added a fourth real value, NO_SOLD_EVIDENCE,
-- which the constraint also rejected -- exposing this same pre-existing
-- drift a second time and giving it its own trigger event. All three
-- rejections manifested identically: a real Buyer Decision write for a
-- real book priced with one of these standings threw
-- "violates check constraint buyer_decision_event_market_standing_check"
-- at the database layer -- confirmed empirically, not by static reading
-- alone, by this ticket's own real live test
-- (tests/gk241-buyer-marketstanding-vocabulary.test.js) before this
-- migration existed.
--
-- Scope, deliberately narrow: this migration touches ONLY the
-- market_standing CHECK constraint on buyer_decision_event. Nothing else
-- in that table, and nothing in any other table, is touched. Per the
-- standing "never modify historical migrations" rule, 0027's own file is
-- left completely unedited -- this is a new, additive, independent
-- migration.
--
-- Safely re-runnable: DROP CONSTRAINT IF EXISTS followed by an
-- unconditional ADD CONSTRAINT under the same name always succeeds,
-- whether this is the first run or a repeat.
--
-- Deployment scope for THIS pass (GK-241 follow-up dispatch,
-- 2026-09-21): Development (data1_dev) ONLY. Production DB target
-- identity remains unresolved (GK-235) -- Vercel's own project env-var
-- metadata shows Development's GRAILKEY_CATALOG_DATABASE_URL entry
-- carries a contentHint linking it to a real Vercel-Neon Storage
-- integration; Production's entry carries no such link, only an opaque
-- secret with no structural Neon project/branch identifier exposed via
-- the API (no secret was decrypted to reach this finding). This migration
-- file is written and ready; it is explicitly NOT applied to Production
-- by this dispatch, and must not be until that identity gate is
-- independently resolved by a future pass.
-- =====================================================================

SET search_path TO data1_dev;

ALTER TABLE buyer_decision_event DROP CONSTRAINT IF EXISTS buyer_decision_event_market_standing_check;

ALTER TABLE buyer_decision_event ADD CONSTRAINT buyer_decision_event_market_standing_check
  CHECK (market_standing IS NULL OR market_standing IN (
    'EXACT_CURRENT',
    'EXACT_STALE',
    'SIMILAR_ONLY',
    'FALLBACK_ONLY',
    'NO_SOLD_EVIDENCE',
    'NONE'
  ));
