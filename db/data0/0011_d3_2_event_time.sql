-- =====================================================================
-- 0011 -- D3.2: true event time (PROPOSED, NOT APPLIED to data1_dev)
-- =====================================================================
-- STATUS: proposed by this dispatch, NOT yet run against any database.
-- Per the standing "never modify historical migrations" rule (Summit
-- Phase 1 amendment A5), this is a NEW additive file -- 0001 through
-- 0010 are untouched. Applying this migration to live data1_dev
-- requires explicit authorization -- see the D3.2 Standing Report for
-- why it was not applied this pass (an isolated scratch schema, created
-- and dropped within this same dispatch, was used for real DB proof
-- instead; data1_dev itself was never touched).
--
-- CONTRACT (GrailKey Physical Asset Protocol v1, Foundation Law 3):
--   recorded_at = GrailKey persistence/ingestion time (when this row was
--     actually written). This is what EVERY existing occurred_at/
--     captured_at/assigned_at column in the 7 tables below has ALWAYS
--     actually meant in practice -- audited directly against every
--     writer in src/modules/assets/repository.js (before this dispatch's
--     own edit) and confirmed uniform: not one writer, for any of these
--     7 tables, has ever supplied a value for the existing timestamp
--     column -- every single INSERT omits it and relies exclusively on
--     the column's own DEFAULT now(). Readers (repository.js's
--     getAssetGraph) use it only for chronological ORDER BY, never with
--     occurrence-specific interpretation. This audit finding is recorded
--     in full in the D3.2 Standing Report and in each table's own
--     comment below -- it is a verified FACT for these 7 tables
--     specifically, not generalized from one table to the rest (each
--     was checked individually).
--   occurred_at = asserted real-world occurrence time, independently
--     persisted, NEVER inferred from recorded_at and NEVER defaulted to
--     "now" by application code. NULL is a legal, durable, permanent
--     state meaning "historical occurrence is UNKNOWN" -- never treated
--     as corruption or migration debt, never backfilled from
--     recorded_at merely to populate the column (D3 Amendment A2).
--
-- FORBIDDEN, per explicit ruling: no CHECK (occurred_at <= recorded_at)
-- or equivalent constraint anywhere below. Backdated events are legal.
-- occurred_at > recorded_at is also structurally legal (imported
-- historical evidence, corrected timestamps, delayed ingestion, clock
-- skew, future-dated assertions later reconciled -- chronological
-- inconsistency is evidence for later review, never schema invalidity).
--
-- SCOPE, deliberately bounded to the 7 tables where a genuine real-world-
-- occurrence-vs-recording distinction is meaningful (durable evidence/
-- decision surfaces of the existing asset kernel). Explicitly OUT of
-- scope, with reasoning (not oversight):
--   - entity_mint_basis.created_at / mint_event.occurred_at (0003) --
--     minting IS the event; there is no real-world occurrence separate
--     from the act of recording a mint decision. Renaming would imply a
--     distinction that doesn't exist for this table's own semantics.
--   - collection_item_link.linked_at (0007) -- a pure routing edge
--     ("which asset does this collection row attach to"), not a domain
--     event with its own asserted occurrence time; the link's creation
--     IS the fact being recorded.
--   - outbox.created_at/processed_at (0004) -- dispatch-queue mechanics,
--     already honestly named for what they are (queue timing, not a
--     domain event's real-world occurrence).
--   - gk_asset.created_at / gk_principal.created_at / gk_organization.
--     created_at (0004) -- entity-row creation metadata, not `_event`
--     tables; out of the "durable event table" scope this dispatch
--     covers.
--   - custody_event, condition_observation, gk_organization, gk_membership
--     (0004) -- NOT LIVE (confirmed absent from data1_dev, D2.1). The
--     same pattern applies whenever any of these is eventually applied,
--     but no DDL is written here for a table that doesn't exist yet.
--
-- REVERSIBILITY -- every statement below is reversible without data
-- loss: each RENAME COLUMN has a trivial inverse RENAME COLUMN back; each
-- ADD COLUMN (nullable, no default) has a trivial inverse DROP COLUMN
-- (dropping a column that, by construction, has never been written to
-- by any code this dispatch shipped until this migration is actually
-- applied and paired code deployed).
-- =====================================================================

SET search_path TO data1_dev;

-- ownership_event: existing occurred_at has always meant "when this
-- ownership_event row was persisted" (repository.js's insertOwnershipEvent
-- omits it from every INSERT; DEFAULT now() is the sole source). Rename
-- to recorded_at (meaning unchanged, name now honest); add a new,
-- nullable occurred_at for a caller-asserted transfer/mint date.
ALTER TABLE ownership_event RENAME COLUMN occurred_at TO recorded_at;
ALTER TABLE ownership_event ADD COLUMN occurred_at TIMESTAMPTZ;

-- acquisition_event: same pattern -- insertAcquisitionEvent has never
-- supplied occurred_at; it is recording time today.
ALTER TABLE acquisition_event RENAME COLUMN occurred_at TO recorded_at;
ALTER TABLE acquisition_event ADD COLUMN occurred_at TIMESTAMPTZ;

-- valuation_event: same pattern -- insertValuationEvent has never
-- supplied occurred_at; it is recording time today.
ALTER TABLE valuation_event RENAME COLUMN occurred_at TO recorded_at;
ALTER TABLE valuation_event ADD COLUMN occurred_at TIMESTAMPTZ;

-- decision_event: same pattern -- insertDecisionEvent has never
-- supplied occurred_at; it is recording time today.
ALTER TABLE decision_event RENAME COLUMN occurred_at TO recorded_at;
ALTER TABLE decision_event ADD COLUMN occurred_at TIMESTAMPTZ;

-- domain_event: same pattern -- writeDomainEvent has never supplied
-- occurred_at; it is recording time today (and is what every other
-- operation's own domain_event row already inherits by omission).
ALTER TABLE domain_event RENAME COLUMN occurred_at TO recorded_at;
ALTER TABLE domain_event ADD COLUMN occurred_at TIMESTAMPTZ;

-- media: captured_at is misleadingly named -- insertMedia has never
-- supplied it either; it has always been recording (upload/attach) time,
-- not the real-world moment a photo was actually taken. Rename to
-- recorded_at; add occurred_at for a genuinely known capture time.
ALTER TABLE media RENAME COLUMN captured_at TO recorded_at;
ALTER TABLE media ADD COLUMN occurred_at TIMESTAMPTZ;

-- asset_identity_assignment: assigned_at is, likewise, recording time
-- today -- insertIdentityAssignment has never supplied it. Rename to
-- recorded_at; add occurred_at for a genuinely known evidence-observed
-- time, distinct from when the assignment row was written.
ALTER TABLE asset_identity_assignment RENAME COLUMN assigned_at TO recorded_at;
ALTER TABLE asset_identity_assignment ADD COLUMN occurred_at TIMESTAMPTZ;

-- No index added on occurred_at in this pass -- ORDER BY / range queries
-- against it are not yet a real access pattern (nothing populates it
-- until paired code ships); adding one speculatively is deferred, not
-- forgotten.
