// src/modules/marketplace/repository.js — PRIVATE. Only service.js may
// import this file (enforced by tests/marketplace-module-boundary.test.js).
// All SQL lives here; service.js orchestrates, never issues SQL
// directly. Every query is schema-qualified (data1_dev.<table>) — GK-178's
// own pooled-connection lesson, never a bare `SET search_path`.
//
// Every function here works with the RAW row (including
// encrypted_refresh_credential) — it is service.js's job, never this
// file's, to strip that field before returning metadata to any caller
// outside the module. This file has no opinion about the secret-return
// boundary; it just reads and writes rows.

export async function assertPrincipalExists(client, principalId) {
  const r = await client.query('SELECT 1 FROM data1_dev.gk_principal WHERE id = $1', [principalId]);
  return r.rows.length > 0;
}

// getConnectionByPrincipalProvider — the ONE lookup predicate this
// module exposes for a principal's own connection: principal_id +
// provider, never connection id alone. Returns the row regardless of
// connection_status (CONNECTED/RECONNECT_REQUIRED/DISCONNECTED) — the
// caller decides what each status means for its purpose.
export async function getConnectionByPrincipalProvider(client, { principalId, provider }) {
  const r = await client.query(
    `SELECT * FROM data1_dev.marketplace_connection WHERE principal_id = $1 AND provider = $2`,
    [principalId, provider]
  );
  return r.rows[0] || null;
}

// getConnectionByProviderIdentity — the provider-identity collision check
// (governing dispatch, Section 6, corrected by the GK-263 invariant
// review). excludePrincipalId is always the CALLER's own principalId —
// this only ever looks for a DIFFERENT principal already holding a row
// for this exact provider account. Deliberately NOT scoped to
// CONNECTED/RECONNECT_REQUIRED only: a provider identity must remain
// bound to the GrailKey principal that first connected it EVEN AFTER
// that principal disconnects — Phase 1 has no account-transfer or
// release semantic, so a DISCONNECTED row still counts as "already
// claimed" for this check. Governing law: a marketplace provider
// identity may not silently migrate between GrailKey principals.
export async function getConnectionByProviderIdentity(client, { provider, providerUserId, excludePrincipalId }) {
  const r = await client.query(
    `SELECT * FROM data1_dev.marketplace_connection
     WHERE provider = $1 AND provider_user_id = $2
       AND principal_id <> $3
     LIMIT 1`,
    [provider, providerUserId, excludePrincipalId]
  );
  return r.rows[0] || null;
}

// getConnectionByProviderUserId — the REVERSE lookup
// getConnectionByProviderIdentity deliberately doesn't offer (that one
// always excludes a given principalId, for the connect-time collision
// check). This one has no exclusion: given a verified provider-side
// identity alone (e.g. an eBay Marketplace Account Deletion
// notification's own eiasToken), find whichever GrailKey principal, if
// any, currently owns it — regardless of connection_status, since a
// deletion notification must still resolve a principal to disconnect
// even if this module already marked the row RECONNECT_REQUIRED or
// DISCONNECTED earlier.
export async function getConnectionByProviderUserId(client, { provider, providerUserId }) {
  const r = await client.query(
    `SELECT * FROM data1_dev.marketplace_connection WHERE provider = $1 AND provider_user_id = $2 LIMIT 1`,
    [provider, providerUserId]
  );
  return r.rows[0] || null;
}

export async function insertConnection(client, {
  id, principalId, provider, providerUserId, connectionStatus, grantedScopes,
  encryptedRefreshCredential, credentialKeyVersion, connectedAt,
}) {
  await client.query(
    `INSERT INTO data1_dev.marketplace_connection
       (id, principal_id, provider, provider_user_id, connection_status, granted_scopes,
        encrypted_refresh_credential, credential_key_version, connected_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
    [id, principalId, provider, providerUserId, connectionStatus, grantedScopes,
     encryptedRefreshCredential, credentialKeyVersion ?? null, connectedAt ?? new Date()]
  );
}

// updateConnectionForReconnect — the SAME row is reused across the
// whole CONNECTED -> RECONNECT_REQUIRED -> DISCONNECTED -> CONNECTED-
// again lifecycle, never re-inserted (see the migration's own header
// for why). last_error is always cleared here — a fresh, successful
// (re)connect supersedes any prior recorded failure reason.
export async function updateConnectionForReconnect(client, {
  id, providerUserId, connectionStatus, grantedScopes, encryptedRefreshCredential,
  credentialKeyVersion, connectedAt,
}) {
  await client.query(
    `UPDATE data1_dev.marketplace_connection
     SET provider_user_id = $2, connection_status = $3, granted_scopes = $4,
         encrypted_refresh_credential = $5, credential_key_version = $6,
         connected_at = $7, updated_at = now(), last_error = NULL
     WHERE id = $1`,
    [id, providerUserId, connectionStatus, grantedScopes, encryptedRefreshCredential,
     credentialKeyVersion ?? null, connectedAt ?? new Date()]
  );
}

export async function markReconnectRequired(client, { id, reason }) {
  const r = await client.query(
    `UPDATE data1_dev.marketplace_connection
     SET connection_status = 'RECONNECT_REQUIRED', last_error = $2, updated_at = now()
     WHERE id = $1
     RETURNING id`,
    [id, reason ?? null]
  );
  return r.rows.length > 0;
}

// disconnectConnection — makes the credential unusable by GrailKey:
// status DISCONNECTED, encrypted_refresh_credential and
// credential_key_version both NULLed (the DB-layer CHECK constraint
// requires this pairing). No eBay revocation call — that belongs to a
// future OAuth phase, not this one.
export async function disconnectConnection(client, { id }) {
  const r = await client.query(
    `UPDATE data1_dev.marketplace_connection
     SET connection_status = 'DISCONNECTED', encrypted_refresh_credential = NULL,
         credential_key_version = NULL, last_error = NULL, updated_at = now()
     WHERE id = $1
     RETURNING id`,
    [id]
  );
  return r.rows.length > 0;
}
