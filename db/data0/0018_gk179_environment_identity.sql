-- =====================================================================
-- 0018 -- GK-179: database-resident environment identity (PROPOSED,
-- NOT APPLIED to data1_dev, Development, Preview, or Production)
-- =====================================================================
-- Infrastructure primitive, not a domain table: answers "which database
-- is this" for a pre-query guard (acquireConnection()) to assert against
-- BEFORE any ordinary query executes -- the mechanism GK-179's V3.0/V3
-- cross-wiring proof depends on. Deliberately excluded from every D2/D3
-- durable contract, content-hash/dedup surface, domain_event/outbox
-- flow, and D5 reconstruction expectation (state brief, "Environment
-- identity object is infrastructure, not domain") -- it records nothing
-- about a physical asset or a market fact, only which physical database
-- a connection has landed on.
--
-- Value provenance (A16/GK-179 requirement): the one row is inserted
-- EXPLICITLY, per branch, at provisioning time -- never derived from, or
-- defaulted to, an application environment variable. A wrong or absent
-- row means the guard fails closed, not that it falls back to reading
-- process.env.
--
-- SHAPE: reused verbatim from Book Forge's own `environment_marker`
-- table (bookforge database, inspected read-only via the GK-179
-- pre-separation dump `bookforge-pre-separation.sql`, never queried or
-- modified live) -- `id boolean` fixed-true primary key + a same-column
-- CHECK, already solving this exact singleton problem for a separate
-- application on this same Neon project. Reused because it already
-- fits; the only additions are a stricter three-value CHECK on the
-- identity column itself (Book Forge's is free text) and a `created_at`
-- audit column -- both additive, neither weakens the reused pattern.
--
-- SINGLETON ENFORCEMENT (structural, not developer discipline): `id` is
-- a fixed-value BOOLEAN primary key. A second row can only ever attempt
-- id=TRUE (rejected by the PRIMARY KEY's own uniqueness, SQLSTATE 23505,
-- constraint `environment_marker_pkey`) or id=FALSE (rejected by the
-- CHECK below, SQLSTATE 23514, constraint `environment_marker_single_row`)
-- -- a BOOLEAN column has no third value. Zero rows (before provisioning)
-- or exactly one row are the only two states this table can ever be in.
-- =====================================================================

SET search_path TO data1_dev;

CREATE TABLE environment_marker (
  id          BOOLEAN PRIMARY KEY DEFAULT TRUE,
  app_env     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT environment_marker_single_row CHECK (id),
  CONSTRAINT environment_marker_app_env_check CHECK (app_env IN ('development', 'preview', 'production'))
);

-- No INSERT here -- the one authoritative row is written per branch, with
-- that branch's own app_env value, as a distinct provisioning step AFTER
-- this migration applies (GK-179 ordered apply plan, Step 19). Baking a
-- value into this shared migration file would apply the SAME value to
-- every branch it runs against -- exactly the failure mode this table
-- exists to prevent.
