-- =====================================================================
-- 0022 -- BETA-1A: Clerk external-identity mapping (PROPOSED, NOT APPLIED)
-- =====================================================================
-- One new, fully independent table. No existing table altered, per the
-- standing "never modify historical migrations" rule. Not applied to
-- data1_dev by this pass -- design + code only, per this dispatch's own
-- "do NOT provision public users yet" boundary. A live-apply gate (real
-- scratch-schema proof, then real apply) is a separate, later,
-- explicitly-authorized step, matching the D4/D5B/D5C/D5D precedent
-- (docs/D5B-0015-DESIGN-REPORT.md, docs/D5C-MARKET-POPULATION-DESIGN-REPORT.md)
-- rather than a migration written straight to a live schema.
--
-- Purpose: map a verified external-identity-provider subject (Clerk's
-- own user ID today; provider column leaves room for a second provider
-- later without a shape change) to EXACTLY ONE existing gk_principal
-- row. This is an IDENTITY adapter, not a tenant/organization/Vault
-- table -- it introduces no new authorization concept. Authorization
-- continues to run exactly where it already does: verifyToken()'s
-- principalId, unchanged, downstream of this table.
--
-- Provisioning: a row here is created the SAME way principal_credential
-- rows are (0008's own precedent) -- an offline, one-off local script,
-- never a public self-serve endpoint. This migration does not seed any
-- row. An unrecognized external_subject at login time is NotProvisionedError
-- (identical shape/status to an unrecognized passphrase today) -- it
-- NEVER falls through to "use the one existing operator principal
-- anyway."
--
-- UNIQUE(provider, external_subject) is the whole safety property this
-- table exists to provide: one verified external subject maps to at
-- most one principal, and a given principal can be reached via more
-- than one external identity (e.g. passphrase AND Clerk, both mapping
-- to the same operator row) without ever letting two different
-- external subjects silently collide onto the same row by accident
-- (the constraint would reject a second INSERT attempting that).
--
-- REVERSIBILITY: one new table, one new index. Rollback drops both and
-- nothing else -- no existing auth path is touched.
-- =====================================================================

SET search_path TO data1_dev;

CREATE TABLE principal_external_identity (
  id                 UUID PRIMARY KEY,
  principal_id       UUID NOT NULL REFERENCES gk_principal(id),
  provider           TEXT NOT NULL CHECK (provider IN ('clerk')),
  external_subject   TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, external_subject)
);
CREATE INDEX ON principal_external_identity (principal_id);
