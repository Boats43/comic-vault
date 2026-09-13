-- =====================================================================
-- 0024 -- Outcome #1 PRE-PUBLISH HARDENING: observation/cutoff policy
-- for right-censored ACTIVE_AT_CUTOFF rows.
-- =====================================================================
-- This dispatch's own instruction: "Before the listing is allowed to
-- run, define and persist the observation/cutoff policy needed to later
-- determine right-censoring... Do not create ACTIVE_AT_CUTOFF
-- retroactively with an invented date after the fact."
--
-- POLICY (documented here, not invented at read time): api/list-ebay.js
-- always lists with <ListingDuration>GTC</ListingDuration> (Good 'Til
-- Cancelled -- eBay auto-renews the listing roughly every 30 days until
-- it sells or is manually ended; there is no natural fixed EndTime to
-- borrow from the AddFixedPriceItem response the way a fixed-duration
-- listing would have one). This migration adds next_observation_due_at,
-- POPULATED AT LISTED-WRITE TIME (never backfilled later) as
-- occurred_at + a fixed, named policy window
-- (LISTING_OBSERVATION_WINDOW_DAYS = 30, src/lib/marketplaceOutcomeBridge.js)
-- matching that real GTC renewal cadence. A future observation process
-- (not built this pass -- explicitly out of scope, "do not build
-- automation yet") would use this column to know WHEN a listing is next
-- due to be checked; if it is still active at that point, an
-- ACTIVE_AT_CUTOFF row is written with occurred_at = the real check
-- time (the genuine observation instant), and next_observation_due_at
-- again set forward from THAT row -- never an invented date chosen
-- after the fact to justify a censoring claim.
--
-- REVERSIBILITY: one nullable column added to one table already
-- introduced by 0023 (this migration). Rollback drops just the column.
-- =====================================================================

SET search_path TO data1_dev;

ALTER TABLE outcome_event
  ADD COLUMN next_observation_due_at TIMESTAMPTZ;

COMMENT ON COLUMN outcome_event.next_observation_due_at IS
  'Policy-defined observation horizon, set AT WRITE TIME (never backfilled): occurred_at + LISTING_OBSERVATION_WINDOW_DAYS for a LISTED row (matches the GTC ~30-day renewal cadence). Used later to derive genuine ACTIVE_AT_CUTOFF rows, never to justify one after the fact.';
