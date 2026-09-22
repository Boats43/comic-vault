-- Rollback for 0030_gk241_buyer_market_standing_check_widen.sql
--
-- SAFETY, enforced not merely documented: once a durable
-- buyer_decision_event row exists with market_standing IN
-- ('FALLBACK_ONLY', 'NO_SOLD_EVIDENCE', 'NONE'), reinstating the old,
-- narrower 3-value CHECK would either (a) fail outright on the ALTER
-- TABLE itself, since Postgres validates every existing row against a
-- newly-added CHECK by default, or (b) if ever changed to a NOT VALID/
-- non-validating form, silently leave a truthful historical row in a
-- state a future reader would misinterpret as "never should have been
-- possible." Neither outcome is acceptable per this project's own "never
-- rewrite or invalidate truthful historical rows" discipline (GK-241's
-- own registry entry, GRAILKEY-PHYSICAL-ASSET-PROTOCOL-v1.md's
-- Append-only invariant). This rollback therefore REFUSES LOUDLY —
-- raises a real exception, naming the exact offending row count — rather
-- than either deleting/rewriting those rows to force success, or
-- silently degrading to a non-enforcing constraint. A human must resolve
-- the underlying reason a rollback is being attempted (almost certainly:
-- don't roll this back at all, once real FALLBACK_ONLY/NO_SOLD_EVIDENCE/
-- NONE rows exist and are meant to stay valid) before this can run
-- cleanly — chosen over "document only, trust a human read it first"
-- because an enforced check cannot be skipped by accident, matching this
-- module's own established fail-closed convention
-- (assertPrincipalActive, assertScratchSchemaTarget, etc.).

SET search_path TO data1_dev;

DO $$
DECLARE
  offending_count INT;
BEGIN
  SELECT COUNT(*) INTO offending_count
  FROM buyer_decision_event
  WHERE market_standing IN ('FALLBACK_ONLY', 'NO_SOLD_EVIDENCE', 'NONE');

  IF offending_count > 0 THEN
    RAISE EXCEPTION
      'GK-241 rollback refused: % real buyer_decision_event row(s) carry a market_standing value (FALLBACK_ONLY/NO_SOLD_EVIDENCE/NONE) the old, narrower CHECK constraint would reject. Reinstating it would either fail outright or invalidate truthful historical data — neither is acceptable. Resolve manually; do not force this rollback.',
      offending_count;
  END IF;
END $$;

ALTER TABLE buyer_decision_event DROP CONSTRAINT IF EXISTS buyer_decision_event_market_standing_check;

ALTER TABLE buyer_decision_event ADD CONSTRAINT buyer_decision_event_market_standing_check
  CHECK (market_standing IS NULL OR market_standing IN ('EXACT_CURRENT', 'EXACT_STALE', 'SIMILAR_ONLY'));
