-- =====================================================================
-- 0033 -- GK-276: valuation_event.provenance (additive, server-controlled)
-- =====================================================================
-- DURABLE ECONOMIC PROVENANCE IS PART OF ECONOMIC AUTHORITY.
--
-- valuation_event.method ('engine-computed' etc.) is a writer-supplied
-- label, not proof of who computed the number: the capture path stamped
-- every client-supplied price 'engine-computed'. This column names the
-- WRITER CLASS, set only by server code:
--
--   SERVER_DERIVED     the server's own economic engine computed it
--   OPERATOR_OVERRIDE  a governed operator valuation
--   CLIENT_ASSERTED    the value was supplied by a client (provable legacy rows only)
--   LEGACY_UNKNOWN     origin cannot be established
--
-- Provenance outranks the legacy `method` string. Nothing is inferred:
-- a row is classified only when its origin is deterministic from durable
-- evidence (the idempotency key shape / an explicit override marker).
-- Everything else is LEGACY_UNKNOWN.
--
-- ORDER (hard dependency): add column -> backfill -> constrain. The
-- UPDATE/DELETE-blocking triggers (0034) MUST be installed only after
-- this backfill is complete and verified in the target environment.
-- Re-runnable: the backfill touches only rows whose provenance IS NULL.
-- =====================================================================

SET search_path TO data1_dev;

ALTER TABLE valuation_event ADD COLUMN IF NOT EXISTS provenance TEXT;

-- (1) Governed operator overrides: the explicit method marker, or the one
--     known manual-correction idempotency key (GK-226, Old Man Logan #25).
UPDATE valuation_event v
   SET provenance = 'OPERATOR_OVERRIDE'
 WHERE v.provenance IS NULL
   AND (
     v.method = 'operator-override'
     OR EXISTS (
       SELECT 1 FROM idempotency_key i
        WHERE i.operation = 'recordValuation'
          AND i.result_snapshot ->> 'valuationEventId' = v.id::text
          AND i.idempotency_key LIKE 'gk226-%valuation-correction%'
     )
   );

-- (2) Capture-writer rows: the capture service is the ONLY writer that
--     claims its valuation idempotency key as `<captureKey>:valuation`, and
--     it fed that valuation from the client-supplied scanPayload.outcome.price.
UPDATE valuation_event v
   SET provenance = 'CLIENT_ASSERTED'
 WHERE v.provenance IS NULL
   AND EXISTS (
     SELECT 1 FROM idempotency_key i
      WHERE i.operation = 'recordValuation'
        AND i.result_snapshot ->> 'valuationEventId' = v.id::text
        AND i.idempotency_key LIKE '%:valuation'
   );

-- (3) Everything not provable stays unknown.
UPDATE valuation_event SET provenance = 'LEGACY_UNKNOWN' WHERE provenance IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'valuation_event_provenance_check' AND conrelid = 'valuation_event'::regclass
  ) THEN
    ALTER TABLE valuation_event ADD CONSTRAINT valuation_event_provenance_check
      CHECK (provenance = ANY (ARRAY['SERVER_DERIVED', 'OPERATOR_OVERRIDE', 'CLIENT_ASSERTED', 'LEGACY_UNKNOWN']));
  END IF;
END $$;

-- No DEFAULT on purpose: every writer must name itself explicitly.
ALTER TABLE valuation_event ALTER COLUMN provenance SET NOT NULL;
