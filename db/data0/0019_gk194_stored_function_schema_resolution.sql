-- =====================================================================
-- 0019 -- GK-194: stored function schema resolution (function-level
-- search_path pin), CODIFYING an already-live Development state.
-- =====================================================================
-- GK-179 consumed migration number 0018 (environment_marker) before this
-- ticket's own artifact was ever committed -- renumbered from the
-- originally-described 0018_gk194_... to 0019 for that reason alone; no
-- other change from the original GK-194 design.
--
-- PROBLEM (docs/TICKET-REGISTRY.md, "GK-194"): both trigger guard
-- functions below have a bare, unqualified relation reference in their
-- own cycle-guard SELECT and no function-level search_path pin
-- (proconfig = NULL). Under a session whose search_path excludes
-- data1_dev (the default for a plain pooled connection, GK-178), the
-- guard throws 42P01 regardless of whether the CALLER's own query was
-- already correctly schema-qualified -- GK-178 fixed caller-side queries
-- only, never these migration-defined function bodies, a separate code
-- surface.
--
-- FIX: a pure function-CONFIGURATION change -- ALTER FUNCTION ... SET
-- search_path, never CREATE OR REPLACE FUNCTION, never a body rewrite.
-- Semantic non-change is mechanically provable via byte-exact `prosrc`
-- before and after (proven in scratch, see
-- tests/gk194-stored-function-resolution-scratch.test.js).
--
-- SCHEMA NAME: `data1_dev` remains the correct literal pin -- GK-179
-- closed with the schema name kept invariant across all three isolated
-- branches (same name, different physical branch = different physical
-- target already), so this file's `data1_dev` reference needs no
-- environment-derived replacement (GK-179's own R3/B9 rulings, now
-- resolved rather than merely deferred).
--
-- IDEMPOTENT BY CONSTRUCTION: `ALTER FUNCTION ... SET search_path TO X`
-- is idempotent by nature -- re-applying it against a function that
-- already carries that exact pin produces the identical proconfig again,
-- no error, no duplicate entry. Proven in scratch: apply, apply again,
-- assert no change and no error (tests/gk194-stored-function-resolution-
-- scratch.test.js, idempotent-reapply section). This is what makes the
-- Development question in this ticket's own §6 answerable by the
-- artifact itself rather than by judgment -- applying 0019 to a target
-- already in the post-fix state is a verified no-op, not a live-state
-- risk requiring a separate decision each time.
--
-- CANONICAL FORM: `pg_catalog, data1_dev` (matches the exact live
-- Development value, byte-for-byte, confirmed directly against
-- pg_proc.proconfig before this file was authored -- not assumed).
-- =====================================================================

ALTER FUNCTION data1_dev.asset_identifier_assertion_guard()
  SET search_path TO pg_catalog, data1_dev;

ALTER FUNCTION data1_dev.asset_identity_assignment_guard()
  SET search_path TO pg_catalog, data1_dev;
