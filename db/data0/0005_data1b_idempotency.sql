-- =====================================================================
-- 0005 -- DATA-1B: generalized idempotency-key support (NEW, additive)
-- =====================================================================
-- Zero lines touched in 0001/0002/0003/0004 -- per the standing "never
-- modify historical migrations" rule (Summit Phase 1 amendment A5), same
-- discipline 0004's own header already restated. This file adds exactly
-- one new table and nothing else.
--
-- Full rationale: docs/adr/DATA-1B-ASSET-SERVICE-DESIGN.md, Section 3
-- ("Idempotency") and Section 6. entity_mint_basis (0003) already proves
-- "a UNIQUE constraint is the idempotency mechanism, not an
-- application-level check-then-insert race" for ONE operation (minting).
-- This table generalizes the same shape to every operation the Asset
-- Service (src/modules/assets/) names, since minting is the only
-- Section-2 operation with a natural dedup key of its own.
-- =====================================================================

SET search_path TO data1_dev;

CREATE TABLE IF NOT EXISTS idempotency_key (
  id                UUID PRIMARY KEY,                              -- uuidv7()
  operation         TEXT NOT NULL,                                 -- e.g. 'createPhysicalAsset', 'transferOwnership'
  idempotency_key   TEXT NOT NULL,                                 -- caller-supplied
  principal_id      UUID NOT NULL REFERENCES gk_principal(id),
  result_snapshot   JSONB NOT NULL,                                -- the original result, returned verbatim on replay
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idempotency_key_unique ON idempotency_key (operation, idempotency_key);
CREATE INDEX IF NOT EXISTS idempotency_key_principal_idx ON idempotency_key (principal_id);
