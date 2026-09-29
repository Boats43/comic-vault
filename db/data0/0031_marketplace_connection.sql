-- =====================================================================
-- 0031 -- GK-263 Phase 1: the minimum durable, principal-owned
-- foundation for seller-user marketplace credentials (EBAY today).
-- Storage + ownership + encryption-envelope shape ONLY -- no OAuth
-- flow, no HTTP surface, no eBay call of any kind is introduced by this
-- migration or the module built on top of it (src/modules/marketplace/).
--
-- ONE row per (principal_id, provider), reused across the full
-- CONNECTED -> RECONNECT_REQUIRED -> DISCONNECTED -> CONNECTED-again
-- lifecycle (never re-inserted on reconnect) -- the smallest shape that
-- satisfies "one active connection per principal" without needing a
-- partial index for that constraint: there is only ever one row to be
-- active in the first place.
--
-- The provider-identity collision guard (governing dispatch, Section 6)
-- DOES need to be scoped to non-terminal states only, so a real eBay
-- account can be reconnected by a DIFFERENT GrailKey principal after a
-- genuine disconnect -- hence the partial unique index below, not a
-- plain one. This migration does not implement account-transfer
-- semantics; it simply does not permanently lock a real eBay account to
-- whichever GrailKey principal happened to connect it first, forever.
--
-- DB-layer state/credential consistency (governing amendment, does not
-- rely on caller discipline alone): CONNECTED requires a real
-- ciphertext; DISCONNECTED must have none. RECONNECT_REQUIRED is
-- intentionally unconstrained by this CHECK -- whether a stale
-- ciphertext is retained or cleared for that state is a service-layer
-- design choice, but the service layer (never this CHECK) is what
-- refuses to treat it as usable (resolveMarketplaceRefreshCredential).
--
-- credential_key_version is nullable and independent of
-- connection_status -- it names which server key encrypted the CURRENT
-- ciphertext, so a future key rotation can identify which rows still
-- need re-encryption under a new key without changing the envelope
-- format itself.
--
-- No existing kernel table is altered. Reversibility: one new, fully
-- independent table. Rollback (0031_marketplace_connection_rollback.sql)
-- drops it and nothing else.
-- =====================================================================

SET search_path TO data1_dev;

CREATE TABLE marketplace_connection (
  id                            UUID PRIMARY KEY,
  principal_id                  UUID NOT NULL REFERENCES gk_principal(id),
  provider                      TEXT NOT NULL CHECK (provider IN ('EBAY')),
  provider_user_id              TEXT NOT NULL,
  connection_status             TEXT NOT NULL CHECK (connection_status IN ('CONNECTED', 'RECONNECT_REQUIRED', 'DISCONNECTED')),
  granted_scopes                TEXT[] NOT NULL DEFAULT '{}',
  encrypted_refresh_credential  TEXT,     -- versioned AES-256-GCM envelope (src/modules/marketplace/crypto.js); NULL when no usable credential is stored
  credential_key_version        INT,      -- which server key encrypted the current ciphertext; NULL when no ciphertext stored
  connected_at                  TIMESTAMPTZ,
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error                    TEXT,

  CONSTRAINT marketplace_connection_status_credential_chk CHECK (
    (connection_status = 'CONNECTED' AND encrypted_refresh_credential IS NOT NULL)
    OR (connection_status = 'DISCONNECTED' AND encrypted_refresh_credential IS NULL)
    OR (connection_status = 'RECONNECT_REQUIRED')
  ),

  CONSTRAINT marketplace_connection_principal_provider_uk UNIQUE (principal_id, provider)
);

CREATE UNIQUE INDEX marketplace_connection_provider_identity_active_uidx
  ON marketplace_connection (provider, provider_user_id)
  WHERE connection_status IN ('CONNECTED', 'RECONNECT_REQUIRED');

CREATE INDEX ON marketplace_connection (principal_id);
