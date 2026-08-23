-- =====================================================================
-- 0007 -- CAPTURE-INT: collectionItemId -> gkAssetId linkage (NEW, additive)
-- =====================================================================
-- Zero lines touched in 0001-0006 -- per the standing "never modify
-- historical migrations" rule (Summit Phase 1 amendment A5). Applied to
-- data1_dev for real (Task 3's staging proof requires it), same
-- discipline 0005 (DATA-1B idempotency_key) already established: report
-- the DDL, then apply it, never an inline alteration of an earlier file.
--
-- Full rationale: docs/adr/DATA-1-CAPTURE-INTEGRATION.md, Task 1a.
-- Formalizes GK-145's own correlation field (collectionItemId, threaded
-- from the Collection's IndexedDB item.id into scanLog) into a durable
-- lookup edge. THE LAW, restated here exactly as GK-145 and this
-- dispatch both state it: collectionItemId != gkAssetId. This table is
-- a ROUTING lookup only -- "which asset does a re-scan of this
-- collection row attach to" -- never a claim about physical identity.
-- Identity itself is established solely through asset_identity_
-- assignment (evidence-based, ADR-EVIDENCE-001), completely independent
-- of this table.
-- =====================================================================

SET search_path TO data1_dev;

CREATE TABLE IF NOT EXISTS collection_item_link (
  collection_item_id       TEXT PRIMARY KEY,        -- the app's own IndexedDB item.id, verbatim
  gk_asset_id                UUID NOT NULL REFERENCES gk_asset(id),
  linked_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_by_principal_id          UUID NOT NULL REFERENCES gk_principal(id)
);
CREATE INDEX IF NOT EXISTS collection_item_link_asset_idx ON collection_item_link (gk_asset_id);

-- No supersession/history mechanism on this table by design: a given
-- collectionItemId points at exactly one gkAssetId for its whole life in
-- this v1 (the service layer's linkCollectionItem throws ConflictError
-- rather than silently relinking -- see docs/adr/
-- DATA-1-CAPTURE-INTEGRATION.md, Task 1a, for the one open question this
-- leaves: what happens if an operator genuinely needs to re-point a
-- collection row at a different physical asset (e.g. a data-entry
-- mistake) -- not solved here, named as a future item).
