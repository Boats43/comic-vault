-- =====================================================================
-- 0008 -- DATA-1D: principal credential storage (NEW, additive)
-- =====================================================================
-- Zero lines touched in 0001-0007 -- per the standing "never modify
-- historical migrations" rule. Applied to data1_dev for real (Task 4's
-- staging/cross-device proof requires real login).
--
-- Full rationale: docs/adr/DATA-1D-AUTH-CROSS-DEVICE.md, T1. One row per
-- principal that has a real login credential -- in this single-operator
-- era, exactly one row (Jimmy). Registration (self-serve credential
-- creation) is explicitly NOT built -- see the design doc's own "what is
-- NOT built" section; a credential is provisioned by a one-off local
-- script (C:\grailkey-data\data-1\set-operator-credential.mjs), never a
-- public endpoint.
-- =====================================================================

SET search_path TO data1_dev;

CREATE TABLE IF NOT EXISTS principal_credential (
  principal_id       UUID PRIMARY KEY REFERENCES gk_principal(id),
  credential_hash      TEXT NOT NULL,   -- scrypt(passphrase, salt), hex
  credential_salt        TEXT NOT NULL, -- random, per-credential, hex
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No credential history/rotation table in v1 -- upsertCredential
-- (src/modules/auth/repository.js) overwrites in place. Rotation is
-- named, not built -- see the design doc.
